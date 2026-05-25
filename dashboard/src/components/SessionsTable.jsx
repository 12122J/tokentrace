import React, { useState, useMemo } from 'react';

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatCost(value) {
  if (value == null || isNaN(value)) return '—';
  if (value === 0) return '—';
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatTokens(value) {
  if (value == null || isNaN(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function effectiveTokens(usage) {
  if (!usage) return null;
  if ('cache_creation_tokens' in usage) return usage.total_tokens;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const COLUMNS = [
  { key: 'started_at', label: 'Date', sortFn: (a, b) => (a.started_at || a.completed_at || '').localeCompare(b.started_at || b.completed_at || '') },
  { key: 'model', label: 'Model', sortFn: (a, b) => (a.model || '').localeCompare(b.model || '') },
  { key: 'total_tokens', label: 'Tokens', sortFn: (a, b) => (effectiveTokens(a.usage) ?? -1) - (effectiveTokens(b.usage) ?? -1) },
  { key: 'cost_usd', label: 'Cost', sortFn: (a, b) => (a.usage?.cost_usd ?? -1) - (b.usage?.cost_usd ?? -1) },
  { key: 'files_changed', label: 'Files', sortFn: (a, b) => (a.diff?.files_changed ?? -1) - (b.diff?.files_changed ?? -1) },
  { key: 'duration_ms', label: 'Duration', sortFn: (a, b) => (a.duration_ms ?? -1) - (b.duration_ms ?? -1) },
  { key: 'success', label: 'Status', sortFn: (a, b) => Number(b.success) - Number(a.success) },
];

export default function SessionsTable({ sessions, selectedId, onSelect }) {
  const [sortKey, setSortKey] = useState('started_at');
  const [sortDir, setSortDir] = useState('desc');

  const sorted = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sortKey);
    if (!col) return sessions;
    const arr = [...sessions].sort(col.sortFn);
    return sortDir === 'asc' ? arr : arr.reverse();
  }, [sessions, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="sessions-table-wrapper">
        <div className="empty-state">
          <p className="empty-state__text">
            No sessions recorded yet. Run <code className="empty-state__code">tt install</code> to start recording.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-table-wrapper">
      <table className="sessions-table">
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={sortKey === col.key ? 'sorted' : ''}
              >
                {col.label}
                <span className="sort-indicator">
                  {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(session => (
            <tr
              key={session.id}
              onClick={() => onSelect(session.id === selectedId ? null : session.id)}
              className={session.id === selectedId ? 'selected' : ''}
            >
              <td>{formatDate(session.started_at || session.completed_at)}</td>
              <td className="muted" style={{ fontFamily: 'Menlo, monospace', fontSize: 11 }}>{session.model ? session.model.replace('claude-', '') : '—'}</td>
              <td className="muted">{formatTokens(effectiveTokens(session.usage))}</td>
              <td className="muted">{formatCost(session.usage?.cost_usd)}</td>
              <td className="muted">{session.diff?.files_changed ?? '—'}</td>
              <td className="muted">{formatDuration(session.duration_ms)}</td>
              <td>
                <span className={`status-badge ${session.success !== false && session.exit_code === 0 ? 'status-badge--ok' : 'status-badge--fail'}`}>
                  {session.success !== false && session.exit_code === 0 ? 'ok' : `exit ${session.exit_code ?? '?'}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
