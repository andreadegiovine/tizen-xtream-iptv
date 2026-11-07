import { dbPut } from '../../src/core/idb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { favoriteFilterEntries } from '../../src/services/favoriteFilters.js';
import { youtubeId, youtubeUrl } from '../../src/services/trailer.js';
import { groupByType } from '../../src/ui/components/typedRows.js';
import { tagsFrom } from '../../src/ui/pages/detailPage.js';

let n = 0;
const newDb = () => openAppDb(`fav-test-${(n += 1)}`);

test('favorites: toggle, own titles per provider, shared titles for all (newest first), persistence', async () => {
  const db = await newDb();
  let clock = 1;
  const svc = createFavoritesService({ db, now: () => (clock += 1) });
  expect(await svc.toggle('p1', 'movie:i1', 'movie')).toBe(true);
  expect(await svc.toggle('p1', 'series:i2', 'series')).toBe(true);
  expect(await svc.toggle('p2', 'movie:i1', 'movie')).toBe(true);
  expect((await svc.list('p1')).map((f) => f.entryKey)).toEqual(['series:i2', 'movie:i1']);
  expect(await svc.has('p1', 'movie:i1')).toBe(true);
  expect(await svc.toggle('p1', 'movie:i1', 'movie')).toBe(false);
  expect(await svc.has('p1', 'movie:i1')).toBe(false);
  const again = createFavoritesService({ db }); // a fresh instance reads what was saved
  expect((await again.list('p1')).map((f) => f.entryKey)).toEqual(['series:i2']);
  await again.removeProvider('p1');
  expect(await again.list('p1')).toEqual([]);
  expect((await again.list('p2')).length).toBe(1); // p2's movie:i1 is its own: same key as p1's, another title
});

test('favorites with a TMDB id are shared by all providers and survive the removal of the one that added them', async () => {
  const db = await newDb();
  const svc = createFavoritesService({ db, now: (() => { let c = 0; return () => (c += 1); })() });
  await svc.toggle('p1', 'movie:t603', 'movie');
  await svc.toggle('p1', 'live:i9', 'live'); // the provider's own channel
  await svc.toggle('p1', 'live:gdazn', 'live'); // a group: shared
  expect((await svc.list('p2')).map((f) => f.entryKey)).toEqual(['live:gdazn', 'movie:t603']);
  expect(await svc.has('p2', 'movie:t603')).toBe(true);
  expect(await svc.has('p2', 'live:i9')).toBe(false);
  expect(await svc.toggle('p2', 'movie:t603', 'movie')).toBe(false); // the same record from the other provider
  expect(await svc.has('p1', 'movie:t603')).toBe(false);
  await svc.toggle('p2', 'movie:t603', 'movie');
  await svc.removeProvider('p1');
  expect((await svc.list('p2')).map((f) => f.entryKey)).toEqual(['movie:t603', 'live:gdazn']); // nothing shared was deleted
  expect((await svc.list('p1')).length).toBe(2);
});

test('a title saved under the provider key moves to the shared one when it gets a TMDB id', async () => {
  const db = await newDb();
  const svc = createFavoritesService({ db, now: (() => { let c = 0; return () => (c += 1); })() });
  await svc.toggle('p1', 'movie:i5', 'movie');
  await svc.toggle('p1', 'movie:i6', 'movie');
  await svc.toggle('p2', 'movie:t42', 'movie');
  const moved = await svc.upgrade('p1', async (key) => (key === 'movie:i5' ? 'movie:t42' : null)); // already a favourite through p2: merged
  expect(moved).toBe(1);
  expect((await svc.list('p3')).map((f) => f.entryKey)).toEqual(['movie:t42']);
  expect((await svc.list('p1')).map((f) => f.entryKey)).toEqual(['movie:t42', 'movie:i6']);
  expect(await svc.upgrade('p1', async () => 'movie:t7')).toBe(1);
  expect((await svc.list('p3')).map((f) => f.entryKey)).toEqual(['movie:t42', 'movie:t7']);
});

test('saved categories are renamed by folded name and duplicates merged', async () => {
  const db = await newDb();
  await dbPut(db, 'kv', { key: 'favorites', value: [
    { providerId: 'a', entryKey: 'category:live:5', kind: 'category', type: 'live', refId: '5', name: 'Sport', addedAt: 1 },
    { providerId: 'b', entryKey: 'category:live:90', kind: 'category', type: 'live', refId: '90', name: 'sport', addedAt: 2 },
    { providerId: 'a', entryKey: 'movie:t1', type: 'movie', addedAt: 3 },
  ] });
  const svc = createFavoritesService({ db });
  expect((await svc.list('z')).map((f) => f.entryKey)).toEqual(['movie:t1', 'category:live:sport']);
  expect(await svc.hasFilter('z', 'category', 'live', '12', ' SPORT ')).toBe(true);
});

