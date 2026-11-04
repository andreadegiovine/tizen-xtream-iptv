import { dbGet, dbPut } from '../core/idb.js';

const KEY = 'pins';

/**
 * Categories and genres pinned in the sidebar of the browse pages (app database, `kv`).
 * A pin: { providerId, kind: 'category' | 'genre', type, id, name, addedAt }.
 */
export function createPinsService({ db, now = Date.now }) {
  let cache = null;

  async function load() {
    if (!cache) {
      const record = await dbGet(db, 'kv', KEY);
      cache = (record && record.value) || [];
    }
    return cache;
  }

  const same = (item, providerId, kind, type, id) => item.providerId === providerId && item.kind === kind && item.type === type && String(item.id) === String(id);

  return {
    /** Pins of one provider and media type, in the order they were added. */
    async list(providerId, type) {
      return (await load()).filter((item) => item.providerId === providerId && item.type === type).sort((a, b) => a.addedAt - b.addedAt);
    },
    async has(providerId, kind, type, id) {
      return (await load()).some((item) => same(item, providerId, kind, type, id));
    },
    /** Pins or unpins; resolves with the new state (true = pinned). */
    async toggle(providerId, { kind, type, id, name }) {
      const all = await load();
      const index = all.findIndex((item) => same(item, providerId, kind, type, id));
      if (index >= 0) all.splice(index, 1);
      else all.push({ providerId, kind, type, id: String(id), name: String(name || ''), addedAt: now() });
      await dbPut(db, 'kv', { key: KEY, value: all });
      return index < 0;
    },
    async removeProvider(providerId) {
      cache = (await load()).filter((item) => item.providerId !== providerId);
      await dbPut(db, 'kv', { key: KEY, value: cache });
    },
  };
}
