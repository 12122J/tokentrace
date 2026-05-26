import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

function getCacheRead(usage) {
  if (!usage) return 0;
  return usage.cache_read_tokens ?? usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? 0;
}

function aggregateByDay(sessions) {
  const map = new Map();

  for (const s of sessions) {
    const date = (s.started_at || s.completed_at || '').slice(0, 10);
    if (!date || !s.usage) continue;
    const u = s.usage;
    const cacheRead = getCacheRead(u);
    const freshInput = u.input_tokens ?? 0;
    if (freshInput + cacheRead === 0) continue;

    const prev = map.get(date) ?? { cacheRead: 0, freshInput: 0 };
    map.set(date, {
      cacheRead: prev.cacheRead + cacheRead,
      freshInput: prev.freshInput + freshInput,
    });
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const total = v.cacheRead + v.freshInput;
      return {
        date,
        label: formatLabel(date),
        rate: total > 0 ? parseFloat(((v.cacheRead / total) * 100).toFixed(1)) : 0,
      };
    });
}

function formatLabel(dateStr) {
  const [, month, day] = dateStr.split('-');
  return `${parseInt(month, 10)}/${parseInt(day, 10)}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">{label}</div>
      <div className="custom-tooltip__value">{payload[0].value}% cached</div>
    </div>
  );
}

export default function CacheEfficiencyChart({ sessions }) {
  const data = useMemo(() => aggregateByDay(sessions), [sessions]);
  const hasData = data.some(d => d.rate > 0);

  if (!hasData || data.length === 0) {
    return (
      <div className="chart-section">
        <div className="chart-section__title">Cache Hit Rate</div>
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>No cache data available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-section">
      <div className="chart-section__title">Cache Hit Rate</div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
            tickFormatter={v => `${v}%`}
            width={40}
            domain={[0, 100]}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={80} stroke="#e5e7eb" strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
