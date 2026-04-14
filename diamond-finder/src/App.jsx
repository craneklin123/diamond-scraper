import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { Charts } from './Charts.jsx';

const VENDOR_FILES = {
  diamonds:    ['brilliantearth', 'jamesallen', 'cleanorigin'],
  moissanite:  ['brilliantearth_moi', 'charlesandcolvard'],
};

const SORTABLE_COLS = [
  { key: 'Price', label: 'Price' },
  { key: 'Carat Weight', label: 'Carat' },
  { key: 'Shape', label: 'Shape' },
  { key: 'Color Grade', label: 'Color' },
  { key: 'Clarity Grade', label: 'Clarity' },
  { key: 'Cut Grade', label: 'Cut' },
  { key: 'Origin', label: 'Origin' },
  { key: 'Grading Lab', label: 'Lab' },
  { key: 'Vendor', label: 'Vendor' },
];

const CLARITY_ORDER = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2','I1','I2','I3'];
const COLOR_ORDER = ['D','E','F','G','H','I','J','K','L','M'];
const CUT_ORDER = ['Ideal','Super Ideal','Excellent','Very Good','Good','Fair','Poor'];

function gradeScore(val, order) {
  const i = order.indexOf(String(val || '').trim());
  return i === -1 ? 999 : i;
}

