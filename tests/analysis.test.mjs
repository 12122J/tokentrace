import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRunWarnings, looksLikeVerificationCommand } from '../src/analysis.mjs';

test('looksLikeVerificationCommand detects common verification commands', () => {
  assert.equal(looksLikeVerificationCommand('npm test'), true);
  assert.equal(looksLikeVerificationCommand('cargo test --all'), true);
  assert.equal(looksLikeVerificationCommand('node script.js'), false);
});

test('buildRunWarnings flags missing usage and git metadata', () => {
  const warnings = buildRunWarnings({
    exit_code: 0,
    usage: null,
    git: {
      before: { available: false },
      after: { available: false }
    },
    diff: { files_changed: 0 },
    tools: { commands: [] }
  });

  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ['missing-token-usage', 'git-unavailable']
  );
});

test('buildRunWarnings flags changes without verification', () => {
  const warnings = buildRunWarnings({
    exit_code: 0,
    usage: { total_tokens: 100 },
    git: {
      before: { available: true },
      after: { available: true }
    },
    diff: { files_changed: 2 },
    tools: { commands: [{ command: 'npm install', exit_code: 0 }] }
  });

  assert.equal(warnings.some((warning) => warning.code === 'changes-without-verification'), true);
});

test('buildRunWarnings accepts changed files with verification command', () => {
  const warnings = buildRunWarnings({
    exit_code: 0,
    usage: { total_tokens: 100 },
    git: {
      before: { available: true },
      after: { available: true }
    },
    diff: { files_changed: 2 },
    tools: { commands: [{ command: 'npm run check', exit_code: 0 }] }
  });

  assert.equal(warnings.some((warning) => warning.code === 'changes-without-verification'), false);
});
