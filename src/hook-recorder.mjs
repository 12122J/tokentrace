import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractFromTranscript } from './adapters/transcript.mjs';
import { EventWriter } from './event-writer.mjs';
import { countPatchFiles, getGitDiff, getGitSnapshot } from './git.mjs';
import { regenerateReport } from './report.mjs';
import { ensureDir, nowIso, writeJson } from './util.mjs';

export async function recordFromHook({ sessionId, transcriptPath, fallbackCwd }) {
  const transcriptRaw = await readFile(transcriptPath, 'utf8');
  const lines = transcriptRaw.split(/\r?\n/);
  const extracted = extractFromTranscript(lines);

  const resolvedCwd = resolve(extracted.cwd ?? fallbackCwd ?? process.cwd());
  const runDir = join(resolvedCwd, '.afr', 'runs', sessionId);

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
    started_at: null,
    completed_at: completedAt,
    duration_ms: null,
    exit_code: 0,
    success: true,
    source: 'hook',
    git: { after: gitAfter },
    usage: extracted.usage,
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
