import React, { useState, useEffect } from 'react';
import { lookupPrice, sessionCost } from '../pricing.js';
import TurnChart from './TurnChart.jsx';

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function formatCost(value, estimated = false) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '—';
  const prefix = estimated ? '~' : '';
  if (value >= 1) return `${prefix}$${value.toFixed(2)}`;
  return `${prefix}$${value.toFixed(4)}`;
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
  const fromParts = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  const total = isNewFormat
    ? usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.cache_creation_tokens ?? 0) + (usage.output_tokens ?? 0))
    : (fromParts > 0 ? fromParts : (usage.total_tokens ?? null));
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
  const u = session.usage;
  if (u) {
    const cacheWrite = u.cache_creation_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    if (cacheWrite > 0 && output > 0 && cacheWrite > output * 8) {
      const ratio = (cacheWrite / output).toFixed(0);
      warnings.push(`Context bloat: ${ratio}× more cache writes than output — large context loaded with little output`);
    }
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

function CostBreakdown({ model, usage, vatRate, pricingDb }) {
  if (!usage || !model) return null;
  const p = lookupPrice(pricingDb, model);
  if (!p) return null;

  const M = 1_000_000;
  const rows = [
    { label: 'Input',       tokens: usage.input_tokens  ?? 0, rate: p.input      },
    { label: 'Cache write', tokens: usage.cache_creation_tokens ?? 0, rate: p.cacheWrite },
    { label: 'Cache reads', tokens: usage.cache_read_tokens ?? usage.cached_input_tokens ?? 0, rate: p.cacheRead },
    { label: 'Output',      tokens: usage.output_tokens ?? 0, rate: p.output     },
  ].filter(r => r.tokens > 0 && r.rate != null);

  if (rows.length === 0) return null;

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
      <div className="cost-breakdown__rows">
        {rows.map(r => (
          <div key={r.label} className="cost-breakdown__row">
            <span className="cost-breakdown__row-label">{r.label}</span>
            <span className="cost-breakdown__row-tokens">{fmtTokens(r.tokens)}</span>
            <span className="cost-breakdown__row-rate">${r.rate.toFixed(2)}/M</span>
            <span className="cost-breakdown__row-cost">{fmt(r.tokens / M * r.rate)}</span>
          </div>
        ))}
        <div className="cost-breakdown__divider" />
        <div className="cost-breakdown__row cost-breakdown__row--subtotal">
          <span className="cost-breakdown__row-label">Subtotal</span>
          <span className="cost-breakdown__row-tokens" />
          <span className="cost-breakdown__row-rate" />
          <span className="cost-breakdown__row-cost">{fmt(subtotal)}</span>
        </div>
        {vatRate > 0 && (
          <div className="cost-breakdown__row cost-breakdown__row--vat">
            <span className="cost-breakdown__row-label">VAT {vatRate}%</span>
            <span className="cost-breakdown__row-tokens" />
            <span className="cost-breakdown__row-rate" />
            <span className="cost-breakdown__row-cost">{fmt(vat)}</span>
          </div>
        )}
        <div className="cost-breakdown__row cost-breakdown__row--total">
          <span className="cost-breakdown__row-label">{vatRate > 0 ? 'Total incl. VAT' : 'Total'}</span>
          <span className="cost-breakdown__row-tokens" />
          <span className="cost-breakdown__row-rate" />
          <span className="cost-breakdown__row-cost">{fmt(total)}</span>
        </div>
      </div>
      <div className="cost-breakdown__note">
        Estimated from Anthropic published pricing.{vatRate === 0 && ' Set VAT rate in Settings for EU totals.'}
      </div>
    </div>
  );
}

