import { useState, useMemo, useRef, useCallback, useEffect } from 'react';

const COLOR_ORDER   = ['D','E','F','G','H','I','J','K','L','M'];
const CLARITY_ORDER = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2'];
const CUT_ORDER     = ['Super Ideal','Ideal','Excellent','Very Good','Good','Fair','Poor'];

const AXES = [
  { key: 'Color Grade',   label: 'Color',   order: COLOR_ORDER,   type: 'ordinal' },
  { key: 'Clarity Grade', label: 'Clarity', order: CLARITY_ORDER, type: 'ordinal' },
  { key: 'Cut Grade',     label: 'Cut',     order: CUT_ORDER,     type: 'ordinal' },
  { key: 'Carat Weight',  label: 'Carat',   type: 'numeric' },
  { key: 'Price',         label: 'Price',   type: 'numeric' },
];

const MARGIN = { top: 52, right: 64, bottom: 28, left: 64 };
const HEIGHT = 400;

function rowKey(r) {
  return `${r.Vendor}::${r['Vendor SKU']}::${r.Price}`;
}

function nicePrice(v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

export function ParallelCoords({ rows, selected, onSelect }) {
  const [hovered, setHovered]   = useState(null);
  const [width, setWidth]       = useState(860);
  const containerRef            = useRef(null);
  const svgRef                  = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    obs.observe(el);
    setWidth(el.clientWidth || 860);
    return () => obs.disconnect();
  }, []);

  const innerW = Math.max(320, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const valid = useMemo(() =>
    rows.filter(r => parseFloat(r.Price) > 0),
  [rows]);

  // Build a scale object for each axis
  const scales = useMemo(() => AXES.map(axis => {
    if (axis.type === 'ordinal') {
      const usedOrder = axis.order.filter(v => valid.some(r => r[axis.key] === v));
      const n = usedOrder.length;
      return {
        ...axis,
        usedOrder,
        toY: val => {
          const idx = usedOrder.indexOf(val);
          if (idx === -1) return null;
          return n <= 1 ? innerH / 2 : (idx / (n - 1)) * innerH;
        },
      };
    } else {
      const vals = valid.map(r => parseFloat(r[axis.key])).filter(v => !isNaN(v));
      if (!vals.length) return { ...axis, toY: () => null, min: 0, max: 1 };
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      return {
        ...axis, min, max,
        toY: val => {
          const v = parseFloat(val);
          if (isNaN(v)) return null;
          return innerH - ((v - min) / (max - min)) * innerH;
        },
      };
    }
  }), [valid, innerH]);

  const axisX = useCallback(i =>
    AXES.length === 1 ? innerW / 2 : (i / (AXES.length - 1)) * innerW,
  [innerW]);

  const pathFor = useCallback(r => {
    const pts = scales.map((sc, i) => {
      const y = sc.toY(r[sc.key]);
      return y === null ? null : [axisX(i), y];
    });
    if (pts.some(p => p === null)) return null;
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  }, [scales, axisX]);

  const allPaths = useMemo(() =>
    valid.map(r => ({
      r, key: rowKey(r),
      d: pathFor(r),
      isLab: r.Origin === 'Lab Grown',
    })).filter(item => item.d !== null),
  [valid, pathFor]);

  const selKey = selected ? rowKey(selected) : null;
  const hovKey = hovered  ? rowKey(hovered.r) : null;

  const handleMouseMove = useCallback((e, r) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHovered({ r, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <svg ref={svgRef} width={width} height={HEIGHT} style={{ display: 'block' }}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>

          {/* Background lines */}
          {allPaths
            .filter(item => item.key !== selKey && item.key !== hovKey)
            .map(item => (
              <path key={item.key} d={item.d}
                fill="none"
                stroke={item.isLab ? '#10b981' : '#94a3b8'}
                strokeOpacity={0.18}
                strokeWidth={1}
                style={{ cursor: 'pointer' }}
                onMouseMove={e => handleMouseMove(e, item.r)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(selKey === item.key ? null : item.r)}
              />
            ))}

          {/* Hovered line */}
          {hovKey && hovKey !== selKey && (() => {
            const item = allPaths.find(p => p.key === hovKey);
            if (!item) return null;
            return (
              <path d={item.d} fill="none"
                stroke={item.isLab ? '#059669' : '#475569'}
                strokeOpacity={0.9} strokeWidth={2}
                style={{ cursor: 'pointer' }}
                onMouseMove={e => handleMouseMove(e, item.r)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(selKey === item.key ? null : item.r)}
              />
            );
          })()}

          {/* Selected line */}
          {selKey && (() => {
            const item = allPaths.find(p => p.key === selKey);
            if (!item) return null;
            return (
              <path d={item.d} fill="none"
                stroke="#1e40af" strokeOpacity={1} strokeWidth={2.5}
                style={{ cursor: 'pointer' }}
                onMouseMove={e => handleMouseMove(e, item.r)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(null)}
              />
            );
          })()}

          {/* Axes */}
          {scales.map((sc, i) => {
            const x      = axisX(i);
            const isFirst = i === 0;
            const isLast  = i === AXES.length - 1;
            // Labels: first axis → left; all others → right
            const lx      = isFirst ? x - 8 : x + 8;
            const anchor  = isFirst ? 'end' : 'start';

            return (
              <g key={sc.key}>
                {/* Axis line */}
                <line x1={x} x2={x} y1={0} y2={innerH}
                  stroke="#9ca3af" strokeWidth={1.5} />

                {/* Axis title */}
                <text x={x} y={-28}
                  textAnchor="middle" fontSize={12} fontWeight={600} fill="#374151">
                  {sc.label}
                </text>

                {/* Ordinal ticks */}
                {sc.type === 'ordinal' && sc.usedOrder.map(val => {
                  const y = sc.toY(val);
                  return (
                    <g key={val}>
                      <line x1={x - 4} x2={x + 4} y1={y} y2={y}
                        stroke="#d1d5db" strokeWidth={1} />
                      <text x={lx} y={y} textAnchor={anchor}
                        fontSize={10} fill="#6b7280" dy={4}>
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Numeric ticks */}
                {sc.type === 'numeric' && (() => {
                  const { min, max } = sc;
                  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => min + t * (max - min));
                  // For numeric: Carat on left (not last, not first), Price on right (last)
                  const nlx    = isLast ? x + 8 : x - 8;
                  const nanchor = isLast ? 'start' : 'end';
                  return ticks.map(v => {
                    const y = sc.toY(v);
                    const label = sc.key === 'Price'
                      ? nicePrice(v)
                      : parseFloat(v).toFixed(2);
                    return (
                      <g key={v}>
                        <line x1={x - 4} x2={x + 4} y1={y} y2={y}
                          stroke="#d1d5db" strokeWidth={1} />
                        <text x={nlx} y={y} textAnchor={nanchor}
                          fontSize={10} fill="#6b7280" dy={4}>
                          {label}
                        </text>
                      </g>
                    );
                  });
                })()}
              </g>
            );
          })}

        </g>
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div className="chart-tooltip" style={{
          position: 'absolute',
          left: hovered.x + 12,
          top:  hovered.y - 20,
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div className="ct-price">${Number(hovered.r.Price).toLocaleString()}</div>
          <div className="ct-detail">{hovered.r['Carat Weight']}ct · {hovered.r.Shape}</div>
          <div className="ct-detail">
            {hovered.r['Color Grade']} · {hovered.r['Clarity Grade']} · {hovered.r['Cut Grade']}
          </div>
          <div className="ct-detail">{hovered.r.Origin} · {hovered.r['Grading Lab']}</div>
          <div className="ct-vendor">{hovered.r.Vendor}</div>
          <div className="ct-hint">Click to select</div>
        </div>
      )}

      <div className="grouped-legend">
        <span><span className="legend-dot lab" /> Lab Grown</span>
        <span><span className="legend-dot mined" /> Mined</span>
        <span style={{ color: '#1e40af', fontSize: 12, fontWeight: 600 }}>— Selected</span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>Hover a line · click to select</span>
      </div>
    </div>
  );
}
