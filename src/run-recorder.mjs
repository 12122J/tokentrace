import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { observeClaudeCodeLine } from './adapters/claude-code.mjs';
import { observeCodexLine, parseCodexJsonLine } from './adapters/codex.mjs';
import { EventWriter } from './event-writer.mjs';
import { countPatchFiles, getGitDiff, getGitSnapshot } from './git.mjs';
import { loadPricingDb } from './pricing-db.mjs';
import { estimateCostUsdSync } from './pricing.mjs';
import { regenerateReport } from './report.mjs';
import { detectAgent, ensureDir, makeRunId, nowIso, writeJson } from './util.mjs';

export async function recordRun({
  command,
  cwd = process.cwd(),
  runsRoot = join(cwd, '.tokentrace', 'runs'),
  agent = 'auto',
  label = null,
  pricingDb
}) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error('recordRun requires a non-empty command array');
  }

  const resolvedCwd = resolve(cwd);
  const runAgent = detectAgent(command, agent);
  const runId = makeRunId();
  const runDir = join(runsRoot, runId);
  const eventsPath = join(runDir, 'events.jsonl');
  const transcriptPath = join(runDir, 'transcript.txt');
  const diffPath = join(runDir, 'diff.patch');

  await ensureDir(runDir);
  await writeFile(transcriptPath, '');
  await writeFile(diffPath, '');

  const writer = new EventWriter(eventsPath);
  const startedAt = nowIso();
  const gitBefore = await getGitSnapshot(resolvedCwd);
  const observations = createObservationState();

  await writer.write('run.started', {
    id: runId,
    schema_version: 1,
    command,
    cwd: resolvedCwd,
    agent: runAgent,
    label,
    git: { before: gitBefore }
  });

  const exitCode = await runChild(command, resolvedCwd, runAgent, transcriptPath, writer, observations);
  const completedAt = nowIso();
  const gitAfter = await getGitSnapshot(resolvedCwd);
  const patch = await getGitDiff(resolvedCwd);
  await writeFile(diffPath, patch);
  const model = observations.model ?? await inferRunModel(command, runAgent);
  const usage = observations.usage ? { ...observations.usage } : null;
  if (usage && usage.cost_usd == null && model) {
    const db = pricingDb === undefined ? await loadPricingDb() : pricingDb;
    if (db) {
      const cost = estimateCostUsdSync(model, usage, db);
      if (cost != null) {
        usage.cost_usd = cost;
      }
    }
  }

  const run = {
    id: runId,
    schema_version: 1,
    command,
    cwd: resolvedCwd,
    agent: runAgent,
    label,
    description: observations.description,
    model,
    started_at: startedAt,
    completed_at: completedAt,
    exit_code: exitCode,
    success: exitCode === 0,
    git: {
      before: gitBefore,
      after: gitAfter
    },
    usage,
    session: observations.session ?? null,
    tools: observations.tools,
    diff: {
      files_changed: countPatchFiles(patch)
    },
    artifacts: {
      events: 'events.jsonl',
      transcript: 'transcript.txt',
      diff: 'diff.patch',
      summary: 'summary.md',
      report: 'report.html'
    }
  };

  await writer.write('git.diff', run.diff);
  await writer.write('run.completed', {
    exit_code: exitCode,
    success: exitCode === 0,
  });
  await writer.close();

  await writeJson(join(runDir, 'run.json'), run);
  await regenerateReport(runDir);

  return {
    runDir,
    run,
    exitCode
  };
}

function runChild(command, cwd, agent, transcriptPath, writer, observations) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutRemainder = '';
    let stderrRemainder = '';
    const pendingWrites = [];

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (agent !== 'codex') {
        pendingWrites.push(appendTranscript(transcriptPath, text));
      }
      pendingWrites.push(writer.write('process.stdout', { text }));
      stdoutRemainder = observeLines(stdoutRemainder, text, agent, 'stdout', transcriptPath, writer, observations, pendingWrites);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (agent !== 'codex') {
        pendingWrites.push(appendTranscript(transcriptPath, text));
      }
      pendingWrites.push(writer.write('process.stderr', { text }));
      stderrRemainder = observeLines(stderrRemainder, text, agent, 'stderr', transcriptPath, writer, observations, pendingWrites);
    });

    child.on('error', (error) => {
      rejectRun(error);
    });

    child.on('close', async (code, signal) => {
      try {
        flushLine(stdoutRemainder, agent, 'stdout', transcriptPath, writer, observations, pendingWrites);
        flushLine(stderrRemainder, agent, 'stderr', transcriptPath, writer, observations, pendingWrites);
        await Promise.all(pendingWrites);
        if (signal) {
          await writer.write('process.signal', { signal });
        }
        resolveRun(typeof code === 'number' ? code : 1);
      } catch (error) {
        rejectRun(error);
      }
    });
  });
}