test('favourite categories and genres: stored apart from the titles, shared by all providers', async () => {
  const db = await newDb();
  let clock = 1;
  const svc = createFavoritesService({ db, now: () => (clock += 1) });
  await svc.toggle('p1', 'movie:t1', 'movie');
  expect(await svc.toggleFilter('p1', { kind: 'genre', type: 'movie', id: 'drama', name: 'Drama' })).toBe(true);
  expect(await svc.toggleFilter('p1', { kind: 'category', type: 'live', id: '7', name: 'Sport' })).toBe(true);
  expect(await svc.hasFilter('p1', 'genre', 'movie', 'drama')).toBe(true);
  expect(await svc.hasFilter('p1', 'genre', 'series', 'drama')).toBe(false); // same genre, other type
  expect((await svc.listFilters('p1')).map((f) => [f.entryKey, f.name])).toEqual([['category:live:sport', 'Sport'], ['genre:movie:drama', 'Drama']]);
  expect((await svc.listFilters('p2')).length).toBe(2); // shared: another provider sees them too
  expect((await svc.listTitles('p1')).map((f) => f.entryKey)).toEqual(['movie:t1']);
  expect(await svc.toggleFilter('p1', { kind: 'genre', type: 'movie', id: 'drama', name: 'Drama' })).toBe(false);
  expect((await createFavoritesService({ db }).listFilters('p1')).length).toBe(1);
});

test('favourite filters become cards ahead of the titles; a category the provider dropped is skipped', async () => {
  const saved = [
    { kind: 'genre', type: 'movie', refId: 'drama', name: 'Drama', entryKey: 'genre:movie:drama' },
    { kind: 'category', type: 'movie', refId: 'gone', name: 'Gone', entryKey: 'category:movie:gone' },
    { kind: 'category', type: 'movie', refId: 'action', name: 'Action', entryKey: 'category:movie:action' },
    { entryKey: 'movie:t1', type: 'movie' },
  ];
  const entries = await favoriteFilterEntries(saved, async () => [{ id: '3', name: 'ACTION' }]);
  expect(entries.map((e) => [e.filterKind, e.name, e.type])).toEqual([['genre', 'Drama', 'movie'], ['category', 'Action', 'movie']]);
  expect(entries[1].filterId).toBe('3'); // saved by name, opened by this provider's own id
  const groups = groupByType(entries.concat([{ type: 'movie', key: 'movie:t1', name: 'Heat' }]));
  expect(groups[0].entries.map((e) => e.name)).toEqual(['Drama', 'Action', 'Heat']);
});

test('youtube id from an id or a url', () => {
  expect(youtubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toBe('dQw4w9WgXcQ');
  expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youtubeId('')).toBe('');
  expect(youtubeId('not a video')).toBe('');
  expect(youtubeUrl('abc')).toBe('https://www.youtube.com/watch?v=abc');
});

test('typed rows: grouped by type in a fixed order, limited per type', () => {
  const list = [{ type: 'live', name: 'a' }, { type: 'series', name: 'b' }, { type: 'movie', name: 'c' }, { type: 'movie', name: 'd' }, { type: 'movie', name: 'e' }];
  const groups = groupByType(list, 2);
  expect(groups.map((g) => g.type)).toEqual(['movie', 'series', 'live']);
  expect(groups[0].entries.map((e) => e.name)).toEqual(['c', 'd']);
  expect(groupByType([], 5)).toEqual([]);
});

test('tags come from TMDB genres first, split into separate items', () => {
  expect(tagsFrom({ genre: 'Action, Drama' }, { genre: 'Other' })).toEqual(['Action', 'Drama']);
  expect(tagsFrom(null, { genre: 'Action / Thriller | Action' })).toEqual(['Action', 'Thriller']);
  expect(tagsFrom(null, null)).toEqual([]);
});

test('a favourite genre of the TV guide shows only while the current guide has it, and comes back with it', async () => {
  const { favoriteFilterEntries } = await import('../../src/services/favoriteFilters.js');
  const saved = [{ entryKey: 'epgGenre:live:sport', kind: 'epgGenre', type: 'live', refId: 'sport', name: 'Sport' }];
  expect(await favoriteFilterEntries(saved, async () => [], async () => new Set(['news']))).toEqual([]);
  expect(await favoriteFilterEntries(saved, async () => [], async () => new Set(['sport']))).toEqual([{ key: 'epgGenre:live:sport', type: 'live', name: 'Sport', icon: '', filterKind: 'epgGenre', filterId: 'sport' }]);
  expect(await favoriteFilterEntries(saved, async () => [])).toEqual([]); // no guide: hidden, not deleted
});