function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    let av = a[col], bv = b[col];
    // Numeric cols
    if (col === 'Price' || col === 'Carat Weight') {
      av = parseFloat(av) || 0;
      bv = parseFloat(bv) || 0;
    } else if (col === 'Clarity Grade') {
      av = gradeScore(av, CLARITY_ORDER);
      bv = gradeScore(bv, CLARITY_ORDER);
    } else if (col === 'Color Grade') {
      av = gradeScore(av, COLOR_ORDER);
      bv = gradeScore(bv, COLOR_ORDER);
    } else if (col === 'Cut Grade') {
      av = gradeScore(av, CUT_ORDER);
      bv = gradeScore(bv, CUT_ORDER);
    } else {
      av = String(av || '').toLowerCase();
      bv = String(bv || '').toLowerCase();
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

const DEFAULT_WEIGHTS = { carat: 10, cut: 5, color: 3, clarity: 1 };

function parseUrlFilters() {
  const p = new URLSearchParams(window.location.search);
  const getArr = k => p.has(k) ? p.get(k).split(',').map(s => decodeURIComponent(s)).filter(Boolean) : null;
  const getNum = k => p.has(k) ? Number(p.get(k)) : null;
  return {
    shapes:   getArr('shapes'),
    origins:  getArr('origins'),
    vendors:  getArr('vendors'),
    labs:     getArr('labs'),
    colors:   getArr('colors'),
    cuts:     getArr('cuts'),
    priceMax: getNum('priceMax'),
    caratMin: getNum('caratMin'),
    weights: (p.has('wCarat') || p.has('wCut') || p.has('wColor') || p.has('wClarity')) ? {
      carat:   getNum('wCarat')   ?? DEFAULT_WEIGHTS.carat,
      cut:     getNum('wCut')     ?? DEFAULT_WEIGHTS.cut,
      color:   getNum('wColor')   ?? DEFAULT_WEIGHTS.color,
      clarity: getNum('wClarity') ?? DEFAULT_WEIGHTS.clarity,
    } : null,
  };
}

const URL_INIT = parseUrlFilters();

function useLocalStorage(key, def, urlOverride) {
  const [val, setVal] = useState(() => {
    if (urlOverride !== null && urlOverride !== undefined) return urlOverride;
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  });
  const set = useCallback(v => {
    setVal(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {}
  }, [key]);
  return [val, set];
}

function uniq(rows, key) {
  return [...new Set(rows.map(r => r[key]).filter(Boolean))].sort();
}

function toggle(arr, val) {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
}

export default function App() {
  const [mode, setMode] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('mode') === 'moissanite' ? 'moissanite' : 'diamonds';
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedVendors, setLoadedVendors] = useState([]);

  const [shapes, setShapes] = useLocalStorage('df_shapes', [], URL_INIT.shapes);
  const [origins, setOrigins] = useLocalStorage('df_origins', [], URL_INIT.origins);
  const [vendors, setVendors] = useLocalStorage('df_vendors', [], URL_INIT.vendors);
  const [labs, setLabs] = useLocalStorage('df_labs', [], URL_INIT.labs);
  const [colors, setColors] = useLocalStorage('df_colors', [], URL_INIT.colors);
  const [cuts, setCuts] = useLocalStorage('df_cuts', [], URL_INIT.cuts);
  const [priceMax, setPriceMax] = useLocalStorage('df_priceMax', 3000, URL_INIT.priceMax);
  const [caratMin, setCaratMin] = useLocalStorage('df_caratMin', 0, URL_INIT.caratMin);
  const [sort, setSort] = useState({ col: 'Price', dir: 'asc' });
  const [selected, setSelected] = useState(null);
  const selectedRowRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [weights, setWeights] = useState(URL_INIT.weights ?? DEFAULT_WEIGHTS);

  // Sync filters → URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (mode !== 'diamonds') p.set('mode', mode);
    if (shapes.length)  p.set('shapes',   shapes.map(encodeURIComponent).join(','));
    if (origins.length) p.set('origins',  origins.map(encodeURIComponent).join(','));
    if (vendors.length) p.set('vendors',  vendors.map(encodeURIComponent).join(','));
    if (labs.length)    p.set('labs',     labs.map(encodeURIComponent).join(','));
    if (colors.length)  p.set('colors',   colors.map(encodeURIComponent).join(','));
    if (cuts.length)    p.set('cuts',     cuts.map(encodeURIComponent).join(','));
    if (priceMax !== 3000) p.set('priceMax', priceMax);
    if (caratMin !== 0)    p.set('caratMin', caratMin);
    p.set('wCarat',   weights.carat);
    p.set('wCut',     weights.cut);
    p.set('wColor',   weights.color);
    p.set('wClarity', weights.clarity);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [mode, shapes, origins, vendors, labs, colors, cuts, priceMax, caratMin, weights]);

  function shareFilters() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }

  useEffect(() => {
    const loaded = [];
    setRows([]);
    setLoading(true);
    Promise.all(
      VENDOR_FILES[mode].map(v =>
        fetch(`/data/${v}.csv`)
          .then(r => r.ok ? r.text() : null)
          .then(text => {
            if (!text) return [];
            loaded.push(v);
            return Papa.parse(text, {
              header: true,
              skipEmptyLines: true,
              dynamicTyping: false,
            }).data;
          })
          .catch(() => [])
      )
    ).then(results => {
      setRows(results.flat().filter(r => parseFloat(r.Price) > 0));
      setLoadedVendors(loaded);
      setLoading(false);
    });
  }, [mode]);

  const filtered = useMemo(() => {
    let out = rows;
    if (shapes.length) out = out.filter(r => shapes.includes(r.Shape));
    if (origins.length) out = out.filter(r => origins.includes(r.Origin));
    if (vendors.length) out = out.filter(r => vendors.includes(r.Vendor));
    if (labs.length) out = out.filter(r => labs.includes(r['Grading Lab']));
    if (colors.length) out = out.filter(r => colors.includes(r['Color Grade']));
    if (cuts.length) out = out.filter(r => cuts.includes(r['Cut Grade']));
    out = out.filter(r => parseFloat(r.Price) <= priceMax);
    if (caratMin > 0) out = out.filter(r => parseFloat(r['Carat Weight']) >= caratMin);
    return sortRows(out, sort.col, sort.dir);
  }, [rows, shapes, origins, vendors, labs, colors, cuts, priceMax, caratMin, sort]);

  const sortBy = col => setSort(s =>
    s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }
  );

  const handleSelect = useCallback((row) => {
    setSelected(row);
    if (row) {
      // Give React a tick to render, then scroll
      setTimeout(() => selectedRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, []);

  const dataShapes = useMemo(() => uniq(rows, 'Shape'), [rows]);
  const dataOrigins = useMemo(() => uniq(rows, 'Origin'), [rows]);
  const dataVendors = useMemo(() => uniq(rows, 'Vendor'), [rows]);
  const dataLabs = useMemo(() => uniq(rows, 'Grading Lab'), [rows]);
  const dataColors = useMemo(() => [...new Set(rows.map(r => r['Color Grade']).filter(Boolean))].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b)), [rows]);
  const dataCuts = useMemo(() => [...new Set(rows.map(r => r['Cut Grade']).filter(Boolean))].sort((a, b) => CUT_ORDER.indexOf(a) - CUT_ORDER.indexOf(b)), [rows]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading diamond data...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <button className="filter-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle filters">
            ☰ Filters
          </button>
          <h1>Diamond Finder</h1>
          <div className="mode-tabs">
            <button className={`mode-tab${mode === 'diamonds' ? ' active' : ''}`} onClick={() => setMode('diamonds')}>Diamonds</button>
            <button className={`mode-tab${mode === 'moissanite' ? ' active' : ''}`} onClick={() => setMode('moissanite')}>Moissanite</button>
          </div>
          <div className="header-meta">
            <span>{filtered.length.toLocaleString()} results</span>
            <span className="dot">·</span>
            <span>{rows.length.toLocaleString()} total</span>
            {loadedVendors.length > 0 && (
              <>
                <span className="dot">·</span>
                <span>{loadedVendors.join(', ')}</span>
              </>
            )}
          </div>
          <button className="share-btn" onClick={shareFilters}>
            {shareCopied ? 'Copied!' : 'Share filters'}
          </button>
        </div>
      </header>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className="layout">
        <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
          <div className="filter-section">
            <div className="filter-label">
              Max Price
              <span className="filter-value">${priceMax.toLocaleString()}</span>
            </div>
            <input
              type="range" min="500" max="10000" step="100"
              value={priceMax}
              onChange={e => setPriceMax(Number(e.target.value))}
              className="slider"
            />
            <div className="slider-bounds"><span>$500</span><span>$10,000</span></div>
          </div>

          <div className="filter-section">
            <div className="filter-label">
              Min Carat
              <span className="filter-value">{caratMin > 0 ? caratMin.toFixed(1) : 'Any'}</span>
            </div>
            <input
              type="range" min="0" max="3" step="0.1"
              value={caratMin}
              onChange={e => setCaratMin(Number(e.target.value))}
              className="slider"
            />
            <div className="slider-bounds"><span>Any</span><span>3ct</span></div>
          </div>

          <FilterGroup
            label="Shape" options={dataShapes} selected={shapes}
            onToggle={v => setShapes(toggle(shapes, v))}
            onClear={() => setShapes([])}
          />
          <FilterGroup
            label="Origin" options={dataOrigins} selected={origins}
            onToggle={v => setOrigins(toggle(origins, v))}
            onClear={() => setOrigins([])}
          />
          <FilterGroup
            label="Vendor" options={dataVendors} selected={vendors}
            onToggle={v => setVendors(toggle(vendors, v))}
            onClear={() => setVendors([])}
          />
          <FilterGroup
            label="Lab" options={dataLabs} selected={labs}
            onToggle={v => setLabs(toggle(labs, v))}
            onClear={() => setLabs([])}
          />
          <FilterGroup
            label="Color" options={dataColors} selected={colors}
            onToggle={v => setColors(toggle(colors, v))}
            onClear={() => setColors([])}
          />
          <FilterGroup
            label="Cut" options={dataCuts} selected={cuts}
            onToggle={v => setCuts(toggle(cuts, v))}
            onClear={() => setCuts([])}
          />

          <button
            className="reset-btn"
            onClick={() => { setShapes([]); setOrigins([]); setVendors([]); setLabs([]); setColors([]); setCuts([]); setPriceMax(3000); setCaratMin(0); }}
          >
            Reset all filters
          </button>
        </aside>

        <main className="results">
          <AboutBanner mode={mode} />
          <Charts rows={filtered} selected={selected} onSelect={handleSelect} weights={weights} onWeightsChange={setWeights} mode={mode} />

          {selected && (
            <div className="selected-card">
              <div className="selected-card-inner">
                <div className="sc-price">${Number(selected.Price).toLocaleString()}</div>
                <div className="sc-details">
                  <span>{selected['Carat Weight']}ct</span>
                  <span>{selected.Shape}</span>
                  <span>{selected['Color Grade']}</span>
                  <span>{selected['Clarity Grade']}</span>
                  <span>{selected['Cut Grade']}</span>
                  <span className={`badge ${selected.Origin === 'Lab Grown' ? 'badge-lab' : 'badge-mined'}`}>
                    {selected.Origin}
                  </span>
                  <span>{selected['Grading Lab']}</span>
                  <span className="sc-vendor">{selected.Vendor}</span>
                </div>
                <div className="sc-links">
                  {selected.Link && <a href={selected.Link} target="_blank" rel="noopener noreferrer" className="link-btn">View listing</a>}
                  {selected['Grading Link'] && <a href={selected['Grading Link']} target="_blank" rel="noopener noreferrer" className="link-btn link-cert">Certificate</a>}
                  {selected['360 Video Link'] && <a href={selected['360 Video Link']} target="_blank" rel="noopener noreferrer" className="link-btn link-video">360° Video</a>}
                </div>
              </div>
              <button className="sc-close" onClick={() => setSelected(null)}>✕</button>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="empty">No diamonds match your filters.</div>
          ) : (
            <div className="table-wrap">
              {filtered.length > 500 && (
                <div className="table-cap-notice">
                  Showing first 500 of {filtered.length.toLocaleString()} results — use filters to narrow down.
                </div>
              )}
              <table>
                <thead>
                  <tr>
                    {SORTABLE_COLS.map(({ key, label }) => (
                      <th
                        key={key}
                        onClick={() => sortBy(key)}
                        className={sort.col === key ? 'sorted' : ''}
                      >
                        {label}
                        {sort.col === key && (
                          <span className="sort-arrow">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>
                        )}
                      </th>
                    ))}
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((r, i) => {
                    const isSel = selected &&
                      `${selected.Vendor}::${selected['Vendor SKU']}::${selected.Price}` ===
                      `${r.Vendor}::${r['Vendor SKU']}::${r.Price}`;
                    return (
                      <DiamondRow
                        key={i}
                        row={r}
                        isSelected={isSel}
                        rowRef={isSel ? selectedRowRef : null}
                        onSelect={handleSelect}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AboutBanner({ mode }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState(null);

  useEffect(() => {
    fetch('/data/sources.json').then(r => r.json()).then(setSources).catch(() => {});
  }, []);

  const modeKey = mode === 'moissanite' ? 'moissanite' : 'diamonds';
  const scrapeList = sources?.[modeKey] || [];

  return (
    <div className="about-banner">
      <div className="about-summary">
        <strong>Diamond &amp; Moissanite Finder</strong> — compare lab-grown and natural diamonds (or moissanite) across vendors.
        Use the <strong>Diamonds / Moissanite</strong> toggle at the top to switch gemstone types.
        Use the filters on the left to narrow by shape, price, carat, and more.
        Click any chart point or table row to see details and a link to buy.
        {' '}
        <button className="about-toggle" onClick={() => setOpen(o => !o)}>
          {open ? 'Hide info' : 'How it works'}
        </button>
        {scrapeList.length > 0 && (
          <span className="scrape-dates">
            {' '}Data last updated: {scrapeList.map(s => `${s.vendor} ${s.scraped}`).join(' · ')}
          </span>
        )}
      </div>
      {open && (
        <div className="about-details">
          <p><strong>What is this?</strong> A tool to browse and compare diamonds and moissanite from multiple vendors side-by-side. Data is scraped periodically so prices may vary — always verify on the vendor's site before purchasing.</p>
          <p><strong>Diamond vendors:</strong> Brilliant Earth, James Allen, Clean Origin. Lab-grown diamonds are significantly cheaper than mined for the same specs.</p>
          <p><strong>Moissanite vendors:</strong> Brilliant Earth, Charles &amp; Colvard. Moissanite is a lab-grown gemstone that looks nearly identical to a diamond but costs a fraction of the price. Switch to Moissanite mode using the toggle in the header.</p>
          <p><strong>The 4 C's:</strong> Diamonds and moissanite are graded on four attributes. <strong>Carat</strong> is the weight of the stone — bigger is more expensive. <strong>Cut</strong> determines how well the stone reflects light; Ideal and Excellent are the best grades. <strong>Color</strong> is graded D (colorless, best) through M (noticeable yellow tint). <strong>Clarity</strong> measures internal flaws, from FL (flawless) down to I3 (heavily included) — VS1/VS2 and SI1 offer good value since flaws are invisible to the naked eye.</p>
          <p><strong>Charts:</strong> The "All Attributes" view lets you drag axes to filter by multiple dimensions at once. The scatter charts show price vs. a single attribute — click any dot to highlight that stone in the table below. The "Value Score" chart lets you assign a weight to each of the 4 C's — a higher number means that attribute matters more to you. Stones are scored based on those weights and plotted against price, so the top-right of the chart shows the highest-scoring stones at the lowest prices.</p>
          <p><strong>Tips:</strong> Sort by Price ↑ to find the best deals. Filter by shape first (Round and Oval tend to have the most inventory). Lab-grown stones offer the best value per carat.</p>
        </div>
      )}
    </div>
  );
}

function DiamondRow({ row: r, isSelected, rowRef, onSelect }) {
  const isLab = r.Origin === 'Lab Grown';
  return (
    <tr
      ref={rowRef}
      className={isSelected ? 'row-selected' : ''}
      onClick={() => onSelect(isSelected ? null : r)}
      style={{ cursor: 'pointer' }}
    >
      <td className="price">${Number(r.Price || 0).toLocaleString()}</td>
      <td>{r['Carat Weight']}</td>
      <td>{r.Shape}</td>
      <td>{r['Color Grade']}</td>
      <td>{r['Clarity Grade']}</td>
      <td>{r['Cut Grade']}</td>
      <td>
        <span className={`badge ${isLab ? 'badge-lab' : 'badge-mined'}`}>
          {r.Origin || '—'}
        </span>
      </td>
      <td>{r['Grading Lab'] || '—'}</td>
      <td className="vendor">{r.Vendor}</td>
      <td className="links-cell">
        {r.Link && (
          <a href={r.Link} target="_blank" rel="noopener noreferrer" className="link-btn">View</a>
        )}
        {r['Grading Link'] && (
          <a href={r['Grading Link']} target="_blank" rel="noopener noreferrer" className="link-btn link-cert">Cert</a>
        )}
        {r['360 Video Link'] && (
          <a href={r['360 Video Link']} target="_blank" rel="noopener noreferrer" className="link-btn link-video">360°</a>
        )}
      </td>
    </tr>
  );
}

function FilterGroup({ label, options, selected, onToggle, onClear }) {
  if (!options.length) return null;
  return (
    <div className="filter-section">
      <div className="filter-label">
        {label}
        {selected.length > 0 && (
          <button className="clear-btn" onClick={onClear}>clear</button>
        )}
      </div>
      <div className="checkbox-list">
        {options.map(o => (
          <label key={o} className="checkbox-label">
            <input
              type="checkbox"
              checked={selected.includes(o)}
              onChange={() => onToggle(o)}
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
