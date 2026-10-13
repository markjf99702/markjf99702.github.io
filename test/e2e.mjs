// Opens the drawer's pages in Chromium the way people see them:  node test/e2e.mjs  (needs Playwright)
// The home page, the privacy page and the 404 page on two phones, a tablet and a desktop, in light and dark: nothing
// goes wrong, nothing loads from elsewhere and nothing scrolls sideways. Headless Chromium has its own fonts, so a
// line can break a word earlier or later on a real phone.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const PAGES = ['/', '/privacy.html', '/404.html'];
const SIZES = [
  { width: 320, height: 640, phone: true }, // the smallest phones, and a desktop browser zoomed to 400%
  { width: 390, height: 844, phone: true },
  { width: 800, height: 1000 },
  { width: 1280, height: 800 },
];

const browser = await pw.chromium.launch();
const problems = [];
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

async function open(path, { width, height, phone = false }, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, colorScheme: scheme });
  const page = await ctx.newPage();
  const where = `${path} at ${width}px, ${scheme}`;
  page.on('pageerror', e => problems.push(`${where}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`${where}: ${m.text()}`); });
  page.on('request', r => { if (!r.url().startsWith(base + '/')) problems.push(`${where}: loaded ${r.url()}`); });
  await page.goto(base + path);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, where };
}

try {
  for (const path of PAGES) for (const size of SIZES) for (const scheme of ['light', 'dark']) {
    const { ctx, page, where } = await open(path, size, scheme);

    // Nothing scrolls sideways. A phone widens the page to fit what's too wide instead, so compare with the width asked for.
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= size.width, `${where}: the page is ${wide}px wide, so it scrolls sideways`);

    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

failures.push(...problems);
if (failures.length) {
  console.error(failures.join('\n'));
  assert.fail(`${failures.length} problem(s)`);
}
console.log('all good');
