import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeHtml, readJson } from './util.mjs';

export function renderSummaryMarkdown(run) {
  const usage = run.usage || {};
  const diff = run.diff || {};
  return `# Agent Flight Recorder Run

**Run ID**: ${run.id}
**Agent**: ${run.agent || 'unknown'}
**Command**: \`${run.command.join(' ')}\`
**Working Directory**: \`${run.cwd}\`
**Started**: ${run.started_at}
**Completed**: ${run.completed_at || 'not completed'}
**Duration**: ${formatDuration(run.duration_ms)}
**Exit Code**: ${run.exit_code ?? 'unknown'}
**Total Tokens**: ${usage.total_tokens ?? 'unknown'}
**Files Changed**: ${diff.files_changed ?? 0}

## Artifacts

- Events: \`${run.artifacts?.events || 'events.jsonl'}\`
- Transcript: \`${run.artifacts?.transcript || 'transcript.txt'}\`
- Diff: \`${run.artifacts?.diff || 'diff.patch'}\`
- HTML Report: \`${run.artifacts?.report || 'report.html'}\`
`;
}

export function renderHtmlReport(run, transcript = '', patch = '', events = []) {
  const usage = run.usage || {};
  const diff = run.diff || {};
  const eventLines = Array.isArray(events) ? events : String(events).split('\n').filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Flight Recorder - ${escapeHtml(run.id)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    body {
      margin: 0;
      background: Canvas;
      color: CanvasText;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    h1, h2 {
      line-height: 1.15;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 20px 0 28px;
    }
    .metric {
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 8px;
      padding: 12px;
    }
    .metric span {
      display: block;
      font-size: 12px;
      color: color-mix(in srgb, CanvasText 68%, transparent);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .metric strong {
      display: block;
      margin-top: 4px;
      font-size: 18px;
    }
    pre {
      overflow: auto;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
      background: color-mix(in srgb, CanvasText 6%, Canvas);
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Agent Flight Recorder</h1>
    <p><strong>${escapeHtml(run.id)}</strong></p>
    <div class="grid">
      ${metric('Agent', run.agent || 'unknown')}
      ${metric('Exit Code', run.exit_code ?? 'unknown')}
      ${metric('Duration', formatDuration(run.duration_ms))}
      ${metric('Total Tokens', usage.total_tokens ?? 'unknown')}
      ${metric('Files Changed', diff.files_changed ?? 0)}
    </div>

    <h2>Command</h2>
    <pre><code>${escapeHtml(run.command.join(' '))}</code></pre>

    <h2>Transcript</h2>
    <pre><code>${escapeHtml(transcript || '(empty)')}</code></pre>

    <h2>Diff</h2>
    <pre><code>${escapeHtml(patch || '(no git diff captured)')}</code></pre>

    <h2>Events</h2>
    <pre><code>${escapeHtml(eventLines.join('\n') || '(no events)')}</code></pre>
  </main>
</body>
</html>
`;
}

export async function regenerateReport(runDir) {
  const run = await readJson(join(runDir, 'run.json'));
  const transcript = await readOptional(join(runDir, 'transcript.txt'));
  const patch = await readOptional(join(runDir, 'diff.patch'));
  const eventsText = await readOptional(join(runDir, 'events.jsonl'));
  const events = eventsText.trim() ? eventsText.trim().split('\n') : [];

  const summary = renderSummaryMarkdown(run);
  const html = renderHtmlReport(run, transcript, patch, events);

  const summaryPath = join(runDir, 'summary.md');
  const reportPath = join(runDir, 'report.html');
  await writeFile(summaryPath, summary);
  await writeFile(reportPath, html);
  return { summaryPath, reportPath };
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number') {
    return 'unknown';
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(2)}s`;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