function LabelEditor({ sessionId, value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => { setDraft(value || ''); }, [value]);

  function save() {
    const trimmed = draft.trim();
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/label`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed || null }),
    })
      .then(r => r.json())
      .then(d => { onChange(d.label); setEditing(false); })
      .catch(() => setEditing(false));
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="label-input"
        value={draft}
        placeholder="Add a label…"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
        onBlur={save}
      />
    );
  }
  return (
    <button className="label-trigger" onClick={() => setEditing(true)} title="Click to edit label">
      {value || <span className="label-trigger__empty">+ add label</span>}
    </button>
  );
}

export default function SessionDetail({ session, vatRate = 0, pricingDb = null, onLabelChange }) {
  const hasTurns = Array.isArray(session?.turns) && session.turns.length > 1;
  const [activeTab, setActiveTab] = useState('transcript');
  const [transcript, setTranscript] = useState(null);
  const [diff, setDiff] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [label, setLabel] = useState(session?.label ?? null);

  useEffect(() => { setLabel(session?.label ?? null); }, [session?.id]);

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
  const { value: baseCost, estimated: isEstimated } = sessionCost(session, pricingDb);
  const displayCost = baseCost != null ? baseCost * (1 + vatRate / 100) : null;

  return (
    <div className="detail-panel">
      <div className="section-header">Session Detail</div>

      <div className="detail-header">
        <div className="detail-header__id">{session.id}</div>
        {session.description && (
          <div className="detail-header__description">{session.description}</div>
        )}
      </div>

      <div className="detail-label-row">
        <span className="detail-label-row__key">Label</span>
        <LabelEditor
          sessionId={session.id}
          value={label}
          onChange={v => { setLabel(v); onLabelChange?.(session.id, v); }}
        />
      </div>

      <div className="detail-meta-grid">
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">{session.started_at ? 'Started' : 'Completed'}</div>
          <div className="detail-meta-item__value">{formatDate(session.started_at || session.completed_at)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Model</div>
          <div className="detail-meta-item__value" style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>{session.model || '—'}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Source</div>
          <div className="detail-meta-item__value" style={{ fontSize: 12, color: '#6b7280' }}>
            {session.source === 'codex-desktop' ? 'Codex Desktop'
              : session.source === 'hook' && session.entrypoint === 'desktop' ? 'Claude Code Desktop'
              : session.source === 'hook' && (session.entrypoint === 'ide' || session.entrypoint === 'vscode') ? 'Claude Code IDE'
              : session.source === 'hook' && session.entrypoint === 'cli' ? 'Claude Code CLI'
              : session.source === 'hook' ? 'Claude Code'
              : session.agent || '—'}
          </div>
        </div>
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
          <div className="detail-meta-item__label">Tokens</div>
          <div className="detail-meta-item__value">{formatTokens(displayTotal)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Output</div>
          <div className="detail-meta-item__value">{formatTokens(usage?.output_tokens)}</div>
        </div>
        <div className="detail-meta-item">
          <div className="detail-meta-item__label">Cache Reads</div>
          <div className="detail-meta-item__value" title="Context re-reads across turns — not counted in total">{formatTokens(cacheReads)}</div>
        </div>
        {gitAvailable && (
          <>
            <div className="detail-meta-item">
              <div className="detail-meta-item__label">Files Changed</div>
              <div className="detail-meta-item__value">{session.diff?.files_changed ?? '—'}</div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-item__label">Branch</div>
              <div className="detail-meta-item__value">{gitBranch || '—'}</div>
            </div>
            <div className="detail-meta-item">
              <div className="detail-meta-item__label">Commit</div>
              <div className="detail-meta-item__value" style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>
                {git?.commit ? git.commit.slice(0, 8) : '—'}
              </div>
            </div>
          </>
        )}
        {(session.profile || session.account_key_prefix) && (
          <div className="detail-meta-item">
            <div className="detail-meta-item__label">Account</div>
            <div className="detail-meta-item__value">
              {session.profile || <span style={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>{session.account_key_prefix}…</span>}
            </div>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="warnings-list">
          {warnings.map((w, i) => (
            <div key={i} className="warning-item">{w}</div>
          ))}
        </div>
      )}

      <CostBreakdown model={session.model} usage={usage} vatRate={vatRate} pricingDb={pricingDb} />

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
        {hasTurns && (
          <button
            className={`detail-tab ${activeTab === 'turns' ? 'detail-tab--active' : ''}`}
            onClick={() => setActiveTab('turns')}
          >
            Turns
          </button>
        )}
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

      {activeTab === 'turns' && (
        <TurnChart turns={session.turns} />
      )}
    </div>
  );
}