async function appendTranscript(path, text) {
  await appendFile(path, text);
}

function observeLines(remainder, text, agent, stream, transcriptPath, writer, observations, pendingWrites) {
  const combined = remainder + text;
  const lines = combined.split(/\r?\n/);
  const nextRemainder = lines.pop() ?? '';

  for (const line of lines) {
    flushLine(line, agent, stream, transcriptPath, writer, observations, pendingWrites);
  }

  return nextRemainder;
}

function flushLine(line, agent, stream, transcriptPath, writer, observations, pendingWrites) {
  if (!line.trim()) return;

  let lineObservations = [];
  if (agent === 'codex') {
    lineObservations = observeCodexLine(line);
  } else if (agent === 'claude') {
    lineObservations = observeClaudeCodeLine(line);
  }

  for (const observation of lineObservations) {
    applyObservation(observations, observation);
    pendingWrites.push(writer.write(observation.type, withoutType(observation)));
    if (observation.type === 'message.agent') {
      pendingWrites.push(appendTranscript(transcriptPath, `[assistant]\n${observation.text.trim()}\n\n`));
    }
  }

  if (agent === 'codex' && stream === 'stdout' && lineObservations.length === 0 && !parseCodexJsonLine(line)) {
    pendingWrites.push(appendTranscript(transcriptPath, `${line}\n`));
  }
}

function createObservationState() {
  return {
    usage: null,
    session: null,
    model: null,
    description: null,
    tools: {
      command_count: 0,
      commands: []
    },
  };
}

function applyObservation(state, observation) {
  if (observation.type === 'usage.tokens') {
    state.usage = {
      input_tokens: observation.input_tokens,
      cached_input_tokens: observation.cached_input_tokens,
      output_tokens: observation.output_tokens,
      reasoning_output_tokens: observation.reasoning_output_tokens,
      total_tokens: observation.total_tokens
    };
  }

  if (observation.type === 'usage.cost') {
    state.usage = state.usage ?? {};
    state.usage.cost_usd = observation.cost_usd;
  }

  if (observation.type === 'session.turns') {
    state.session = {
      num_turns: observation.num_turns,
      session_id: observation.session_id
    };
  }

  if (observation.type === 'model.detected') {
    state.model = observation.model;
  }

  if (observation.type === 'session.thread') {
    state.session = {
      ...(state.session ?? {}),
      session_id: observation.session_id
    };
  }

  if (observation.type === 'message.agent') {
    state.description = state.description ?? observation.text.trim().slice(0, 160);
  }

  if (observation.type === 'tool.command') {
    state.tools.command_count += 1;
    state.tools.commands.push({
      command: observation.command,
      exit_code: observation.exit_code
    });
  }

}

async function inferRunModel(command, agent) {
  const cliModel = inferModelFromArgs(command);
  if (cliModel) return cliModel;
  if (agent === 'codex') {
    return readCodexConfiguredModel();
  }
  return null;
}

function inferModelFromArgs(command) {
  for (let index = 0; index < command.length; index += 1) {
    const arg = command[index];
    if ((arg === '--model' || arg === '-m') && command[index + 1]) {
      return command[index + 1];
    }
    if (arg?.startsWith('--model=')) {
      return arg.slice('--model='.length);
    }
    if (arg === '-c' && typeof command[index + 1] === 'string') {
      const match = command[index + 1].match(/^model\s*=\s*"?([^"]+)"?$/);
      if (match) return match[1];
    }
  }
  return null;
}

async function readCodexConfiguredModel() {
  // CODEX_MODEL env var takes priority
  if (process.env.CODEX_MODEL) return process.env.CODEX_MODEL;
  // Try config.toml
  try {
    const toml = await readFile(join(homedir(), '.codex', 'config.toml'), 'utf8');
    const m = toml.match(/^model\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch { /* no file */ }
  // Try config.yaml / config.yml
  for (const name of ['config.yaml', 'config.yml']) {
    try {
      const yaml = await readFile(join(homedir(), '.codex', name), 'utf8');
      const m = yaml.match(/^model\s*:\s*["']?([^\s"']+)/m);
      if (m) return m[1];
    } catch { /* no file */ }
  }
  return null;
}

function withoutType(observation) {
  const { type, ...rest } = observation;
  return rest;
}
