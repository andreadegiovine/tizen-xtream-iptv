#!/usr/bin/env node
/**
 * Drives the production build in headless Chromium against the mock panel (start scripts/mock-xtream/server.js first) and prints
 * timings: first setup and catalog sync, home, Movies / Series / Live pages, grid scrolling, search, detail, settings; long tasks
 * (main thread blocked > 50 ms), JS heap and requests made. Only the keyboard is used, as on the TV.
 *
 *   node scripts/mock-xtream/perf.js [--url http://localhost:8090] [--tmdb] [--cpu 4] [--out perf-report.json] [--shots dir]
 *
 * --cpu N slows the CPU N times (DevTools throttling) to get closer to a TV; --tmdb sets a TMDB key so the TMDB flows run (the fake one
 * of the mock server answers them).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const URL_BASE = opt('url', 'http://localhost:8090');
const CPU = Number(opt('cpu', 1));
const OUT = opt('out', null);
const SHOTS = opt('shots', null);
const TMDB = Boolean(opt('tmdb', false));
const PROFILE = Boolean(opt('profile', false)); // CPU profile of every step: the functions that took the most main-thread time

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { config: { url: URL_BASE, cpu: CPU, tmdb: TMDB }, steps: [] };

async function main() {
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] }); // real heap figures, not rounded ones
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // TMDB goes to the fake one of the mock server.
  const forward = (from, to) => async (route) => {
    try {
      const response = await route.fetch({ url: route.request().url().replace(from, to) });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    } catch {
      await route.abort().catch(() => undefined);
    }
  };
  await context.route(/https:\/\/api\.themoviedb\.org\/.*/, forward('https://api.themoviedb.org', `${URL_BASE}/tmdb`));
  await context.route(/https:\/\/image\.tmdb\.org\/.*/, forward('https://image.tmdb.org', `${URL_BASE}/tmdbimg`));
  await context.addInitScript(() => {
    window.__perf = { longTasks: [] };
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__perf.longTasks.push({ start: e.startTime, ms: e.duration }))).observe({ entryTypes: ['longtask'] });
    } catch {
      /* no longtask support */
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err && err.message)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  }
  /** Self time per function of a CPU profile, top N (anonymous functions keep their file:line). */
  function topFunctions(profile, n = 10) {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map();
    const dt = profile.timeDeltas || [];
    (profile.samples || []).forEach((id, i) => {
      const node = byId.get(id);
      const f = node.callFrame;
      if (['(idle)', '(program)', '(garbage collector)', '(root)'].includes(f.functionName) && f.url === '') {
        if (f.functionName !== '(garbage collector)') return;
      }
      const name = `${f.functionName || '(anon)'} ${f.url ? f.url.replace(/^.*\//, '') : ''}:${f.lineNumber + 1}`;
      self.set(name, (self.get(name) || 0) + (dt[i] || 0) / 1000);
    });
    return Array.from(self.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, ms]) => `${Math.round(ms)} ms ${name}`);
  }
  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };
  const key = async (name, times = 1, gap = 120) => {
    for (let i = 0; i < times; i += 1) {
      await page.keyboard.press(name);
      await sleep(gap);
    }
  };
  const now = () => page.evaluate(() => performance.now());
  const longTasksSince = (t) => page.evaluate((from) => {
    const list = window.__perf.longTasks.filter((x) => x.start >= from);
    return { count: list.length, totalMs: Math.round(list.reduce((s, x) => s + x.ms, 0)), maxMs: Math.round(list.reduce((m, x) => Math.max(m, x.ms), 0)) };
  }, t);
  const heapMb = () => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  /** Visible cards and how many of their posters are loaded (in the viewport only). */
  const visibleCards = () => page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let cards = 0;
    let loaded = 0;
    document.querySelectorAll('.card').forEach((card) => {
      const r = card.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
      cards += 1;
      const img = card.querySelector('img');
      if (!img) {
        cards -= 1; // no poster to wait for (no picture, or a locked title)
        return;
      }
      if (img.complete && img.naturalWidth > 0 && img.getAttribute('src')) loaded += 1;
    });
    return { cards, loaded };
  });
  /** Waits until cards are on screen, then until their posters are in (or the time runs out). */
  async function waitCards(timeout = 30000) {
    const start = Date.now();
    let firstCards = null;
    let state = { cards: 0, loaded: 0 };
    while (Date.now() - start < timeout) {
      state = await visibleCards();
      if (state.cards > 0 && firstCards === null) firstCards = Date.now() - start;
      if (state.cards > 0 && state.loaded >= state.cards * 0.9) return { cardsMs: firstCards, postersMs: Date.now() - start, ...state };
      await sleep(50);
    }
    return { cardsMs: firstCards, postersMs: null, ...state, timeout: true };
  }
  const providerMeta = () => page.evaluate(async () => {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    const prov = dbs.find((d) => d.name && d.name.startsWith('provider_'));
    if (!prov) return null;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(prov.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // keys first, then only the small sync records (the derived ones hold the whole search index: reading them would be measured)
    const keys = await new Promise((resolve) => {
      const req = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys();
      req.onsuccess = () => resolve(req.result);
    });
    const all = [];
    for (const k of keys) {
      if (!/^sync:/.test(k)) {
        all.push({ key: k });
        continue;
      }
      all.push(await new Promise((resolve) => {
        const req = db.transaction('meta', 'readonly').objectStore('meta').get(k);
        req.onsuccess = () => resolve(req.result);
      }));
    }
    const counts = {};
    for (const store of ['items', 'entries', 'groups', 'entry_genre', 'entry_genre_tmdb', 'epg']) {
      counts[store] = await new Promise((resolve) => {
        const req = db.transaction(store, 'readonly').objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
      });
    }
    db.close();
    return { meta: all.filter((m) => /^sync:/.test(m.key)).map((m) => ({ key: m.key, durationMs: m.durationMs, fetchMs: m.fetchMs, writeMs: m.writeMs, items: m.itemCount, entries: m.entryCount, changes: m.changes, lastSync: m.lastSync })), keys: all.map((m) => m.key).filter((k) => !/:\d+$/.test(k)), counts };
  });
  const stats = async (reset = false) => {
    const res = await fetch(`${URL_BASE}/__stats`, { method: reset ? 'POST' : 'GET' });
    return res.json();
  };
  async function step(name, run) {
    const t = await now();
    const wall = Date.now();
    await stats(true);
    let result = {};
    if (PROFILE) await cdp.send('Profiler.start');
    try {
      result = (await run()) || {};
    } catch (err) {
      result = { error: String(err && err.message) };
    }
    if (PROFILE) result.profile = topFunctions((await cdp.send('Profiler.stop')).profile);
    const entry = { name, wallMs: Date.now() - wall, ...result, longTasks: await longTasksSince(t), heapMb: await heapMb(), requests: (await stats()).requests };
    report.steps.push(entry);
    console.log(JSON.stringify(entry));
    await shot(name.replace(/\W+/g, '_'));
    return entry;
  }

  // 1. First start: provider form, verification, home.
  await step('first load (setup page)', async () => {
    await page.goto(`${URL_BASE}/`);
    await page.waitForSelector('input', { timeout: 20000 });
    // First start: the app asks for a parental PIN (1234, twice) before the provider form can be used.
    for (let i = 0; i < 2; i += 1) {
      const pin = await page.waitForFunction(() => /PIN/.test(document.body.innerText), null, { timeout: 4000 }).catch(() => null);
      if (!pin) break;
      await page.keyboard.type('1234', { delay: 80 });
      await sleep(700);
    }
    return {};
  });
  await step('provider verified → home', async () => {
    const inputs = page.locator('input');
    await inputs.nth(0).fill('Mock');
    await inputs.nth(1).fill(URL_BASE);
    await inputs.nth(2).fill('test');
    await inputs.nth(3).fill('test');
    await inputs.nth(3).press('Enter'); // leaves the field
    await key('ArrowDown', 1, 150);
    await key('Enter', 1, 0);
    const t = Date.now();
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), null, { timeout: 30000 });
    return { toHomeMs: Date.now() - t };
  });
  await step('catalog sync (first, full)', async () => {
    const t = Date.now();
    let meta = null;
    while (Date.now() - t < 600000) {
      meta = await providerMeta();
      if (meta && ['sync:movie', 'sync:series', 'sync:live'].every((k) => meta.meta.some((m) => m.key === k && m.lastSync > 0))) break;
      await sleep(500);
    }
    return { syncWallMs: Date.now() - t, ...meta };
  });
  await step('home after sync', async () => waitCards());
  // Topbar: home(0) search(1) movies(2) series(3) live(4) favorites collections suggestions ... settings(last)
  const topbarIndex = () => page.evaluate(() => {
    if (document.querySelector('.page .focused, .dialog .focused')) return -1; // the focus is on the page, not on the bar
    const items = Array.from(document.querySelectorAll('.topbar .topbar-item'));
    return items.findIndex((n) => n.classList.contains('focused'));
  });
  /** Opens a section of the top bar, checking after every key where the focus is (with a slow CPU keys can be handled late). */
  async function openTopbar(index) {
    for (let i = 0; i < 45 && (await topbarIndex()) < 0; i += 1) await key('ArrowUp', 1, 90);
    for (let i = 0; i < 30; i += 1) {
      const at = await topbarIndex();
      if (at === index) break;
      await key(at < 0 || at > index ? 'ArrowLeft' : 'ArrowRight', 1, 120);
    }
    if ((await topbarIndex()) !== index) throw new Error(`top bar: could not reach item ${index}`);
    await key('Enter', 1, 0);
  }
  if (TMDB) {
    await step('TMDB key set in Settings', async () => {
      await openTopbar(9);
      await page.waitForFunction(() => document.querySelectorAll('.sync-row').length > 3, null, { timeout: 10000 });
      const field = page.locator('.field', { hasText: 'TMDB' }).locator('input').first();
      await field.fill('0123456789abcdef0123456789abcdef');
      await field.press('Enter');
      await sleep(1000);
      return {};
    });
  }
  for (const [index, label] of [[2, 'Movies page (cold)'], [3, 'Series page (cold)'], [4, 'Live page (cold)'], [2, 'Movies page (again)']]) {
    await step(label, async () => {
      await openTopbar(index);
      const r = await waitCards();
      await sleep(1500); // what keeps running behind (sidebar counts, enrich)
      return { ...r, sidebarItems: await page.evaluate(() => document.querySelectorAll('.page .cats .row, .page [class*=sidebar] .row, .page .cat').length) };
    });
  }
  await step('Movies grid: 30 × DOWN', async () => {
    await key('ArrowRight', 1, 100);
    const t = await now();
    for (let i = 0; i < 30; i += 1) await key('ArrowDown', 1, 90);
    const after = await waitCards(15000);
    const lt = await longTasksSince(t);
    return { ...after, scrollLongTasks: lt };
  });
  await step('reload (warm start, catalog unchanged)', async () => {
    const t = Date.now();
    await page.reload();
    const r = await waitCards();
    await sleep(4000);
    return { ...r, reloadMs: Date.now() - t };
  });
  await step('search "ombra"', async () => {
    await openTopbar(1);
    const focused = () => page.evaluate(() => Boolean(document.activeElement && document.activeElement.tagName === 'INPUT'));
    for (let i = 0; i < 3 && !(await focused()); i += 1) await key('Enter', 1, 400);
    const t = Date.now();
    await page.keyboard.type('ombra', { delay: 120 });
    const typed = Date.now();
    await shot('search_typed');
    // results: the placeholders shown while searching are replaced by result cards
    await page.waitForFunction(() => {
      const sk = document.querySelector('.search-skeleton');
      return (!sk || sk.style.display === 'none') && document.querySelectorAll('.page .carousel .card, .page .search-results .card').length > 0;
    }, null, { timeout: 20000 });
    const results = Date.now() - typed;
    const r = await waitCards(10000);
    const shown = await page.evaluate(() => document.querySelectorAll('.page .card').length);
    await page.keyboard.press('Enter'); // leaves the field
    await sleep(200);
    return { resultsAfterLastKeyMs: results, typingMs: typed - t, resultCards: shown, ...r };
  });
  await step('detail of a title', async () => {
    await openTopbar(2);
    await waitCards();
    await key('ArrowDown', 1, 150);
    await key('ArrowRight', 2, 150);
    await key('Enter', 1, 0);
    const t = Date.now();
    await page.waitForFunction(() => /Cast|Trama|Plot/.test(document.body.innerText) && document.querySelector('.detail-poster img, .detail img'), null, { timeout: 15000 }).catch(() => null);
    const shown = Date.now() - t;
    await sleep(1500);
    return { detailMs: shown };
  });
  await step('Settings page', async () => {
    await key('Escape');
    await sleep(800);
    await openTopbar(9);
    await page.waitForFunction(() => document.querySelectorAll('.sync-row').length > 3, null, { timeout: 10000 }).catch(() => null);
    await sleep(1500);
    return { rows: await page.evaluate(() => Array.from(document.querySelectorAll('.sync-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()).slice(0, 20)) };
  });
  await step('Movies page after warm start', async () => {
    await openTopbar(2);
    return waitCards();
  });
  await step('idle 20 s (background work)', async () => {
    await sleep(20000);
    return { db: await providerMeta() };
  });
  await step('sync again, unchanged catalog (start-up after 12 h)', async () => {
    // The lists are marked as expired, as after 12 hours, and the app is started again: the sync runs on the same catalog.
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const prov = dbs.find((d) => d.name && d.name.startsWith('provider_'));
      const db = await new Promise((resolve) => {
        const req = indexedDB.open(prov.name);
        req.onsuccess = () => resolve(req.result);
      });
      for (const key of ['sync:movie', 'sync:series', 'sync:live']) {
        const store = db.transaction('meta', 'readwrite').objectStore('meta');
        await new Promise((resolve) => {
          const get = store.get(key);
          get.onsuccess = () => {
            const put = store.put({ ...get.result, lastSync: 1 });
            put.onsuccess = resolve;
          };
        });
      }
      db.close();
    });
    await page.reload();
    const t = Date.now();
    let meta = null;
    while (Date.now() - t < 600000) {
      meta = await providerMeta();
      if (meta && ['sync:movie', 'sync:series', 'sync:live'].every((k) => meta.meta.some((m) => m.key === k && m.lastSync > 1))) break;
      await sleep(500);
    }
    return { syncWallMs: Date.now() - t, ...meta };
  });
  report.errors = errors.slice(0, 50);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`errors: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
