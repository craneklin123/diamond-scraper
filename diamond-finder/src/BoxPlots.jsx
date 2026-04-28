import { useMemo, useRef, useEffect, useState } from 'react';

const COLOR_ORDER   = ['D','E','F','G','H','I','J','K'];
const CLARITY_ORDER = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2'];
const CUT_ORDER     = ['Super Ideal','Ideal','Excellent','Very Good','Good'];

const PANELS = [
  {
    id: 'color', title: '$/ct by Color',
    getGroup: r => COLOR_ORDER.includes(r['Color Grade']) ? r['Color Grade'] : null,
    order: COLOR_ORDER,
  },
  {
    id: 'clarity', title: '$/ct by Clarity',
    getGroup: r => CLARITY_ORDER.includes(r['Clarity Grade']) ? r['Clarity Grade'] : null,
    order: CLARITY_ORDER,
  },
  {
    id: 'cut', title: '$/ct by Cut',
    getGroup: r => CUT_ORDER.includes(r['Cut Grade']) ? r['Cut Grade'] : null,
    order: CUT_ORDER,
    short: { 'Super Ideal': 'S.Ideal', 'Very Good': 'V.Good' },
  },
  {
    id: 'carat', title: '$/ct by Carat',
    getGroup: r => {
      const c = parseFloat(r['Carat Weight']);
      if (isNaN(c) || c < 0.3) return null;
      if (c < 0.75) return '<0.75';
      if (c < 1.0)  return '0.75–1';
      if (c < 1.25) return '1–1.25';
      if (c < 1.5)  return '1.25–1.5';
      if (c < 2.0)  return '1.5–2';
      if (c < 3.0)  return '2–3';
      return '3ct+';
    },
    order: ['<0.75','0.75–1','1–1.25','1.25–1.5','1.5–2','2–3','3ct+'],
  },
];

const LAB_COLOR   = '#10b981';
const MINED_COLOR = '#94a3b8';
const M = { top: 24, right: 8, bottom: 42, left: 54 };
const PANEL_H = 210;

