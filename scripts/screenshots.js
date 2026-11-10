#!/usr/bin/env node
/*
 * Screenshots of the app with the fictional demo catalog of the mock server, for the documentation (docs/screenshots, 1280x720) and the
 * stores (platforms/tizen/store/screenshots and platforms/webos/store/screenshots, 1920x1080 JPG under 500 kB).
 *
 *   npm run build && npm run screenshots
 *
 * Starts the mock with --demo (fictional titles, drawn posters, made-up channel brands), adds the demo provider, sets a TMDB key
 * answered by the mock's fake TMDB, waits for the catalog and the guide, then walks the app with the keyboard like a remote.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8097;
const BASE = `http://localhost:${PORT}`;
const DOCS = path.join(ROOT, 'docs/screenshots');
const STORES = [path.join(ROOT, 'platforms/tizen/store/screenshots'), path.join(ROOT, 'platforms/webos/store/screenshots')];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-xtream/server.js'), '--port', String(PORT), '--movies', '400', '--series', '150', '--live', '160', '--latency', '5', '--img-latency', '0', '--demo', '1'], { stdio: 'ignore' });
  await sleep(2500);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-US' });
    const forward = (from, to) => async (route) => {
      try {
        const response = await route.fetch({ url: route.request().url().replace(from, to) });
        await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
      } catch {
        await route.abort().catch(() => undefined);
      }
    };
    await context.route(/https:\/\/api\.themoviedb\.org\/.*/, forward('https://api.themoviedb.org', `${BASE}/tmdb`));
    await context.route(/https:\/\/image\.tmdb\.org\/.*/, forward('https://image.tmdb.org', `${BASE}/tmdbimg`));
    await context.route(/github\.io\/.*/, (route) => route.abort());
    const page = await context.newPage();
    const key = async (name, times = 1, gap = 120) => {
      for (let i = 0; i < times; i += 1) {
        await page.keyboard.press(name);
        await sleep(gap);
      }
    };
    const shots = [];
    const shot = async (name, { store = null } = {}) => {
      await sleep(900);
      fs.mkdirSync(DOCS, { recursive: true });
      const full = await page.screenshot({ type: 'jpeg', quality: 80 });
      const small = await (async () => {
        const p = await context.newPage();
        await p.setViewportSize({ width: 1280, height: 720 });
        await p.setContent(`<img src="data:image/jpeg;base64,${full.toString('base64')}" style="width:1280px;height:720px;display:block;margin:0">`);
        const out = await p.screenshot({ type: 'jpeg', quality: 82 });
        await p.close();
        return out;
      })();
      fs.writeFileSync(path.join(DOCS, `${name}.jpg`), small);
      if (store) {
        STORES.forEach((dir) => {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${store}.jpg`), full);
        });
      }
      shots.push(name);
      console.log(`${name}${store ? ` (store ${store})` : ''}: ${Math.round(full.length / 1024)} kB`);
    };
    const inTopbar = () => page.evaluate(() => Boolean(document.querySelector('.topbar .focused')));
    const topbar = async (label) => {
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      for (let i = 0; i < 40 && !(await inTopbar()); i += 1) await key('ArrowUp', 1, 40);
      for (let i = 0; i < 12; i += 1) await key('ArrowLeft', 1, 40); // to Home, the first item
      for (let i = 0; i < 14; i += 1) {
        const now = await page.evaluate(() => {
          const n = document.querySelector('.topbar .focused');
          return n ? n.getAttribute('aria-label') : '';
        });
        if (now === label) break;
        await key('ArrowRight', 1, 90);
      }
      await key('Enter', 1, 0);
      await sleep(2500);
    };

    // First start: parental PIN, then the kind of provider.
    await page.goto(`${BASE}/`);
    for (let i = 0; i < 2; i += 1) {
      const pin = await page.waitForFunction(() => /PIN/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => null);
      if (!pin) break;
      await page.keyboard.type('1234', { delay: 60 });
      await sleep(700);
    }
    await shot('first-run');
    await key('Enter', 1, 400); // Xtream API
    const inputs = page.locator('input');
    await inputs.nth(0).fill('Demo TV');
    await inputs.nth(1).fill(BASE);
    await inputs.nth(2).fill('test');
    await inputs.nth(3).fill('test');
    await inputs.nth(3).press('Enter');
    await key('ArrowDown', 1, 150);
    await key('Enter', 1, 0);
    await page.waitForFunction(() => !document.querySelector('.setup-step'), null, { timeout: 30000 });
    await sleep(15000); // catalog, then the guide (the last start-up task)

    // The guide is the last start-up task: wait for it before the Live TV screenshot.
    const guideReady = () =>
      page.evaluate(async () => {
        const dbs = await indexedDB.databases();
        const p = dbs.find((d) => d.name.startsWith('provider_'));
        if (!p) return false;
        const db = await new Promise((resolve) => {
          const q = indexedDB.open(p.name);
          q.onsuccess = () => resolve(q.result);
        });
        const meta = await new Promise((resolve) => {
          const q = db.transaction('meta').objectStore('meta').get('epg');
          q.onsuccess = () => resolve(q.result);
        });
        db.close();
        return Boolean(meta);
      });
    const waitStart = Date.now();
    for (let i = 0; i < 60 && !(await guideReady()); i += 1) await sleep(2000);
    console.log(`guide ready after ${Math.round((Date.now() - waitStart) / 1000)} s`);
    await topbar('Live TV');
    await key('ArrowRight', 1, 400);
    await shot('live-tv', { store: '3-live-guide' });

    // TMDB key (the mock answers like TMDB): posters, plots and suggestions.
    await topbar('Settings');
    const field = page.locator('.field', { hasText: 'TMDB' }).locator('input').first();
    await field.fill('0123456789abcdef0123456789abcdef');
    await field.press('Enter');
    await sleep(12000);
    await topbar('Settings');
    await shot('settings');

    await topbar('Home');
    await key('ArrowDown', 1, 300);
    await shot('home', { store: '1-home' });
    await topbar('Movies');
    await key('ArrowRight', 1, 300);
    await shot('movies', { store: '2-movies' });
    await topbar('TV Series');
    await key('ArrowRight', 1, 300);
    await shot('series');
    await key('Enter', 1, 2500);
    await shot('series-detail');
    await topbar('Movies');
    await key('ArrowRight', 1, 300);
    await key('Enter', 1, 2500);
    await shot('movie-detail', { store: '4-detail' });
    await key('Enter', 1, 3000); // play: the mock has no video, the controls are shown
    await key('ArrowDown', 1, 300);
    await shot('player');
    await key('Escape', 1, 1500);
    await key('Escape', 1, 1500);
    // Search: from the icon, a word of the demo titles.
    await topbar('Search');
    await page.keyboard.type('Midnight', { delay: 80 });
    await sleep(2500);
    await key('Enter', 1, 600);
    await shot('search');
    await key('Escape', 1, 800); // closes the search bar: the sections are back
    await topbar('Provider');
    await shot('providers');
    console.log(`${shots.length} screenshots`);
  } finally {
    await browser.close();
    mock.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
