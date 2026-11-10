import { dbPut } from '../../src/core/idb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { createCollectionsService, collectionGenres, unionGenres, collectionKey, isCollectionKey } from '../../src/services/collections.js';
import { collectionSidebarItems, collectionsOfView } from '../../src/ui/pages/collectionsPage.js';

let n = 0;
const newDb = () => openAppDb(`collections-test-${(n += 1)}`);

test('collections: create, add (no duplicates), rename, take titles out, delete', async () => {
  const svc = createCollectionsService({ db: await newDb(), now: (() => { let c = 0; return () => (c += 1); })() });
  const a = await svc.create('p1', '  Marvel ', ['movie:t1']);
  expect(a.name).toBe('Marvel');
  await svc.create('p2', 'Other');
  expect(await svc.addEntry(a.id, 'series:t2', 'p1')).toBe(true);
  expect(await svc.addEntry(a.id, 'series:t2', 'p1')).toBe(false);
  expect((await svc.list('p1')).map((c) => c.name)).toEqual(['Other', 'Marvel']); // collections are shared by all providers
  await svc.update(a.id, { name: 'MCU', remove: ['movie:t1'] }, 'p1');
  expect((await svc.get(a.id, 'p1')).entryKeys).toEqual(['series:t2']);
  expect((await svc.get(a.id, 'p1')).name).toBe('MCU');
  await svc.update(a.id, { name: '   ' }, 'p1');
  expect((await svc.get(a.id, 'p1')).name).toBe('MCU'); // an empty name keeps the old one
  expect((await svc.search('p1', 'mcu')).length).toBe(1);
  expect((await svc.search('p1', 'zzz')).length).toBe(0);
  expect((await svc.search('p1', '')).length).toBe(2);
  expect(await svc.remove(a.id)).toBe(true);
  await svc.removeProvider('p2');
  expect((await svc.list('p2')).map((c) => c.name)).toEqual(['Other']); // removing a provider does not delete a collection
});

test('a provider sees the shared titles and its own; another provider own titles stay hidden but are kept', async () => {
  const db = await newDb();
  const svc = createCollectionsService({ db, now: (() => { let c = 0; return () => (c += 1); })() });
  const c = await svc.create('p1', 'Mix', ['movie:t5', 'movie:i7', 'live:gdazn']);
  expect(c.entryKeys).toEqual(['movie:t5', 'movie:i7', 'live:gdazn']);
  expect((await svc.get(c.id, 'p2')).entryKeys).toEqual(['movie:t5', 'live:gdazn']); // p1's own title is not p2's movie:i7
  await svc.addEntry(c.id, 'movie:i7', 'p2'); // p2's own movie 7 is another title
  expect((await svc.get(c.id, 'p2')).entryKeys).toEqual(['movie:t5', 'live:gdazn', 'movie:i7']);
  expect((await svc.get(c.id, 'p1')).entryKeys).toEqual(['movie:t5', 'movie:i7', 'live:gdazn']);
  await svc.update(c.id, { remove: ['movie:i7'] }, 'p2'); // takes out p2's, not p1's
  expect((await svc.get(c.id, 'p1')).entryKeys).toContain('movie:i7');
  await svc.removeProvider('p1'); // takes only p1's own title out
  expect((await svc.get(c.id, 'p2')).entryKeys).toEqual(['movie:t5', 'live:gdazn']);
});

test('own titles move to the shared key when the catalog gives them a TMDB id', async () => {
  const db = await newDb();
  const svc = createCollectionsService({ db, now: (() => { let c = 0; return () => (c += 1); })() });
  const c = await svc.create('p1', 'Mix', ['movie:i7', 'movie:i8', 'movie:t9']);
  const moved = await svc.upgrade('p1', async (key) => ({ 'movie:i7': 'movie:t7', 'movie:i8': 'movie:t9' }[key] || null));
  expect(moved).toBe(2);
  expect((await svc.get(c.id, 'p2')).entryKeys).toEqual(['movie:t7', 'movie:t9']); // t9 was already there: no duplicate
});

test('collections saved per provider are made shared, their own titles prefixed', async () => {
  const db = await newDb();
  await dbPut(db, 'kv', { key: 'collections', value: [{ id: 'x', providerId: 'p1', name: 'Old', entryKeys: ['movie:t1', 'movie:i2'], createdAt: 1, updatedAt: 1 }] });
  const svc = createCollectionsService({ db });
  expect((await svc.get('x', 'p1')).entryKeys).toEqual(['movie:t1', 'movie:i2']);
  expect((await svc.get('x', 'p2')).entryKeys).toEqual(['movie:t1']);
  expect((await createCollectionsService({ db }).list('p2')).length).toBe(1);
});

test('collections persist and newest comes first', async () => {
  const db = await newDb();
  let clock = 10;
  const svc = createCollectionsService({ db, now: () => (clock += 1) });
  await svc.create('p', 'A');
  await svc.create('p', 'B');
  const again = createCollectionsService({ db });
  expect((await again.list('p')).map((c) => c.name)).toEqual(['B', 'A']);
});

test('a collection inherits the genres of its members', async () => {
  const lookup = { 'movie:1': [{ key: 'drama', name: 'Drama' }], 'movie:2': [{ key: 'action', name: 'Action' }, { key: 'drama', name: 'Drama' }], 'live:i3': [] };
  const genres = await collectionGenres(null, ['movie:1', 'movie:2', 'live:i3', 'gone'], async (_db, key) => lookup[key] || []);
  expect(genres.map((g) => g.key)).toEqual(['action', 'drama']);
  expect(unionGenres([])).toEqual([]);
  expect(isCollectionKey(collectionKey('x1'))).toBe(true);
  expect(isCollectionKey('movie:i1')).toBe(false);
});

test('collections sidebar: all, favourites, pinned genres, then the open genres', () => {
  const labels = { all: 'All', favorites: 'F', genres: 'G' };
  const genres = [{ key: 'action', name: 'Action' }, { key: 'drama', name: 'Drama' }];
  const items = collectionSidebarItems({ genres, pinned: [{ id: 'drama', name: 'Drama' }], labels });
  expect(items.map((i) => i.kind)).toEqual(['all', 'favorites', 'genre', 'genresToggle', 'genre', 'genre']);
  expect(items[2]).toMatchObject({ pinned: true, id: 'drama' });
  expect(collectionSidebarItems({ genres, genresExpanded: false, labels }).map((i) => i.kind)).toEqual(['all', 'favorites', 'genresToggle']);
  expect(collectionSidebarItems({ labels }).map((i) => i.kind)).toEqual(['all', 'favorites']);
  expect(collectionSidebarItems({ labels, hasFavorites: false }).map((i) => i.kind)).toEqual(['all']); // no favourite collection: no entry
});

test('collections views: all, favourites and a genre', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ctx = { genresById: new Map([['a', [{ key: 'drama' }]], ['b', []], ['c', [{ key: 'drama' }, { key: 'action' }]]]), favoriteIds: new Set(['b']) };
  expect(collectionsOfView(list, { kind: 'all' }, ctx).length).toBe(3);
  expect(collectionsOfView(list, { kind: 'favorites' }, ctx).map((c) => c.id)).toEqual(['b']);
  expect(collectionsOfView(list, { kind: 'genre', id: 'drama' }, ctx).map((c) => c.id)).toEqual(['a', 'c']);
});
