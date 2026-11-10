#!/usr/bin/env node
/*
 * Focused performance bench (development only): drives a build in headless Chromium against the mock panel with a large catalog and
 * guide, the CPU slowed down like a TV, and prints what each step costs on the UI thread.
 *
 *   node scripts/mock-xtream/bench.js [--dist dist] [--cpu 4] [--port 8099] [--movies 20000] [--live 3000] [--rows 150]
 *                                     [--epg-days 3] [--update-delay 0] [--out report.json]
 *
 * The guide: every channel its own, 3 days (~170k programmes with 3000 channels). Steps: first setup (PIN, Xtream provider) and catalog + guide download; warm start (reload) to the first cards of Home; the search
 * opened and a programme searched; the Movies grid walked down `--rows` rows; 30 s idle. `--update-delay N` answers version.json after N
 * ms (an "_autoupdate" build checks it at start). Measures: long tasks (UI thread blocked > 50 ms), time of every key press until the next
 * frame, DOM size, JS heap, main-thread task time while idle (CDP Performance metrics).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const DIST = path.resolve(opt('dist', path.join(ROOT, 'dist')));
const CPU = Number(opt('cpu', 4));
const PORT = Number(opt('port', 8099));
const ROWS = Number(opt('rows', 150));
const UPDATE_DELAY = Number(opt('update-delay', 0));
const OUT = opt('out', null);
const SHOTS = opt('shots', null); // a screenshot after every step (to check the walk)
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n) => Math.round(n * 10) / 10;

const INSTRUMENT = () => {
  window.__bench = { longTasks: [], keys: [] };
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__bench.longTasks.push({ start: e.startTime, ms: e.duration }))).observe({ entryTypes: ['longtask'] });
  } catch {
    /* no long task API */
  }
  // Every key press: from the keydown to the frame after it (handler, layout and paint).
  window.addEventListener(
    'keydown',
    () => {
      const t0 = performance.now();
      requestAnimationFrame(() => setTimeout(() => window.__bench.keys.push(performance.now() - t0), 0));
    },
    true,
  );
};

function summarize(values) {
  if (!values.length) return { n: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: values.length, avg: round(values.reduce((s, v) => s + v, 0) / values.length), p50: round(pick(0.5)), p95: round(pick(0.95)), max: round(sorted[sorted.length - 1]) };
}

