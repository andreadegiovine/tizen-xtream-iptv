import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { writeEntries, removeCatalogType } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';
import { estimateStoresBytes, DERIVED_STORES } from '../../src/services/dbSize.js';
import { dbGetAllKeys, dbPut } from '../../src/core/idb.js';
import { derivedVersion, writeDerived, readDerivedAny, bumpCatalogRev } from '../../src/services/derivedStore.js';

const item = (type, id) => ({ key: `${type}:${id}`, type, id, name: `T ${id}`, categoryId: '1', added: 100 + id, tmdbId: null, ext: 'mkv', genre: 'Azione' });

test('removing one type keeps the others', async () => {
  const db = await openProviderDb(`rm-${Math.random()}`);
  await writeEntries(db, 'movie', buildEntries('movie', [item('movie', 1)]));
  await writeEntries(db, 'series', buildEntries('series', [item('series', 2)]));
  await dbPut(db, 'items', { key: 'movie:1', type: 'movie' });
  await dbPut(db, 'items', { key: 'series:2', type: 'series' });
  await removeCatalogType(db, 'movie');
  expect(await dbGetAllKeys(db, 'items')).toEqual(['series:2']);
  expect((await dbGetAllKeys(db, 'entries')).length).toBe(1);
  expect((await dbGetAllKeys(db, 'entry_genre')).every((k) => k.startsWith('series'))).toBe(true);
});

test('the size of the stores is estimated from a sample', async () => {
  const db = await openProviderDb(`size-${Math.random()}`);
  await writeEntries(db, 'movie', buildEntries('movie', [item('movie', 1), item('movie', 2)]));
  expect(await estimateStoresBytes(db, DERIVED_STORES)).toBeGreaterThan(100);
  expect(await estimateStoresBytes(db, ['details'])).toBe(0);
});

test('a copy built on an older version is still readable, marked as not fresh', async () => {
  const db = await openProviderDb(`any-${Math.random()}`);
  const v = await derivedVersion(db, { genres: true });
  await writeDerived(db, 'x', { a: 1 }, v);
  expect(await readDerivedAny(db, 'x', v)).toEqual({ value: { a: 1 }, fresh: true });
  await bumpCatalogRev(db);
  expect(await readDerivedAny(db, 'x', await derivedVersion(db, { genres: true }))).toEqual({ value: { a: 1 }, fresh: false });
});
