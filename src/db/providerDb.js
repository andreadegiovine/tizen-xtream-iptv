import { openDb, deleteDb } from '../core/idb.js';

export const PROVIDER_DB_VERSION = 1;
export const providerDbName = (providerId) => `provider_${providerId}`;

function createSchema(db) {
  db.createObjectStore('categories', { keyPath: 'key' }); // `${type}:${categoryId}`

  const items = db.createObjectStore('items', { keyPath: 'key' }); // `${type}:${id}`
  items.createIndex('byType', 'type');
  items.createIndex('byTypeTmdb', ['type', 'tmdbId']);

  const entries = db.createObjectStore('entries', { keyPath: 'key' }); // what grids display
  entries.createIndex('byTypeAdded', ['type', 'added']);
  entries.createIndex('byTypeTmdb', ['type', 'tmdbId']);

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
