import { dbGet } from '../core/idb.js';
import { MediaType } from './mediaType.js';

/**
 * The record each catalog sync leaves per media type (counts, timings, when), read by the UI. Apart from catalogSync.js so the start-up
 * bundle does not carry the sync itself (it runs in the catalog worker).
 */
// Progressive order: whatever finishes first becomes usable first.
export const SYNC_ORDER = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];
export const syncMetaKey = (type) => `sync:${type}`;

export function getSyncMeta(db, type) {
  return dbGet(db, 'meta', syncMetaKey(type));
}

export async function getSyncStatus(db) {
  const status = {};
  for (const type of SYNC_ORDER) status[type] = (await getSyncMeta(db, type)) || null;
  return status;
}
