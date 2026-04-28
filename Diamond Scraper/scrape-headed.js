/**
 * scrape-headed.js — Diamond scraper using a real browser + HTTPS interception
 *
 * Launches a headed (visible) Chromium browser, navigates to each vendor site,
 * intercepts JSON API responses, and writes results to CSV files.
 *
 * Why headed? Cloudflare and other bot-protection systems trust real browsers.
 * Why intercept? We capture the raw API data before it's rendered into HTML —
 * no CSS selectors, no fragile DOM parsing.
 *
 * Usage:
 *   node scrape-headed.js [--headless] [--sites jamesallen,cleanorigin,brilliantearth]
 *
 * Output:
 *   jamesallen.csv, cleanorigin.csv, brilliantearth.csv
 *   (in diamond_scraper/diamond_scraper/ alongside the Python spiders' output)
 */

const puppeteerVanilla = require('puppeteer');
const puppeteerExtra  = (() => { try { const p = require('puppeteer-extra'); const s = require('puppeteer-extra-plugin-stealth'); p.use(s()); return p; } catch(_) { return null; } })();
const puppeteer = puppeteerExtra || puppeteerVanilla;
const fs = require('fs');
const path = require('path');

// ── Logging (console + file) ──────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'scrape.log');
fs.writeFileSync(LOG_FILE, `--- Run started ${new Date().toISOString()} ---\n`);
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
console.log = (...args) => {
  const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _origLog(...args);
  fs.appendFileSync(LOG_FILE, line + '\n');
};
console.error = (...args) => {
  const line = '[ERROR] ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  _origErr(...args);
  fs.appendFileSync(LOG_FILE, line + '\n');
};

// ── Config ────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(__dirname, 'diamond_scraper', 'diamond_scraper');

const args = process.argv.slice(2);
const HEADLESS = args.includes('--headless');
const SITES_ARG = args.find(a => a.startsWith('--sites='));
const SITES = SITES_ARG
  ? SITES_ARG.replace('--sites=', '').split(',')
  : ['jamesallen', 'cleanorigin', 'brilliantearth'];

// ── Utilities ─────────────────────────────────────────────────────────────────

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    keys.join(','),
    ...rows.map(r => keys.map(k => escape(r[k])).join(','))
  ].join('\r\n');
}

function saveCsv(filename, rows) {
  const outPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, toCsv(rows), 'utf8');
  console.log(`  Saved ${rows.length} rows → ${outPath}`);
}

