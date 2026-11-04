import { openDb, deleteDb } from '../core/idb.js';

// v2: `items` has no secondary indexes (one type = one primary-key range) and `entries` has no tmdb index:
// a grouped entry's key already is `${type}:t${tmdbId}`, so "is this tmdb id in the catalog?" is a plain get().
// v3/v4: genre stores (provider genres rebuilt at every sync, other sources filled as they arrive); added without a rebuild.
// v5: `groups` (versions of the same live channel, merged at every sync).
export const PROVIDER_DB_VERSION = 5;
export const providerDbName = (providerId) => `provider_${providerId}`;

function createGenreStores(db) {
  // entry_genre: from the sync (`${entryKey}|${genreKey}`). entry_genre_tmdb: TMDB and provider-detail genres (`${entryKey}|${genreKey}|${source}`).
  ['entry_genre', 'entry_genre_tmdb'].forEach((name) => {
    db.createObjectStore(name, { keyPath: 'key' }).createIndex('byGenreAdded', ['type', 'genreKey', 'added']);
  });
}

function createSchema(db) {
  db.createObjectStore('categories', { keyPath: 'key' }); // `${type}:${categoryId}`

  db.createObjectStore('items', { keyPath: 'key' }); // `${type}:${id}`

  const entries = db.createObjectStore('entries', { keyPath: 'key' }); // what grids display
  entries.createIndex('byTypeAdded', ['type', 'added']);

  const entryCat = db.createObjectStore('entry_cat', { keyPath: 'key' }); // `${entryKey}|${categoryId}`
  entryCat.createIndex('byCatAdded', ['type', 'categoryId', 'added']);

  db.createObjectStore('groups', { keyPath: 'key' }); // grouped live channels

  db.createObjectStore('details', { keyPath: 'key' }); // get_vod_info / get_series_info cache

  const epg = db.createObjectStore('epg', { keyPath: ['channelId', 'start'] });
  epg.createIndex('byStop', 'stop');

  db.createObjectStore('meta', { keyPath: 'key' });
  createGenreStores(db);
}

/** Provider databases only hold data derived from the provider: on schema change, rebuild from scratch. */
export function openProviderDb(providerId) {
  return openDb(providerDbName(providerId), PROVIDER_DB_VERSION, {
    upgrade: (db, oldVersion) => {
      if (oldVersion >= 2) {
        // Same catalog layout: keep what was downloaded, (re)create only the genre stores.
        ['entry_genre', 'entry_genre_tmdb'].forEach((name) => db.objectStoreNames.contains(name) && db.deleteObjectStore(name));
        createGenreStores(db);
        if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'key' });
        return;
      }
      Array.from(db.objectStoreNames).forEach((name) => db.deleteObjectStore(name));
      createSchema(db);
    },
  });
}

export function deleteProviderDb(providerId) {
  return deleteDb(providerDbName(providerId));
}
