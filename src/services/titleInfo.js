import { dbDeleteMany, dbGetAllKeys, dbPut, dbGet } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { createProviderClient } from './providerTypes.js';
import { rebuildEntries } from './catalogSync.js';
import { ENRICHABLE, enrichType } from './catalogEnrich.js';
import { createGate } from '../core/gate.js';
import { log } from '../core/logger.js';
import { toAppError } from '../core/errors.js';

/** Provider meta row with the outcome of the last run per type (the "Title details" row of Settings › TMDB). */
export const TITLE_INFO_KEY = 'titleInfo';
const WATCH_MS = 4000;

/**
 * The details of the titles listed without a TMDB id (catalogEnrich.js), for the movies and series of a provider: run in their own worker,
 * after the catalog scan. `mode` "forget": what was learned is deleted and the ids it gave are taken back (nothing is asked).
 * Emits { event: 'progress', mediaType, done, total }, { event: 'info', message } and ends with { event: 'done', count, byType }.
 */
export async function runTitleInfoForProvider({ provider, search = null, excluded = {}, cleanTitles = true, grouping, mode = 'run', signal, gate, emit = () => {}, openDb = openProviderDb, makeClient = createProviderClient, now = Date.now }) {
  let db = null;
  const byType = {};
  let count = 0;
  try {
    db = await openDb(provider.id);
    const client = makeClient(provider);
    for (const type of ENRICHABLE) {
      if (signal && signal.aborted) break;
      if (mode === 'forget') await dbDeleteMany(db, 'enrich', await dbGetAllKeys(db, 'enrich', { range: IDBKeyRange.bound(`${type}:`, `${type}:￿`) }));
      const counts = await enrichType({
        db,
        client,
        type,
        search,
        signal,
        gate,
        now,
        ask: mode !== 'forget',
        progress: ({ done, total }) => emit({ event: 'progress', mediaType: type, done, total }),
        log: (message) => emit({ event: 'info', level: 'warn', message }),
        rebuild: () => rebuildEntries({ db, type, excludedCategories: new Set(excluded[type] || []), cleanTitles, grouping }),
      });
      byType[type] = { ...counts, at: now() };
      count += counts.asked + counts.searched;
      if (counts.asked || counts.searched || counts.changed) {
        emit({ event: 'info', message: `Title details ${type}: ${counts.asked} asked (${counts.found} TMDB ids), ${counts.searched} searched on TMDB (${counts.matched} found), ${counts.changed} titles updated` });
      }
    }
    const previous = (await dbGet(db, 'meta', TITLE_INFO_KEY)) || { key: TITLE_INFO_KEY, byType: {} };
    await dbPut(db, 'meta', { key: TITLE_INFO_KEY, byType: { ...previous.byType, ...byType } });
  } catch (err) {
    const error = toAppError(err);
    emit({ event: 'info', level: 'warn', message: `Title details stopped: ${error.code} ${error.message}` });
  } finally {
    if (db) db.close();
  }
  const outcome = { event: 'done', count, byType };
  emit(outcome);
  return outcome;
}

/** What the last runs left for the active provider: { movie: { asked, found, searched, matched, changed, at }, series: … } or {}. */
export async function readTitleInfo(providerId, openDb = openProviderDb) {
  const db = await openDb(providerId);
  try {
    const row = await dbGet(db, 'meta', TITLE_INFO_KEY);
    return (row && row.byType) || {};
  } finally {
    db.close();
  }
}

/**
 * Main-thread side: one run at a time for the active provider, in a worker (or here when there is none), listed among the operations as
 * "Title details" (stoppable) and in the sync log. Paused while `isBusy()` (the catalog scan, playback). `onChanged()` after a run that
 * changed titles (caches and open pages read the catalog again). `progress` holds the counts of the run going on (per type).
 */
