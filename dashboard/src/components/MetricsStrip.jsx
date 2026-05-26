import React from 'react';
import { effectiveTokens, sessionCost } from '../pricing.js';

function formatCost(value, estimated = false) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '—';
  const p = estimated ? '~' : '';
  if (value >= 1) return `${p}$${value.toFixed(2)}`;
  return `${p}$${value.toFixed(4)}`;
}

function formatTokens(value) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function cacheHitRate(sessions) {
  let totalCacheRead = 0;
  let totalFresh = 0;
  for (const s of sessions) {
    const u = s.usage;
    if (!u) continue;
    totalCacheRead += u.cache_read_tokens ?? u.cache_read_input_tokens ?? u.cached_input_tokens ?? 0;
    totalFresh += u.input_tokens ?? 0;
  }
  const total = totalCacheRead + totalFresh;
  return total > 0 ? (totalCacheRead / total) * 100 : null;
}

export default function MetricsStrip({ sessions, vatRate = 0, pricingDb = null }) {
  const costResults = sessions.map(s => sessionCost(s, pricingDb));
  const costs = costResults.map(c => c.value).filter(c => c != null);
  const subtotal = costs.reduce((sum, c) => sum + c, 0);
  const totalCost = subtotal * (1 + vatRate / 100);
  const totalTokens = sessions.reduce((sum, s) => sum + effectiveTokens(s.usage), 0);
  const sessionCount = sessions.length;
  const avgCost = costs.length > 0 ? totalCost / costs.length : null;
  const isEstimated = costResults.some(c => c.value != null && c.estimated);
  const hitRate = cacheHitRate(sessions);

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
      <div className="metric-card">
        <div className="metric-card__label">Cache Hit Rate</div>
        <div className="metric-card__value">
          {hitRate != null ? `${hitRate.toFixed(0)}%` : '—'}
        </div>
        <div className="metric-card__sub">input tokens served from cache</div>
      </div>
    </div>
  );
}
