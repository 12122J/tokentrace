import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractFromTranscript } from './adapters/transcript.mjs';
import { EventWriter } from './event-writer.mjs';
import { countPatchFiles, getGitDiff, getGitSnapshot } from './git.mjs';
import { estimateCostUsd } from './pricing.mjs';
import { regenerateReport } from './report.mjs';
import { ensureDir, nowIso, writeJson } from './util.mjs';

function accountFingerprint() {
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  if (!key) return null;
  // Record only the first 12 chars — identifies the account, not usable as a key
  return key.slice(0, 12);
}

export async function recordFromHook({ sessionId, transcriptPath, fallbackCwd }) {
  const transcriptRaw = await readFile(transcriptPath, 'utf8');
  const lines = transcriptRaw.split(/\r?\n/);
  const extracted = extractFromTranscript(lines);

  const resolvedCwd = resolve(extracted.cwd ?? fallbackCwd ?? process.cwd());
  const runDir = join(homedir(), '.tokentrace', 'runs', sessionId);

  await ensureDir(runDir);

  const completedAt = nowIso();
  const gitAfter = await getGitSnapshot(resolvedCwd);
  const patch = await getGitDiff(resolvedCwd);

  const run = {
    id: sessionId,
    schema_version: 1,
    command: ['claude'],
    cwd: resolvedCwd,
    agent: 'claude',
    label: null,
    profile: process.env.TOKENTRACE_PROFILE ?? null,
    account_key_prefix: accountFingerprint(),
    model: extracted.model,
    cc_version: extracted.ccVersion,
    entrypoint: extracted.entrypoint,
    started_at: null,
    completed_at: completedAt,
    duration_ms: null,
    exit_code: 0,
    success: true,
    source: 'hook',
    git: {
      branch: extracted.gitBranch,
      after: gitAfter,
    },
    usage: extracted.usage ? {
      ...extracted.usage,
      cost_usd: estimateCostUsd(extracted.model, extracted.usage),
    } : null,
    session: null,
    tools: extracted.tools,
    files: extracted.files,
    diff: { files_changed: countPatchFiles(patch) },
    artifacts: {
      events: 'events.jsonl',
      transcript: 'transcript.txt',
      diff: 'diff.patch',
      summary: 'summary.md',
      report: 'report.html'
    }
  };

  const writer = new EventWriter(join(runDir, 'events.jsonl'));
  await writer.write('run.started', { id: sessionId, source: 'hook', cwd: resolvedCwd });
  if (extracted.usage) {
    await writer.write('usage.tokens', extracted.usage);
  }
  for (const cmd of extracted.tools.commands) {
    await writer.write('tool.command', cmd);
  }
  for (const file of extracted.files.reads) {
    await writer.write('file.read', file);
  }
  await writer.write('run.completed', { source: 'hook' });
  await writer.close();

  await writeFile(join(runDir, 'transcript.txt'), extracted.humanTranscript);
  await writeFile(join(runDir, 'diff.patch'), patch);
  await writeJson(join(runDir, 'run.json'), run);
  await regenerateReport(runDir);

  return { runDir, run };
}
