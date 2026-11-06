import { dbGet, dbPut } from '../core/idb.js';
import { filterId } from './shareKeys.js';

const KEY = 'pins';

/**
 * Categories, genres and networks pinned in the sidebar of the browse pages (app database, `kv`), shared by all providers.
 * A pin: { kind: 'category' | 'genre' | 'network', type, id, name, addedAt }. `id` is the same in every provider: the genre key, the network
 * key, or — for a category, whose own id belongs to a provider — the category name folded (see `foldName`). A provider without that
 * genre / category / network does not show the pin; it is not deleted.
 */
export function createPinsService({ db, now = Date.now }) {
  let cache = null;

  async function load() {
    if (!cache) {
      const record = await dbGet(db, 'kv', KEY);
      cache = (record && record.value) || [];
      if (migrate(cache)) await dbPut(db, 'kv', { key: KEY, value: cache });
    }
    return cache;
  }

  /** Pins saved per provider and by category id: now by name, without provider, duplicates merged. */
  function migrate(all) {
    let changed = false;
    const seen = new Set();
    for (let i = 0; i < all.length; i += 1) {
      const pin = all[i];
      if (pin.providerId !== undefined) {
        delete pin.providerId;
        changed = true;
      }
      const id = filterId(pin.kind, pin.id, pin.name);
      if (pin.id !== id) {
        pin.id = id;
        changed = true;
      }
      const sig = `${pin.kind}|${pin.type}|${pin.id}`;
      if (seen.has(sig)) {
        all.splice(i, 1);
        i -= 1;
        changed = true;
      } else seen.add(sig);
    }
    return changed;
  }

  const same = (item, kind, type, id) => item.kind === kind && item.type === type && String(item.id) === String(id);

  return {
    /** Pins of one media type, in the order they were added (the provider is not needed: they are shared). */
    async list(_providerId, type) {
      return (await load()).filter((item) => item.type === type).sort((a, b) => a.addedAt - b.addedAt);
    },
    /** `name` matters for a category (pinned by name). */
    async has(_providerId, kind, type, id, name) {
      const key = filterId(kind, id, name);
      return (await load()).some((item) => same(item, kind, type, key));
    },
    /** Pins or unpins; resolves with the new state (true = pinned). */
    async toggle(_providerId, { kind, type, id, name }) {
      const all = await load();
      const key = filterId(kind, id, name);
      const index = all.findIndex((item) => same(item, kind, type, key));
      if (index >= 0) all.splice(index, 1);
      else all.push({ kind, type, id: key, name: String(name || ''), addedAt: now() });
      await dbPut(db, 'kv', { key: KEY, value: all });
      return index < 0;
    },
    /** Pins belong to no provider: removing one deletes nothing. */
    async removeProvider() {},
  };
}