function looksLikeDiamonds(obj) {
  // Does this JSON object/array contain diamond inventory data?
  const str = JSON.stringify(obj).toLowerCase();
  const hits = ['carat', 'clarity', 'color grade', '"cut"', '"shape"', 'sku'].filter(k => str.includes(k));
  return hits.length >= 3;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Random delay between min and max ms — defeats fixed-interval bot detection */
function jitter(min = 600, max = 1800) {
  return sleep(min + Math.random() * (max - min));
}

/** Longer pause every N pages to mimic a user pausing to look at results */
async function maybeLongPause(pageNum, every = 25) {
  if (pageNum % every === 0) {
    const pause = 5000 + Math.random() * 5000; // 5–10 s
    console.log(`  [pause] taking a ${(pause / 1000).toFixed(1)}s break after page ${pageNum}...`);
    await sleep(pause);
  }
}

async function withPage(browser, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Hide automation signals on every page
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36'
  );

  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

/**
 * If a page shows a Cloudflare or Radware challenge, wait for the user to
 * solve it manually (up to 60 seconds), then continue.
 */
async function waitForChallenge(page, vendor) {
  const title = await page.title();
  const isChallenged = ['just a moment', 'checking', 'captcha', 'radware', 'attention required']
    .some(t => title.toLowerCase().includes(t));

  if (isChallenged) {
    console.log(`\n  ⚠️  [${vendor}] Bot challenge detected ("${title}")`);
    console.log(`  ⚠️  Please solve the captcha in the browser window, then wait...`);
    // Wait until the title changes (challenge passed) or timeout
    try {
      await page.waitForFunction(
        () => !['just a moment', 'checking', 'captcha', 'radware', 'attention required']
          .some(t => document.title.toLowerCase().includes(t)),
        { timeout: 60000 }
      );
      console.log(`  ✓  [${vendor}] Challenge passed, continuing...`);
      await sleep(2000);
    } catch (_) {
      console.log(`  ✗  [${vendor}] Challenge not solved within 60s, skipping...`);
    }
  }
}

// ── Shape normalization ────────────────────────────────────────────────────────

const SHAPE_MAP = {
  em: 'Emerald', emerald: 'Emerald', 'emerald cut': 'Emerald',
  mq: 'Marquise', marquise: 'Marquise', 'marquise cut': 'Marquise',
  rd: 'Round', round: 'Round',
  ov: 'Oval', oval: 'Oval',
  pr: 'Pear', pear: 'Pear',
  cu: 'Cushion', cushion: 'Cushion',
  ra: 'Radiant', radiant: 'Radiant',
  as: 'Asscher', asscher: 'Asscher',
  princess: 'Princess', sq: 'Princess',
  heart: 'Heart', ht: 'Heart',
};

function normalizeShape(s) {
  if (!s) return null;
  return SHAPE_MAP[String(s).toLowerCase().trim()] || String(s).trim();
}

// ── James Allen ───────────────────────────────────────────────────────────────

function parseJAProduct(p, fallbackShape) {
  const id = p.productID || p.sku || p.id || p.itemId;
  if (!id) return null;
  // DOM-extracted items have price/carat/etc already parsed as strings
  if (p.href) {
    return {
      Vendor: 'James Allen',
      'Vendor SKU': String(id),
      Link: p.href,
      Price: p.price,
      Shape: normalizeShape(p.shape) || fallbackShape,
      'Carat Weight': p.carat,
      'Color Grade': p.color || '',
      'Cut Grade': p.cut || null,
      'Clarity Grade': p.clarity || '',
      'Grading Lab': p.lab || null,
      Origin: p._isLab ? 'Lab Grown' : (p.lab === 'IGI' ? 'Lab Grown' : 'Mined'),
    };
  }
  const lab = String(p.lab || p.gradingLab || p.certLab || '').toUpperCase() || null;
  const certId = (() => {
    const raw = String(p.cert || p.certNumber || p.certificateNumber || p.reportNumber || '');
    const m = raw.match(/(\d{6,})/);
    return m ? m[1] : null;
  })();
  let link = p.url || p.pdpUrl || p.productUrl || '';
  if (link && !link.startsWith('http')) link = 'https://www.jamesallen.com' + link;
  const meas = p.measurements || p.dims || {};
  const cap = s => s ? String(s).replace(/\b\w/g, c => c.toUpperCase()) : null;
  return {
    Vendor: 'James Allen',
    'Vendor SKU': String(id),
    Link: link || null,
    Price: p.price || p.usdPrice || p.salePrice || p.retailPrice,
    Shape: normalizeShape(p.shape || p.shapeName) || fallbackShape,
    'Carat Weight': p.carat || p.caratWeight,
    'Color Grade': p.color || p.colorGrade || '',
    'Cut Grade': cap(p.cut || p.cutGrade),
    'Clarity Grade': p.clarity || p.clarityGrade || '',
    Fluorescence: cap(p.flour || p.fluorescence),
    'Polish Grade': cap(p.polish),
    'Symmetry Grade': cap(p.symmetry),
    'Depth (%)': p.depth || p.totalDepth,
    Table: p.tableSize || p.table,
    Girdle: p.girdle,
    Culet: p.culet,
    Width: meas.length || meas.width || p.measurement1,
    Height: meas.width || p.measurement2,
    Depth: meas.depth || p.measurement3,
    'Grading Lab': lab,
    'Grading Certificate ID': certId,
    'Grading Link': certId && lab === 'IGI'
      ? `https://www.igi.org/reports/verify-your-report?r=${certId}`
      : certId && lab === 'GIA'
      ? `https://www.gia.edu/report-check?reportno=${certId}`
      : null,
    Origin: (p.isLabDiamond || p.labGrown || p.lab_grown) ? 'Lab Grown' : 'Mined',
    '360 Video Link': p.galleryUrl || p.stage || p.videoUrl || null,
  };
}

function extractJAProducts(json) {
  // Try every likely key that might hold an array of products
  if (Array.isArray(json)) return json;
  const candidates = [
    json.products, json.items, json.diamonds, json.results,
    json.data?.products, json.data?.items, json.data?.diamonds,
    json.payload?.products, json.payload?.items,
    json.response?.products,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
  }
  // Walk one more level if it's a plain object
  for (const val of Object.values(json)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const v2 of Object.values(val)) {
        if (Array.isArray(v2) && v2.length && looksLikeDiamonds(v2.slice(0, 2))) return v2;
      }
    }
  }
  return null;
}

