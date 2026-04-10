import { useState, useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const CLARITY_ORDER = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2','I1','I2','I3'];
const COLOR_ORDER   = ['D','E','F','G','H','I','J','K','L','M'];
const CUT_ORDER     = ['Ideal','Super Ideal','Excellent','Very Good','Good','Fair','Poor'];

const DEFAULT_WEIGHTS = { carat: 3, cut: 2, clarity: 1, color: 1 };

function scoreRow(r, weights, caratRange) {
  const carat   = parseFloat(r['Carat Weight']);
  const colorIdx   = COLOR_ORDER.indexOf(r['Color Grade']);
  const clarityIdx = CLARITY_ORDER.indexOf(r['Clarity Grade']);
  const cutIdx     = CUT_ORDER.indexOf(r['Cut Grade']);

  if (isNaN(carat) || colorIdx === -1 || clarityIdx === -1 || cutIdx === -1) return null;

  const [minC, maxC] = caratRange;
  const caratScore   = maxC > minC ? (carat - minC) / (maxC - minC) : 0;
  const colorScore   = 1 - colorIdx   / (COLOR_ORDER.length   - 1);
  const clarityScore = 1 - clarityIdx / (CLARITY_ORDER.length - 1);
  const cutScore     = 1 - cutIdx     / (CUT_ORDER.length     - 1);

  const total = weights.carat   * caratScore
              + weights.color   * colorScore
              + weights.clarity * clarityScore
              + weights.cut     * cutScore;

  return total;
}

function priceLabel(v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v}`;
}

function ScoreTooltip({ active, payload }) {
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
      <div className="ct-detail" style={{color:'#2563eb',marginTop:4}}>Score: {d.x.toFixed(2)}</div>
      <div className="ct-hint">Click to select</div>
    </div>
  );
}

export function ValueScore({ rows, selected, onSelect }) {
  const [draft, setDraft]     = useState(DEFAULT_WEIGHTS);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [flash, setFlash]     = useState(false);

  const caratRange = useMemo(() => {
    const vals = rows.map(r => parseFloat(r['Carat Weight'])).filter(v => !isNaN(v));
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 5];
  }, [rows]);

  const chartData = useMemo(() => {
    return rows
      .map(r => {
        const score = scoreRow(r, weights, caratRange);
        const price = parseFloat(r.Price);
        if (score === null || isNaN(price)) return null;
        return { x: score, y: price, row: r };
      })
      .filter(Boolean);
  }, [rows, weights, caratRange]);

  const priceDomain = useMemo(() => {
    if (!chartData.length) return ['auto', 'auto'];
    const prices = chartData.map(d => d.y);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }, [chartData]);

  const labData   = chartData.filter(d => d.row.Origin === 'Lab Grown');
  const minedData = chartData.filter(d => d.row.Origin !== 'Lab Grown');

  function rowKey(r) { return `${r.Vendor}::${r['Vendor SKU']}::${r.Price}`; }

  function Dot({ cx, cy, payload }) {
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
  }

  function recalculate() {
    setWeights({ ...draft });
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
  }

  function setW(key, val) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  const ATTRS = [
    { key: 'carat',   label: 'Carat Weight' },
    { key: 'cut',     label: 'Cut Grade'    },
    { key: 'clarity', label: 'Clarity Grade'},
    { key: 'color',   label: 'Color Grade'  },
  ];

  return (
    <div>
      <div className="score-controls">
        <div className="score-weights">
          {ATTRS.map(({ key, label }) => (
            <div key={key} className="score-weight-row">
              <label className="score-weight-label" htmlFor={`w-${key}`}>{label}</label>
              <input
                id={`w-${key}`}
                type="number" min="0" max="100" step="1"
                value={draft[key]}
                onChange={e => setW(key, Number(e.target.value))}
                className="score-weight-input"
              />
            </div>
          ))}
        </div>
        <button
          className={`recalc-btn${flash ? ' recalc-flash' : ''}`}
          onClick={recalculate}
        >
          Recalculate
        </button>
      </div>

      <div className="score-axis-labels">
        <span style={{color:'#6b7280',fontSize:12}}>← cheaper (better value)</span>
        <span style={{color:'#6b7280',fontSize:12,marginLeft:'auto'}}>higher score →</span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 24, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e4" />
          <XAxis
            dataKey="x"
            type="number"
            name="Score"
            domain={['auto', 'auto']}
            tickFormatter={v => v.toFixed(1)}
            label={{ value: 'Value Score', position: 'insideBottom', offset: -16, fontSize: 12, fill: '#6b7280' }}
            tick={{ fontSize: 12, fill: '#6b7280' }}
          />
          <YAxis
            dataKey="y"
            name="Price"
            reversed
            domain={priceDomain}
            tickFormatter={priceLabel}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            width={56}
            label={{ value: 'Price (↑ cheaper)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 12, fill: '#6b7280' }}
          />
          <Tooltip content={<ScoreTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          {labData.length   > 0 && <Scatter name="Lab Grown" data={labData}   shape={<Dot />} />}
          {minedData.length > 0 && <Scatter name="Mined"     data={minedData} shape={<Dot />} />}
        </ScatterChart>
      </ResponsiveContainer>

      <div className="chart-legend" style={{justifyContent:'center',marginTop:4}}>
        <span><span className="legend-dot lab" /> Lab Grown</span>
        <span><span className="legend-dot mined" /> Mined</span>
      </div>
    </div>
  );
}
