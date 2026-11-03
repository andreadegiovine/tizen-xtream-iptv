import { dbGetAllKeys, dbDeleteMany } from '../core/idb.js';
import { listGenres, genreEntryKeys, genreCounts } from './catalogQuery.js';
import { runGenreBackfillForProvider } from './genreBackfill.js';
import { createGate } from '../core/gate.js';
import { log } from '../core/logger.js';

const STORE = 'entry_genre_tmdb';
const WATCH_MS = 4000;

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
  const gate = createGate();

  function setPaused(paused) {
    if (paused === gate.isPaused()) return;
    if (paused) gate.pause();
    else gate.resume();
    if (worker) worker.postMessage({ op: paused ? 'pause' : 'resume' });
  }

  function watch() {
    clearInterval(watcher);
    watcher = setInterval(() => setPaused(isBusy()), WATCH_MS);
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

  /** Starts (or queues) the background search for missing genres of the active provider. */
  function backfill() {
    if (running) {
      again = true;
      return Promise.resolve(0);
    }
    return syncLog ? syncLog.track('genres', run) : run();
  }

  async function run() {
    const current = await active.get();
    if (!current) return 0;
    running = true;
    sent = false;
    let done = 0;
    const p = current.provider;
    const payload = {
      provider: { id: p.id, baseUrl: p.baseUrl, username: p.username, password: p.password },
      tmdbKey: getTmdbKey(),
      language: getLanguage(),
    };
    watch();
    try {
      try {
        done = createWorker ? await runInWorker(payload) : await runGenreBackfillForProvider({ ...payload, gate: gate.wait });
      } catch (err) {
        if (sent) throw err; // the worker was running: do not start it twice
        log.warn('Genre worker unavailable, using the main thread:', err.message);
        done = await runGenreBackfillForProvider({ ...payload, gate: gate.wait });
      }
    } catch (err) {
      log.warn('Genre backfill failed', err && err.message);
    } finally {
      running = false;
      clearInterval(watcher);
    }
    if (again) {
      again = false;
      done += await run();
    }
    return done;
  }

  return {
    backfill,
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
    },
  };
}
