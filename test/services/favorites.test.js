import { openAppDb } from '../../src/db/appDb.js';
import { createFavoritesService } from '../../src/services/favorites.js';
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
