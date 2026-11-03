import { dbGet, dbGetAllKeys, dbClear, transactionDone } from '../core/idb.js';
import { mergeGenres } from './genres.js';
import { listGenres, genreEntryKeys } from './catalogQuery.js';
import { log } from '../core/logger.js';

const STORE = 'entry_genre_tmdb';
const BATCH = 60;
const MAX_PER_RUN = 2000;

/**
 * Genres of the active provider's catalog. Provider genres are written by the sync; TMDB genres are added here
 * as TMDB metadata arrives (visible cards, detail pages and a background pass after each sync). Both feed the
 * same normalised keys, so "Animazione" from the provider and "Animation" from TMDB are one sidebar entry.
 */
export function createGenreIndex({ active, tmdb, isBusy = () => false, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let running = false;
  let again = false;

  /** Stores the TMDB genres of one entry; skips the write when nothing changed. */
  async function record(db, entry, genreNames) {
    const genres = mergeGenres(genreNames);
    const prefix = `${entry.key}|`;
    const existing = await dbGetAllKeys(db, STORE, { range: IDBKeyRange.bound(prefix, `${prefix}￿`) });
    const wanted = genres.map((g) => `${prefix}${g.key}`);
    if (existing.length === wanted.length && wanted.every((key) => existing.indexOf(key) >= 0)) return false;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    existing.forEach((key) => store.delete(key));
    genres.forEach((g) => store.put({ key: `${prefix}${g.key}`, entryKey: entry.key, type: entry.type, genreKey: g.key, name: g.name, added: entry.added || 0 }));
    await transactionDone(tx);
    return true;
  }

  /** Called with every TMDB metadata answer: `${type}:t${tmdbId}` is the grouped entry's key. */
  async function onMeta(type, tmdbId, meta) {
    if (!meta || !meta.genreList || !meta.genreList.length) return;
    const current = await active.get();
    if (!current) return;
    const entry = await dbGet(current.db, 'entries', `${type}:t${tmdbId}`);
    if (entry) await record(current.db, entry, meta.genreList);
  }

  /** Entries that have a tmdb id but no TMDB genre yet, newest first. */
  async function missing(db, type, limit, tried) {
    const done = new Set((await dbGetAllKeys(db, STORE)).map((key) => key.slice(0, key.lastIndexOf('|'))));
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction('entries', 'readonly');
      const request = tx.objectStore('entries').index('byTypeAdded').openCursor(IDBKeyRange.bound([type, 0], [type, Number.MAX_SAFE_INTEGER]), 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value;
        if (entry.tmdbId && !done.has(entry.key) && !tried.has(entry.key)) out.push(entry);
        if (out.length < limit) cursor.continue();
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(out);
    });
  }

  /** Downloads metadata (which records the genres through `onMeta`) for titles that lack TMDB genres. */
  async function backfill() {
    if (!tmdb.enabled) return 0;
    if (running) {
      again = true;
      return 0;
    }
    running = true;
    let total = 0;
    try {
      const current = await active.get();
      if (!current) return 0;
      for (const type of ['movie', 'series']) {
        const tried = new Set(); // titles TMDB has no genres for stay "missing": try each only once per run
        let list = await missing(current.db, type, BATCH, tried);
        while (list.length && total < MAX_PER_RUN) {
          while (isBusy()) await wait(30000); // never compete with playback
          await Promise.all(list.map((entry) => tmdb.getMeta(type, entry.tmdbId).catch(() => null)));
          total += list.length;
          list.forEach((entry) => tried.add(entry.key));
          list = await missing(current.db, type, BATCH, tried);
        }
      }
    } catch (err) {
      log.warn('Genre backfill failed', err && err.message);
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      return total + (await backfill());
    }
    return total;
  }

  return {
    onMeta,
    backfill,
    /** Genres for the sidebar: [{ key, name }], only those that still have at least one title. */
    async list(type) {
      const current = await active.get();
      return current ? listGenres(current.db, type) : [];
    },
    async entryKeys(type, genreKey) {
      const current = await active.get();
      return current ? genreEntryKeys(current.db, type, genreKey) : [];
    },
    /** Detail pages know the exact entry (also when TMDB was found by title match). */
    async recordFor(entry, genreNames) {
      const current = await active.get();
      if (current && entry && entry.type !== 'live') await record(current.db, entry, genreNames);
    },
    /** "Remove all TMDB data" also forgets the genres it provided. */
    async clearTmdb() {
      const current = await active.get();
      if (current) await dbClear(current.db, STORE);
    },
  };
}
