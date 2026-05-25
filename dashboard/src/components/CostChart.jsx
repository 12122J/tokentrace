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
import { sessionCost } from '../pricing.js';

function sessionCostValue(session, pricingDb) {
  return sessionCost(session, pricingDb).value ?? 0;
}

function aggregateByDay(sessions, vatRate, pricingDb) {
  const map = new Map();
  const mult = 1 + vatRate / 100;

  for (const session of sessions) {
    const date = (session.started_at || session.completed_at || '').slice(0, 10);
    if (!date) continue;
    const cost = sessionCostValue(session, pricingDb) * mult;
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

export default function CostChart({ sessions, vatRate = 0, pricingDb = null }) {
  const data = useMemo(() => aggregateByDay(sessions, vatRate, pricingDb), [sessions, vatRate, pricingDb]);

  const hasCost = sessions.some(s => sessionCostValue(s, pricingDb) > 0);

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
