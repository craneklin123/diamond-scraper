/**
 * scrape-be-lab.js — scrapes only Brilliant Earth lab-grown diamonds
 * and appends them to brilliantearth.csv
 *
 * Strategy:
 *  1. Open browser, load BE search page (defaults to Natural)
 *  2. Click the "Lab Diamonds" toggle button
 *  3. Capture the lab-specific API URL that fires after the click
 *  4. Paginate through all lab results using browser fetch (stays in browser to avoid Cloudflare)
 *  5. Append lab rows to brilliantearth.csv
 *
 * Usage:  node scrape-be-lab.js
 */

const puppeteerVanilla = require('puppeteer');
const puppeteerExtra   = (() => {
  try { const p = require('puppeteer-extra'); const s = require('puppeteer-extra-plugin-stealth'); p.use(s()); return p; }
  catch(_) { return null; }
})();
const puppeteer = puppeteerExtra || puppeteerVanilla;
const fs   = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'diamond_scraper', 'diamond_scraper');
const OUT_FILE   = path.join(OUTPUT_DIR, 'brilliantearth.csv');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toCsvRow(keys, r) {
  return keys.map(k => {
    const v = r[k] ?? '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }).join(',');
}

const SHAPE_MAP = {
  em:'Emerald', emerald:'Emerald', mq:'Marquise', marquise:'Marquise',
  rd:'Round', round:'Round', ov:'Oval', oval:'Oval', pr:'Pear', pear:'Pear',
  cu:'Cushion', cushion:'Cushion', ra:'Radiant', radiant:'Radiant',
  as:'Asscher', asscher:'Asscher', princess:'Princess', sq:'Princess',
  heart:'Heart', ht:'Heart',
};
function normalizeShape(s) {
  if (!s) return null;
  return SHAPE_MAP[String(s).toLowerCase().trim()] || String(s).trim();
}

function parseBEDiamond(d) {
  const certId = d.certificate_number || null;
  const lab    = String(d.report || '').toUpperCase() || null;
  const mParts = (d.measurements || '').split('x').map(s => parseFloat(s.trim()));
  return {
    Vendor: 'Brilliant Earth',
    'Vendor SKU': d.upc || String(d.id),
    Link: `https://www.brilliantearth.com/loose-diamonds/view_detail/${d.id}/`,
    Price: d.price,
    Shape: normalizeShape(d.shape),
    'Carat Weight': d.carat,
    'Color Grade': d.color,
    'Cut Grade': d.cut,
    'Clarity Grade': d.clarity,
    Fluorescence: d.fluorescence,
    'Polish Grade': d.polish,
    'Symmetry Grade': d.symmetry,
    'Depth (%)': d.depth,
    Table: d.table,
    Girdle: d.girdle,
    Culet: d.culet,
    Width: mParts[0] || null,
    Height: mParts[1] || null,
    Depth: mParts[2] || null,
    'Grading Lab': lab,
    'Grading Certificate ID': certId,
    'Grading Link': certId && lab === 'IGI'
      ? `https://www.igi.org/reports/verify-your-report?r=${certId}`
      : certId && lab === 'GIA'
      ? `https://www.gia.edu/report-check?reportno=${certId}`
      : null,
    Origin: 'Lab Grown',
    '360 Video Link': d.v360_src ? 'https:' + d.v360_src : null,
  };
}

async function main() {
  console.log('Launching browser (stealth)...');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'],
    defaultViewport: null,
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3,4,5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
    window.chrome = { runtime: {} };
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  // Phase 1: capture NATURAL API URL (fired on page load)
  // Phase 2: after clicking Lab button, capture the LAB-specific API URL
  let naturalApiCaptured = false;
  let labApiTemplate = null;

  page.on('response', async (response) => {
    const u  = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!u.includes('brilliantearth.com')) return;
    if (!ct.includes('json')) return;
    if (!u.includes('/plp/') && !u.includes('/api/v1/') && !u.includes('/products/')) return;
    try {
      const json = await response.json();
      if (!json.products || !Array.isArray(json.products) || !json.products.length) return;

      if (!naturalApiCaptured) {
        // First API call = natural (page default)
        naturalApiCaptured = true;
        console.log(`Natural API captured (ignoring): ${u.slice(0, 100)}...`);
      } else if (!labApiTemplate) {
        // Second API call (after clicking Lab button) = lab-specific
        labApiTemplate = u;
        console.log(`Lab API captured: ${u}`);
      }
    } catch (_) {}
  });

  // Load homepage to establish session
  console.log('Loading BE homepage...');
  await page.goto('https://www.brilliantearth.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);

  // Navigate to diamond search (loads Natural by default)
  console.log('Loading diamond search page...');
  await page.goto('https://www.brilliantearth.com/loose-diamonds/search/', { waitUntil: 'networkidle2', timeout: 90000 });

  const title = await page.title();
  console.log(`Page title: "${title}"`);
  if (['just a moment','checking','captcha','radware'].some(t => title.toLowerCase().includes(t))) {
    console.log('Bot challenge — solve it in the browser window...');
    await page.waitForFunction(
      () => !['just a moment','checking','captcha','radware'].some(t => document.title.toLowerCase().includes(t)),
      { timeout: 120000 }
    );
    console.log('Challenge passed!');
  }

  // Wait for the natural API call to fire
  await sleep(5000);
  if (!naturalApiCaptured) {
    console.log('Natural API not captured yet, scrolling...');
    await page.evaluate(() => window.scrollTo(0, 500));
    await sleep(4000);
  }

  // Click the Lab Diamonds button
  console.log('Clicking Lab Diamonds button...');
  const clicked = await page.evaluate(() => {
    const allEls = [...document.querySelectorAll('button, a, [role="tab"], [role="button"], label, span')];
    const btn = allEls.find(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      return text === 'lab diamonds' || text === 'lab-grown diamonds' || text === 'lab grown diamonds'
          || (text.includes('lab') && text.length < 40 && !text.includes('ring') && !text.includes('setting'));
    });
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });

  if (clicked) {
    console.log(`Clicked: "${clicked}"`);
    console.log('Waiting for lab API call...');
    await sleep(8000); // give the page time to fire the lab API
  } else {
    console.log('Lab button not found! Dumping button texts for debug:');
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll('button, [role="tab"]')].map(el => el.textContent.trim()).filter(Boolean).slice(0, 20)
    );
    console.log(texts.join(' | '));
    await sleep(5000);
  }

  if (!labApiTemplate) {
    console.log('Lab API URL not captured. Cannot proceed.');
    await browser.close();
    process.exit(1);
  }

  // Build paginated template (remove price cap)
  const templateUrl = labApiTemplate
    .replace(/max_price=\d+/, 'max_price=500000')
    .replace(/page=\d+/, 'page=PAGE_NUM');

  console.log(`\nTemplate URL: ${templateUrl}\n`);

  // Fetch page 1 to confirm lab origin
  const p1result = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      return { ok: true, data };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, templateUrl.replace('PAGE_NUM', '1'));

  if (!p1result.ok || !p1result.data.products?.length) {
    console.log('Page 1 fetch failed:', p1result.error || 'no products');
    await browser.close();
    process.exit(1);
  }
  const sample = p1result.data.products[0];
  console.log(`Page 1 sample: id=${sample.id} origin="${sample.origin}" price=${sample.price}`);

  // Paginate through all lab results
  const collected = new Map();
  let pageNum = 1;

  // Process page 1 first
  for (const d of p1result.data.products) {
    const id = String(d.id || d.upc);
    if (!collected.has(id)) collected.set(id, parseBEDiamond(d));
  }
  console.log(`Page 1: ${p1result.data.products.length} diamonds (total: ${collected.size})`);

  pageNum = 2;
  let consecutiveNoNew = 0;
  const MAX_NO_NEW = 5; // stop after 5 pages with no new unique diamonds

  while (true) {
    const fetchUrl = templateUrl.replace('PAGE_NUM', String(pageNum));
    const result = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        return { ok: true, data: await res.json() };
      } catch (e) { return { ok: false, error: String(e) }; }
    }, fetchUrl).catch(err => ({ ok: false, error: String(err) }));

    if (!result.ok) {
      console.log(`Fetch error page ${pageNum}: ${result.error}`);
      await sleep(3000);
      const retry = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { credentials: 'include' });
          return { ok: true, data: await res.json() };
        } catch (e) { return { ok: false, error: String(e) }; }
      }, fetchUrl).catch(() => ({ ok: false, error: 'context lost' }));
      if (!retry.ok) { console.log('Retry also failed, stopping.'); break; }
      result.ok   = retry.ok;
      result.data = retry.data;
    }

    const products = result.data?.products;
    if (!products || !products.length) { console.log(`No products on page ${pageNum}. Done.`); break; }

    const sizeBefore = collected.size;
    for (const d of products) {
      const id = String(d.id || d.upc);
      if (!collected.has(id)) collected.set(id, parseBEDiamond(d));
    }
    const newCount = collected.size - sizeBefore;
    console.log(`Page ${pageNum}: ${products.length} total, +${newCount} new → ${collected.size} unique`);

    if (newCount === 0) {
      consecutiveNoNew++;
      if (consecutiveNoNew >= MAX_NO_NEW) {
        console.log(`${MAX_NO_NEW} consecutive pages with no new diamonds — API is cycling. Done.`);
        break;
      }
    } else {
      consecutiveNoNew = 0;
    }

    if (products.length < 50) { console.log('Last page.'); break; }
    pageNum++;
    await sleep(400);
  }

  await browser.close();

  const labRows = [...collected.values()];
  console.log(`\nScraped ${labRows.length} lab-grown diamonds.`);

  if (!labRows.length) { console.log('Nothing to save.'); return; }

  // Merge into existing CSV (replace any old Lab Grown rows)
  if (fs.existsSync(OUT_FILE)) {
    const existing  = fs.readFileSync(OUT_FILE, 'utf8');
    const lines     = existing.split('\n').filter(Boolean);
    const header    = lines[0];
    const keys      = header.split(',');
    const minedLines = lines.slice(1).filter(l => !l.includes('Lab Grown'));
    console.log(`Existing mined rows: ${minedLines.length}`);
    const labLines  = labRows.map(r => toCsvRow(keys, r));
    const combined  = [header, ...minedLines, ...labLines].join('\r\n');
    fs.writeFileSync(OUT_FILE, combined, 'utf8');
    console.log(`Saved ${minedLines.length + labLines.length} total rows → ${OUT_FILE}`);
  } else {
    const keys = Object.keys(labRows[0]);
    const csv  = [keys.join(','), ...labRows.map(r => toCsvRow(keys, r))].join('\r\n');
    fs.writeFileSync(OUT_FILE, csv, 'utf8');
    console.log(`Saved ${labRows.length} rows → ${OUT_FILE}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
