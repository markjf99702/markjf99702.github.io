// Opens the drawer's pages in Chromium the way people see them:  node test/e2e.mjs  (needs Playwright)
// The home page, the privacy page and the 404 page on two phones, a tablet and a desktop, in light and dark: nothing
// goes wrong, nothing loads from elsewhere, nothing scrolls sideways, the text is dark enough to read and the quotes
// are curly. Then lines that have broken badly before: a headline's last word alone, a range like 20–80 split in two.
// Headless Chromium has its own fonts, so a line can break a word earlier or later on a real phone. Then a tile's
// focus ring, which has to show up against what it's drawn on. Last, the share card that tools/og.mjs draws: a
// compartment for every tile, each big enough to make out what's in it.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { card, objectsIn } from '../tools/og.mjs';

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

  // A tile's keyboard focus ring changes the pixels it covers by 3:1 or more, at least 2px deep, on all four sides: the
  // first tile in each tray and one in a row of its own, in light and dark. The wood around a tile is too close in
  // colour to the trays' own, so a ring drawn there barely shows.
  {
    const decoder = await browser.newPage();
    for (const size of SIZES.slice(1)) for (const scheme of ['light', 'dark']) {
      const { ctx, page, where } = await open('/', size, scheme);
      await page.keyboard.press('Tab'); // focus then shows the way it does for someone using a keyboard
      const lone = size.width > 820 ? '[data-l="1"]' : size.width > 540 ? '[data-m="1"]' : null;
      for (const tray of ['tools', 'games', 'explore']) {
        check(await page.locator(`#${tray} a.slot`).count() > 0, `${where}: found no tiles to focus in the ${tray} tray`);
        for (const [tile, kind] of [[page.locator(`#${tray} a.slot`).first(), ''], ...(lone ? [[page.locator(`#${tray} a.slot${lone}`).first(), ', in a row of its own,']] : [])]) {
          if (!await tile.count()) continue; // not every tray has a tile in a row of its own
          await page.evaluate(() => document.activeElement.blur());
          await tile.evaluate(el => el.scrollIntoView({ block: 'center' }));
          const box = await tile.boundingBox();
          const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 };
          const before = await page.screenshot({ clip });
          await tile.evaluate(el => el.focus({ preventScroll: true }));
          const name = `${await tile.locator('h3').textContent()}${kind}`;
          check(await tile.evaluate(el => el.matches(':focus-visible')), `${where}: ${name} shows no focus ring`);
          const after = await page.screenshot({ clip });
          // Across the middle of each side, from 8px outside the tile to 12px inside it: the longest run of pixels that
          // focus changes by 3:1 or more, and the most it changes any of them.
          const sides = await decoder.evaluate(async ([a, b, scale]) => {
            const load = async png => {
              const img = new Image();
              img.src = `data:image/png;base64,${png}`;
              await img.decode();
              const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
              g.drawImage(img, 0, 0);
              return g.getImageData(0, 0, img.width, img.height);
            };
            const [A, B] = [await load(a), await load(b)];
            const lum = (d, i) => {
              const f = v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
              return 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
            };
            const ratio = ([x, y]) => {
              const i = (y * A.width + x) * 4;
              const [hi, lo] = [lum(A.data, i), lum(B.data, i)].sort((p, q) => q - p);
              return (hi + 0.05) / (lo + 0.05);
            };
            const { width: w, height: h } = A;
            const across = { left: k => [k, h >> 1], right: k => [w - 1 - k, h >> 1], top: k => [w >> 1, k], bottom: k => [w >> 1, h - 1 - k] };
            return Object.entries(across).map(([side, at]) => {
              let run = 0, longest = 0, most = 1;
              for (let k = 0; k < 20 * scale; k++) {
                const r = ratio(at(k));
                most = Math.max(most, r);
                run = r >= 3 ? run + 1 : 0;
                longest = Math.max(longest, run);
              }
              return [side, longest / scale, most];
            });
          }, [before.toString('base64'), after.toString('base64'), size.phone ? 2 : 1]);
          for (const [side, deep, most] of sides) {
            check(deep >= 2, `${where}: the focus ring on ${name} changes its ${side} side by ${most.toFixed(2)}:1 at most, needs 3:1 over 2px`);
          }
        }
      }
      await ctx.close();
    }
    await decoder.close();
  }

  // The share card: one compartment per tile in page order, each 40px or more so its object can be made out, and all of
  // it on the card. Then 70 projects, more than four rows of 14 hold, still fit.
  {
    const { ctx, page } = await open('/', { width: 1280, height: 800 });
    const tiles = await page.evaluate(() => [...document.querySelectorAll('.slot > .obj')].map(o => o.textContent));
    await ctx.close();
    const objects = objectsIn(await readFile(join(root, 'index.html'), 'utf8'));
    check(objects.length > 0, 'og.png: tools/og.mjs finds no tiles in index.html');
    const drawing = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    for (const [list, want] of [[objects, tiles], [Array.from({ length: 70 }, (_, i) => objects[i % objects.length])]]) {
      await drawing.setContent(card(list));
      const got = await drawing.evaluate(() => {
        const slots = [...document.querySelectorAll('.slot')].map(s => ({ text: s.textContent, box: s.getBoundingClientRect() }));
        return {
          objects: slots.map(s => s.text),
          smallest: Math.min(...slots.map(s => Math.min(s.box.width, s.box.height))),
          off: [...document.body.children].some(el => {
            const r = el.getBoundingClientRect();
            return r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth;
          }),
        };
      });
      const what = `og.png with ${list.length} projects`;
      if (want) check(JSON.stringify(got.objects) === JSON.stringify(want), `${what}: the compartments hold ${got.objects.join('')}, not the tiles ${want.join('')}`);
      check(got.objects.length === list.length, `${what}: ${got.objects.length} compartments`);
      check(got.smallest >= 40, `${what}: compartments are ${got.smallest}px, too small to make out what's in them`);
      check(!got.off, `${what}: part of the card is cut off`);
    }
    await drawing.close();
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
