import { openDb, runMigrations } from '../core/idb.js';

export const APP_DB_NAME = 'xtream-iptv';
export const APP_DB_VERSION = 2;

// User data lives here and must never be lost: real stepwise migrations only.
const migrations = {
  1: (db) => {
    db.createObjectStore('providers', { keyPath: 'id' });
    db.createObjectStore('kv', { keyPath: 'key' });
    const watch = db.createObjectStore('watch', { keyPath: 'key' });
    watch.createIndex('byUpdatedAt', 'updatedAt');
    db.createObjectStore('tmdb', { keyPath: 'key' });
    db.createObjectStore('tmdb_match', { keyPath: 'key' });
  },
  // TMDB metadata is a cache keyed by tmdb id (not by provider) and now complete (cast, companies, backdrop):
  // older records are dropped, `expiresAt` lets the background job find what is due for a refresh.
  2: (db, tx) => {
    const store = tx.objectStore('tmdb');
    store.clear();
    store.createIndex('byExpires', 'expiresAt');
  },
};

export function openAppDb(name = APP_DB_NAME) {
  return openDb(name, APP_DB_VERSION, {
    upgrade: (db, oldVersion, newVersion, tx) =>
      runMigrations(db, tx, oldVersion, newVersion, migrations),
  });
}
