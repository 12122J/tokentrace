import { spawn } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { observeCodexLine } from './adapters/codex.mjs';
import { EventWriter } from './event-writer.mjs';
import { countPatchFiles, getGitDiff, getGitSnapshot } from './git.mjs';
import { regenerateReport } from './report.mjs';
import { detectAgent, ensureDir, makeRunId, nowIso, writeJson } from './util.mjs';

export async function recordRun({
  command,
  cwd = process.cwd(),
  runsRoot = join(cwd, '.afr', 'runs'),
  agent = 'auto',
  label = null
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
  const startedMs = Date.now();
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

  const run = {
    id: runId,
    schema_version: 1,
    command,
    cwd: resolvedCwd,
    agent: runAgent,
    label,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: Date.now() - startedMs,
    exit_code: exitCode,
    success: exitCode === 0,
    git: {
      before: gitBefore,
      after: gitAfter
    },
    usage: observations.usage,
    tools: observations.tools,
    files: observations.files,
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
    duration_ms: run.duration_ms
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
      pendingWrites.push(appendTranscript(transcriptPath, text));
      pendingWrites.push(writer.write('process.stdout', { text }));
      stdoutRemainder = observeLines(stdoutRemainder, text, agent, writer, observations, pendingWrites);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      pendingWrites.push(appendTranscript(transcriptPath, text));
      pendingWrites.push(writer.write('process.stderr', { text }));
      stderrRemainder = observeLines(stderrRemainder, text, agent, writer, observations, pendingWrites);
    });

    child.on('error', (error) => {
      rejectRun(error);
    });

    child.on('close', async (code, signal) => {
      try {
        flushLine(stdoutRemainder, agent, writer, observations, pendingWrites);
        flushLine(stderrRemainder, agent, writer, observations, pendingWrites);
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

function observeLines(remainder, text, agent, writer, observations, pendingWrites) {
  const combined = remainder + text;
  const lines = combined.split(/\r?\n/);
  const nextRemainder = lines.pop() ?? '';

  for (const line of lines) {
    flushLine(line, agent, writer, observations, pendingWrites);
  }

  return nextRemainder;
}

function flushLine(line, agent, writer, observations, pendingWrites) {
  if (!line.trim() || agent !== 'codex') {
    return;
  }

  for (const observation of observeCodexLine(line)) {
    applyObservation(observations, observation);
    pendingWrites.push(writer.write(observation.type, withoutType(observation)));
  }
}

function createObservationState() {
  return {
    usage: null,
    tools: {
      command_count: 0,
      commands: []
    },
    files: {
      read_count: 0,
      reads: []
    }
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

  if (observation.type === 'tool.command') {
    state.tools.command_count += 1;
    state.tools.commands.push({
      command: observation.command,
      exit_code: observation.exit_code
    });
  }

  if (observation.type === 'file.read') {
    state.files.read_count += 1;
    state.files.reads.push({
      path: observation.path,
      bytes: observation.bytes
    });
  }
}

function withoutType(observation) {
  const { type, ...rest } = observation;
  return rest;
}
