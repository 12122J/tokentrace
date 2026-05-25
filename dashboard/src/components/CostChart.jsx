import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const CHART_PRICING = [
  { prefix: 'claude-opus-4',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-4', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-4',  input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
  { prefix: 'claude-opus-3',   input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  { prefix: 'claude-sonnet-3', input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  { prefix: 'claude-haiku-3',  input:  0.25, output:  1.25, cacheWrite:  0.30, cacheRead: 0.03 },
];

function sessionCostValue(session) {
  if (session.usage?.cost_usd != null) return session.usage.cost_usd;
  if (!session.model || !session.usage) return 0;
  const p = CHART_PRICING.find(t => session.model.startsWith(t.prefix));
  if (!p) return 0;
  const M = 1_000_000;
  const u = session.usage;
  return (
    (u.input_tokens ?? 0) / M * p.input +
    (u.cache_creation_tokens ?? 0) / M * p.cacheWrite +
    (u.cache_read_tokens ?? u.cached_input_tokens ?? 0) / M * p.cacheRead +
    (u.output_tokens ?? 0) / M * p.output
  );
}

function aggregateByDay(sessions, vatRate) {
  const map = new Map();
  const mult = 1 + vatRate / 100;

  for (const session of sessions) {
    const date = (session.started_at || session.completed_at || '').slice(0, 10);
    if (!date) continue;
    const cost = sessionCostValue(session) * mult;
    map.set(date, (map.get(date) ?? 0) + cost);
  }

  // Sort ascending by date
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cost]) => ({
      date,
      label: formatDateLabel(date),
      cost: parseFloat(cost.toFixed(6)),
    }));
}

function formatDateLabel(dateStr) {
  const [, month, day] = dateStr.split('-');
  return `${parseInt(month, 10)}/${parseInt(day, 10)}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
  const formatted = value === 0 ? '—' : value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">{label}</div>
      <div className="custom-tooltip__value">{formatted}</div>
    </div>
  );
}

export default function CostChart({ sessions, vatRate = 0 }) {
  const data = useMemo(() => aggregateByDay(sessions, vatRate), [sessions, vatRate]);

  const hasCost = sessions.some(s => sessionCostValue(s) > 0);

  if (!hasCost || data.length === 0) {
    return (
      <div className="chart-section">
        <div className="chart-section__title">Cost per Day</div>
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>No cost data available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-section">
      <div className="chart-section__title">Cost per Day</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="#f3f4f6" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v === 0 ? '' : `$${v.toFixed(2)}`}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
          <Bar dataKey="cost" fill="#0066ff" radius={0} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
