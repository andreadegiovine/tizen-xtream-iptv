import { openAppDb } from '../../src/db/appDb.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { favoriteFilterEntries } from '../../src/services/favoriteFilters.js';
import { youtubeId, youtubeUrl } from '../../src/services/trailer.js';
import { groupByType } from '../../src/ui/components/typedRows.js';
import { tagsFrom } from '../../src/ui/pages/detailPage.js';

let n = 0;
const newDb = () => openAppDb(`fav-test-${(n += 1)}`);

test('favorites: toggle, list per provider (newest first), persistence', async () => {
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
  expect((await again.list('p2')).length).toBe(1);
});

test('favourite categories and genres: stored apart from the titles, per provider', async () => {
  const db = await newDb();
  let clock = 1;
  const svc = createFavoritesService({ db, now: () => (clock += 1) });
  await svc.toggle('p1', 'movie:t1', 'movie');
  expect(await svc.toggleFilter('p1', { kind: 'genre', type: 'movie', id: 'drama', name: 'Drama' })).toBe(true);
  expect(await svc.toggleFilter('p1', { kind: 'category', type: 'live', id: '7', name: 'Sport' })).toBe(true);
  expect(await svc.hasFilter('p1', 'genre', 'movie', 'drama')).toBe(true);
  expect(await svc.hasFilter('p1', 'genre', 'series', 'drama')).toBe(false); // same genre, other type
  expect((await svc.listFilters('p1')).map((f) => [f.entryKey, f.name])).toEqual([['category:live:7', 'Sport'], ['genre:movie:drama', 'Drama']]);
  expect((await svc.listTitles('p1')).map((f) => f.entryKey)).toEqual(['movie:t1']);
  expect(await svc.toggleFilter('p1', { kind: 'genre', type: 'movie', id: 'drama', name: 'Drama' })).toBe(false);
  expect((await createFavoritesService({ db }).listFilters('p1')).length).toBe(1);
});

test('favourite filters become cards ahead of the titles; a category the provider dropped is skipped', async () => {
  const saved = [
    { kind: 'genre', type: 'movie', refId: 'drama', name: 'Drama', entryKey: 'genre:movie:drama' },
    { kind: 'category', type: 'movie', refId: '5', name: 'Gone', entryKey: 'category:movie:5' },
    { kind: 'category', type: 'movie', refId: '3', name: 'Action', entryKey: 'category:movie:3' },
    { entryKey: 'movie:t1', type: 'movie' },
  ];
  const entries = await favoriteFilterEntries(saved, async () => [{ id: '3' }]);
  expect(entries.map((e) => [e.filterKind, e.name, e.type])).toEqual([['genre', 'Drama', 'movie'], ['category', 'Action', 'movie']]);
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
