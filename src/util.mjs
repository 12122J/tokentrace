import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function makeRunId(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '').replace('T', 'T').replace('Z', 'Z');
  const suffix = randomBytes(3).toString('hex');
  return `${stamp}-${suffix}`;
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function detectAgent(command, requested = 'auto') {
  if (requested && requested !== 'auto') {
    return requested;
  }
  const executable = command[0]?.toLowerCase() || 'shell';
  if (executable.includes('codex')) {
    return 'codex';
  }
  if (executable.includes('claude')) {
    return 'claude';
  }
  return 'shell';
}
