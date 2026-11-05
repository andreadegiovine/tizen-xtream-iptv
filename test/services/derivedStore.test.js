import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { bumpCatalogRev, bumpGenresRev, derivedVersion, readDerived, writeDerived, writeDerivedList, readDerivedList, clearDerived } from '../../src/services/derivedStore.js';

let db;
beforeEach(async () => {
  db = await openProviderDb(`d${Math.random()}`);
});

test('a record is valid only on the version it was built on', async () => {
  const v1 = await derivedVersion(db, { genres: true, locale: 'it' });
  await writeDerived(db, 'x', { a: 1 }, v1);
  expect(await readDerived(db, 'x', v1)).toEqual({ a: 1 });
  await bumpCatalogRev(db);
  expect(await readDerived(db, 'x', await derivedVersion(db, { genres: true, locale: 'it' }))).toBeNull();
});

test('genres and language change the version only when the data depends on them', async () => {
  const a = await derivedVersion(db);
  await bumpGenresRev(db);
  expect(await derivedVersion(db)).toBe(a);
  expect(await derivedVersion(db, { genres: true })).not.toBe(await derivedVersion(db, { genres: false }));
});

test('lists are saved in chunks and cleared', async () => {
  const v = await derivedVersion(db);
  const list = Array.from({ length: 7 }, (_, i) => ({ i }));
  await writeDerivedList(db, 'l', list, v, 3);
  expect(await readDerivedList(db, 'l', v)).toEqual(list);
  await bumpCatalogRev(db);
  expect(await readDerivedList(db, 'l', v)).toEqual(list); // the caller passes the current version: a stale one is not current
  expect(await readDerivedList(db, 'l', await derivedVersion(db))).toBeNull();
  await clearDerived(db);
  expect(await readDerivedList(db, 'l', v)).toBeNull();
});