async function scrapeJamesAllen(browser) {
  console.log('\n[James Allen] Starting...');
  const collected = new Map();

  const BASE = 'https://www.jamesallen.com/loose-diamonds/all-diamonds/lab-grown-diamond-search/'
             + '?Shape=all-diamonds&Color=all-colors'
             + '&Clarity=I1,SI2,SI1,VS2,VS1,VVS2,VVS1,IF,FL'
             + '&Cut=Good,Very+Good,Ideal,TrueHearts&CaratFrom=0.05';
  const BASE_MINED = 'https://www.jamesallen.com/loose-diamonds/all-diamonds/'
             + '?Shape=all-diamonds&Color=all-colors'
             + '&Clarity=I1,SI2,SI1,VS2,VS1,VVS2,VVS1,IF,FL'
             + '&Cut=Good,Very+Good,Ideal,TrueHearts&CaratFrom=0.05';
  const PRICE_BANDS = [500, 1000, 2000, 3500, 6000, 10000];
  const SEARCH_PAGES = [
    // Lab grown across price bands
    ...PRICE_BANDS.map((max, i) =>
      `${BASE}&PriceFrom=${i === 0 ? 0 : PRICE_BANDS[i-1]}&PriceTo=${max}`
    ),
    // Natural/mined across price bands
    ...PRICE_BANDS.map((max, i) =>
      `${BASE_MINED}&PriceFrom=${i === 0 ? 0 : PRICE_BANDS[i-1]}&PriceTo=${max}`
    ),
  ];

  await withPage(browser, async (page) => {
    const intercepted = [];

    page.on('response', async (response) => {
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      if (!url.includes('jamesallen.com')) return;
      try {
        const json = await response.json();

        // Target the known diamond API endpoint directly
        if (url.includes('ja-product-api/diamond')) {
          const d = json.data;
          if (!d) return;

          // searchByIDs is an object keyed by diamond ID: { "123": { price, carat, ... }, ... }
          const byId = d.searchByIDs;
          if (byId && typeof byId === 'object' && !Array.isArray(byId)) {
            const vals = Object.values(byId);
            console.log(`  [JA] Diamond API: ${vals.length} items. Sample keys: ${vals[0] ? Object.keys(vals[0]).join(',') : 'none'}`);
            if (vals[0]) console.log(`  [JA] Sample item: ${JSON.stringify(vals[0]).slice(0, 300)}`);
            intercepted.push(...vals);
          } else if (Array.isArray(byId)) {
            console.log(`  [JA] searchByIDs is array[${byId.length}]`);
            intercepted.push(...byId);
          } else if (Array.isArray(d)) {
            intercepted.push(...d);
          } else {
            console.log(`  [JA] Unexpected data shape: ${JSON.stringify(d).slice(0, 200)}`);
          }
          return;
        }

        // General fallback for other JA endpoints
        const products = extractJAProducts(json);
        if (!products || !looksLikeDiamonds(products.slice(0, 2))) return;
        console.log(`  [JA] Other hit: ${url} (${products.length} items)`);
        intercepted.push(...products);
      } catch (_) {}
    });

    // Visit homepage first to establish session
    console.log('  [JA] Loading homepage...');
    await page.goto('https://www.jamesallen.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForChallenge(page, 'James Allen');
    await sleep(3000);

    const homeLinks = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map(a => a.href)
        .filter(h => h.includes('jamesallen.com')).slice(0, 5)
    ).catch(() => []);
    console.log(`  [JA] Homepage internal links: ${homeLinks.join(', ')}`);

    for (const pageUrl of SEARCH_PAGES) {
      console.log(`  [JA] Navigating to: ${pageUrl}`);
      // Use JS navigation to inherit session/cookies rather than a fresh goto
      await page.evaluate(url => { location.href = url; }, pageUrl);
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      await waitForChallenge(page, 'James Allen');
      await sleep(4000);

      // Wait for product cards to appear in the DOM
      await page.waitForSelector(
        '[class*="product"], [class*="diamond"], [class*="item"], [data-sku], [data-product]',
        { timeout: 15000 }
      ).catch(() => console.log('  [JA] No product selector found yet, scrolling anyway...'));
      await sleep(2000);

      // Slow scroll to trigger lazy-loaded API calls
      for (let i = 1; i <= 8; i++) {
        await page.evaluate(n => window.scrollTo(0, document.body.scrollHeight * n / 8), i);
        await sleep(2000);
      }
      // Scroll back to top to trigger any load-on-visible logic
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(3000);

      // Check __NEXT_DATA__
      const nextData = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        try { return JSON.parse(el.textContent); } catch (_) { return null; }
      }).catch(() => null);

      if (nextData) {
        const walk = (obj, depth = 0) => {
          if (depth > 8 || !obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            if (obj.length && looksLikeDiamonds(obj.slice(0, 2))) {
              console.log(`  [JA] __NEXT_DATA__ hit: ${obj.length} items`);
              intercepted.push(...obj);
            }
            return;
          }
          for (const val of Object.values(obj)) walk(val, depth + 1);
        };
        walk(nextData);
      }

      // Log all frames — diamonds may render inside an iframe
      const allFrames = page.frames();
      console.log(`  [JA] Frames (${allFrames.length}): ${allFrames.map(f => f.url().slice(0,80)).join(' | ')}`);

      // Try DOM extraction from every frame
      const isLabPage = pageUrl.includes('lab-grown');
      for (const frame of allFrames) {
        const items = await frame.evaluate(() => {
          // Log all links with numeric IDs for debugging
          const allLinks = [...document.querySelectorAll('a[href]')]
            .map(a => a.href).filter(h => /\d{5,}/.test(h));
          if (allLinks.length) console.log('Links with IDs:', allLinks.slice(0,5).join(', '));

          const results = [];
          const cards = [...document.querySelectorAll('a[href]')]
            .filter(a => /\d{5,}/.test(a.href));
          for (const card of cards) {
            const txt = card.innerText || '';
            const href = card.href || '';
            const idM = href.match(/(\d{5,})/);
            const priceM = txt.match(/\$([\d,]+)/);
            const caratM = txt.match(/([\d.]+)\s*[Cc]t/);
            const colorM = txt.match(/\b([D-M])\b/);
            const clarityM = txt.match(/\b(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|I1|I2)\b/);
            const shapeM = txt.match(/\b(Round|Oval|Cushion|Emerald|Pear|Marquise|Radiant|Asscher|Princess|Heart)\b/i);
            const cutM = txt.match(/\b(Ideal|Excellent|Very Good|Good|Fair|Super Ideal|Astor)\b/i);
            const labM = txt.match(/\b(GIA|IGI|AGS|GCAL)\b/);
            if (idM && priceM) {
              results.push({
                id: idM[1], price: priceM[1].replace(/,/g, ''),
                carat: caratM?.[1] ?? null, color: colorM?.[1] ?? null,
                clarity: clarityM?.[1] ?? null, shape: shapeM?.[1] ?? null,
                cut: cutM?.[1] ?? null, lab: labM?.[1] ?? null, href,
              });
            }
          }
          return results;
        }).catch(() => []);

        if (items.length) {
          console.log(`  [JA] DOM: ${items.length} cards from frame ${frame.url().slice(0,60)} (${isLabPage ? 'lab' : 'mined'})`);
          for (const d of items) intercepted.push({ ...d, _isLab: isLabPage });
        }
      }

      const prevCount = collected.size;
      for (const p of intercepted.splice(0)) {
        const parsed = parseJAProduct(p, null);
        if (parsed && !collected.has(parsed['Vendor SKU'])) {
          collected.set(parsed['Vendor SKU'], parsed);
        }
      }
      console.log(`  [JA] Running total: ${collected.size} (+${collected.size - prevCount})`);
      await jitter(1200, 2500);
    }
  });

  const rows = [...collected.values()];
  console.log(`[James Allen] Total: ${rows.length} diamonds`);
  if (rows.length) saveCsv('jamesallen.csv', rows);
  else console.log('  [JA] Could not capture JA data. Their anti-bot is too strong for Puppeteer.');
}

