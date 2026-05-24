import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function getGitSnapshot(cwd) {
  try {
    const [branch, commit, status] = await Promise.all([
      gitOptional(['branch', '--show-current'], cwd),
      gitOptional(['rev-parse', '--short', 'HEAD'], cwd),
      git(['status', '--porcelain'], cwd)
    ]);

    return {
      available: true,
      branch: branch.trim() || null,
      commit: commit.trim() || null,
      dirty: status.trim().length > 0,
      status: parsePorcelainStatus(status)
    };
  } catch (error) {
    return {
      available: false,
      reason: normalizeGitError(error)
    };
  }
}

export async function getGitDiff(cwd) {
  try {
    const [trackedPatch, untrackedFiles] = await Promise.all([
      git(['diff', '--binary'], cwd),
      listUntrackedFiles(cwd)
    ]);
    const untrackedPatches = await Promise.all(
      untrackedFiles.map((path) => createUntrackedPatch(cwd, path))
    );
    return [trackedPatch, ...untrackedPatches.filter(Boolean)].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

export function countPatchFiles(patch) {
  if (!patch.trim()) {
    return 0;
  }
  return patch
    .split('\n')
    .filter((line) => line.startsWith('diff --git '))
    .length;
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024
  });
  return stdout;
}

async function gitOptional(args, cwd) {
  try {
    return await git(args, cwd);
  } catch {
    return '';
  }
}

async function listUntrackedFiles(cwd) {
  const output = await git(['ls-files', '--others', '--exclude-standard'], cwd);
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function createUntrackedPatch(cwd, path) {
  const fileStat = await stat(`${cwd}/${path}`);
  if (!fileStat.isFile() || fileStat.size > 1024 * 1024) {
    return [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      '@@ -0,0 +1 @@',
      `+Binary or large untracked file omitted by Agent Flight Recorder: ${path}`,
      ''
    ].join('\n');
  }

  const content = await readFile(`${cwd}/${path}`);
  if (content.includes(0)) {
    return [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      '@@ -0,0 +1 @@',
      `+Binary untracked file omitted by Agent Flight Recorder: ${path}`,
      ''
    ].join('\n');
  }

  const text = content.toString('utf8');
  const lines = text.length > 0 ? text.replace(/\n$/, '').split('\n') : [];
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    ...(lines.length > 0 ? lines.map((line) => `+${line}`) : ['+']),
    ''
  ].join('\n');
}

function parsePorcelainStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3)
    }));
}

function normalizeGitError(error) {
  const message = `${error?.stderr || error?.message || 'git failed'}`.trim();
  return message || 'git not available';
}
