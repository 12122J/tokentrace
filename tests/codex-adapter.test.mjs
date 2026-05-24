import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeCodexLine, parseCodexJsonLine } from '../src/adapters/codex.mjs';

test('parseCodexJsonLine returns null for non-JSON text', () => {
  assert.equal(parseCodexJsonLine('plain terminal text'), null);
});

test('observeCodexLine extracts usage from turn.completed events', () => {
  const line = JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 10,
      cached_input_tokens: 4,
      output_tokens: 3,
      reasoning_output_tokens: 2
    }
  });

  assert.deepEqual(observeCodexLine(line), [
    {
      type: 'usage.tokens',
      input_tokens: 10,
      cached_input_tokens: 4,
      output_tokens: 3,
      reasoning_output_tokens: 2,
      total_tokens: 13
    }
  ]);
});

test('observeCodexLine extracts command tool completions when present', () => {
  const line = JSON.stringify({
    type: 'exec_command.completed',
    command: 'npm test',
    exit_code: 0
  });

  assert.deepEqual(observeCodexLine(line), [
    {
      type: 'tool.command',
      command: 'npm test',
      exit_code: 0
    }
  ]);
});
