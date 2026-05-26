import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readNewSessions } from './adapters/codex-desktop.mjs';
import { EventWriter } from './event-writer.mjs';
import { countPatchFiles, getGitDiff, getGitSnapshot } from './git.mjs';
import { regenerateReport } from './report.mjs';
import { ensureDir, writeJson } from './util.mjs';

const STATE_PATH = join(homedir(), '.tokentrace', 'codex-watch-state.json');
const RUNS_ROOT = join(homedir(), '.tokentrace', 'runs');

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return { lastId: 0, recorded: [] };
  }
}

async function saveState(state) {
  await ensureDir(join(homedir(), '.tokentrace'));
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Process all completed Codex Desktop sessions that haven't been recorded yet.
 * Reads from ~/.codex/logs_2.sqlite, writes run artifacts to ~/.tokentrace/runs/.
 * Returns the number of new sessions recorded.
 */
export async function watchOnce({ verbose = false } = {}) {
  const state = await readState();
  const { maxId, sessions } = await readNewSessions(state.lastId);

  const recorded = new Set(state.recorded ?? []);
  let newCount = 0;

  for (const session of sessions) {
    if (recorded.has(session.thread_id)) continue;
    await recordCodexDesktopSession(session);
    recorded.add(session.thread_id);
    newCount++;
    if (verbose) {
      process.stderr.write(`[tt] Recorded Codex Desktop session: ${session.thread_id}\n`);
    }
  }

  // Keep last 2000 IDs to prevent unbounded growth
  const recordedArr = [...recorded].slice(-2000);
  await saveState({ lastId: maxId, recorded: recordedArr });

  return newCount;
}

async function recordCodexDesktopSession(session) {
  const runId = session.thread_id;
  const runDir = join(RUNS_ROOT, runId);
  await ensureDir(runDir);

  const cwd = session.cwd ?? homedir();
  const startedAt = new Date(session.started_ts * 1000).toISOString();
  const completedAt = new Date(session.ended_ts * 1000).toISOString();
  const durationMs = (session.ended_ts - session.started_ts) * 1000;

  const [gitAfter, patch] = await Promise.all([
    getGitSnapshot(cwd).catch(() => null),
    getGitDiff(cwd).catch(() => ''),
  ]);

  // Use exact billed tokens from response.completed events when available,
  // fall back to context window size only if no API response data was captured.
  const hasBilledData = session.billed_input > 0 || session.billed_output > 0;
  const usage = (hasBilledData || session.total_tokens > 0) ? {
    input_tokens:       hasBilledData ? session.billed_input  : null,
    output_tokens:      hasBilledData ? session.billed_output : null,
    cache_read_tokens:  hasBilledData ? session.billed_cached : null,
    total_tokens:       session.total_tokens > 0 ? session.total_tokens : null,
    cost_usd: null,
  } : null;

  const transcript = buildTranscript(session.user_messages, session.assistant_messages);

  const run = {
    id: runId,
    schema_version: 1,
    command: ['codex'],
    cwd,
    agent: 'codex',
    source: 'codex-desktop',
    label: null,
    description: session.user_messages[0]?.slice(0, 160) ?? null,
    model: session.model,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    exit_code: 0,
    success: true,
    git: { after: gitAfter },
    usage,
    session: { session_id: runId },
    tools: { command_count: 0, commands: [] },
    diff: { files_changed: countPatchFiles(patch) },
    artifacts: {
      events: 'events.jsonl',
      transcript: 'transcript.txt',
      diff: 'diff.patch',
      summary: 'summary.md',
      report: 'report.html',
    },
  };

  const writer = new EventWriter(join(runDir, 'events.jsonl'));
  await writer.write('run.started', { id: runId, source: 'codex-desktop', cwd });
  if (usage) await writer.write('usage.tokens', usage);
  await writer.write('run.completed', { source: 'codex-desktop' });
  await writer.close();

  await writeFile(join(runDir, 'transcript.txt'), transcript);
  await writeFile(join(runDir, 'diff.patch'), patch);
  await writeJson(join(runDir, 'run.json'), run);
  await regenerateReport(runDir);
}

function buildTranscript(userMsgs, assistantMsgs) {
  const lines = [];
  const len = Math.max(userMsgs.length, assistantMsgs.length);
  for (let i = 0; i < len; i++) {
    if (i < userMsgs.length) lines.push(`[user]\n${userMsgs[i]}\n`);
    if (i < assistantMsgs.length) lines.push(`[assistant]\n${assistantMsgs[i]}\n`);
  }
  return lines.join('\n');
}
