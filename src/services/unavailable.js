import { dbGet, dbPut, dbGetAllKeys, dbDeleteMany } from '../core/idb.js';
import { bumpCatalogRev } from './derivedStore.js';

/**
 * Titles the provider still lists but no longer serves (a series whose details have no episode). They are taken out of the catalog
 * (grids, search, continue watching, home) and the syncs leave them out for UNAVAILABLE_TTL_MS; after that they are listed again and,
 * if they are still empty when opened, taken out again (the provider may have put the episodes back).
 */
export const UNAVAILABLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = 'unavailable';
const ROW_STORES = ['entry_cat', 'entry_genre', 'entry_genre_tmdb']; // keys `${entryKey}|...`

/** Keys of the entries left out now: Set. */
export async function unavailableKeys(db, now = Date.now()) {
  const row = await dbGet(db, 'meta', KEY);
  const map = (row && row.entries) || {};
  return new Set(Object.keys(map).filter((key) => now - map[key] < UNAVAILABLE_TTL_MS));
}

/** Takes one entry out of the catalog and remembers it (the next syncs do not bring it back for a while). */
export async function markUnavailable(db, entryKey, now = Date.now()) {
  const row = (await dbGet(db, 'meta', KEY)) || { key: KEY, entries: {} };
  const entries = {};
  Object.keys(row.entries || {}).forEach((key) => {
    if (now - row.entries[key] < UNAVAILABLE_TTL_MS) entries[key] = row.entries[key]; // old marks are dropped
  });
  entries[entryKey] = now;
  await dbPut(db, 'meta', { key: KEY, entries });
  await dbDeleteMany(db, 'entries', [entryKey]);
  const range = IDBKeyRange.bound(`${entryKey}|`, `${entryKey}|￿`);
  for (const store of ROW_STORES) await dbDeleteMany(db, store, await dbGetAllKeys(db, store, { range }));
  await bumpCatalogRev(db);
}

/** A series whose details came back without a single episode is no longer served. */
export const isEmptySeries = (entry, info) => Boolean(entry && entry.type === 'series' && info && Array.isArray(info.seasons) && info.episodeCount === 0);
