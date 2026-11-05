import { h } from '../dom.js';

export const ROTATE_MS = 8000;
const FADE_CLASS = 'visible';

/** A random address of `urls` other than `current` (the same one only when it is the only one). */
export function pickRandom(urls, current = '', random = Math.random) {
  const pool = urls.length > 1 ? urls.filter((u) => u !== current) : urls;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : '';
}

/**
 * Shows one of `urls` at random inside `host` and swaps it for another every `intervalMs` with a cross-fade
 * (two stacked layers, the new picture is preloaded before it fades in). Each rotator draws on its own: two of them
 * over the same pictures (poster and backdrop) are not paired. `setUrls` can be called again as more pictures turn up.
 */
export function createImageRotator({ host, intervalMs = ROTATE_MS, random = Math.random, preload = (url, done) => {
  const probe = new Image();
  probe.onload = () => done(true);
  probe.onerror = () => done(false);
  probe.src = url;
} }) {
  const layers = [h('div', { class: 'rot-layer' }), h('div', { class: 'rot-layer' })];
  layers.forEach((l) => host.appendChild(l));
  let pool = [];
  let front = -1; // index of the layer that is showing
  let current = '';
  let timer = null;
  let stopped = true;
  let token = 0;

  function show(url) {
    token += 1;
    const mine = token;
    preload(url, (ok) => {
      if (stopped || mine !== token) return;
      if (!ok) {
        pool = pool.filter((u) => u !== url); // a broken address is not tried again
        schedule(0);
        return;
      }
      const next = front === 0 ? 1 : 0;
      layers[next].style.backgroundImage = `url("${url}")`;
      layers[next].classList.add(FADE_CLASS);
      if (front >= 0) layers[front].classList.remove(FADE_CLASS);
      front = next;
      current = url;
      host.classList.add('has-image');
      schedule(intervalMs);
    });
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => {
      const url = pickRandom(pool, current, random);
      if (url) show(url);
    }, delay);
  }

  return {
    layers,
    setUrls(next) {
      pool = Array.from(new Set(next.filter(Boolean)));
      if (!stopped && front < 0 && pool.length) schedule(0);
    },
    start() {
      stopped = false;
      if (pool.length) schedule(front < 0 ? 0 : intervalMs);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    get current() {
      return current;
    },
  };
}

// ---- cards: one shared clock for all the rotating posters ----

const rotating = new Set();
let ticker = null;

const STAGGER_MS = 120; // the cards change one after the other, not all in the same frame (many decodes at once stutter)
const STAGGER_MAX_MS = 1800;

function tick() {
  let order = 0;
  rotating.forEach((item) => {
    if (!item.host.isConnected) {
      rotating.delete(item); // the page is gone: forgotten, no timer per card to clean up
      return;
    }
    setTimeout(() => item.next(), Math.min(STAGGER_MAX_MS, order * STAGGER_MS));
    order += 1;
  });
  if (!rotating.size) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** Number of posters rotating now (for tests). */
export const rotatingCount = () => rotating.size;
/** Runs one round of the shared clock (for tests). */
export const tickRotation = tick;

/**
 * A card's poster that changes to another random one of `urls` every `ROTATE_MS`, with a cross-fade, on a clock shared by every card
 * (cards removed from the page drop out by themselves). The layers go before `before` (the badges stay on top).
 * Returns { setUrls }.
 */
export function rotatePoster({ host, before = null, urls = [], random = Math.random, preload = (url, done) => {
  const probe = new Image();
  probe.onload = () => done(true);
  probe.onerror = () => done(false);
  probe.src = url;
} }) {
  const layers = [h('div', { class: 'rot-layer' }), h('div', { class: 'rot-layer' })];
  layers.forEach((l) => host.insertBefore(l, before));
  let pool = [];
  let front = -1;
  let current = '';
  let busy = false;
  const item = {
    host,
    next() {
      const url = pickRandom(pool, current, random);
      if (!url || busy || url === current) return;
      busy = true;
      preload(url, (ok) => {
        busy = false;
        if (!ok) {
          pool = pool.filter((u) => u !== url);
          return;
        }
        const next = front === 0 ? 1 : 0;
        layers[next].style.backgroundImage = `url("${url}")`;
        layers[next].classList.add(FADE_CLASS);
        if (front >= 0) layers[front].classList.remove(FADE_CLASS);
        front = next;
        current = url;
      });
    },
  };
  const api = {
    setUrls(next) {
      pool = Array.from(new Set(next.filter(Boolean)));
      if (pool.length > 1 && !rotating.has(item)) {
        rotating.add(item);
        if (!ticker) ticker = setInterval(tick, ROTATE_MS);
      } else if (pool.length <= 1) rotating.delete(item);
    },
  };
  api.setUrls(urls);
  return api;
}