function quartiles(arr) {
  if (arr.length < 4) return null;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const q1 = s[Math.floor(n * 0.25)];
  const q2 = s[Math.floor(n * 0.50)];
  const q3 = s[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lo = s.find(v => v >= q1 - 1.5 * iqr) ?? s[0];
  const hi = [...s].reverse().find(v => v <= q3 + 1.5 * iqr) ?? s[n - 1];
  return { q1, q2, q3, lo, hi, n };
}

function niceK(v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${Math.round(v)}`;
}

function Box({ stats, x, bw, toY, color }) {
  if (!stats) return null;
  const { q1, q2, q3, lo, hi } = stats;
  const cx = x + bw / 2;
  return (
    <g>
      <line x1={cx} x2={cx} y1={toY(lo)} y2={toY(hi)} stroke={color} strokeWidth={1.5} />
      <line x1={cx - bw * 0.35} x2={cx + bw * 0.35} y1={toY(lo)} y2={toY(lo)} stroke={color} strokeWidth={1.5} />
      <line x1={cx - bw * 0.35} x2={cx + bw * 0.35} y1={toY(hi)} y2={toY(hi)} stroke={color} strokeWidth={1.5} />
      <rect
        x={x} y={toY(q3)} width={bw} height={Math.max(1, toY(q1) - toY(q3))}
        fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.5}
      />
      <line x1={x} x2={x + bw} y1={toY(q2)} y2={toY(q2)} stroke={color} strokeWidth={2.5} />
    </g>
  );
}

function Panel({ panel, labStats, minedStats, width }) {
  const [tip, setTip] = useState(null);

  const innerW = Math.max(60, width - M.left - M.right);
  const innerH = PANEL_H - M.top - M.bottom;

  const allVals = [...labStats.values(), ...minedStats.values()]
    .flatMap(s => s ? [s.lo, s.hi] : []).filter(v => !isNaN(v));
  if (!allVals.length) return (
    <div style={{ width, height: PANEL_H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
      No data
    </div>
  );

  const yMin = Math.min(...allVals) * 0.93;
  const yMax = Math.max(...allVals) * 1.07;
  const toY = v => innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  // 4 nice y-ticks
  const range = yMax - yMin;
  const mag = Math.pow(10, Math.floor(Math.log10(range / 3)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => range / s <= 5) ?? mag;
  const ticks = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticks.push(v);

  const { order } = panel;
  const nGroups = order.length;
  const groupW = innerW / nGroups;
  const bw = Math.max(5, Math.min(13, groupW * 0.28));
  const gap = 1.5;
  const labX   = i => (i + 0.5) * groupW - gap - bw;
  const minedX = i => (i + 0.5) * groupW + gap;

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={PANEL_H} style={{ display: 'block' }}>
        <g transform={`translate(${M.left},${M.top})`}>
          {/* Panel title */}
          <text x={innerW / 2} y={-10} textAnchor="middle" fontSize={12} fontWeight={600} fill="#374151">
            {panel.title}
          </text>

          {/* Grid + y-ticks */}
          {ticks.map(v => {
            const y = toY(v);
            if (y < -2 || y > innerH + 2) return null;
            return (
              <g key={v}>
                <line x1={0} x2={innerW} y1={y} y2={y} stroke="#f0f0ef" strokeWidth={1} />
                <text x={-6} y={y} textAnchor="end" fontSize={10} fill="#9ca3af" dy={4}>
                  {niceK(v)}
                </text>
              </g>
            );
          })}

          <line x1={0} x2={0} y1={0} y2={innerH} stroke="#e5e5e4" strokeWidth={1} />
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#e5e5e4" strokeWidth={1} />

          {/* Boxes */}
          {order.map((g, i) => {
            const ls = labStats.get(g);
            const ms = minedStats.get(g);
            if (!ls && !ms) return null;
            return (
              <g key={g}
                onMouseEnter={() => setTip({ g, ls, ms, cx: (i + 0.5) * groupW })}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: 'default' }}
              >
                <Box stats={ls} x={labX(i)}   bw={bw} toY={toY} color={LAB_COLOR}   />
                <Box stats={ms} x={minedX(i)} bw={bw} toY={toY} color={MINED_COLOR} />
                <text
                  x={(i + 0.5) * groupW} y={innerH + 14}
                  textAnchor="middle" fontSize={10} fill="#6b7280"
                >
                  {panel.short?.[g] ?? g}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {tip && (
        <div className="box-tip" style={{
          left: M.left + tip.cx + 10,
          top: M.top + 10,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 5, fontSize: 13 }}>{tip.g}</div>
          {tip.ls && (
            <div style={{ color: LAB_COLOR, marginBottom: 3 }}>
              <strong>Lab</strong> · n={tip.ls.n}<br />
              med {niceK(tip.ls.q2)}/ct &nbsp;|&nbsp; IQR {niceK(tip.ls.q1)}–{niceK(tip.ls.q3)}
            </div>
          )}
          {tip.ms && (
            <div style={{ color: '#475569' }}>
              <strong>Mined</strong> · n={tip.ms.n}<br />
              med {niceK(tip.ms.q2)}/ct &nbsp;|&nbsp; IQR {niceK(tip.ms.q1)}–{niceK(tip.ms.q3)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BoxPlots({ rows }) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(700);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(e => setWidth(e[0].contentRect.width));
    obs.observe(el);
    setWidth(el.clientWidth || 700);
    return () => obs.disconnect();
  }, []);

  const enriched = useMemo(() =>
    rows.map(r => ({ ...r, ppc: parseFloat(r.Price) / parseFloat(r['Carat Weight']) }))
        .filter(r => !isNaN(r.ppc) && r.ppc > 0),
  [rows]);

  const panelData = useMemo(() => PANELS.map(panel => {
    const labMap = new Map(), minedMap = new Map();
    for (const r of enriched) {
      const g = panel.getGroup(r);
      if (!g) continue;
      const m = r.Origin === 'Lab Grown' ? labMap : minedMap;
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(r.ppc);
    }
    return {
      panel,
      labStats:   new Map([...labMap.entries()].map(([g, v]) => [g, quartiles(v)])),
      minedStats: new Map([...minedMap.entries()].map(([g, v]) => [g, quartiles(v)])),
    };
  }), [enriched]);

  const twoCol = width > 580;
  const panelW = twoCol ? Math.floor((width - 12) / 2) : width;

  return (
    <div ref={containerRef}>
      <div className="box-legend">
        <span><span className="legend-dot lab" /> Lab Grown</span>
        <span><span className="legend-dot mined" /> Mined</span>
        <span className="box-legend-hint">Box = Q1–Q3 · Center line = median · Whisker = 1.5×IQR</span>
      </div>
      <div className="box-grid" style={{ gridTemplateColumns: twoCol ? '1fr 1fr' : '1fr' }}>
        {panelData.map(({ panel, labStats, minedStats }) => (
          <Panel key={panel.id} panel={panel} labStats={labStats} minedStats={minedStats} width={panelW} />
        ))}
      </div>
    </div>
  );
}
