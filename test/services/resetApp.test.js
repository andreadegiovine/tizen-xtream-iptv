import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb, providerDbName } from '../../src/db/providerDb.js';
import { dbPut, dbGetAll } from '../../src/core/idb.js';
import { resetApp } from '../../src/services/resetApp.js';

test('reset deletes provider databases, empties the app database and the storages', async () => {
  const db = await openAppDb('reset-test');
  await dbPut(db, 'providers', { id: 'p1' });
  await dbPut(db, 'kv', { key: 'a', value: 1 });
  (await openProviderDb('p1')).close();
  const stopWork = jest.fn();
  const storage = { clear: jest.fn() };
  await resetApp({ db, providers: { list: async () => [{ id: 'p1' }] }, stopWork, storages: [storage], databases: async () => [{ name: 'provider_orphan' }, { name: 'other' }] });
  expect(stopWork).toHaveBeenCalled();
  expect(storage.clear).toHaveBeenCalled();
  expect(await dbGetAll(db, 'providers')).toEqual([]);
  expect(await dbGetAll(db, 'kv')).toEqual([]);
  const remaining = await indexedDB.databases();
  expect(remaining.map((d) => d.name)).not.toContain(providerDbName('p1'));
});
