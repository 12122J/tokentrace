import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordRun } from '../src/run-recorder.mjs';

test('recordRun creates portable artifacts for a successful command', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'afr-run-cwd-'));
  const runsRoot = join(cwd, '.afr', 'runs');
  try {
    const result = await recordRun({
      command: [process.execPath, '-e', "console.log('hello from afr')"],
      cwd,
      runsRoot,
      agent: 'shell'
    });

    assert.equal(result.exitCode, 0);
    await access(join(result.runDir, 'run.json'));
    await access(join(result.runDir, 'events.jsonl'));
    await access(join(result.runDir, 'transcript.txt'));
    await access(join(result.runDir, 'diff.patch'));
    await access(join(result.runDir, 'summary.md'));
    await access(join(result.runDir, 'report.html'));

    const run = JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8'));
    assert.equal(run.exit_code, 0);
    assert.equal(run.agent, 'shell');
    assert.deepEqual(run.command, [process.execPath, '-e', "console.log('hello from afr')"]);
    assert.match(await readFile(join(result.runDir, 'transcript.txt'), 'utf8'), /hello from afr/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('recordRun captures Codex-style token usage from stdout JSON lines', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'afr-codex-cwd-'));
  const line = JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 21,
      cached_input_tokens: 8,
      output_tokens: 5
    }
  });

  try {
    const result = await recordRun({
      command: [process.execPath, '-e', `console.log(${JSON.stringify(line)})`],
      cwd,
      runsRoot: join(cwd, '.afr', 'runs'),
      agent: 'codex'
    });

    const run = JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8'));
    assert.deepEqual(run.usage, {
      input_tokens: 21,
      cached_input_tokens: 8,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 26
    });

    const events = await readFile(join(result.runDir, 'events.jsonl'), 'utf8');
    assert.match(events, /"type":"usage.tokens"/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('recordRun writes artifacts for a failing command and returns its exit code', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'afr-fail-cwd-'));
  try {
    const result = await recordRun({
      command: [process.execPath, '-e', 'process.exit(7)'],
      cwd,
      runsRoot: join(cwd, '.afr', 'runs'),
      agent: 'shell'
    });

    assert.equal(result.exitCode, 7);
    const run = JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8'));
    assert.equal(run.exit_code, 7);
    assert.equal(run.success, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
