// Redraws og.png, the picture shown when junkdrawer.works is shared in a message:  node tools/og.mjs
// The tray has one compartment per project, read in order from the tiles in index.html,
// so after adding a project this is the only step. Needs Playwright.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each tile's object, in page order.
export const objectsIn = html => [...html.matchAll(/<span class="obj" aria-hidden="true">([^<]+)<\/span>/g)].map((m) => m[1]);

// The card, with a compartment for each object. Compartments are 60px, big enough to make out what's in them,
// 14 to a row: four rows hold 56 projects. Past that the rows take more, a little smaller, so the tray still fits.
export function card(objects) {
  const gap = 12;
  const perRow = Math.max(14, Math.ceil(objects.length / 4));
  const size = Math.min(60, Math.floor((1034 - gap * (perRow - 1)) / perRow));
  return `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f4ede1; color: #2b2118;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .pull { width: 150px; height: 26px; flex: none; border-radius: 13px; position: relative;
    background: linear-gradient(180deg, #f3d08a, #b7863c);
    box-shadow: 0 3px 0 rgba(0,0,0,.18), 0 10px 22px -8px rgba(60,35,10,.28), inset 0 1px 0 rgba(255,255,255,.6); }
  .pull::before, .pull::after { content: ""; position: absolute; top: 7px; width: 12px; height: 12px; border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #f3d08a, #b7863c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
  .pull::before { left: 8px; } .pull::after { right: 8px; }
  h1 { margin: 26px 0 0; font-size: 110px; line-height: 1; font-weight: 800; letter-spacing: -.035em; }
  h1 span { color: #8a4f1c; }
  p { margin: 16px 0 0; font-size: 39px; font-weight: 700; letter-spacing: .005em; }
  .tray { margin-top: 42px; flex: none; padding: 12px; border-radius: 20px;
    display: grid; grid-template-columns: repeat(${Math.min(perRow, objects.length)}, ${size}px); gap: ${gap}px;
    background: repeating-linear-gradient(94deg, transparent 0 22px, rgba(92,56,22,.10) 22px 24px, transparent 24px 61px, rgba(92,56,22,.10) 61px 62px),
      linear-gradient(180deg, #c3935c, #9c6d3c);
    box-shadow: 0 1px 0 rgba(255,255,255,.25) inset, 0 18px 40px -18px rgba(60,35,10,.28), 0 2px 0 #9c6d3c; }
  .slot { width: ${size}px; height: ${size}px; border-radius: 11px; background: #fbf7ef; display: grid; place-items: center;
    font-size: ${Math.round(size * 0.58)}px; line-height: 1;
    box-shadow: inset 0 3px 8px rgba(60,35,10,.28), inset 0 -1px 0 rgba(255,255,255,.35); }
  .slot span { filter: drop-shadow(0 3px 2px rgba(0,0,0,.18)); }
</style>
<div class="pull"></div>
<h1>junkdrawer<span>.works</span></h1>
<p>The only junk drawer where everything works.</p>
<div class="tray">${objects.map((o) => `<div class="slot"><span>${o}</span></div>`).join('')}</div>`;
}

// Draw it only when run as a script; the test imports the two functions above.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const objects = objectsIn(await readFile(join(root, 'index.html'), 'utf8'));
  if (!objects.length) throw new Error('found no tiles in index.html');

  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(card(objects));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(root, 'og.png') });
  } finally {
    await browser.close();
  }
  console.log(`og.png written with ${objects.length} compartments`);
}
