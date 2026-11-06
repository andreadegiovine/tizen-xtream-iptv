/**
 * What a platform adapter (platforms/<name>/platform.js, chosen at build time through the `@platform` alias) gives the app. The app
 * logic is the same everywhere: only these entries change. Every entry is optional; `withDefaults` fills the missing ones with what
 * works in a plain browser.
 *
 *   id, name                  'tizen', 'Samsung Tizen'
 *   keyCodes                  { keyCode: Action } added to the common keys (remote keys of the platform)
 *   registerKeys()            asks the platform to deliver the media / channel keys
 *   exit()                    closes the app
 *   createEngine()            the video engine (contract of createHtml5Engine in src/services/playerEngines.js)
 *                             (`aspectModes`: the aspect ratios it can show, when not all of ASPECT_MODES)
 *   createTrailerEngine()     an engine that plays `youtube:<id>` inside the app, or null (then openTrailer is used)
 *   openTrailer(videoId)      opens the trailer outside the app (the platform's YouTube app); without either, no trailer button
 *   toggleFullscreen()        Promise: switches the window between full screen and a window, resolves true when it is now full screen; only desktop has
 *                             one (a TV is always full screen): without it the player has no full-screen button
 *   isFullscreen()            Promise of whether the window is full screen now (the button shows the opposite action)
 *   createDiagnosticPlayer()  the player lab of the Diagnostics page ({ play, stop, textTracks, selectText })
 *   runtimeChecks()           extra rows of the Diagnostics checks: [{ id, status: 'ok' | 'warn' | 'fail', detail }]
 *   display(env)              Promise of the panel size { width, height } or null
 *   memory(env)               device RAM { used, total } (bytes) or null
 *   networkType(env)          Promise of the connection type ('WIFI', 'ETHERNET', 'NONE'...) or null
 */
export const PLATFORM_API = Object.freeze([
  'keyCodes',
  'registerKeys',
  'exit',
  'createEngine',
  'createTrailerEngine',
  'openTrailer',
  'toggleFullscreen',
  'isFullscreen',
  'createDiagnosticPlayer',
  'runtimeChecks',
  'display',
  'memory',
  'networkType',
]);

/** Player lab of a platform without one: it only says so. */
export function createNoDiagnosticPlayer(onMissing = () => undefined) {
  return {
    play: (url, { onEvent = () => undefined } = {}) => {
      onEvent('No player lab on this platform');
      onMissing();
    },
    stop: () => undefined,
    textTracks: () => [],
    selectText: () => undefined,
  };
}

/** The adapter with every entry of the contract, the missing ones taken from a plain browser. */
export function withDefaults(adapter, { createDefaultEngine } = {}) {
  const base = {
    id: 'browser',
    name: 'Browser',
    keyCodes: {},
    registerKeys: () => undefined,
    exit: () => {
      try {
        window.close(); // may be ignored by a desktop browser
      } catch {
        /* nothing else to do */
      }
    },
    createEngine: createDefaultEngine || null,
    createTrailerEngine: null,
    openTrailer: null,
    toggleFullscreen: null,
    isFullscreen: async () => false,
    createDiagnosticPlayer: () => createNoDiagnosticPlayer(),
    runtimeChecks: () => [],
    display: async () => null,
    memory: () => null,
    networkType: async () => null,
  };
  const out = { ...base };
  Object.keys(adapter || {}).forEach((key) => {
    if (adapter[key] !== undefined) out[key] = adapter[key];
  });
  return out;
}

/** Entries of the contract an adapter has with the wrong type (empty when it is fine). Used by the contract tests. */
export function contractErrors(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== 'object') return ['not an object'];
  if (typeof adapter.id !== 'string' || !adapter.id) errors.push('id');
  PLATFORM_API.forEach((key) => {
    const value = adapter[key];
    if (value === undefined || value === null) return;
    if (key === 'keyCodes') {
      if (typeof value !== 'object') errors.push(key);
    } else if (typeof value !== 'function') errors.push(key);
  });
  Object.keys(adapter).forEach((key) => {
    if (key !== 'id' && key !== 'name' && !PLATFORM_API.includes(key)) errors.push(`unknown: ${key}`);
  });
  return errors;
}
