import assert from 'node:assert/strict';
import { test } from 'node:test';
import packageJson from '../package.json' with { type: 'json' };
import { main } from '../src/cli.mjs';

test('main prints package version', async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => logs.push(line);
  try {
    const exitCode = await main(['--version']);
    assert.equal(exitCode, 0);
    assert.deepEqual(logs, [packageJson.version]);
  } finally {
    console.log = originalLog;
  }
});

test('main prints help', async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (line) => logs.push(line);
  try {
    const exitCode = await main(['--help']);
    assert.equal(exitCode, 0);
    assert.match(logs.join('\n'), /Agent Flight Recorder/);
    assert.match(logs.join('\n'), /afr run/);
  } finally {
    console.log = originalLog;
  }
});
