import { makeSearchKey } from './titleNormalizer.js';
import { requestToPromise } from '../core/idb.js';

/** One light row per entry (name + normalized keys), kept in memory: search never touches IndexedDB. */
export async function loadSearchRows(db, types) {
  const rows = [];
  for (const type of types) {
    const tx = db.transaction('entries', 'readonly');
    const all = await requestToPromise(tx.objectStore('entries').index('byTypeAdded').getAll(IDBKeyRange.bound([type, 0], [type, Number.MAX_SAFE_INTEGER])));
    for (const entry of all) {
      if (entry.groupKey) continue; // a channel in a group is found through the group
      rows.push({ key: entry.key, type, name: entry.name, year: entry.year, icon: entry.icon, rating: entry.rating, tmdbId: entry.tmdbId, defaultId: entry.defaultId, members: entry.members, categoryIds: entry.categoryIds, keys: entry.searchKeys || [makeSearchKey(entry.name)], added: entry.added, groupKey: entry.groupKey || null });
    }
    if (type === 'live') {
      const groups = await requestToPromise(db.transaction('groups', 'readonly').objectStore('groups').getAll());
      groups.forEach((group) => rows.push({ key: group.key, type, name: group.name, year: null, icon: group.icon, rating: null, tmdbId: null, defaultId: group.defaultId, members: group.members, categoryIds: group.categoryIds, keys: group.searchKeys, added: group.added, isGroup: !group.isNetwork, group: !group.isNetwork, isNetwork: Boolean(group.isNetwork), memberKeys: group.memberKeys }));
    }
  }
  return rows;
}

/**
 * Every query word must appear in one of the entry's keys. Ranking: whole-title match, then title
 * starting with the query, then word-start matches, then the rest; newer first inside a rank.
 */
export function searchRows(rows, query, { limit = 40, types = null } = {}) {
  const normalized = makeSearchKey(query);
  if (normalized.length < 2) return [];
  const words = normalized.split(' ');
  const scored = [];
  for (const row of rows) {
    if (types && !types.includes(row.type)) continue;
    let best = -1;
    for (const key of row.keys) {
      if (!words.every((word) => key.includes(word))) continue;
      let rank = 1;
      if (key === normalized) rank = 4;
      else if (key.startsWith(normalized)) rank = 3;
      else if (words.every((word) => key.startsWith(word) || key.includes(` ${word}`))) rank = 2;
      if (rank > best) best = rank;
    }
    if (best > 0) scored.push({ row, rank: best });
  }
  scored.sort((a, b) => b.rank - a.rank || b.row.added - a.row.added);
  return scored.slice(0, limit).map((s) => s.row);
}

/** Caches the rows per provider; `invalidate()` after a catalog sync finishes. */
export function createSearchService({ active, types = ['movie', 'series', 'live'] }) {
  let cache = null;
  return {
    invalidate() {
      cache = null;
    },
    async search(query, options) {
      const current = await active.get();
      if (!current) return [];
      if (!cache || cache.providerId !== current.provider.id) {
        cache = { providerId: current.provider.id, rows: loadSearchRows(current.db, types) };
      }
      return searchRows(await cache.rows, query, options);
    },
  };
}
