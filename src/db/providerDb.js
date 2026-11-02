import { openDb, deleteDb } from '../core/idb.js';

// v2: `items` has no secondary indexes (one type = one primary-key range) and `entries` has no tmdb index:
// a grouped entry's key already is `${type}:t${tmdbId}`, so "is this tmdb id in the catalog?" is a plain get().
export const PROVIDER_DB_VERSION = 2;
export const providerDbName = (providerId) => `provider_${providerId}`;

function createSchema(db) {
  db.createObjectStore('categories', { keyPath: 'key' }); // `${type}:${categoryId}`

  db.createObjectStore('items', { keyPath: 'key' }); // `${type}:${id}`

  const entries = db.createObjectStore('entries', { keyPath: 'key' }); // what grids display
  entries.createIndex('byTypeAdded', ['type', 'added']);

  const entryCat = db.createObjectStore('entry_cat', { keyPath: 'key' }); // `${entryKey}|${categoryId}`
  entryCat.createIndex('byCatAdded', ['type', 'categoryId', 'added']);

  db.createObjectStore('details', { keyPath: 'key' }); // get_vod_info / get_series_info cache

  const epg = db.createObjectStore('epg', { keyPath: ['channelId', 'start'] });
  epg.createIndex('byStop', 'stop');

  db.createObjectStore('meta', { keyPath: 'key' });
}

/** Provider databases only hold data derived from the provider: on schema change, rebuild from scratch. */
export function openProviderDb(providerId) {
  return openDb(providerDbName(providerId), PROVIDER_DB_VERSION, {
    upgrade: (db) => {
      Array.from(db.objectStoreNames).forEach((name) => db.deleteObjectStore(name));
      createSchema(db);
    },
  });
}

export function deleteProviderDb(providerId) {
  return deleteDb(providerDbName(providerId));
}
