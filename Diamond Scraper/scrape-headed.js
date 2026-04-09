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

const puppeteer = require('puppeteer');
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

async function scrapeJamesAllen(browser) {
  console.log('\n[James Allen] Starting...');
  const collected = new Map(); // productID → item, dedup across pages

  const SHAPES = [
    { slug: 'emerald-cut', shape: 'Emerald' },
    { slug: 'marquise-cut', shape: 'Marquise' },
  ];

  for (const { slug, shape } of SHAPES) {
    console.log(`  [JA] Scraping ${shape} cut...`);

    await withPage(browser, async (page) => {
      // Intercept JSON responses and look for diamond data
      page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json')) return;

        try {
          const json = await response.json();
          // Check if this looks like a products/diamonds array
          const products = Array.isArray(json)
            ? json
            : json.products || json.items || json.diamonds || json.results || null;

          if (!products || !Array.isArray(products) || !products.length) return;
          if (!looksLikeDiamonds(products.slice(0, 2))) return;

          console.log(`  [JA] Intercepted diamond data from: ${url} (${products.length} items)`);

          for (const p of products) {
            const id = p.productID || p.sku || p.id;
            if (!id || collected.has(String(id))) continue;

            const meas = p.measurements || {};
            const lab = String(p.lab || '').toUpperCase() || null;
            const certId = (() => {
              const raw = String(p.cert || p.certNumber || '');
              const m = raw.match(/(\d{7,})/);
              return m ? m[1] : null;
            })();

            let url2 = p.url || '';
            if (url2 && !url2.startsWith('http')) url2 = 'https://www.jamesallen.com' + url2;

            collected.set(String(id), {
              Vendor: 'James Allen',
              'Vendor SKU': p.sku || '',
              Link: url2,
              Price: p.price || p.usdPrice || p.salePrice,
              Shape: normalizeShape(p.shape) || shape,
              'Carat Weight': p.carat,
              'Color Grade': p.color || '',
              'Cut Grade': p.cut ? String(p.cut).replace(/\b\w/g, c => c.toUpperCase()) : null,
              'Clarity Grade': p.clarity || '',
              Fluorescence: p.flour ? String(p.flour).replace(/\b\w/g, c => c.toUpperCase()) : null,
              'Polish Grade': p.polish ? String(p.polish).replace(/\b\w/g, c => c.toUpperCase()) : null,
              'Symmetry Grade': p.symmetry ? String(p.symmetry).replace(/\b\w/g, c => c.toUpperCase()) : null,
              'Depth (%)': p.depth,
              Table: p.tableSize,
              Girdle: p.girdle,
              Culet: p.culet,
              Width: meas.length || meas.width,
              Height: meas.width,
              Depth: meas.depth,
              'Grading Lab': lab,
              'Grading Certificate ID': certId,
              'Grading Link': certId && lab === 'IGI'
                ? `https://www.igi.org/reports/verify-your-report?r=${certId}`
                : certId && lab === 'GIA'
                ? `https://www.gia.edu/report-check?reportno=${certId}`
                : null,
              Origin: p.isLabDiamond ? 'Lab Grown' : 'Mined',
              '360 Video Link': p.galleryUrl || p.stage,
            });
          }
        } catch (_) {
          // Not parseable as JSON or not diamond data
        }
      });

      // Navigate and wait for content to load
      const url = `https://www.jamesallen.com/loose-diamonds/${slug}/?priceMax=1500`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await waitForChallenge(page, 'James Allen');

      // Scroll down to trigger lazy loading / pagination API calls
      for (let i = 1; i <= 4; i++) {
        await page.evaluate(n => window.scrollTo(0, document.body.scrollHeight * n / 4), i);
        await sleep(1500);
      }
      await sleep(2000);
    });

    console.log(`  [JA] ${shape}: ${collected.size} items collected so far`);
    await sleep(2000);
  }

  const rows = [...collected.values()];
  console.log(`[James Allen] Total: ${rows.length} diamonds`);
  if (rows.length) saveCsv('jamesallen.csv', rows);
  else console.log('  [JA] No data intercepted. JA may use an obfuscated endpoint — open DevTools Network tab and look for XHR calls returning JSON arrays while on a JA diamond listing page.');
}

// ── Clean Origin ──────────────────────────────────────────────────────────────

async function scrapeCleanOrigin(browser) {
  console.log('\n[Clean Origin] Starting...');
  const items = [];

  // Collect all diamond links across listing pages
  const allLinks = [];
  await withPage(browser, async (page) => {
    let listUrl = 'https://www.cleanorigin.com/diamonds/?product_list_limit=100';
    while (listUrl) {
      console.log(`  [CO] Listing page: ${listUrl}`);
      await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 90000 });
      await waitForChallenge(page, 'Clean Origin');

      const links = await page.$$eval(
        'table.diamonds-listing tr.listing-row td[data-attr="diamond_link"] a',
        els => els.map(el => el.href)
      ).catch(() => []);

      if (!links.length) {
        // Alternate selectors
        const alt = await page.$$eval(
          'a[href*="/lab-created-diamond/"], a[href*="/diamond/"]',
          els => [...new Set(els.map(el => el.href).filter(h => h.includes('cleanorigin.com')))]
        ).catch(() => []);
        allLinks.push(...alt);
        if (!alt.length) { console.log('  [CO] No links found on listing page, stopping.'); break; }
      } else {
        allLinks.push(...links);
      }

      console.log(`  [CO] Found ${links.length} links (${allLinks.length} total)`);

      // Next page
      const nextHref = await page.$eval('.pages-item-next a', el => el.href).catch(() => null);
      listUrl = nextHref || null;
      if (listUrl) await sleep(1500);
    }
  });

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

function parseBEDiamond(d) {
  const certId = d.certificate_number || null;
  const lab = String(d.report || '').toUpperCase() || null;
  const mParts = (d.measurements || '').split('x').map(s => parseFloat(s.trim()));
  const [mLen, mWid, mDep] = mParts;
  const originRaw = String(d.origin || '').toLowerCase();
  const origin = originRaw.includes('lab') ? 'Lab Grown' : 'Mined';
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
      // Capture the first API call the page makes
      page.on('response', async (response) => {
        if (apiTemplate) return;
        if (!response.url().includes('/api/v1/plp/products/')) return;
        apiTemplate = response.url();
        console.log(`  [BE] Captured ${label} API URL`);
      });

      await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 90000 });
      await waitForChallenge(page, 'Brilliant Earth');
      await sleep(3000);

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
          if (!collected.has(id)) collected.set(id, parseBEDiamond(d));
        }

        if (products.length < 50) break;
        pageNum++;
        await sleep(600);
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
