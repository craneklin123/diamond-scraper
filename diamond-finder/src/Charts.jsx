import { useState, useCallback } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { ParallelCoords } from './ParallelCoords.jsx';
import { BoxPlots } from './BoxPlots.jsx';

const CLARITY_ORDER = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];
const COLOR_ORDER   = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];

const METRICS = [
  { key: 'carat',   label: 'Price vs Carat',  xLabel: 'Carat Weight'  },
  { key: 'color',   label: 'Price vs Color',   xLabel: 'Color Grade'   },
  { key: 'clarity', label: 'Price vs Clarity', xLabel: 'Clarity Grade' },
  { key: 'grouped', label: 'All Attributes',   xLabel: ''              },
  { key: 'value',   label: '$/ct Analysis',    xLabel: ''              },
];

function toX(row, metric) {
  if (metric === 'carat')   return parseFloat(row['Carat Weight']);
  if (metric === 'color')   return COLOR_ORDER.indexOf(row['Color Grade']);
  if (metric === 'clarity') return CLARITY_ORDER.indexOf(row['Clarity Grade']);
  return null;
}

function xLabel(val, metric) {
  if (metric === 'color')   return COLOR_ORDER[val]   ?? '';
  if (metric === 'clarity') return CLARITY_ORDER[val] ?? '';
  return val;
}

function rowKey(r) {
  return `${r.Vendor}::${r['Vendor SKU']}::${r.Price}`;
}

function priceLabel(v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v}`;
}

function makeDotShape(selected, onSelect) {
  return function DiamondDot({ cx, cy, payload }) {
    if (cx == null || cy == null) return null;
    const isLab = payload.row?.Origin === 'Lab Grown';
    const isSel = selected && rowKey(selected) === rowKey(payload.row);
    return (
      <circle
        cx={cx} cy={cy}
        r={isSel ? 8 : 4}
        fill={isLab ? '#10b981' : '#94a3b8'}
        fillOpacity={isSel ? 1 : 0.65}
        stroke={isSel ? '#1e40af' : 'transparent'}
        strokeWidth={2}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(isSel ? null : payload.row)}
      />
    );
  };
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d?.row) return null;
  const r = d.row;
  return (
    <div className="chart-tooltip">
      <div className="ct-price">${Number(r.Price).toLocaleString()}</div>
      <div className="ct-detail">{r['Carat Weight']}ct · {r.Shape}</div>
      <div className="ct-detail">{r['Color Grade']} · {r['Clarity Grade']} · {r['Cut Grade']}</div>
      <div className="ct-detail">{r.Origin} · {r['Grading Lab']}</div>
      <div className="ct-vendor">{r.Vendor}</div>
      <div className="ct-hint">Click to select</div>
    </div>
  );
}

export function Charts({ rows, selected, onSelect }) {
  const [metric, setMetric] = useState('grouped');

  // ── All hooks must be called unconditionally ──────────────────────────────
  const DotShape = useCallback(
    makeDotShape(selected, onSelect),
    [selected, onSelect]
  );

  const chartData = metric !== 'grouped' && metric !== 'value'
    ? rows
        .map(r => ({ x: toX(r, metric), y: parseFloat(r.Price), row: r }))
        .filter(d => d.x != null && d.x !== -1 && !isNaN(d.x) && !isNaN(d.y))
    : [];

  const labData   = chartData.filter(d => d.row.Origin === 'Lab Grown');
  const minedData = chartData.filter(d => d.row.Origin !== 'Lab Grown');

  const isCategorical = metric === 'color' || metric === 'clarity';
  const catOrder = metric === 'color' ? COLOR_ORDER : CLARITY_ORDER;
  const ticks  = isCategorical ? catOrder.map((_, i) => i) : undefined;
  const domain = isCategorical ? [-0.5, catOrder.length - 0.5] : ['auto', 'auto'];
  // ─────────────────────────────────────────────────────────────────────────

  const tabs = (
    <div className="chart-tabs">
      {METRICS.map(m => (
        <button
          key={m.key}
          className={`chart-tab ${metric === m.key ? 'active' : ''}`}
          onClick={() => setMetric(m.key)}
        >
          {m.label}
        </button>
      ))}
      {metric !== 'grouped' && metric !== 'value' && (
        <div className="chart-legend">
          <span className="legend-dot lab" /> Lab Grown
          <span className="legend-dot mined" /> Mined
        </div>
      )}
    </div>
  );

  if (metric === 'grouped') {
    return (
      <div className="charts-panel">
        {tabs}
        <ParallelCoords rows={rows} selected={selected} onSelect={onSelect} />
      </div>
    );
  }

  if (metric === 'value') {
    return (
      <div className="charts-panel">
        {tabs}
        <BoxPlots rows={rows} />
      </div>
    );
  }

  return (
    <div className="charts-panel">
      {tabs}
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 10, right: 24, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e4" />
          <XAxis
            dataKey="x"
            type="number"
            name={metric}
            domain={domain}
            ticks={ticks}
            tickFormatter={v => xLabel(v, metric)}
            label={{
              value: METRICS.find(m => m.key === metric).xLabel,
              position: 'insideBottom', offset: -16, fontSize: 12, fill: '#6b7280',
            }}
            tick={{ fontSize: 12, fill: '#6b7280' }}
          />
          <YAxis
            dataKey="y"
            name="Price"
            tickFormatter={priceLabel}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            width={56}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          {labData.length > 0 && (
            <Scatter name="Lab Grown" data={labData} shape={<DotShape />} />
          )}
          {minedData.length > 0 && (
            <Scatter name="Mined" data={minedData} shape={<DotShape />} />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
