import { dbGet, dbPut } from '../core/idb.js';
import { filterId, isPortableKey } from './shareKeys.js';

const KEY = 'favorites';

/** Key of a favourite category / genre: `category:movie:<folded name>`, `genre:series:drama`. */
export const filterKey = (kind, type, id) => `${kind}:${type}:${id}`;

/**
 * Favourites, kept in the app database (`kv`) and shared by all providers. Two kinds of record:
 * - a title:   { providerId, entryKey, type, addedAt }
 * - a filter:  { providerId, entryKey: filterKey(), kind: 'category' | 'genre', type, refId, name, addedAt }
 *   (a category or a genre of one media type: it opens the matching grid)
 * `providerId` is '' when the key means the same in every provider (a title with a TMDB id, a group, a genre, a category — saved by name);
 * it is the provider's id for its own titles (no TMDB id), which only that provider shows. A provider that does not carry a favourite
 * simply does not show it; nothing is deleted, so it is back when the provider that has it is active again.
 */
export function createFavoritesService({ db, now = Date.now }) {
  let cache = null;

  async function load() {
    if (!cache) {
      const record = await dbGet(db, 'kv', KEY);
      cache = (record && record.value) || [];
      if (migrate(cache)) await save(cache);
    }
    return cache;
  }

  /** Records saved before sharing: categories by name, shared keys without provider, duplicates merged. Resolves true when something changed. */
  function migrate(all) {
    let changed = false;
    const seen = new Set();
    for (let i = 0; i < all.length; i += 1) {
      const item = all[i];
      if (item.kind === 'category' && item.name) {
        const id = filterId('category', item.refId, item.name);
        if (item.refId !== id) {
          item.refId = id;
          item.entryKey = filterKey('category', item.type, id);
          changed = true;
        }
      }
      if ((item.kind || isPortableKey(item.entryKey)) && item.providerId) {
        item.providerId = '';
        changed = true;
      }
      const id = `${item.providerId || ''}|${item.entryKey}`;
      if (seen.has(id)) {
        all.splice(i, 1);
        i -= 1;
        changed = true;
      } else seen.add(id);
    }
    return changed;
  }

  const scopeOf = (providerId, entryKey) => (isPortableKey(entryKey) ? '' : providerId);
  const mine = (item, providerId) => !item.providerId || item.providerId === providerId;
  const same = (item, providerId, entryKey) => item.entryKey === entryKey && mine(item, providerId);
  const newest = (a, b) => b.addedAt - a.addedAt;
  const save = (all) => dbPut(db, 'kv', { key: KEY, value: all });

  return {
    /** Everything this provider shows (titles and filters), newest first. */
    async list(providerId) {
      const all = await load();
      return all.filter((item) => mine(item, providerId)).sort(newest);
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
      else all.push({ providerId: scopeOf(providerId, entryKey), entryKey, type, addedAt: now() });
      await save(all);
      return index < 0;
    },
    /** `name` matters for a category (saved by name). */
    hasFilter(providerId, kind, type, id, name) {
      return this.has(providerId, filterKey(kind, type, filterId(kind, id, name)));
    },
    /** Same as toggle(), for a category or a genre. */
    async toggleFilter(providerId, { kind, type, id, name }) {
      const all = await load();
      const refId = filterId(kind, id, name);
      const entryKey = filterKey(kind, type, refId);
      const index = all.findIndex((item) => same(item, providerId, entryKey));
      if (index >= 0) all.splice(index, 1);
      else all.push({ providerId: '', entryKey, kind, type, refId, name: String(name || ''), addedAt: now() });
      await save(all);
      return index < 0;
    },
    /**
     * Moves the provider's own titles that now have a shared key (`resolve(key)` → the portable key, or null) to that key, so the other providers
     * show them too. Resolves with how many moved.
     */
    async upgrade(providerId, resolve) {
      const all = await load();
      let moved = 0;
      for (let i = 0; i < all.length; i += 1) {
        const item = all[i];
        if (item.kind || item.providerId !== providerId) continue;
        const next = await resolve(item.entryKey).catch(() => null);
        if (!next || !isPortableKey(next)) continue;
        if (all.some((other) => other !== item && !other.providerId && other.entryKey === next)) {
          all.splice(i, 1);
          i -= 1;
        } else {
          item.entryKey = next;
          item.providerId = '';
        }
        moved += 1;
      }
      if (moved) await save(all);
      return moved;
    },
    /** A removed provider takes only its own titles with it: what is shared stays for the other providers. */
    async removeProvider(providerId) {
      const all = await load();
      cache = all.filter((item) => item.providerId !== providerId);
      await save(cache);
    },
  };
}
