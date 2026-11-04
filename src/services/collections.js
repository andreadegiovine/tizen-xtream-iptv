import { dbGet, dbPut } from '../core/idb.js';

const KEY = 'collections';

/** Key under which a collection is stored as a favourite: `collection:<id>`. */
export const collectionKey = (id) => `collection:${id}`;
export const isCollectionKey = (key) => String(key || '').startsWith('collection:');

/** Fold accents and case so "Cinéma" and "cinema" match. */
const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Collections: named sets of titles (movies, series, channels and channel groups) of one provider, in the app database (`kv`).
 * A collection: { id, providerId, name, entryKeys: [], createdAt, updatedAt }. The genres of a collection are not stored:
 * they are the genres of its members (see `collectionGenres`).
 */
export function createCollectionsService({ db, now = Date.now }) {
  let cache = null;
  let counter = 0;

  async function load() {
    if (!cache) {
      const record = await dbGet(db, 'kv', KEY);
      cache = (record && record.value) || [];
    }
    return cache;
  }
  const save = () => dbPut(db, 'kv', { key: KEY, value: cache });
  const find = async (id) => (await load()).find((c) => c.id === id) || null;

  return {
    /** Collections of one provider, newest first. */
    async list(providerId) {
      return (await load()).filter((c) => c.providerId === providerId).sort((a, b) => b.createdAt - a.createdAt);
    },
    get: find,
    /** Collections whose name contains `text`, then the others untouched when the text is empty. */
    async search(providerId, text) {
      const needle = fold(text);
      return (await this.list(providerId)).filter((c) => !needle || fold(c.name).includes(needle));
    },
    async create(providerId, name, entryKeys = []) {
      const all = await load();
      const stamp = now();
      counter += 1;
      const record = { id: `${stamp.toString(36)}${counter.toString(36)}`, providerId, name: String(name || '').trim(), entryKeys: Array.from(new Set(entryKeys)), createdAt: stamp, updatedAt: stamp };
      all.push(record);
      await save();
      return record;
    },
    /** Adds a title; resolves false when it was already there. */
    async addEntry(id, entryKey) {
      const record = await find(id);
      if (!record || record.entryKeys.includes(entryKey)) return false;
      record.entryKeys.push(entryKey);
      record.updatedAt = now();
      await save();
      return true;
    },
    /** Applies the edit of a collection: a new name and/or titles to take out. */
    async update(id, { name, remove = [] }) {
      const record = await find(id);
      if (!record) return null;
      const gone = new Set(remove);
      if (name !== undefined && String(name).trim()) record.name = String(name).trim();
      record.entryKeys = record.entryKeys.filter((key) => !gone.has(key));
      record.updatedAt = now();
      await save();
      return record;
    },
    async remove(id) {
      const all = await load();
      const index = all.findIndex((c) => c.id === id);
      if (index >= 0) all.splice(index, 1);
      await save();
      return index >= 0;
    },
    async removeProvider(providerId) {
      cache = (await load()).filter((c) => c.providerId !== providerId);
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

/** A collection as a card entry (`type: 'collection'`): the picture is the first member that has one. `getEntry(db, key)` reads the catalog. */
export async function collectionEntry(db, collection, getEntry, countLabel) {
  let icon = '';
  for (const key of collection.entryKeys.slice(0, 6)) {
    const entry = await getEntry(db, key).catch(() => null);
    if (entry && entry.icon) {
      icon = entry.icon;
      break;
    }
  }
  return { key: collectionKey(collection.id), type: 'collection', name: collection.name, icon, collectionId: collection.id, subtitle: countLabel(collection.entryKeys.length) };
}
