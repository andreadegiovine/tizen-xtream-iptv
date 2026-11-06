import { dbGet, dbPut } from '../core/idb.js';
import { isOwnKey, isPortableKey, qualifyKey, visibleKey } from './shareKeys.js';

const KEY = 'collections';

/** Key under which a collection is stored as a favourite: `collection:<id>`. */
export const collectionKey = (id) => `collection:${id}`;
export const isCollectionKey = (key) => String(key || '').startsWith('collection:');

/** Fold accents and case so "Cinéma" and "cinema" match. */
const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Collections: named sets of titles (movies, series, channels and channel groups), in the app database (`kv`), shared by all providers.
 * A collection: { id, name, entryKeys: [], createdAt, updatedAt }. A title with a TMDB id (and a channel group) is stored under its shared key;
 * a provider's own title (no TMDB id) under `<providerId>@<key>`, so only that provider shows it. A provider that lacks some of the titles
 * just shows fewer: nothing is deleted, they are back when the provider that has them is active again. The genres of a collection are not
 * stored: they are the genres of its members (see `collectionGenres`).
 * Every read takes the active provider and returns the collection with `entryKeys` as that provider sees them (plain keys).
 */
export function createCollectionsService({ db, now = Date.now }) {
  let cache = null;
  let counter = 0;

  async function load() {
    if (!cache) {
      const record = await dbGet(db, 'kv', KEY);
      cache = (record && record.value) || [];
      // Collections saved per provider, with plain keys: the provider's own titles get its prefix, the collection becomes shared.
      let changed = false;
      cache.forEach((c) => {
        if (c.providerId === undefined) return;
        c.entryKeys = Array.from(new Set((c.entryKeys || []).map((key) => qualifyKey(c.providerId, key))));
        delete c.providerId;
        changed = true;
      });
      if (changed) await save();
    }
    return cache;
  }
  const save = () => dbPut(db, 'kv', { key: KEY, value: cache });
  const raw = async (id) => (await load()).find((c) => c.id === id) || null;
  const view = (c, providerId) => (c ? { ...c, entryKeys: c.entryKeys.map((key) => visibleKey(providerId, key)).filter(Boolean) } : null);

  return {
    /** All collections, newest first, with the titles this provider shows. */
    async list(providerId) {
      return (await load()).slice().sort((a, b) => b.createdAt - a.createdAt).map((c) => view(c, providerId));
    },
    async get(id, providerId) {
      return view(await raw(id), providerId);
    },
    /** Collections whose name contains `text`, then the others untouched when the text is empty. */
    async search(providerId, text) {
      const needle = fold(text);
      return (await this.list(providerId)).filter((c) => !needle || fold(c.name).includes(needle));
    },
    async create(providerId, name, entryKeys = []) {
      const all = await load();
      const stamp = now();
      counter += 1;
      const record = { id: `${stamp.toString(36)}${counter.toString(36)}`, name: String(name || '').trim(), entryKeys: Array.from(new Set(entryKeys.map((key) => qualifyKey(providerId, key)))), createdAt: stamp, updatedAt: stamp };
      all.push(record);
      await save();
      return view(record, providerId);
    },
    /** Adds a title; resolves false when it was already there. */
    async addEntry(id, entryKey, providerId) {
      const record = await raw(id);
      const stored = qualifyKey(providerId, entryKey);
      if (!record || record.entryKeys.includes(stored)) return false;
      record.entryKeys.push(stored);
      record.updatedAt = now();
      await save();
      return true;
    },
    /** Applies the edit of a collection: a new name and/or titles to take out (plain keys, as this provider shows them). */
    async update(id, { name, remove = [] }, providerId) {
      const record = await raw(id);
      if (!record) return null;
      const gone = new Set(remove.map((key) => qualifyKey(providerId, key)));
      if (name !== undefined && String(name).trim()) record.name = String(name).trim();
      record.entryKeys = record.entryKeys.filter((key) => !gone.has(key));
      record.updatedAt = now();
      await save();
      return view(record, providerId);
    },
    async remove(id) {
      const all = await load();
      const index = all.findIndex((c) => c.id === id);
      if (index >= 0) all.splice(index, 1);
      await save();
      return index >= 0;
    },
    /**
     * Moves the provider's own titles that now have a shared key (`resolve(key)` → the portable key, or null) to that key, so the other
     * providers show them too. Resolves with how many moved.
     */
    async upgrade(providerId, resolve) {
      const all = await load();
      let moved = 0;
      for (const c of all) {
        for (let i = 0; i < c.entryKeys.length; i += 1) {
          if (!isOwnKey(providerId, c.entryKeys[i])) continue;
          const next = await resolve(visibleKey(providerId, c.entryKeys[i])).catch(() => null);
          if (!next || !isPortableKey(next)) continue;
          if (c.entryKeys.includes(next)) c.entryKeys.splice(i, 1);
          else c.entryKeys[i] = next;
          moved += 1;
        }
      }
      if (moved) await save();
      return moved;
    },
    /** A removed provider takes only its own titles out of the collections; the collections and the shared titles stay. */
    async removeProvider(providerId) {
      const all = await load();
      all.forEach((c) => {
        c.entryKeys = c.entryKeys.filter((key) => !isOwnKey(providerId, key));
      });
      await save();
    },
  };
}

/** Distinct genres of a set of per-entry genre lists, alphabetical: [[{ key, name }]] → [{ key, name }]. */
export function unionGenres(lists) {
  const out = new Map();
  lists.forEach((list) => list.forEach((g) => out.has(g.key) || out.set(g.key, { key: g.key, name: g.name })));
  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Genres a collection inherits from its members (members without genres, like channels, add none). */
export async function collectionGenres(db, entryKeys, genresOf) {
  return unionGenres(await Promise.all(entryKeys.map((key) => genresOf(db, key).catch(() => []))));
}

/** The keys the catalog has: a collection can hold titles this provider does not carry (shared by all providers), which are not counted nor shown. */
export async function presentKeys(db, keys, getEntry) {
  const found = await Promise.all(keys.map((key) => getEntry(db, key).then(Boolean).catch(() => false)));
  return keys.filter((_, i) => found[i]);
}

/** Pictures of the titles of a collection (up to `limit`): posters first, channel logos only when there is nothing else. */
export async function collectionImages(db, collection, getEntry, limit = 12) {
  const entries = (await Promise.all(collection.entryKeys.slice(0, limit * 2).map((key) => getEntry(db, key).catch(() => null)))).filter((e) => e && e.icon);
  const posters = entries.filter((e) => e.type !== 'live');
  return (posters.length ? posters : entries).slice(0, limit).map((e) => e.icon);
}

/** A collection as a card entry (`type: 'collection'`): `icon` is one of its pictures, `icons` all of them (the card rotates them). `getEntry(db, key)` reads the catalog. */
export async function collectionEntry(db, collection, getEntry, countLabel) {
  const icons = await collectionImages(db, collection, getEntry);
  const present = await presentKeys(db, collection.entryKeys, getEntry);
  return { key: collectionKey(collection.id), type: 'collection', name: collection.name, icon: icons[0] || '', icons, collectionId: collection.id, subtitle: countLabel(present.length) };
}
