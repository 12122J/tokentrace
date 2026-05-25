import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordRun } from '../src/run-recorder.mjs';

test('recordRun creates portable artifacts for a successful command', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tt-run-cwd-'));
  const runsRoot = join(cwd, '.afr', 'runs');
  try {
    const result = await recordRun({
      command: [process.execPath, '-e', "console.log('hello from tt')"],
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
    assert.deepEqual(run.command, [process.execPath, '-e', "console.log('hello from tt')"]);
    assert.match(await readFile(join(result.runDir, 'transcript.txt'), 'utf8'), /hello from tt/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('recordRun captures Codex-style token usage from stdout JSON lines', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tt-codex-cwd-'));
  const scriptPath = join(cwd, 'codex-smoke.mjs');
  const messageLine = JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: 'tokentrace codex smoke test'
    }
  });
  const line = JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 21,
      cached_input_tokens: 8,
      output_tokens: 5
    }
  });

  try {
    await writeFile(scriptPath, [
      "console.error('Reading additional input from stdin...');",
      `console.log(${JSON.stringify(JSON.stringify({ type: 'turn.started' }))});`,
      `console.log(${JSON.stringify(messageLine)});`,
      `console.log(${JSON.stringify(line)});`,
    ].join('\n'));

    const result = await recordRun({
      command: [process.execPath, scriptPath, '--model', 'gpt-5.5'],
      cwd,
      runsRoot: join(cwd, '.afr', 'runs'),
      agent: 'codex',
      pricingDb: {
        'gpt-5.5': { input: 5, output: 30, cacheWrite: null, cacheRead: 0.5 }
      }
    });

    const run = JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8'));
    assert.equal(run.model, 'gpt-5.5');
    assert.equal(run.description, 'tokentrace codex smoke test');
    assert.deepEqual(run.usage, {
      input_tokens: 21,
      cached_input_tokens: 8,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 26,
      cost_usd: 0.000259
    });

    const transcript = await readFile(join(result.runDir, 'transcript.txt'), 'utf8');
    assert.equal(transcript.trim(), '[assistant]\ntokentrace codex smoke test');
    assert.doesNotMatch(transcript, /turn\.started/);
    assert.doesNotMatch(transcript, /turn\.completed/);
    assert.doesNotMatch(transcript, /Reading additional input/);

    const events = await readFile(join(result.runDir, 'events.jsonl'), 'utf8');
    assert.match(events, /"type":"usage.tokens"/);
    assert.match(events, /"type":"message.agent"/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('recordRun writes artifacts for a failing command and returns its exit code', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tt-fail-cwd-'));
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
