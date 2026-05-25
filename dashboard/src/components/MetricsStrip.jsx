import React from 'react';

function formatCost(value) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '—';
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
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
  const totalCost = sessions.reduce((sum, s) => sum + (s.usage?.cost_usd ?? 0), 0);
  const totalTokens = sessions.reduce((sum, s) => sum + effectiveTokens(s.usage), 0);
  const sessionCount = sessions.length;
  const avgCost = sessionCount > 0 ? totalCost / sessionCount : null;

  const hasCost = sessions.some(s => s.usage?.cost_usd != null);

  return (
    <div className="metrics-strip">
      <div className="metric-card">
        <div className="metric-card__label">Total Cost</div>
        <div className="metric-card__value">{hasCost ? formatCost(totalCost) : '—'}</div>
        <div className="metric-card__sub">{sessionCount} session{sessionCount !== 1 ? 's' : ''}</div>
      </div>
      <div className="metric-card">
        <div className="metric-card__label">Total Tokens</div>
        <div className="metric-card__value">{formatTokens(totalTokens)}</div>
        <div className="metric-card__sub">across all sessions</div>
      </div>
      <div className="metric-card">
        <div className="metric-card__label">Sessions</div>
        <div className="metric-card__value">{sessionCount === 0 ? '—' : sessionCount.toLocaleString()}</div>
        <div className="metric-card__sub">recorded runs</div>
      </div>
      <div className="metric-card">
        <div className="metric-card__label">Avg Cost / Session</div>
        <div className="metric-card__value">
          {hasCost && avgCost != null ? formatCost(avgCost) : '—'}
        </div>
        <div className="metric-card__sub">per run</div>
      </div>
    </div>
  );
}
