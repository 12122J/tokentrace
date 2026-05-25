import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { regenerateReport, renderHtmlReport, renderSummaryMarkdown } from '../src/report.mjs';

const SAMPLE_RUN = {
  id: 'run-123',
  command: ['node', '-e', '<script>alert(1)</script>'],
  cwd: '/tmp/project',
  agent: 'shell',
  started_at: '2026-05-24T12:00:00.000Z',
  completed_at: '2026-05-24T12:00:01.000Z',
  duration_ms: 1000,
  exit_code: 0,
  usage: {
    input_tokens: 10,
    output_tokens: 3,
    total_tokens: 13
  },
  diff: {
    files_changed: 2
  },
  artifacts: {
    events: 'events.jsonl',
    transcript: 'transcript.txt',
    diff: 'diff.patch',
    summary: 'summary.md',
    report: 'report.html'
  }
};

test('renderSummaryMarkdown includes command, exit code, usage, and diff summary', () => {
  const markdown = renderSummaryMarkdown(SAMPLE_RUN);
  assert.match(markdown, /# TokenTrace Run/);
  assert.match(markdown, /node -e/);
  assert.match(markdown, /Exit Code\*\*: 0/);
  assert.match(markdown, /Total Tokens\*\*: 13/);
  assert.match(markdown, /Files Changed\*\*: 2/);
  assert.match(markdown, /Changes recorded without verification command/);
});

test('renderHtmlReport escapes command, transcript, patch, and event content', () => {
  const html = renderHtmlReport(
    SAMPLE_RUN,
    '<script>alert("transcript")</script>',
    '<script>alert("patch")</script>',
    ['{"type":"x","text":"<script>event</script>"}']
  );

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;transcript&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;patch&quot;\)&lt;\/script&gt;/);
  assert.match(html, /Warnings/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('regenerateReport writes summary and html files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-report-'));
  try {
    await writeFile(join(dir, 'run.json'), `${JSON.stringify(SAMPLE_RUN, null, 2)}\n`);
    await writeFile(join(dir, 'transcript.txt'), 'hello\n');
    await writeFile(join(dir, 'diff.patch'), '');
    await writeFile(join(dir, 'events.jsonl'), '{"type":"run.completed"}\n');

    const result = await regenerateReport(dir);
    assert.equal(result.reportPath, join(dir, 'report.html'));
    assert.match(await readFile(join(dir, 'summary.md'), 'utf8'), /run-123/);
    assert.match(await readFile(join(dir, 'report.html'), 'utf8'), /TokenTrace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
