import { useState, useMemo, useRef, useCallback, useEffect } from 'react';

const COLOR_ORDER   = ['D','E','F','G','H','I','J','K','L','M'];
const CLARITY_ORDER = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2'];

const MARGIN = { top: 16, right: 24, bottom: 72, left: 64 };
const HEIGHT  = 340;

function rowKey(r) {
  return `${r.Vendor}::${r['Vendor SKU']}::${r.Price}`;
}

function caratToRadius(carat) {
  const c = parseFloat(carat) || 0.5;
  return Math.max(3, Math.min(10, 3 + (c - 0.25) * 4));
}

function nicePrice(p) {
  if (p >= 1000) return `$${(p / 1000).toFixed(1)}k`;
  return `$${Math.round(p)}`;
}

export function GroupedScatter({ rows, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const [width, setWidth] = useState(860);
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    obs.observe(el);
    setWidth(el.clientWidth || 860);
    return () => obs.disconnect();
  }, []);

  const innerW = Math.max(200, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  // Only include rows with known color + clarity
  const valid = useMemo(() =>
    rows.filter(r =>
      COLOR_ORDER.includes(r['Color Grade']) &&
      CLARITY_ORDER.includes(r['Clarity Grade']) &&
      parseFloat(r.Price) > 0
    ), [rows]);

  // Price scale
  const { minP, maxP } = useMemo(() => {
    const ps = valid.map(r => parseFloat(r.Price));
    return { minP: Math.min(...ps, 0), maxP: Math.max(...ps, 1) };
  }, [valid]);

  const toY = useCallback(price =>
    innerH - ((price - minP) / (maxP - minP)) * innerH,
    [innerH, minP, maxP]);

  // Group colors that actually appear
  const usedColors = useMemo(() =>
    COLOR_ORDER.filter(c => valid.some(r => r['Color Grade'] === c)),
    [valid]);

  const usedClarities = useMemo(() =>
    CLARITY_ORDER.filter(c => valid.some(r => r['Clarity Grade'] === c)),
    [valid]);

  const numColors    = usedColors.length;
  const numClarities = usedClarities.length;
  const groupW = innerW / numColors;
  const slotW  = groupW / numClarities;

  // Map (colorIdx, clarityIdx) → center X of that slot
  const slotCX = (ci, ki) => ci * groupW + ki * slotW + slotW / 2;

  // Pre-group rows so we can spread them within each slot
  const grouped = useMemo(() => {
    const map = {};
    for (const r of valid) {
      const ci = usedColors.indexOf(r['Color Grade']);
      const ki = usedClarities.indexOf(r['Clarity Grade']);
      if (ci === -1 || ki === -1) continue;
      const key = `${ci}::${ki}`;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [valid, usedColors, usedClarities]);

  // Build dot data with stable x positions (spread within slot, no random jitter)
  const dots = useMemo(() => {
    const out = [];
    for (const [key, members] of Object.entries(grouped)) {
      const [ci, ki] = key.split('::').map(Number);
      const cx0 = slotCX(ci, ki);
      const spread = Math.min(slotW * 0.7, 24);
      members.forEach((r, idx) => {
        const offset = members.length === 1
          ? 0
          : (idx / (members.length - 1) - 0.5) * spread;
        out.push({ r, cx: cx0 + offset, cy: toY(parseFloat(r.Price)), ci, ki });
      });
    }
    return out;
  }, [grouped, slotW, toY]);

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const step = Math.ceil((maxP - minP) / 6 / 100) * 100;
    const ticks = [];
    for (let v = Math.floor(minP / step) * step; v <= maxP + step; v += step) ticks.push(v);
    return ticks;
  }, [minP, maxP]);

  const handleMouseMove = useCallback((e, row, cx, cy) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setHovered({ row, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top });
  }, []);

  if (!usedColors.length || !usedClarities.length) {
    return <div style={{ padding: 40, color: '#9ca3af', textAlign: 'center' }}>Not enough color/clarity data to display this chart.</div>;
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg
        ref={svgRef}
        width={width}
        height={HEIGHT}
        style={{ display: 'block', maxWidth: '100%' }}
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>

          {/* Grid + Y axis */}
          {yTicks.map(v => (
            <g key={v}>
              <line x1={0} x2={innerW} y1={toY(v)} y2={toY(v)}
                stroke="#e5e5e4" strokeDasharray="3 3" />
              <text x={-10} y={toY(v)} textAnchor="end" fontSize={11} fill="#9ca3af" dy={4}>
                {nicePrice(v)}
              </text>
            </g>
          ))}

          {/* Color group separators */}
          {usedColors.map((_, ci) => ci > 0 && (
            <line key={ci}
              x1={ci * groupW} x2={ci * groupW}
              y1={0} y2={innerH + 48}
              stroke="#d1d5db" strokeWidth={1}
            />
          ))}

          {/* Chart border */}
          <rect x={0} y={0} width={innerW} height={innerH}
            fill="none" stroke="#e5e5e4" />

          {/* Dots */}
          {dots.map(({ r, cx, cy }, i) => {
            const isLab = r.Origin === 'Lab Grown';
            const isSel = selected && rowKey(selected) === rowKey(r);
            const rad   = caratToRadius(r['Carat Weight']);
            return (
              <circle
                key={i}
                cx={cx} cy={cy} r={isSel ? rad + 3 : rad}
                fill={isLab ? '#10b981' : '#94a3b8'}
                fillOpacity={isSel ? 1 : 0.65}
                stroke={isSel ? '#1e40af' : 'transparent'}
                strokeWidth={2}
                style={{ cursor: 'pointer' }}
                onMouseMove={e => handleMouseMove(e, r, cx, cy)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(isSel ? null : r)}
              />
            );
          })}

          {/* Clarity labels (row 1 below chart) */}
          {usedColors.map((_, ci) =>
            usedClarities.map((clarity, ki) => (
              <text
                key={`c${ci}k${ki}`}
                x={slotCX(ci, ki)} y={innerH + 14}
                textAnchor="middle" fontSize={9} fill="#9ca3af"
              >
                {clarity}
              </text>
            ))
          )}

          {/* Clarity label underline (group bracket) */}
          {usedColors.map((_, ci) => (
            <line key={`ul${ci}`}
              x1={ci * groupW + 4} x2={(ci + 1) * groupW - 4}
              y1={innerH + 22} y2={innerH + 22}
              stroke="#d1d5db" strokeWidth={1}
            />
          ))}

          {/* Color labels (row 2 below chart) */}
          {usedColors.map((color, ci) => (
            <text
              key={`col${ci}`}
              x={ci * groupW + groupW / 2} y={innerH + 36}
              textAnchor="middle" fontSize={13} fontWeight={600} fill="#374151"
            >
              {color}
            </text>
          ))}

          {/* Axis label */}
          <text
            x={innerW / 2} y={innerH + 56}
            textAnchor="middle" fontSize={12} fill="#6b7280"
          >
            Color grade (columns) · Clarity grade (sub-columns) · Dot size = carat
          </text>

        </g>
      </svg>

      {/* Hover tooltip */}
      {hovered && (
        <div className="chart-tooltip" style={{
          position: 'absolute',
          left: hovered.screenX + MARGIN.left + 12,
          top:  hovered.screenY + MARGIN.top - 20,
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div className="ct-price">${Number(hovered.row.Price).toLocaleString()}</div>
          <div className="ct-detail">{hovered.row['Carat Weight']}ct · {hovered.row.Shape}</div>
          <div className="ct-detail">
            {hovered.row['Color Grade']} · {hovered.row['Clarity Grade']} · {hovered.row['Cut Grade']}
          </div>
          <div className="ct-detail">{hovered.row.Origin} · {hovered.row['Grading Lab']}</div>
          <div className="ct-vendor">{hovered.row.Vendor}</div>
          <div className="ct-hint">Click to select</div>
        </div>
      )}

      {/* Legend */}
      <div className="grouped-legend">
        <span><span className="legend-dot lab" /> Lab Grown</span>
        <span><span className="legend-dot mined" /> Mined</span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>Dot size = carat weight</span>
      </div>
    </div>
  );
}
