import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { Charts } from './Charts.jsx';

const VENDOR_FILES = ['brilliantearth', 'jamesallen', 'cleanorigin'];

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

function useLocalStorage(key, def) {
  const [val, setVal] = useState(() => {
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedVendors, setLoadedVendors] = useState([]);

  const [shapes, setShapes] = useLocalStorage('df_shapes', []);
  const [origins, setOrigins] = useLocalStorage('df_origins', []);
  const [vendors, setVendors] = useLocalStorage('df_vendors', []);
  const [labs, setLabs] = useLocalStorage('df_labs', []);
  const [priceMax, setPriceMax] = useLocalStorage('df_priceMax', 3000);
  const [caratMin, setCaratMin] = useLocalStorage('df_caratMin', 0);
  const [sort, setSort] = useState({ col: 'Price', dir: 'asc' });
  const [selected, setSelected] = useState(null);
  const selectedRowRef = useRef(null);

  useEffect(() => {
    const loaded = [];
    Promise.all(
      VENDOR_FILES.map(v =>
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
  }, []);

  const filtered = useMemo(() => {
    let out = rows;
    if (shapes.length) out = out.filter(r => shapes.includes(r.Shape));
    if (origins.length) out = out.filter(r => origins.includes(r.Origin));
    if (vendors.length) out = out.filter(r => vendors.includes(r.Vendor));
    if (labs.length) out = out.filter(r => labs.includes(r['Grading Lab']));
    out = out.filter(r => parseFloat(r.Price) <= priceMax);
    if (caratMin > 0) out = out.filter(r => parseFloat(r['Carat Weight']) >= caratMin);
    return sortRows(out, sort.col, sort.dir);
  }, [rows, shapes, origins, vendors, labs, priceMax, caratMin, sort]);

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
          <h1>Diamond Finder</h1>
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
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
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

          <button
            className="reset-btn"
            onClick={() => { setShapes([]); setOrigins([]); setVendors([]); setLabs([]); setPriceMax(3000); setCaratMin(0); }}
          >
            Reset all filters
          </button>
        </aside>

        <main className="results">
          <Charts rows={filtered} selected={selected} onSelect={handleSelect} />

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
                  {filtered.map((r, i) => {
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
