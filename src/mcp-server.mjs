import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readJson } from './util.mjs';

const RUNS_DIR = join(homedir(), '.afr', 'runs');

const TOOLS = [
  {
    name: 'list_sessions',
    description:
      'List recorded agent sessions, newest first. Returns id, date, agent, token count, cost, files changed, and exit status for each session.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max sessions to return (default 20)',
        },
        since: {
          type: 'string',
          description: 'ISO date string — only return sessions on or after this date',
        },
      },
    },
  },
  {
    name: 'get_session',
    description:
      'Get full details for a session: metadata, token usage, files changed, warnings, and the human-readable transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID from list_sessions' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'get_diff',
    description: 'Get the git diff (patch) captured at the end of a session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID from list_sessions' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'get_token_usage',
    description:
      'Aggregate token usage and cost across sessions. Returns totals plus a per-session breakdown.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'ISO date string — only count sessions on or after this date',
        },
        until: {
          type: 'string',
          description: 'ISO date string — only count sessions on or before this date',
        },
      },
    },
  },
];

async function loadRuns(runsDir = RUNS_DIR) {
  let names;
  try {
    names = await readdir(runsDir);
  } catch {
    return [];
  }
  const runs = [];
  for (const name of names.sort().reverse()) {
    try {
      runs.push(await readJson(join(runsDir, name, 'run.json')));
    } catch {
      // skip incomplete
    }
  }
  return runs;
}

function runSummary(run) {
  return {
    id: run.id,
    date: run.completed_at ?? run.started_at ?? null,
    agent: run.agent ?? 'unknown',
    exit_code: run.exit_code ?? null,
    status: run.exit_code === 0 ? 'ok' : `exit ${run.exit_code}`,
    tokens: run.usage?.total_tokens ?? null,
    cost_usd: run.usage?.cost_usd ?? null,
    files_changed: run.diff?.files_changed ?? 0,
    cwd: run.cwd ?? null,
  };
}

function filterByDate(runs, since, until) {
  return runs.filter((r) => {
    const ts = r.completed_at ?? r.started_at;
    if (!ts) return true;
    if (since && ts < since) return false;
    if (until && ts > until) return false;
    return true;
  });
}

async function handleListSessions({ limit = 20, since } = {}) {
  let runs = await loadRuns();
  if (since) runs = filterByDate(runs, since, null);
  runs = runs.slice(0, limit);
  return runs.map(runSummary);
}

async function handleGetSession({ session_id }) {
  const runDir = join(RUNS_DIR, session_id);
  let run;
  try {
    run = await readJson(join(runDir, 'run.json'));
  } catch {
    return { error: `Session not found: ${session_id}` };
  }

  let transcript = '';
  try {
    transcript = await readFile(join(runDir, 'transcript.txt'), 'utf8');
  } catch {
    // optional
  }

  const { buildRunWarnings } = await import('./analysis.mjs');
  const warnings = buildRunWarnings(run);

  return {
    ...runSummary(run),
    duration_ms: run.duration_ms ?? null,
    command: run.command ?? [],
    warnings: warnings.map((w) => `${w.title}: ${w.detail}`),
    usage: run.usage ?? null,
    tools_used: run.tools ?? null,
    transcript: transcript || null,
  };
}

async function handleGetDiff({ session_id }) {
  const patchPath = join(RUNS_DIR, session_id, 'diff.patch');
  try {
    const patch = await readFile(patchPath, 'utf8');
    return { session_id, patch: patch || '(no changes)' };
  } catch {
    return { error: `Diff not found for session: ${session_id}` };
  }
}

async function handleGetTokenUsage({ since, until } = {}) {
  let runs = await loadRuns();
  if (since || until) runs = filterByDate(runs, since ?? null, until ?? null);

  let totalTokens = 0;
  let totalCost = 0;
  const breakdown = [];

  for (const run of runs) {
    const tokens = run.usage?.total_tokens ?? 0;
    const cost = run.usage?.cost_usd ?? 0;
    totalTokens += tokens;
    totalCost += cost;
    breakdown.push({
      id: run.id,
      date: run.completed_at ?? run.started_at ?? null,
      tokens,
      cost_usd: cost,
    });
  }

  return {
    total_tokens: totalTokens,
    total_cost_usd: Number(totalCost.toFixed(6)),
    session_count: runs.length,
    breakdown,
  };
}

export async function startMcpServer() {
  const server = new Server(
    { name: 'agent-flight-recorder', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    let result;
    if (name === 'list_sessions') result = await handleListSessions(args ?? {});
    else if (name === 'get_session') result = await handleGetSession(args);
    else if (name === 'get_diff') result = await handleGetDiff(args);
    else if (name === 'get_token_usage') result = await handleGetTokenUsage(args ?? {});
    else return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
