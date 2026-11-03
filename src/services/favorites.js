import { dbGet, dbPut } from '../core/idb.js';

const KEY = 'favorites';

/** Key of a favourite category / genre: `category:movie:12`, `genre:series:drama`. */
export const filterKey = (kind, type, id) => `${kind}:${type}:${id}`;

/**
 * Favourites, kept in the app database (`kv`). Two kinds of record:
 * - a title:   { providerId, entryKey, type, addedAt }
 * - a filter:  { providerId, entryKey: filterKey(), kind: 'category' | 'genre', type, refId, name, addedAt }
 *   (a category or a genre of one media type: it opens the matching grid)
 */
export function createFavoritesService({ db, now = Date.now }) {
  let cache = null;

  async function load() {
    if (!cache) {
      const record = await dbGet(db, 'kv', KEY);
      cache = (record && record.value) || [];
    }
    return cache;
  }

  const same = (item, providerId, entryKey) => item.providerId === providerId && item.entryKey === entryKey;
  const newest = (a, b) => b.addedAt - a.addedAt;
  const save = (all) => dbPut(db, 'kv', { key: KEY, value: all });

  return {
    /** Everything (titles and filters), newest first. */
    async list(providerId) {
      const all = await load();
      return all.filter((item) => item.providerId === providerId).sort(newest);
    },
    /** Only the titles. */
    async listTitles(providerId) {
      return (await this.list(providerId)).filter((item) => !item.kind);
    },
    /** Only the favourite categories and genres. */
    async listFilters(providerId) {
      return (await this.list(providerId)).filter((item) => item.kind);
    },
    async has(providerId, entryKey) {
      return (await load()).some((item) => same(item, providerId, entryKey));
    },
    /** Adds or removes; resolves with the new state (true = favourite). */
    async toggle(providerId, entryKey, type) {
      const all = await load();
      const index = all.findIndex((item) => same(item, providerId, entryKey));
      if (index >= 0) all.splice(index, 1);
      else all.push({ providerId, entryKey, type, addedAt: now() });
      await save(all);
      return index < 0;
    },
    hasFilter(providerId, kind, type, id) {
      return this.has(providerId, filterKey(kind, type, id));
    },
    /** Same as toggle(), for a category or a genre. */
    async toggleFilter(providerId, { kind, type, id, name }) {
      const all = await load();
      const entryKey = filterKey(kind, type, id);
      const index = all.findIndex((item) => same(item, providerId, entryKey));
      if (index >= 0) all.splice(index, 1);
      else all.push({ providerId, entryKey, kind, type, refId: String(id), name: String(name || ''), addedAt: now() });
      await save(all);
      return index < 0;
    },
    /** A removed provider takes its favourites with it. */
    async removeProvider(providerId) {
      const all = await load();
      cache = all.filter((item) => item.providerId !== providerId);
      await save(cache);
    },
  };
}
