import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { sessionCost } from '../pricing.js';

function truncate(str, len) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function fmtCost(v) {
  if (v == null) return '—';
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label" style={{ maxWidth: 200, whiteSpace: 'normal', lineHeight: 1.4 }}>
        {d.fullLabel}
      </div>
      <div className="custom-tooltip__value">{fmtCost(payload[0].value)}{d.estimated ? ' (est.)' : ''}</div>
    </div>
  );
}

export default function TopCostChart({ sessions, vatRate = 0, pricingDb = null, selectedId, onSelect }) {
  const mult = 1 + vatRate / 100;

  const data = useMemo(() => {
    const ranked = sessions
      .map(s => {
        const { value, estimated } = sessionCost(s, pricingDb);
        return { s, cost: value != null ? value * mult : null, estimated };
      })
      .filter(d => d.cost != null && d.cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    return ranked.reverse().map(({ s, cost, estimated }) => ({
      id: s.id,
      label: truncate(s.label || s.description || s.id, 30),
      fullLabel: s.label || s.description || s.id,
      cost: parseFloat(cost.toFixed(6)),
      estimated,
    }));
  }, [sessions, vatRate, pricingDb]);

  if (data.length === 0) {
    return (
      <div className="chart-section">
        <div className="chart-section__title">Top Sessions by Cost</div>
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>No cost data available</span>
        </div>
      </div>
    );
  }

  const barHeight = 24;
  const chartHeight = data.length * barHeight + 32;

  return (
    <div className="chart-section">
      <div className="chart-section__title">Top Sessions by Cost</div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid horizontal={false} stroke="#f3f4f6" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => v === 0 ? '' : fmtCost(v)}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: '#374151' }}
            axisLine={false}
            tickLine={false}
            width={160}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f9fafb' }} />
          <Bar
            dataKey="cost"
            radius={[0, 2, 2, 0]}
            onClick={d => onSelect?.(d.id === selectedId ? null : d.id)}
            style={{ cursor: 'pointer' }}
          >
            {data.map(d => (
              <Cell key={d.id} fill={d.id === selectedId ? '#004acc' : '#0066ff'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
