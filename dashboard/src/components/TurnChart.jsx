import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const billed = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">Turn {label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.fill, fontSize: 12 }}>
          {p.name}: {fmt(p.value)}
        </div>
      ))}
      <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 4, paddingTop: 4, fontSize: 12, color: '#6b7280' }}>
        Billed: {fmt(billed)}
      </div>
    </div>
  );
}

export default function TurnChart({ turns }) {
  const data = useMemo(() => {
    if (!turns?.length) return [];
    return turns.map((t, i) => ({
      turn: i + 1,
      Input: t.input,
      'Cache write': t.cacheWrite,
      Output: t.output,
      cacheRead: t.cacheRead,
    }));
  }, [turns]);

  if (!data.length) {
    return (
      <div style={{ padding: '24px', fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
        No per-turn data — requires a session recorded after v0.5.
      </div>
    );
  }

  const maxTicks = Math.min(data.length, 20);
  const tickInterval = Math.ceil(data.length / maxTicks) - 1;

  return (
    <div style={{ padding: '16px 0 8px' }}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="#f3f4f6" />
          <XAxis
            dataKey="turn"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar dataKey="Input" stackId="a" fill="#0066ff" />
          <Bar dataKey="Cache write" stackId="a" fill="#f59e0b" />
          <Bar dataKey="Output" stackId="a" fill="#10b981" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {data.some(d => d.cacheRead > 0) && (
        <div style={{ fontSize: 11, color: '#9ca3af', padding: '4px 16px' }}>
          Cache reads (avg {fmt(Math.round(data.reduce((s, d) => s + d.cacheRead, 0) / data.length))} / turn) not shown — repeated context, not billed as new tokens.
        </div>
      )}
    </div>
  );
}
