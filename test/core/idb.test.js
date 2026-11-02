import { openDb, runMigrations, dbPutMany, dbGetAll, dbGet, deleteDb } from '../../src/core/idb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb, deleteProviderDb } from '../../src/db/providerDb.js';
import { kvGet, kvSet } from '../../src/db/kv.js';

describe('idb helpers', () => {
  test('stepwise migrations run in order', async () => {
    const calls = [];
    const migrations = {
      1: (db) => {
        calls.push(1);
        db.createObjectStore('a', { keyPath: 'id' });
      },
      2: (db) => {
        calls.push(2);
        db.createObjectStore('b', { keyPath: 'id' });
      },
    };
    const db = await openDb('mig-test', 2, {
      upgrade: (d, o, n, tx) => runMigrations(d, tx, o, n, migrations),
    });
    expect(calls).toEqual([1, 2]);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['a', 'b']);
    db.close();
    await deleteDb('mig-test');
  });

  test('dbPutMany writes in batches', async () => {
    const db = await openDb('batch-test', 1, { upgrade: (d) => d.createObjectStore('s', { keyPath: 'id' }) });
    const rows = Array.from({ length: 25 }, (_, id) => ({ id }));
    await dbPutMany(db, 's', rows, 10);
    expect(await dbGetAll(db, 's')).toHaveLength(25);
    db.close();
    await deleteDb('batch-test');
  });
});

describe('app and provider databases', () => {
  test('kv round trip', async () => {
    const db = await openAppDb('app-test');
    await kvSet(db, 'x', { a: 1 });
    expect(await kvGet(db, 'x')).toEqual({ a: 1 });
    expect(await kvGet(db, 'missing', 'fallback')).toBe('fallback');
    db.close();
  });

  test('provider schema pages entries by category and date', async () => {
    const db = await openProviderDb('t1');
    const rows = [
      { key: 'a|1', entryKey: 'a', type: 'movie', categoryId: '1', added: 100 },
      { key: 'b|1', entryKey: 'b', type: 'movie', categoryId: '1', added: 300 },
      { key: 'c|2', entryKey: 'c', type: 'movie', categoryId: '2', added: 200 },
    ];
    await dbPutMany(db, 'entry_cat', rows);
    const index = db.transaction('entry_cat').objectStore('entry_cat').index('byCatAdded');
    const found = await new Promise((resolve) => {
      const out = [];
      index.openCursor(IDBKeyRange.bound(['movie', '1', 0], ['movie', '1', Infinity]), 'prev').onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          out.push(cursor.value.entryKey);
          cursor.continue();
        } else resolve(out);
      };
    });
    expect(found).toEqual(['b', 'a']);
    expect(await dbGet(db, 'entry_cat', 'c|2')).toBeTruthy();
    db.close();
    await deleteProviderDb('t1');
  });
});
