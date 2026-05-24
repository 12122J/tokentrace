import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { countPatchFiles, getGitDiff, getGitSnapshot } from '../src/git.mjs';

const execFileAsync = promisify(execFile);

test('getGitSnapshot degrades outside a git repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afr-no-git-'));
  try {
    const snapshot = await getGitSnapshot(dir);
    assert.equal(snapshot.available, false);
    assert.match(snapshot.reason, /not a git repository|not available|git failed/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitDiff returns an empty patch outside a git repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afr-no-diff-'));
  try {
    assert.equal(await getGitDiff(dir), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitDiff includes untracked text files as patch entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afr-untracked-git-'));
  try {
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
    await writeFile(join(dir, 'new-file.txt'), 'hello\nworld\n');

    const patch = await getGitDiff(dir);
    assert.match(patch, /diff --git a\/new-file.txt b\/new-file.txt/);
    assert.match(patch, /\+hello/);
    assert.equal(countPatchFiles(patch), 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('countPatchFiles counts changed files in a unified git patch', () => {
  const patch = [
    'diff --git a/src/a.js b/src/a.js',
    'index 111..222 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    'diff --git a/src/b.js b/src/b.js',
    'index 333..444 100644',
    '--- a/src/b.js',
    '+++ b/src/b.js'
  ].join('\n');

  assert.equal(countPatchFiles(patch), 2);
});

test('getGitSnapshot handles an unborn git branch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'afr-unborn-git-'));
  try {
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Test\n');

    const snapshot = await getGitSnapshot(dir);
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.branch, 'main');
    assert.equal(snapshot.commit, null);
    assert.equal(snapshot.dirty, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
