import React, { useState, useEffect } from 'react';

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatCost(value, estimated = false) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '—';
  const prefix = estimated ? '~' : '';
  if (value >= 1) return `${prefix}$${value.toFixed(2)}`;
  return `${prefix}$${value.toFixed(4)}`;
}

const PRICING = [
  { prefix: 'claude-opus-4',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-4', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-4',  input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  { prefix: 'claude-opus-3',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-3', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-3',  input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
];

function estimateCost(model, usage) {
  if (!model || !usage) return null;
  const p = PRICING.find(t => model.startsWith(t.prefix));
  if (!p) return null;
  const M = 1_000_000;
  const cacheWrite = usage.cache_creation_tokens ?? 0;
  const cacheRead  = usage.cache_read_tokens ?? usage.cached_input_tokens ?? 0;
  return (
    (usage.input_tokens  ?? 0) / M * p.input      +
    cacheWrite           / M * p.cacheWrite         +
    cacheRead            / M * p.cacheRead          +
    (usage.output_tokens ?? 0) / M * p.output
  );
}

function formatTokens(value) {
  if (value == null || isNaN(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

// Old run.json format stores cache_creation+cache_read combined in cached_input_tokens,
// which inflates total_tokens massively. New format separates them.
function resolveUsageTokens(usage) {
  if (!usage) return { total: null, cacheCreation: null, cacheReads: null };
  const isNewFormat = 'cache_creation_tokens' in usage;
  const total = isNewFormat
    ? usage.total_tokens
    : (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  const cacheCreation = isNewFormat ? usage.cache_creation_tokens : null;
  const cacheReads = isNewFormat ? usage.cache_read_tokens : usage.cached_input_tokens;
  return { total, cacheCreation, cacheReads };
}

function buildWarnings(session) {
  const warnings = [];
  if (session.exit_code !== 0) {
    warnings.push(`Non-zero exit code: ${session.exit_code}`);
  }
  if (session.usage == null) {
    warnings.push('No usage data recorded for this session');
  }
  if (session.git?.after?.dirty) {
    warnings.push('Working tree was dirty after session completed');
  }
  return warnings;
}

function DiffView({ content }) {
  if (!content) return <div style={{ padding: '16px 24px', fontSize: 13, color: '#6b7280' }}>No diff available.</div>;

  const lines = content.split('\n');
  return (
    <div className="diff-container">
      <div className="diff-content">
        {lines.map((line, i) => {
          let cls = 'diff-line';
          if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-line--add';
          else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-line--remove';
          else if (line.startsWith('@@')) cls += ' diff-line--hunk';
          else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) cls += ' diff-line--header';
          return <span key={i} className={cls}>{line}</span>;
        })}
      </div>
    </div>
  );
}

function TranscriptView({ content }) {
  if (!content) return <div style={{ padding: '16px 24px', fontSize: 13, color: '#6b7280' }}>No transcript available.</div>;
  return (
    <div className="transcript-container">
      <pre className="transcript-content">{content}</pre>
    </div>
  );
}

function CostBreakdown({ model, usage, vatRate }) {
  if (!usage || !model) return null;
  const PRICING = [
    { prefix: 'claude-opus-4',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
    { prefix: 'claude-sonnet-4', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
    { prefix: 'claude-haiku-4',  input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
    { prefix: 'claude-opus-3',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
    { prefix: 'claude-sonnet-3', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
    { prefix: 'claude-haiku-3',  input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
  ];
  const p = PRICING.find(t => model.startsWith(t.prefix));
  if (!p) return null;

  const M = 1_000_000;
  const rows = [
    { label: 'Input',       tokens: usage.input_tokens  ?? 0, rate: p.input      },
    { label: 'Cache write', tokens: usage.cache_creation_tokens ?? 0, rate: p.cacheWrite },
    { label: 'Cache reads', tokens: usage.cache_read_tokens ?? usage.cached_input_tokens ?? 0, rate: p.cacheRead },
    { label: 'Output',      tokens: usage.output_tokens ?? 0, rate: p.output     },
  ].filter(r => r.tokens > 0);

  const subtotal = rows.reduce((s, r) => s + r.tokens / M * r.rate, 0);
  const vat = subtotal * (vatRate / 100);
  const total = subtotal + vat;

  function fmt(n) {
    if (n < 0.001) return '<$0.001';
    if (n >= 1) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(4)}`;
  }
  function fmtTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  return (
    <div className="cost-breakdown">
      <div className="cost-breakdown__title">Cost Breakdown</div>
      <table className="cost-breakdown__table">
        <thead>
          <tr>
            <th>Component</th>
            <th className="right">Tokens</th>
            <th className="right">Rate /M</th>
            <th className="right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="right mono">{fmtTokens(r.tokens)}</td>
              <td className="right mono">${r.rate.toFixed(2)}</td>
              <td className="right mono">{fmt(r.tokens / M * r.rate)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="subtotal">
            <td colSpan={3}>Subtotal</td>
            <td className="right mono">{fmt(subtotal)}</td>
          </tr>
          {vatRate > 0 && (
            <tr className="vat-row">
              <td colSpan={3}>VAT ({vatRate}%)</td>
              <td className="right mono">{fmt(vat)}</td>
            </tr>
          )}
          <tr className="total-row">
            <td colSpan={3}><strong>Total{vatRate > 0 ? ' (incl. VAT)' : ''}</strong></td>
            <td className="right mono"><strong>{fmt(total)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <div className="cost-breakdown__note">
        Estimated from published Anthropic pricing. Actual billed amount may vary.
        {vatRate === 0 && ' EU customers: set your VAT rate in Settings.'}
      </div>
    </div>
  );
}

export default function SessionDetail({ session, vatRate = 0 }) {
  const [activeTab, setActiveTab] = useState('transcript');
  const [transcript, setTranscript] = useState(null);
  const [diff, setDiff] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);

  useEffect(() => {
    if (!session) return;
    setTranscript(null);
    setDiff(null);
    setActiveTab('transcript');
  }, [session?.id]);

  useEffect(() => {
    if (!session || activeTab !== 'transcript' || transcript !== null) return;
    setLoadingTranscript(true);
    fetch(`/api/sessions/${encodeURIComponent(session.id)}/transcript`)
      .then(r => r.ok ? r.text() : null)
      .then(text => setTranscript(text ?? ''))
      .catch(() => setTranscript(''))
      .finally(() => setLoadingTranscript(false));
  }, [session?.id, activeTab]);

  useEffect(() => {
    if (!session || activeTab !== 'diff' || diff !== null) return;
    setLoadingDiff(true);
    fetch(`/api/sessions/${encodeURIComponent(session.id)}/diff`)
      .then(r => r.ok ? r.text() : null)
      .then(text => setDiff(text ?? ''))
      .catch(() => setDiff(''))
      .finally(() => setLoadingDiff(false));
  }, [session?.id, activeTab]);

  if (!session) {
    return (
      <div className="detail-panel">
        <div className="section-header">Session Detail</div>
        <div className="detail-empty">
          <p className="detail-empty__text">Select a session to view details.</p>
        </div>
      </div>
    );
  }

  const warnings = buildWarnings(session);
  const usage = session.usage;
  const git = session.git?.after;
  const gitBranch = session.git?.branch || git?.branch;
  const gitAvailable = git?.available !== false;
  const { total: displayTotal, cacheCreation, cacheReads } = resolveUsageTokens(usage);
  const costUsd = usage?.cost_usd;
  const baseCost = costUsd ?? estimateCost(session.model, usage);
  const displayCost = baseCost != null ? baseCost * (1 + vatRate / 100) : null;
  const isEstimated = costUsd == null;

  return (
    <div className="detail-panel">
      <div className="section-header">Session Detail</div>

      <div className="detail-header">
        <div className="detail-header__id">{session.id}</div>
        <div className="detail-header__command">{(session.command || []).join(' ') || '—'}</div>
      </div>

      <div className="detail-meta-grid">
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">{session.started_at ? 'Started' : 'Completed'}</div>
          <div className="detail-meta-item__value">{formatDate(session.started_at || session.completed_at)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Duration</div>
          <div className="detail-meta-item__value">{formatDuration(session.duration_ms)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Agent</div>
          <div className="detail-meta-item__value">{session.agent || '—'}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Model</div>
          <div className="detail-meta-item__value" style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>{session.model || '—'}</div>
        </div>
        {(session.profile || session.account_key_prefix) && (
          <div className="detail-meta-item">
            <div className="detail-meta-item__label">Account</div>
            <div className="detail-meta-item__value">
              {session.profile
                ? session.profile
                : <span style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>{session.account_key_prefix}…</span>
              }
            </div>
          </div>
        )}
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Status</div>
          <div className="detail-meta-item__value">
            <span className={`status-badge ${session.exit_code === 0 ? 'status-badge--ok' : 'status-badge--fail'}`}>
              {session.exit_code === 0 ? 'ok' : `exit ${session.exit_code ?? '?'}`}
            </span>
          </div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">{isEstimated ? 'Est. Cost' : 'Cost'}{vatRate > 0 ? ` +${vatRate}%` : ''}</div>
          <div className="detail-meta-item__value" title={isEstimated ? 'Estimated from token counts and model pricing' : undefined}>
            {formatCost(displayCost, isEstimated)}
          </div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Total Tokens</div>
          <div className="detail-meta-item__value">{formatTokens(displayTotal)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Input</div>
          <div className="detail-meta-item__value">{formatTokens(usage?.input_tokens)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Output</div>
          <div className="detail-meta-item__value">{formatTokens(usage?.output_tokens)}</div>
        </div>
        {cacheCreation != null && (
          <div className="detail-meta-item">
            <div className="detail-meta-item__label">Cache Write</div>
            <div className="detail-meta-item__value">{formatTokens(cacheCreation)}</div>
          </div>
        )}
        {cacheReads != null && cacheReads > 0 && (
          <div className="detail-meta-item">
            <div className="detail-meta-item__label">Cache Reads</div>
            <div className="detail-meta-item__value" title="Re-reads of cached context across turns — not counted in total">
              {formatTokens(cacheReads)}
            </div>
          </div>
        )}
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Files Changed</div>
          <div className="detail-meta-item__value">
            {!gitAvailable
              ? <span style={{ color: '#9ca3af', fontSize: 11 }}>no git</span>
              : (session.diff?.files_changed ?? '—')
            }
          </div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Branch</div>
          <div className="detail-meta-item__value">
            {!gitAvailable
              ? <span style={{ color: '#9ca3af', fontSize: 11 }}>no git</span>
              : (gitBranch || '—')
            }
          </div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Commit</div>
          <div className="detail-meta-item__value" style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>
            {!gitAvailable
              ? <span style={{ color: '#9ca3af', fontSize: 11, fontFamily: 'inherit' }}>no git</span>
              : (git?.commit ? git.commit.slice(0, 8) : '—')
            }
          </div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Label</div>
          <div className="detail-meta-item__value">{session.label || '—'}</div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="warnings-list">
          {warnings.map((w, i) => (
            <div key={i} className="warning-item">{w}</div>
          ))}
        </div>
      )}

      <CostBreakdown model={session.model} usage={usage} vatRate={vatRate} />

      <div className="detail-tabs">
        <button
          className={`detail-tab ${activeTab === 'transcript' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('transcript')}
        >
          Transcript
        </button>
        <button
          className={`detail-tab ${activeTab === 'diff' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('diff')}
        >
          Diff
        </button>
      </div>

      {activeTab === 'transcript' && (
        loadingTranscript
          ? <div className="loading">Loading...</div>
          : <TranscriptView content={transcript} />
      )}

      {activeTab === 'diff' && (
        loadingDiff
          ? <div className="loading">Loading...</div>
          : <DiffView content={diff} />
      )}
    </div>
  );
}
