import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_DB_PATH = join(homedir(), '.codex', 'logs_2.sqlite');

export async function dbExists(dbPath = DEFAULT_DB_PATH) {
  try {
    await access(dbPath);
    return true;
  } catch {
    return false;
  }
}

async function queryJson(dbPath, sql) {
  const { stdout } = await execFileAsync(
    'sqlite3',
    ['-json', dbPath, sql],
    { maxBuffer: 100 * 1024 * 1024 }
  );
  if (!stdout.trim()) return [];
  return JSON.parse(stdout);
}

// Extract thread_id from body text (e.g. "thread 019e5073-... has no subscribers")
function extractThreadIdFromBody(body) {
  const m = body?.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/);
  return m?.[1] ?? null;
}

// Unescape Rust Debug string literals (\n, \t, \r, \\, \")
function unescapeRust(s) {
  return s.replace(/\\(n|t|r|\\|")/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"' }[c]));
}

function extractModel(body) {
  const m = body?.match(/\bmodel=([^\s},]+)/);
  return m?.[1] ?? null;
}

function extractCwd(body) {
  // From OTEL span attribute: cwd=/path
  const spanM = body?.match(/\bcwd=([^\s},]+)/);
  if (spanM) return spanM[1];
  // From UserInputWithTurnContext struct: cwd: Some("/path")
  const structM = body?.match(/\bcwd: Some\("([^"]+)"\)/);
  return structM?.[1] ?? null;
}

function extractUserMessage(body) {
  // Match Text { text: "...", or Text { text: "..."  }
  const m = body?.match(/Text \{ text: "((?:[^"\\]|\\.)*)"/s);
  return m ? unescapeRust(m[1]).trim() : null;
}

// Extract per-turn billed usage and model from response.completed WebSocket event
function extractResponseUsage(body) {
  if (!body?.includes('"type":"response.completed"')) return null;
  try {
    const start = body.indexOf('{"type":"response.completed"');
    if (start === -1) return null;
    const data = JSON.parse(body.slice(start));
    const u = data?.response?.usage;
    if (!u) return null;
    return {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cached_tokens: u.input_tokens_details?.cached_tokens ?? 0,
      model: data?.response?.model ?? null,
    };
  } catch {
    return null;
  }
}

function extractAssistantMessage(body) {
  // codex_core::stream_events_utils logs final assistant messages as Rust Debug:
  // handle_output_item_done: Output item item=Message { ... content: [OutputText { text: "..." }], phase: Some(FinalAnswer) }
  if (!body?.includes('handle_output_item_done:')) return null;
  if (!body.includes('FinalAnswer')) return null;
  const m = body.match(/OutputText \{ text: "((?:[^"\\]|\\.)*)" \}/s);
  return m ? unescapeRust(m[1]).trim() : null;
}

/**
 * Read completed Codex Desktop sessions from the SQLite log database.
 * A session is "complete" when Codex logs a thread shutdown event.
 *
 * Returns { maxId, sessions } where maxId is the highest log row id seen
 * and sessions is an array of completed session objects.
 */
export async function readNewSessions(sinceId = 0, dbPath = DEFAULT_DB_PATH) {
  if (!(await dbExists(dbPath))) {
    return { maxId: sinceId, sessions: [] };
  }

  const rows = await queryJson(dbPath, `
    SELECT id, ts, thread_id, target, feedback_log_body
    FROM logs
    WHERE id > ${sinceId}
      AND (
        thread_id IS NOT NULL
        OR (target = 'codex_app_server::request_processors::thread_lifecycle'
            AND feedback_log_body LIKE '%has no subscribers and is idle%')
      )
    ORDER BY id ASC
  `);

  const threads = new Map();
  let maxId = sinceId;
  let lastActiveThread = null; // tracks which thread is currently executing a turn

  for (const row of rows) {
    const { id, ts, target, feedback_log_body: body } = row;
    if (id > maxId) maxId = id;

    // For lifecycle shutdown rows, thread_id is NULL — extract from body text.
    // For assistant message rows, thread_id is also NULL — use lastActiveThread.
    let thread_id = row.thread_id;
    if (!thread_id) {
      if (
        target === 'codex_app_server::request_processors::thread_lifecycle' ||
        (target === 'log' && body?.includes('response.output_item.done'))
      ) {
        thread_id = extractThreadIdFromBody(body) ?? lastActiveThread;
      }
    }
    if (!thread_id) continue;

    if (!threads.has(thread_id)) {
      threads.set(thread_id, {
        thread_id,
        started_ts: ts,
        ended_ts: ts,
        model: null,
        cwd: null,
        total_tokens: 0,
        // Exact billed token sums from response.completed events
        billed_input: 0,
        billed_output: 0,
        billed_cached: 0,
        is_complete: false,
        user_messages: [],
        assistant_messages: [],
      });
    }

    const t = threads.get(thread_id);
    if (ts > t.ended_ts) t.ended_ts = ts;

    // Session end: thread becomes idle
    if (
      target === 'codex_app_server::request_processors::thread_lifecycle' &&
      body?.includes('has no subscribers and is idle')
    ) {
      t.is_complete = true;
    }

    // Exact billed usage from response.completed WebSocket events (per turn)
    if (target === 'codex_api::endpoint::responses_websocket') {
      const u = extractResponseUsage(body);
      if (u) {
        t.billed_input  += u.input_tokens;
        t.billed_output += u.output_tokens;
        t.billed_cached += u.cached_tokens;
        if (!t.model && u.model) t.model = u.model;
      }
    }

    // Fallback: cumulative context window size from session::turn (used only if no response.completed data)
    if (target === 'codex_core::session::turn') lastActiveThread = thread_id;
    if (target === 'codex_core::session::turn' && body?.includes('total_usage_tokens=')) {
      const m = body.match(/total_usage_tokens=(\d+)/);
      if (m) {
        const tokens = parseInt(m[1], 10);
        if (tokens > t.total_tokens) t.total_tokens = tokens;
      }
      if (!t.model) t.model = extractModel(body);
      if (!t.cwd) t.cwd = extractCwd(body);
    }

    // User messages
    if (target === 'codex_core::session::handlers' && body?.includes('UserInput')) {
      if (!t.cwd) t.cwd = extractCwd(body);
      const text = extractUserMessage(body);
      if (text) t.user_messages.push(text);
    }

    // Assistant text messages — logged as Rust Debug in stream_events_utils
    if (target === 'codex_core::stream_events_utils' && body?.includes('handle_output_item_done:')) {
      const text = extractAssistantMessage(body);
      if (text) t.assistant_messages.push(text);
    }
  }

  return {
    maxId,
    sessions: [...threads.values()].filter(s => s.is_complete),
  };
}
