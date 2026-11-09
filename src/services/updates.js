/*
 * Updates from the app itself, without the store or the system: the installed package is a shell that holds a working copy of the app;
 * a newer build of the web code (JavaScript, styles, fonts) published on GitHub Pages (`gh-pages` branch, written by the release workflow)
 * is loaded instead of it. The loader in index.html picks the copy at every start (see src/index.html); this module checks for a newer one,
 * as the first thing the app does, and switches to it (the app starts again).
 *
 * version.json: { version, date, platforms: { <platform>: { base: "bundles/<version>/<platform>/", minShell } } }. `minShell` is the oldest
 * installed package that can run the build (a build that needs new native parts asks for a new package instead).
 */
export const UPDATE_URL = 'https://andreadegiovine.github.io/xtream-iptv-client/version.json';
export const BUNDLE_KEY = 'xi.bundle';
export const LAST_CHECK_KEY = 'xi.lastCheck';

/** When version.json last answered (ms), or null. */
export function lastCheck(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    const value = Number(storage && storage.getItem(LAST_CHECK_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** -1, 0, 1 comparing "1.2.10" with "1.2.9" (missing parts are 0; anything else than digits counts as 0). */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.');
  const pb = String(b || '0').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number(pa[i]) || 0;
    const y = Number(pb[i]) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * What version.json offers this app: null (nothing newer), { version, base } (a newer build this package can load, `base` absolute) or
 * { version, needsPackage: true } (newer, but it needs a newer package).
 */
export function pickUpdate(manifest, { platform, running, shell, url = UPDATE_URL }) {
  const entry = manifest && manifest.platforms && manifest.platforms[platform];
  if (!entry || !entry.base || compareVersions(manifest.version, running) <= 0) return null;
  if (compareVersions(shell, entry.minShell || '0.0.0') < 0) return { version: manifest.version, needsPackage: true };
  return { version: manifest.version, base: new URL(entry.base, url).href };
}

/** Reads version.json (never from the cache; gives up after `timeoutMs`, offline or slow networks start the app as it is). */
export async function checkForUpdate({ platform, running, shell, fetchImpl = (...args) => fetch(...args), url = UPDATE_URL, timeoutMs = 5000 }) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const request = fetchImpl(`${url}?t=${Date.now()}`, { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null));
    const manifest = await Promise.race([request, timeout]);
    if (manifest) {
      try {
        window.localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      } catch {
        /* storage not available */
      }
    }
    return manifest ? pickUpdate(manifest, { platform, running, shell, url }) : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gets a build ready: its script and stylesheet are downloaded (they must answer, and stay in the browser cache) and the loader is told to
 * use it from the next start. Throws when the build cannot be reached (the app then starts as it is).
 */
export async function installUpdate(update, { fetchImpl = (...args) => fetch(...args), storage = window.localStorage } = {}) {
  for (const file of ['js/main.js', 'css/main.css']) {
    const res = await fetchImpl(update.base + file);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const body = await res.text();
    if (!body.length) throw new Error(`${file}: empty`);
  }
  storage.setItem(BUNDLE_KEY, JSON.stringify({ version: update.version, base: update.base }));
}

/** Back to the copy in the package (a published build that does not start). */
export function forgetUpdate(storage = window.localStorage) {
  try {
    storage.removeItem(BUNDLE_KEY);
  } catch {
    /* storage not available */
  }
}

/** The versions running now: the package (shell) and the loaded build ('' when it is the package's own copy). */
export function runningVersions() {
  const w = typeof window !== 'undefined' ? window : {};
  return { shell: w.__XI_SHELL__ || '', bundle: w.__XI_BUNDLE__ || '' };
}
