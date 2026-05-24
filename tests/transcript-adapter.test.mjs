import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFromTranscript, parseTranscriptLine } from '../src/adapters/transcript.mjs';

test('parseTranscriptLine returns null for empty lines', () => {
  assert.equal(parseTranscriptLine(''), null);
  assert.equal(parseTranscriptLine('   '), null);
});

test('parseTranscriptLine returns null for non-JSON', () => {
  assert.equal(parseTranscriptLine('not json'), null);
});

test('extractFromTranscript picks up cwd from user events', () => {
  const lines = [
    JSON.stringify({ type: 'user', cwd: '/projects/myapp', message: { role: 'user', content: 'hello' } })
  ];
  const result = extractFromTranscript(lines);
  assert.equal(result.cwd, '/projects/myapp');
});

test('extractFromTranscript sums token usage across assistant turns', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'First response' }],
        usage: { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 200, output_tokens: 50 }
      }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Second response' }],
        usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 300, output_tokens: 30 }
      }
    })
  ];

  const result = extractFromTranscript(lines);
  assert.equal(result.usage.input_tokens, 15);
  assert.equal(result.usage.cached_input_tokens, 1000); // 500+200+0+300
  assert.equal(result.usage.output_tokens, 80);
  assert.equal(result.usage.total_tokens, 1095);
});

test('extractFromTranscript returns null usage when no assistant messages have usage', () => {
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })
  ];
  const result = extractFromTranscript(lines);
  assert.equal(result.usage, null);
});

test('extractFromTranscript extracts Bash tool calls', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'git status' } }
        ],
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    })
  ];

  const result = extractFromTranscript(lines);
  assert.equal(result.tools.command_count, 2);
  assert.equal(result.tools.commands[0].command, 'npm test');
  assert.equal(result.tools.commands[1].command, 'git status');
});

test('extractFromTranscript extracts file operations', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/index.mjs' } },
          { type: 'tool_use', name: 'Write', input: { file_path: 'out.txt' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/util.mjs' } }
        ],
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    })
  ];

  const result = extractFromTranscript(lines);
  assert.equal(result.files.read_count, 3);
  assert.deepEqual(result.files.reads.map(r => r.path), ['src/index.mjs', 'out.txt', 'src/util.mjs']);
});

test('extractFromTranscript builds human-readable transcript', () => {
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'run the tests' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running tests now.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
        ],
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    })
  ];

  const result = extractFromTranscript(lines);
  assert.ok(result.humanTranscript.includes('[user]'));
  assert.ok(result.humanTranscript.includes('run the tests'));
  assert.ok(result.humanTranscript.includes('[assistant]'));
  assert.ok(result.humanTranscript.includes('[bash] npm test'));
});

test('extractFromTranscript ignores non-user/assistant events', () => {
  const lines = [
    JSON.stringify({ type: 'permission-mode', permissionMode: 'default' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Some title' }),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' })
  ];
  const result = extractFromTranscript(lines);
  assert.equal(result.usage, null);
  assert.equal(result.tools.command_count, 0);
});
