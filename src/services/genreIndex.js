import { dbGetAllKeys, dbDeleteMany, dbGetAll, dbPutMany } from '../core/idb.js';
import { buildEntryGenreRows } from './grouping.js';
import { bumpGenresRev } from './derivedStore.js';
import { listGenres, genreEntryKeys, genreCounts } from './catalogQuery.js';
import { runGenreBackfillForProvider } from './genreBackfill.js';
import { createGate } from '../core/gate.js';
import { log } from '../core/logger.js';

const STORE = 'entry_genre_tmdb';
const WATCH_MS = 4000;
const UI_RELEASE_MS = 800;

/**
 * Genres of the active provider's catalog. Provider genres come with the catalog sync. The rest is found in the
 * background by a worker (TMDB or the provider's detail call) and never depends on which titles are opened.
 * Every spelling is normalised (not translated) so the same genre is one sidebar entry.
 */
export function createGenreIndex({ active, syncLog = null, getTmdbKey = () => '', getLanguage = () => 'en', createWorker = null, isBusy = () => false }) {
  let worker = null;
  let running = false;
  let again = false;
  let watcher = null;
  let sent = false;
  let stopRun = null;
  let controller = null;
  let cancelled = false;
  let releaseTimer = null;
  const holds = { busy: false, ui: false };
  const gate = createGate();

  function setPaused(paused) {
    if (paused === gate.isPaused()) return;
    if (paused) gate.pause();
    else gate.resume();
    if (worker) worker.postMessage({ op: paused ? 'pause' : 'resume' });
  }

  const refreshPause = () => setPaused(holds.busy || holds.ui);

  function watch() {
    clearInterval(watcher);
    holds.busy = isBusy();
    refreshPause();
    watcher = setInterval(() => {
      holds.busy = isBusy();
      refreshPause();
    }, WATCH_MS);
  }

  /**
   * Makes the background download wait while something else needs the network: `reason` "ui" is the user
   * browsing (visible cards, an open page: asked from TMDB at once), released a moment after the last request.
   */
  function hold(reason, on) {
    if (reason !== 'ui') return;
    clearTimeout(releaseTimer);
    if (on) {
      holds.ui = true;
      refreshPause();
    } else {
      releaseTimer = setTimeout(() => {
        holds.ui = false;
        refreshPause();
      }, UI_RELEASE_MS);
    }
  }

  function runInWorker(payload) {
    return new Promise((resolve, reject) => {
      let instance;
      try {
        instance = createWorker();
      } catch (err) {
        reject(err);
        return;
      }
      worker = instance;
      stopRun = () => {
        instance.terminate();
        worker = null;
        resolve(0);
      };
      const timer = setTimeout(() => {
        instance.terminate();
        worker = null;
        reject(new Error('worker did not report ready'));
      }, 4000);
      instance.onmessage = (event) => {
        const message = event.data || {};
        if (message.event === 'ready') {
          clearTimeout(timer);
          sent = true;
          instance.postMessage({ op: 'start', ...payload });
          if (gate.isPaused()) instance.postMessage({ op: 'pause' });
        } else if (message.event === 'info') {
          log[message.level === 'warn' ? 'warn' : 'info'](message.message);
        } else if (message.event === 'done') {
          instance.terminate();
          worker = null;
          resolve(message.done || 0);
        }
      };
      instance.onerror = (event) => {
        clearTimeout(timer);
        instance.terminate();
        worker = null;
        reject(new Error((event && event.message) || 'worker error'));
      };
    });
  }

  /** Stops the search now (the titles found so far stay). */
  function stop() {
    again = false;
    cancelled = true;
    if (controller) controller.abort();
    if (stopRun) stopRun();
  }

  /**
   * Starts (or queues) the background work for the active provider: first the TMDB download of every title
   * (`force` downloads again what is still fresh), then the provider's genres for what is still without.
   */
  function backfill({ force = false } = {}) {
    if (running) {
      again = true;
      return Promise.resolve(0);
    }
    return runPhases(force);
  }

  /** One phase on its own (the "update metadata" operations). */
  const download = (force = false) => phase('tmdb', force);
  const findGenres = () => phase('genres', false);

  function phase(name, force) {
    if (running) return Promise.resolve(0);
    cancelled = false;
    return track(name, force);
  }

  const track = (name, force) => (syncLog ? syncLog.track(name, () => run(name, force), { cancel: stop }) : run(name, force));

  async function runPhases(force) {
    cancelled = false;
    running = true;
    let done = 0;
    try {
      if (getTmdbKey()) done += await track('tmdb', force);
      if (!cancelled) done += await track('genres', false);
    } finally {
      running = false;
    }
    if (again && !cancelled) {
      again = false;
      done += await runPhases(false);
    }
    return done;
  }

  async function run(name, force) {
    const current = await active.get();
    if (!current) return 0;
    const wasRunning = running;
    running = true;
    sent = false;
    let done = 0;
    const p = current.provider;
    const payload = {
      provider: { id: p.id, baseUrl: p.baseUrl, username: p.username, password: p.password },
      tmdbKey: getTmdbKey(),
      language: getLanguage(),
      phase: name,
      force,
    };
    watch();
    controller = new AbortController();
    try {
      try {
        done = createWorker ? await runInWorker(payload) : await runGenreBackfillForProvider({ ...payload, gate: gate.wait, signal: controller.signal, emit: (m) => m.event === 'info' && log[m.level === 'warn' ? 'warn' : 'info'](m.message) });
      } catch (err) {
        if (sent) throw err; // the worker was running: do not start it twice
        log.warn('Genre worker unavailable, using the main thread:', err.message);
        done = await runGenreBackfillForProvider({ ...payload, gate: gate.wait, signal: controller.signal, emit: (m) => m.event === 'info' && log[m.level === 'warn' ? 'warn' : 'info'](m.message) });
      }
    } catch (err) {
      log.warn('Background metadata job failed', err && err.message);
    } finally {
      if (done > 0) await bumpGenresRev(current.db).catch(() => undefined); // genre lists and counts derived from it are worked out again
      running = wasRunning;
      stopRun = null;
      controller = null;
      clearInterval(watcher);
    }
    return done;
  }

  return {
    backfill,
    download,
    findGenres,
    hold,
    stop,
    /** Genres for the sidebar: [{ key, name }], only those that still have at least one title. */
    async list(type) {
      const current = await active.get();
      return current ? listGenres(current.db, type) : [];
    },
    async counts(type) {
      const current = await active.get();
      return current ? genreCounts(current.db, type) : new Map();
    },
    async entryKeys(type, genreKey) {
      const current = await active.get();
      return current ? genreEntryKeys(current.db, type, genreKey) : [];
    },
    /** A new TMDB key makes the "nothing found" markers stale: forget them so the next run asks TMDB again. */
    async forgetMisses() {
      const current = await active.get();
      if (!current) return;
      const keys = await dbGetAllKeys(current.db, STORE);
      await dbDeleteMany(current.db, STORE, keys.filter((key) => key.endsWith('|none')));
    },
    /** "Remove all TMDB data" also forgets the genres it provided (provider ones stay). */
    async clearTmdb() {
      const current = await active.get();
      if (!current) return;
      const keys = await dbGetAllKeys(current.db, STORE);
      await dbDeleteMany(current.db, STORE, keys.filter((key) => key.endsWith('|tmdb')));
      // TMDB's genres had replaced the provider's list for those titles: the list comes back from the entries.
      const entries = await dbGetAll(current.db, 'entries');
      await dbPutMany(current.db, 'entry_genre', buildEntryGenreRows(entries.filter((entry) => entry.genres && entry.genres.length)));
    },
  };
}
