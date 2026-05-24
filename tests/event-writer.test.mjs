import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EventWriter } from '../src/event-writer.mjs';

test('EventWriter appends timestamped JSONL events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afr-events-'));
  try {
    const path = join(dir, 'events.jsonl');
    const writer = new EventWriter(path);
    await writer.write('run.started', { command: ['node', '-v'] });
    await writer.write('run.completed', { exit_code: 0 });
    await writer.close();

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]);
    assert.equal(first.type, 'run.started');
    assert.deepEqual(first.command, ['node', '-v']);
    assert.match(first.timestamp, /^\d{4}-\d{2}-\d{2}T/);

    const second = JSON.parse(lines[1]);
    assert.equal(second.type, 'run.completed');
    assert.equal(second.exit_code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