export function createTitleInfo({ active, settings, syncLog = null, createWorker = null, getSearch = async () => null, getCleanTitles = async () => true, getGrouping = async () => undefined, isBusy = () => false, onChanged = () => {} }) {
  const gate = createGate();
  let worker = null;
  let running = null;
  let again = null;
  let watcher = null;
  let stopRun = null;
  let controller = null;
  const progress = {};
  const listeners = new Set();
  const onProgress = (value) => listeners.forEach((fn) => fn(value));

  const setPaused = (paused) => {
    if (paused === gate.isPaused()) return;
    if (paused) gate.pause();
    else gate.resume();
    if (worker) worker.postMessage({ op: paused ? 'pause' : 'resume' });
  };
  const handle = (message) => {
    if (message.event === 'info') log[message.level === 'warn' ? 'warn' : 'info'](message.message);
    else if (message.event === 'progress') {
      progress[message.mediaType] = { done: message.done, total: message.total };
      onProgress(progress);
    }
  };

  function inWorker(payload) {
    return new Promise((resolve, reject) => {
      let instance;
      try {
        instance = createWorker();
      } catch (err) {
        reject(err);
        return;
      }
      worker = instance;
      const finish = (value) => {
        instance.terminate();
        if (worker === instance) worker = null;
        resolve(value);
      };
      stopRun = () => finish({ count: 0, byType: {}, cancelled: true });
      const timer = setTimeout(() => {
        instance.terminate();
        worker = null;
        reject(new Error('worker did not report ready'));
      }, 4000);
      instance.onmessage = (event) => {
        const message = event.data || {};
        if (message.event === 'ready') {
          clearTimeout(timer);
          instance.postMessage({ op: 'start', ...payload });
          if (gate.isPaused()) instance.postMessage({ op: 'pause' });
        } else if (message.event === 'done') finish(message);
        else handle(message);
      };
      instance.onerror = (event) => {
        clearTimeout(timer);
        instance.terminate();
        worker = null;
        reject(new Error((event && event.message) || 'worker error'));
      };
    });
  }

  async function execute(mode, signal) {
    const current = await active.get();
    if (!current) return 0;
    const p = current.provider;
    if (p.type === 'm3u') return 0; // a playlist has no details
    const excluded = {};
    for (const type of ['movie', 'series']) excluded[type] = Array.from(await settings.getExcluded(p.id, type));
    const payload = {
      provider: { id: p.id, type: p.type || 'xtream', baseUrl: p.baseUrl, username: p.username, password: p.password, playlistUrl: p.playlistUrl || '', epgUrl: p.epgUrl || '' },
      search: (await getSearch().catch(() => null)) || null,
      excluded,
      cleanTitles: Boolean(await getCleanTitles()),
      grouping: await getGrouping(p.id),
      mode,
    };
    Object.keys(progress).forEach((key) => delete progress[key]);
    clearInterval(watcher);
    setPaused(isBusy());
    watcher = setInterval(() => setPaused(isBusy()), WATCH_MS);
    controller = new AbortController();
    if (signal) signal.addEventListener('abort', () => stop(), { once: true });
    let outcome = null;
    try {
      if (createWorker) {
        try {
          outcome = await inWorker(payload);
        } catch (err) {
          log.warn('Title details worker unavailable, using the main thread:', err && err.message);
        }
      }
      if (!outcome) outcome = await runTitleInfoForProvider({ ...payload, signal: controller.signal, gate: gate.wait, emit: handle });
    } finally {
      clearInterval(watcher);
      stopRun = null;
      controller = null;
      setPaused(false);
      Object.keys(progress).forEach((key) => delete progress[key]);
      onProgress(progress);
    }
    const changed = Object.values(outcome.byType || {}).some((c) => c && c.changed);
    if (changed) onChanged();
    return outcome.count || 0;
  }

  /** Stops the run going on (what was learned so far stays). */
  function stop() {
    again = null;
    if (controller) controller.abort();
    if (stopRun) stopRun();
  }

  /** Runs now (or once more after the run going on): `forget` deletes what was learned first. Resolves with how many titles were asked. */
  function run({ forget = false } = {}) {
    const mode = forget ? 'forget' : 'run';
    if (running) {
      again = mode;
      return running;
    }
    const job = (signal) => execute(mode, signal);
    running = (syncLog ? syncLog.track('info', job, { cancel: stop }) : job())
      .catch((err) => {
        log.warn('Title details failed', err && err.message);
        return 0;
      })
      .finally(() => {
        running = null;
        if (again) {
          const next = again;
          again = null;
          run({ forget: next === 'forget' });
        }
      });
    return running;
  }

  return {
    run,
    stop,
    progress,
    /** `fn(progress)` while a run goes on (and once at its end, empty). Returns the function that stops listening. */
    onProgress(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    isRunning: () => Boolean(running),
    read: () => active.get().then((current) => (current ? readTitleInfo(current.provider.id) : {})),
  };
}
