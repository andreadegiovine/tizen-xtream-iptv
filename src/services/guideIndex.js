import { dbGet, dbPut, requestToPromise } from '../core/idb.js';

/**
 * The rows of the programme guide as a small list kept in `meta`: `[key, epgChannelId]` of the Live TV groups (one per channel in several
 * qualities) and of the channels in no group, by name; networks and rows without a guide id are left out. Written with the Live TV entries
 * (sync and rebuild), so the guide page reads one record and then only the entries of the rows on screen.
 */
export const GUIDE_INDEX_KEY = 'guide:rows';

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true });

export function buildGuideIndex(entries, groups) {
  return groups
    .filter((g) => !g.isNetwork)
    .concat(entries.filter((e) => !e.groupKey))
    .filter((row) => row.epgChannelId)
    .sort(byName)
    .map((row) => [row.key, row.epgChannelId]);
}

export function writeGuideIndex(db, rows) {
  return dbPut(db, 'meta', { key: GUIDE_INDEX_KEY, rows });
}

/** `[{ key, epgChannelId }]`; a catalog stored before the index existed builds it once (and saves it). */
export async function readGuideIndex(db) {
  const stored = await dbGet(db, 'meta', GUIDE_INDEX_KEY);
  let rows = stored && stored.rows;
  if (!rows) {
    const entries = await requestToPromise(db.transaction('entries', 'readonly').objectStore('entries').index('byTypeAdded').getAll(IDBKeyRange.bound(['live', 0], ['live', Number.MAX_SAFE_INTEGER])));
    const groups = await requestToPromise(db.transaction('groups', 'readonly').objectStore('groups').getAll());
    rows = buildGuideIndex(entries, groups);
    await writeGuideIndex(db, rows).catch(() => undefined);
  }
  return rows.map(([key, epgChannelId]) => ({ key, epgChannelId }));
}
