import { openAppDb } from '../../src/db/appDb.js';
import { createCollectionsService, collectionGenres, unionGenres, collectionKey, isCollectionKey } from '../../src/services/collections.js';
import { collectionSidebarItems, collectionsOfView } from '../../src/ui/pages/collectionsPage.js';

let n = 0;
const newDb = () => openAppDb(`collections-test-${(n += 1)}`);

test('collections: create, add (no duplicates), rename, take titles out, delete, per provider', async () => {
  const svc = createCollectionsService({ db: await newDb(), now: (() => { let c = 0; return () => (c += 1); })() });
  const a = await svc.create('p1', '  Marvel ', ['movie:i1']);
  expect(a.name).toBe('Marvel');
  await svc.create('p2', 'Other');
  expect(await svc.addEntry(a.id, 'series:i2')).toBe(true);
  expect(await svc.addEntry(a.id, 'series:i2')).toBe(false);
  expect((await svc.list('p1')).map((c) => c.name)).toEqual(['Marvel']);
  await svc.update(a.id, { name: 'MCU', remove: ['movie:i1'] });
  expect((await svc.get(a.id)).entryKeys).toEqual(['series:i2']);
  expect((await svc.get(a.id)).name).toBe('MCU');
  await svc.update(a.id, { name: '   ' });
  expect((await svc.get(a.id)).name).toBe('MCU'); // an empty name keeps the old one
  expect((await svc.search('p1', 'mcu')).length).toBe(1);
  expect((await svc.search('p1', 'zzz')).length).toBe(0);
  expect((await svc.search('p1', '')).length).toBe(1);
  expect(await svc.remove(a.id)).toBe(true);
  await svc.removeProvider('p2');
  expect(await svc.list('p2')).toEqual([]);
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
});

test('collections views: all, favourites and a genre', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ctx = { genresById: new Map([['a', [{ key: 'drama' }]], ['b', []], ['c', [{ key: 'drama' }, { key: 'action' }]]]), favoriteIds: new Set(['b']) };
  expect(collectionsOfView(list, { kind: 'all' }, ctx).length).toBe(3);
  expect(collectionsOfView(list, { kind: 'favorites' }, ctx).map((c) => c.id)).toEqual(['b']);
  expect(collectionsOfView(list, { kind: 'genre', id: 'drama' }, ctx).map((c) => c.id)).toEqual(['a', 'c']);
});