async function main() {
  const mock = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--port', String(PORT), '--movies', opt('movies', '6000'), '--series', opt('series', '2000'), '--live', opt('live', '3000'), '--latency', '5', '--img-latency', '0', '--dist', DIST, '--epg-per-channel', '1', '--epg-days', opt('epg-days', '3')], { stdio: ['ignore', 'pipe', 'inherit'] });
  mock.stdout.on('data', (d) => process.stdout.write(`[mock] ${d}`));
  await sleep(4000);
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const report = { dist: path.relative(ROOT, DIST), cpu: CPU, steps: {} };
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.addInitScript(INSTRUMENT);
    // The last route added is tried first: version.json (answered after --update-delay ms) before the rest of GitHub Pages (refused).
    await context.route(/github\.io\/.*/, (route) => route.abort());
    await context.route(/github\.io\/.*version\.json.*/, async (route) => {
      if (UPDATE_DELAY) await sleep(UPDATE_DELAY);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.0.1', platforms: {} }) }).catch(() => undefined);
    });
    await context.route(/themoviedb\.org/, (route) => route.abort());
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const key = async (name, times = 1, gap = 120) => {
      for (let i = 0; i < times; i += 1) {
        await page.keyboard.press(name);
        await sleep(gap);
      }
    };
    const mark = () => page.evaluate(() => ({ t: performance.now(), keys: window.__bench.keys.length }));
    const since = async (from) =>
      page.evaluate((m) => {
        const lt = window.__bench.longTasks.filter((x) => x.start >= m.t);
        return { longTasks: lt.length, blockedMs: Math.round(lt.reduce((s, x) => s + Math.max(0, x.ms - 50), 0)), longestMs: Math.round(lt.reduce((s, x) => Math.max(s, x.ms), 0)), keys: window.__bench.keys.slice(m.keys) };
      }, from);
    const heap = () => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
    const dom = () => page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, cards: document.querySelectorAll('.card').length, imgs: document.querySelectorAll('img').length }));
    const taskMs = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
      return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, layout: m.LayoutDuration * 1000, style: m.RecalcStyleDuration * 1000 };
    };
    const snap = async (name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 60 });
    };
        const topbar = async (label) => {
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      // Up until the top bar (Up there does nothing): the "focused" class of the current section is not a sure sign.
      await key('ArrowUp', 25, 130);
      for (let i = 0; i < 12; i += 1) await key('ArrowLeft', 1, 130);
      for (let i = 0; i < 14; i += 1) {
        const now = await page.evaluate(() => {
          const n = document.querySelector('.topbar .focused');
          return n ? n.getAttribute('aria-label') : '';
        });
        if (now === label) break;
        await key('ArrowRight', 1, 130);
      }
      await key('Enter', 1, 0);
    };
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
        const count = meta ? await new Promise((resolve) => {
          const q = db.transaction('epg').objectStore('epg').count();
          q.onsuccess = () => resolve(q.result);
        }) : 0;
        db.close();
        return meta ? count : false;
      });

    if (argv.includes('--start-only')) {
      // Only the time to the first screen (an "_autoupdate" build with version.json answering after --update-delay ms).
      await throttle(CPU);
      const s0 = Date.now();
      await page.goto(`${BASE}/`);
      await page.waitForFunction(() => /PIN|provider/i.test(document.body.innerText), null, { timeout: 60000 });
      const metrics = await taskMs();
      report.steps.firstScreen = { ms: Date.now() - s0, updateDelayMs: UPDATE_DELAY, scriptMs: Math.round(metrics.script), taskMs: Math.round(metrics.task) };
      console.log('firstScreen', report.steps.firstScreen);
      return;
    }
    // 1. First start (CPU not slowed: only the setup).
    await page.goto(`${BASE}/`);
    for (let i = 0; i < 2; i += 1) {
      const pin = await page.waitForFunction(() => /PIN/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => null);
      if (!pin) break;
      await page.keyboard.type('1234', { delay: 60 });
      await sleep(700);
    }
    await key('Enter', 1, 400);
    const inputs = page.locator('input');
    await inputs.nth(0).fill('Bench');
    await inputs.nth(1).fill(BASE);
    await inputs.nth(2).fill('test');
    await inputs.nth(3).fill('test');
    await inputs.nth(3).press('Enter');
    await key('ArrowDown', 1, 150);
    await key('Enter', 1, 0);
    await page.waitForFunction(() => !document.querySelector('.setup-step'), null, { timeout: 60000 });
    const t0 = Date.now();
    // The guide is the last start-up task (after the genre work, slow on purpose): it is asked for now from Settings.
    await sleep(15000);
    await topbar('Settings');
    await sleep(3000);
    const focusedLabel = () => page.evaluate(() => {
      const n = document.querySelector('.focused');
      return n ? n.getAttribute('aria-label') || n.textContent.slice(0, 40) : '';
    });
    for (let i = 0; i < 80; i += 1) {
      const label = await focusedLabel();
      if (label === 'Download the TV guide (EPG) again') break;
      if (label === 'Delete the TV guide (EPG)') await key('ArrowRight', 1, 150);
      else await key('ArrowDown', 1, 150);
    }
    console.log('guide button:', await focusedLabel());
    await key('Enter', 1, 500);
    let programmes = false;
    for (let i = 0; i < 300 && !(programmes = await guideReady()); i += 1) await sleep(2000);
    report.steps.setup = { catalogAndGuideS: Math.round((Date.now() - t0) / 1000), programmes };
    console.log('setup', report.steps.setup);
    await sleep(3000);

    await throttle(CPU);
    // 2. Warm start: reload to the first cards of Home.
    const r0 = Date.now();
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.home .card, .page .card').length > 3, null, { timeout: 60000 });
    report.steps.warmStart = { toHomeCardsMs: Date.now() - r0, ...(await since({ t: 0, keys: 0 })), heapMb: await heap() };
    delete report.steps.warmStart.keys;
    console.log('warmStart', report.steps.warmStart);
    await snap('1-warm');
    await sleep(8000); // start-up work (search index, guide check) settles

    // 3. Search: opened from the top bar, then a programme title typed.
    let m = await mark();
    const s0 = Date.now();
    await topbar('Search');
    await sleep(6000);
    const open = await since(m);
    await snap('2-search-open');
    m = await mark();
    const q0 = Date.now();
    const hour = 24 + new Date().getUTCHours() + 3; // a programme 3 hours from now (the mock counts the hours from yesterday 00:00 UTC)
    await page.keyboard.type(`Programma ${hour}`, { delay: 150 });
    const found = await page.waitForFunction(() => /On TV/.test(document.body.innerText), null, { timeout: 30000 }).then(() => true).catch(() => false);
    const typed = await since(m);
    await snap('3-search-typed');
    report.steps.search = {
      openWallMs: Date.now() - s0,
      openLongTasks: open.longTasks,
      openBlockedMs: open.blockedMs,
      openLongestMs: open.longestMs,
      typeToResultsMs: Date.now() - q0,
      resultsFound: found,
      typingKeys: summarize(typed.keys),
      typingLongestMs: typed.longestMs,
      heapMb: await heap(),
    };
    console.log('search', report.steps.search);
    // A fresh start before the grid (the search leaves the focus in its bar).
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.page .card').length > 3, null, { timeout: 60000 });
    await sleep(8000);

    // 4. Movies grid walked down.
    await topbar('Movies');
    await sleep(4000);
    await key('ArrowRight', 1, 600);
    m = await mark();
    const firstKeys = [];
    const lastKeys = [];
    const g0 = await taskMs();
    for (let i = 0; i < ROWS; i += 1) {
      const before = await page.evaluate(() => window.__bench.keys.length);
      await key('ArrowDown', 1, 140);
      if (i % 25 === 24) await sleep(400); // the next batch of titles arrives
      const k = await page.evaluate((b) => window.__bench.keys.slice(b), before);
      if (i < 20) firstKeys.push(...k);
      if (i >= ROWS - 20) lastKeys.push(...k);
    }
    await sleep(1500);
    const g1 = await taskMs();
    await snap('4-grid');
    const walk = await since(m);
    report.steps.grid = {
      rows: ROWS,
      firstRowsKey: summarize(firstKeys),
      lastRowsKey: summarize(lastKeys),
      allKeys: summarize(walk.keys),
      longTasks: walk.longTasks,
      blockedMs: walk.blockedMs,
      scriptMs: Math.round(g1.script - g0.script),
      layoutStyleMs: Math.round(g1.layout - g0.layout + g1.style - g0.style),
      ...(await dom()),
      heapMb: await heap(),
    };
    console.log('grid', report.steps.grid);

    // 5. Idle on Home: main-thread work while nothing happens.
    await topbar('Home');
    await sleep(5000);
    const i0 = await taskMs();
    await sleep(30000);
    const i1 = await taskMs();
    report.steps.idle = { seconds: 30, taskMs: Math.round(i1.task - i0.task), scriptMs: Math.round(i1.script - i0.script) };
    console.log('idle', report.steps.idle);
  } finally {
    await browser.close();
    mock.kill();
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
