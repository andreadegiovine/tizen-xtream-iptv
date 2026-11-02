import { AppError, ErrorCode } from './errors.js';

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Opens a database; `upgrade(db, oldVersion, newVersion, tx)` runs inside the versionchange tx. */
export function openDb(name, version, { upgrade } = {}) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      try {
        if (upgrade) upgrade(request.result, event.oldVersion, event.newVersion, request.transaction);
      } catch (err) {
        request.transaction.abort();
        reject(new AppError(ErrorCode.STORAGE, 'Database upgrade failed', { cause: err }));
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(new AppError(ErrorCode.STORAGE, 'Cannot open database', { cause: request.error }));
    request.onblocked = () =>
      reject(new AppError(ErrorCode.STORAGE, 'Database is blocked by another connection'));
  });
}

/** Runs stepwise migrations: migrations[n] upgrades the schema from n-1 to n. */
export function runMigrations(db, tx, oldVersion, newVersion, migrations) {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`Missing migration to version ${version}`);
    migrate(db, tx);
  }
}

export function deleteDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

export function dbGet(db, store, key) {
  return requestToPromise(db.transaction(store).objectStore(store).get(key));
}

export function dbGetAll(db, store) {
  return requestToPromise(db.transaction(store).objectStore(store).getAll());
}

export function dbPut(db, store, value) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return transactionDone(tx);
}

/** Writes in batches so one huge transaction never blocks the UI thread. */
export async function dbPutMany(db, store, values, batchSize = 2000) {
  for (let i = 0; i < values.length; i += batchSize) {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    values.slice(i, i + batchSize).forEach((value) => os.put(value));
    await transactionDone(tx);
  }
}

export function dbDelete(db, store, key) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return transactionDone(tx);
}

export function dbClear(db, store) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return transactionDone(tx);
}
