import { dbGet, dbPut } from '../core/idb.js';

const KEY = 'favorites';

/** Favourite titles, kept in the app database (`kv`): [{ providerId, entryKey, type, addedAt }]. */
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

  return {
    async list(providerId) {
      const all = await load();
      return all.filter((item) => item.providerId === providerId).sort((a, b) => b.addedAt - a.addedAt);
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
      await dbPut(db, 'kv', { key: KEY, value: all });
      return index < 0;
    },
    /** A removed provider takes its favourites with it. */
    async removeProvider(providerId) {
      const all = await load();
      cache = all.filter((item) => item.providerId !== providerId);
      await dbPut(db, 'kv', { key: KEY, value: cache });
    },
  };
}