// ── Clean Origin ──────────────────────────────────────────────────────────────

async function scrapeCleanOrigin(browser) {
  console.log('\n[Clean Origin] Starting...');
  const items = [];

  // Navigate to shape pages (which we know load without 403) and intercept API
  const SHAPES = ['Round','Princess','Radiant','Heart','Oval','Cushion','Pear','Emerald','Marquise','Asscher'];
  const collected = new Map(); // SKU → item

  await withPage(browser, async (page) => {
    // Intercept all JSON responses
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      try {
        const json = await response.json();
        const products = Array.isArray(json) ? json
          : json.products || json.items || json.diamonds || json.data || json.results
          || json.items_data || json.collection;
        if (!products || !Array.isArray(products) || !products.length) return;
        if (!looksLikeDiamonds(products.slice(0, 3))) return;
        console.log(`  [CO] API hit: ${response.url()} (${products.length} items)`);
        for (const p of products) {
          const key = p.sku || p.id || p.certificate_number || JSON.stringify(p).slice(0,40);
          if (!collected.has(key)) collected.set(key, p);
        }
      } catch (_) {}
    });

    // Load homepage first to establish session
    console.log('  [CO] Loading homepage...');
    await page.goto('https://www.cleanorigin.com/', { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForChallenge(page, 'Clean Origin');
    await sleep(3000);

    // Navigate to each shape page via JS (inherits session)
    for (const shape of SHAPES) {
      const shapeUrl = `https://www.cleanorigin.com/diamonds/?diamond_shape=${shape}`;
      console.log(`  [CO] Loading shape: ${shape}`);
      await page.evaluate(url => { location.href = url; }, shapeUrl);
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      await waitForChallenge(page, 'Clean Origin');
      await sleep(2000);

      // Slow scroll to trigger all lazy-loaded API calls
      for (let i = 1; i <= 6; i++) {
        await page.evaluate(n => window.scrollTo(0, document.body.scrollHeight * n / 6), i);
        await sleep(1500);
      }
      await sleep(2000);

      const pageTitle = await page.title().catch(() => '');
      console.log(`  [CO] ${shape}: page="${pageTitle}", total collected=${collected.size}`);
    }
  });

  if (collected.size) {
    console.log(`  [CO] API captured ${collected.size} items`);
    for (const p of collected.values()) {
      const certId = p.certificate_number || p.certNumber || p.cert_id || null;
      const lab = String(p.grading_lab || p.lab || 'IGI').toUpperCase();
      items.push({
        Vendor: 'Clean Origin',
        'Vendor SKU': p.sku || p.id || null,
        Link: p.url ? (p.url.startsWith('http') ? p.url : 'https://www.cleanorigin.com' + p.url) : null,
        Price: p.price || p.retail_price,
        Shape: normalizeShape(p.shape),
        'Carat Weight': p.carat || p.carat_weight,
        'Color Grade': p.color,
        'Cut Grade': p.cut,
        'Clarity Grade': p.clarity,
        Fluorescence: p.fluorescence,
        'Polish Grade': p.polish,
        'Symmetry Grade': p.symmetry,
        'Grading Lab': lab,
        'Grading Certificate ID': certId,
        'Grading Link': certId && lab === 'IGI'
          ? `https://www.igi.org/reports/verify-your-report?r=${certId}`
          : certId && lab === 'GIA'
          ? `https://www.gia.edu/report-check?reportno=${certId}`
          : null,
        Origin: 'Lab Grown',
      });
    }
    console.log(`[Clean Origin] Total: ${items.length} diamonds`);
    if (items.length) saveCsv('cleanorigin.csv', items);
    return;
  }

  console.log('  [CO] No API data found on shape pages.');

  console.log(`  [CO] Total links to scrape: ${allLinks.length}`);

  // Scrape each detail page
  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i];
    console.log(`  [CO] Detail ${i + 1}/${allLinks.length}: ${link}`);

    await withPage(browser, async (page) => {
      // Intercept IGI cert API response
      let igiData = null;
      page.on('response', async (response) => {
        if (!response.url().includes('igi.org/igi_new.php')) return;
        try {
          const text = await response.text();
          igiData = text;
        } catch (_) {}
      });

      await page.goto(link, { waitUntil: 'networkidle2', timeout: 45000 });

      // Extract price
      const price = await page.$eval(
        '[data-price-type="finalPrice"]',
        el => el.getAttribute('data-price-amount')
      ).catch(() => null);

      // Extract attributes from details list
      const attrs = await page.$$eval('#details-list .item', items => {
        const map = {};
        items.forEach(item => {
          const label = item.querySelector('.attr-label');
          const value = item.querySelector('.attr-value');
          if (label && value) map[label.textContent.trim()] = value.textContent.trim();
        });
        return map;
      }).catch(() => ({}));

      // Extract cert ID from page (cert image URL or details)
      const certId = await page.evaluate(() => {
        // Look for cert image URL containing a number
        const imgs = [...document.querySelectorAll('img[src*="igi"], img[alt*="cert"], img[alt*="IGI"]')];
        for (const img of imgs) {
          const m = img.src.match(/(\d{6,})/);
          if (m) return m[1];
        }
        // Try gallery script
        const scripts = [...document.querySelectorAll('script')];
        for (const s of scripts) {
          if (s.textContent.includes('certImage')) {
            const m = s.textContent.match(/certImage[^"]*"([^"]*\d{6,}[^"]*)"/) ||
                      s.textContent.match(/"certImage":"([^"]+)"/);
            if (m) {
              const numM = m[1].match(/(\d{6,})/);
              if (numM) return numM[1];
            }
          }
        }
        return null;
      }).catch(() => null);

      const gradingLab = attrs['Grading Lab'] || 'IGI';

      const item = {
        Vendor: 'Clean Origin',
        'Vendor SKU': attrs['SKU'] || null,
        Link: link,
        Price: price,
        Shape: normalizeShape(attrs['Shape']),
        'Carat Weight': attrs['Carat Weight'] ? parseFloat(attrs['Carat Weight']) : null,
        'Color Grade': attrs['Color'] || attrs['Color Grade'] || null,
        'Cut Grade': attrs['Cut'] || attrs['Cut Grade'] || null,
        'Clarity Grade': attrs['Clarity'] || attrs['Clarity Grade'] || null,
        Fluorescence: attrs['Fluorescence'] || null,
        'Polish Grade': attrs['Polish'] || null,
        'Symmetry Grade': attrs['Symmetry'] || null,
        'Grading Lab': gradingLab,
        'Grading Certificate ID': certId,
        'Grading Link': certId && gradingLab.toUpperCase() === 'IGI'
          ? `https://www.igi.org/reports/verify-your-report?r=${certId}`
          : null,
        Origin: 'Lab Grown', // Clean Origin sells only lab-grown
      };

      // If we got IGI data from the network intercept, enrich the item
      if (igiData) {
        try {
          const parsed = JSON.parse(igiData);
          // igiData is an HTML blob wrapped in JSON array
          const html = Array.isArray(parsed) ? parsed[0] : parsed;
          // Parse measurements from the cert HTML
          const mMatch = String(html).match(/Measurements[\s\S]*?([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*mm/i);
          if (mMatch) {
            item.Width = parseFloat(mMatch[1]);
            item.Height = parseFloat(mMatch[2]);
            item.Depth = parseFloat(mMatch[3]);
          }
          const depthMatch = String(html).match(/Total Depth[\s\S]*?([\d.]+%)/i);
          if (depthMatch) item['Depth (%)'] = depthMatch[1];
          const tableMatch = String(html).match(/Table Size[\s\S]*?([\d.]+%)/i);
          if (tableMatch) item.Table = tableMatch[1];
        } catch (_) {}
      }

      items.push(item);
    });

    await sleep(1200);
  }

  console.log(`[Clean Origin] Total: ${items.length} diamonds`);
  if (items.length) saveCsv('cleanorigin.csv', items);
}

// ── Brilliant Earth ───────────────────────────────────────────────────────────

function parseBEDiamond(d, sectionLabel) {
  const certId = d.certificate_number || null;
  const lab = String(d.report || '').toUpperCase() || null;
  const mParts = (d.measurements || '').split('x').map(s => parseFloat(s.trim()));
  const [mLen, mWid, mDep] = mParts;
  // Use sectionLabel as the authoritative source — BE's `origin` field is unreliable for lab
  const origin = sectionLabel === 'Lab'
    ? 'Lab Grown'
    : sectionLabel === 'Natural'
    ? 'Mined'
    : (String(d.origin || '').toLowerCase().includes('lab') ? 'Lab Grown' : 'Mined');
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
    Width: mLen || null,
    Height: mWid || null,
    Depth: mDep || null,
    'Grading Lab': lab,
    'Grading Certificate ID': certId,
    'Grading Link': certId && lab === 'IGI'
      ? `https://www.igi.org/reports/verify-your-report?r=${certId}`
      : certId && lab === 'GIA'
      ? `https://www.gia.edu/report-check?reportno=${certId}`
      : null,
    Origin: origin,
    '360 Video Link': d.v360_src ? 'https:' + d.v360_src : null,
  };
}

