// Opens the drawer's pages in Chromium the way people see them:  node test/e2e.mjs  (needs Playwright)
// The home page, the privacy page and the 404 page on two phones, a tablet and a desktop, in light and dark: nothing
// goes wrong, nothing loads from elsewhere, nothing scrolls sideways, the text is dark enough to read and the quotes
// are curly. Then lines that have broken badly before: a headline's last word alone, a range like 20–80 split in two.
// Headless Chromium has its own fonts, so a line can break a word earlier or later on a real phone.
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

// Each line of an element's text, as the words on it.
const lines = (page, selector) => page.evaluate(selector => {
  const words = [];
  const walk = document.createTreeWalker(document.querySelector(selector), NodeFilter.SHOW_TEXT);
  for (let node; (node = walk.nextNode());) {
    for (const m of node.data.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      words.push({ word: m[0], top: r.getClientRects()[0].top });
    }
  }
  const out = [];
  for (const w of words) {
    const line = out[out.length - 1];
    if (line && Math.abs(line.top - w.top) < 4) line.words.push(w.word); else out.push({ top: w.top, words: [w.word] });
  }
  return out.map(l => l.words);
}, selector);

try {
  for (const path of PAGES) for (const size of SIZES) for (const scheme of ['light', 'dark']) {
    const { ctx, page, where } = await open(path, size, scheme);

    // Nothing scrolls sideways. A phone widens the page to fit what's too wide instead, so compare with the width asked for.
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= size.width, `${where}: the page is ${wide}px wide, so it scrolls sideways`);

    // Text stands out from what it sits on: 4.5:1, or 3:1 for large text (WCAG AA).
    const faint = await page.evaluate(() => {
      const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => {
        const f = v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ground = el => {
        for (; el; el = el.parentElement) { const c = rgb(getComputedStyle(el).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0) return c; }
        return [255, 255, 255];
      };
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.getClientRects().length || ![...el.childNodes].some(n => n.nodeType === 3 && /\w/.test(n.data))) continue;
        const s = getComputedStyle(el);
        const [hi, lo] = [lum(rgb(s.color)), lum(ground(el))].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const px = parseFloat(s.fontSize), large = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.push(`“${el.textContent.trim().slice(0, 40)}” is ${ratio.toFixed(2)}:1`);
      }
      return out;
    });
    check(!faint.length, `${where}: text too faint to read: ${faint.join('; ')}`);

    // Curly apostrophes and quotes in what people read, like the rest of the copy.
    const straight = await page.evaluate(() => document.body.innerText.split('\n').filter(l => /['"]/.test(l)));
    check(!straight.length, `${where}: straight quotes in ${straight.map(l => `“${l.slice(0, 60)}”`).join(', ')}`);

    await ctx.close();
  }

  // A headline doesn't leave its last word on a line of its own.
  for (const [path, selector, widths] of [['/', '.tag', [320, 390, 414]], ['/404.html', '.lost h1', [320, 390, 800, 1280]]]) {
    for (const width of widths) {
      const { ctx, page, where } = await open(path, { width, height: 800, phone: width < 500 });
      const got = await lines(page, selector);
      check(got.length < 2 || got[got.length - 1].length > 1, `${where}: ${selector} breaks as ${got.map(l => `“${l.join(' ')}”`).join(' / ')}`);
      await ctx.close();
    }
  }

  // A range like 20–80 stays on one line at every width.
  {
    const { ctx, page } = await open('/', { width: 1300, height: 800 });
    for (let width = 320; width <= 1300; width += 10) {
      await page.setViewportSize({ width, height: 800 });
      const split = await page.evaluate(() => {
        const out = [];
        const walk = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
        for (let node; (node = walk.nextNode());) {
          for (const m of node.data.matchAll(/\d+[–\u2060]+\d+/g)) {
            const top = i => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getClientRects()[0].top; };
            if (Math.abs(top(m.index) - top(m.index + m[0].length - 1)) > 4) out.push(m[0].replace(/\u2060/g, ''));
          }
        }
        return out;
      });
      check(!split.length, `/ at ${width}px: ${split.join(', ')} breaks across two lines`);
    }
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
