import React from 'react';

function formatCost(value, estimated = false) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '—';
  const p = estimated ? '~' : '';
  if (value >= 1) return `${p}$${value.toFixed(2)}`;
  return `${p}$${value.toFixed(4)}`;
}

const PRICING = [
  { prefix: 'claude-opus-4',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-4', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-4',  input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  { prefix: 'claude-opus-3',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-3', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-3',  input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
];

function sessionCost(s) {
  if (s.usage?.cost_usd != null) return s.usage.cost_usd;
  if (!s.model || !s.usage) return null;
  const p = PRICING.find(t => s.model.startsWith(t.prefix));
  if (!p) return null;
  const M = 1_000_000;
  const u = s.usage;
  return (
    (u.input_tokens  ?? 0) / M * p.input      +
    (u.cache_creation_tokens ?? 0) / M * p.cacheWrite +
    (u.cache_read_tokens ?? u.cached_input_tokens ?? 0) / M * p.cacheRead +
    (u.output_tokens ?? 0) / M * p.output
  );
}

function formatTokens(value) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function effectiveTokens(usage) {
  if (!usage) return 0;
  // Old format: cached_input_tokens combines creation+reads, total_tokens is inflated.
  // New format: cache_creation_tokens is separate, total_tokens is correct.
  if ('cache_creation_tokens' in usage) return usage.total_tokens ?? 0;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

export default function MetricsStrip({ sessions }) {
  const costs = sessions.map(s => sessionCost(s)).filter(c => c != null);
  const totalCost = costs.reduce((sum, c) => sum + c, 0);
  const totalTokens = sessions.reduce((sum, s) => sum + effectiveTokens(s.usage), 0);
  const sessionCount = sessions.length;
  const avgCost = costs.length > 0 ? totalCost / costs.length : null;
  const isEstimated = costs.length > 0 && sessions.some(s => s.usage?.cost_usd == null && sessionCost(s) != null);

  return (
    <div className="metrics-strip">
      <div className="metric-card">
        <div className="metric-card__label">Total Cost</div>
        <div className="metric-card__value">{costs.length > 0 ? formatCost(totalCost, isEstimated) : '—'}</div>
        <div className="metric-card__sub">{sessionCount} session{sessionCount !== 1 ? 's' : ''}</div>
      </div>
      <div className="metric-card">
        <div className="metric-card__label">Total Tokens</div>
        <div className="metric-card__value">{formatTokens(totalTokens)}</div>
        <div className="metric-card__sub">input + output + cache writes</div>
      </div>
      <div className="metric-card">
        <div className="metric-card__label">Sessions</div>
        <div className="metric-card__value">{sessionCount === 0 ? '—' : sessionCount.toLocaleString()}</div>
        <div className="metric-card__sub">recorded runs</div>
      </div>
      <div className="metric-card">
        <div className="metric-card__label">Avg Cost / Session</div>
        <div className="metric-card__value">
          {avgCost != null ? formatCost(avgCost, isEstimated) : '—'}
        </div>
        <div className="metric-card__sub">per run</div>
      </div>
    </div>
  );
}
