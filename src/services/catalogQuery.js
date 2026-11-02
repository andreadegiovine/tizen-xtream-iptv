import { requestToPromise } from '../core/idb.js';

const MAX_ADDED = Number.MAX_SAFE_INTEGER;

/** Categories of one type, alphabetical (locale-aware). */
export async function listCategories(db, type) {
  const tx = db.transaction('categories', 'readonly');
  const all = await requestToPromise(tx.objectStore('categories').getAll(IDBKeyRange.bound(`${type}:`, `${type}:￿`)));
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * One page of grid entries, newest first.
 * - without `categoryId`: walks `entries` by (type, added);
 * - with `categoryId`: walks `entry_cat` by (type, category, added) and joins the entries.
 * Reads `limit + 1` rows to know whether another page exists, without counting anything.
 */
export function pageEntries(db, { type, categoryId = null, offset = 0, limit = 21 }) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'entry_cat'], 'readonly');
    const useCategory = categoryId !== null && categoryId !== undefined;
    const source = useCategory
      ? tx.objectStore('entry_cat').index('byCatAdded')
      : tx.objectStore('entries').index('byTypeAdded');
    const range = useCategory
      ? IDBKeyRange.bound([type, String(categoryId), 0], [type, String(categoryId), MAX_ADDED])
      : IDBKeyRange.bound([type, 0], [type, MAX_ADDED]);
    const rows = [];
    let skipped = offset === 0;
    const request = source.openCursor(range, 'prev');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!skipped) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      rows.push(cursor.value);
      if (rows.length <= limit) cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = async () => {
      try {
        const hasMore = rows.length > limit;
        const wanted = rows.slice(0, limit);
        if (!useCategory) {
          resolve({ entries: wanted, hasMore });
          return;
        }
        const readTx = db.transaction('entries', 'readonly');
        const store = readTx.objectStore('entries');
        const entries = await Promise.all(wanted.map((row) => requestToPromise(store.get(row.entryKey))));
        resolve({ entries: entries.filter(Boolean), hasMore });
      } catch (err) {
        reject(err);
      }
    };
  });
}

/** One grid entry by key (`movie:t603`, `series:i12`...). */
export async function getEntry(db, key) {
  return requestToPromise(db.transaction('entries', 'readonly').objectStore('entries').get(key));
}