async function scrapeBrilliantEarth(browser) {
  console.log('\n[Brilliant Earth] Starting...');
  const collected = new Map();

  // Navigate to both the lab and natural search pages. Intercept the first
  // /api/v1/plp/products/ call to get the exact URL with all real params BE uses,
  // then page through results using that URL as a template (just replace page=N).
  const SECTIONS = [
    { url: 'https://www.brilliantearth.com/lab-diamonds/search/', label: 'Lab' },
    { url: 'https://www.brilliantearth.com/loose-diamonds/search/', label: 'Natural' },
  ];

  for (const { url: startUrl, label } of SECTIONS) {
    console.log(`\n  [BE] Navigating to ${label} diamonds page...`);
    let apiTemplate = null;

    await withPage(browser, async (page) => {
      // Log all BE API calls so we can see what the lab page fires
      page.on('response', async (response) => {
        const u = response.url();
        if (!u.includes('brilliantearth.com')) return;
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('json') || u.includes('/api/') || u.includes('/plp/') || u.includes('/products/')) {
          console.log(`  [BE] ${label} response: ${u.slice(0, 140)}`);
        }
        if (apiTemplate) return;
        // Accept any BE API URL that returns product/diamond data
        if (u.includes('/plp/') || u.includes('/api/v1/') || u.includes('/products/')) {
          try {
            const json = await response.json();
            if (json.products && Array.isArray(json.products)) {
              apiTemplate = u;
              console.log(`  [BE] Captured ${label} API URL: ${u.slice(0, 120)}`);
            }
          } catch (_) {}
        }
      });

      await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 90000 });
      await waitForChallenge(page, 'Brilliant Earth');
      await sleep(5000);

      if (!apiTemplate) {
        console.log(`  [BE] No API call captured for ${label} — skipping`);
        return;
      }

      // Replace max_price with our budget cap and reset to page 1
      const templateUrl = apiTemplate
        .replace(/max_price=\d+/, 'max_price=5000')
        .replace(/page=\d+/, 'page=PAGE_NUM');

      let pageNum = 1;
      let fetched = 0;

      while (true) {
        const pageUrl = templateUrl.replace('PAGE_NUM', String(pageNum));
        const result = await page.evaluate(async (fetchUrl) => {
          try {
            const res = await fetch(fetchUrl, { credentials: 'include' });
            return { ok: true, data: await res.json() };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }, pageUrl);

        if (!result.ok) {
          console.log(`  [BE] Fetch error p${pageNum}: ${result.error}`);
          break;
        }

        const products = result.data.products;
        if (!products || !products.length) break;

        console.log(`  [BE] ${label} page ${pageNum}: ${products.length} diamonds`);
        fetched += products.length;

        for (const d of products) {
          const id = String(d.id || d.upc);
          if (!collected.has(id)) collected.set(id, parseBEDiamond(d, label));
        }

        if (products.length < 50) break;
        pageNum++;
        await maybeLongPause(pageNum);
        await jitter(600, 1600);
      }

      console.log(`  [BE] ${label}: ${fetched} fetched, ${collected.size} total unique`);
    });

    await sleep(2000);
  }

  const rows = [...collected.values()];
  console.log(`[Brilliant Earth] Total: ${rows.length} diamonds`);
  if (rows.length) saveCsv('brilliantearth.csv', rows);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Launching ${HEADLESS ? 'headless' : 'headed'} browser...`);
  console.log(`Scraping: ${SITES.join(', ')}`);
  console.log(`Output dir: ${OUTPUT_DIR}\n`);

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
    defaultViewport: null,
    ignoreHTTPSErrors: true,
  });

  try {
    if (SITES.includes('jamesallen')) await scrapeJamesAllen(browser);
    if (SITES.includes('cleanorigin')) await scrapeCleanOrigin(browser);
    if (SITES.includes('brilliantearth')) await scrapeBrilliantEarth(browser);
  } finally {
    await browser.close();
  }

  console.log('\nDone! Run filter_results.py to filter the results:');
  console.log('  cd diamond_scraper/diamond_scraper && python filter_results.py');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
