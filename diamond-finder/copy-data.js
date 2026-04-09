/**
 * copy-data.js — copies scraped CSVs into public/data/ for the web app.
 * Run from diamond-finder/:  node copy-data.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'Diamond Scraper', 'diamond_scraper', 'diamond_scraper');
const DEST = path.join(__dirname, 'public', 'data');

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

const files = ['brilliantearth.csv', 'jamesallen.csv', 'cleanorigin.csv'];
let copied = 0;

for (const file of files) {
  const src = path.join(SRC, file);
  const dest = path.join(DEST, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const rows = fs.readFileSync(src, 'utf8').split('\n').length - 2;
    console.log(`  Copied ${file} (${rows} rows)`);
    copied++;
  } else {
    console.log(`  Skipped ${file} (not found)`);
  }
}

console.log(`\nDone. ${copied} file(s) copied to public/data/`);
console.log('Now run: npm run build  (or npm run dev to preview locally)');
