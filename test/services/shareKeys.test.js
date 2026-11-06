import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPut } from '../../src/core/idb.js';
import { filterId, foldName, isOwnKey, isPortableKey, portableKeyFor, qualifyKey, visibleKey } from '../../src/services/shareKeys.js';

test('which keys mean the same in every provider', () => {
  ['movie:t603', 'series:t1', 'live:gdazn', 'live:nrai', 'collection:x1', 'genre:movie:drama', 'category:live:sport'].forEach((key) => expect(isPortableKey(key)).toBe(true));
  ['movie:i603', 'series:i1', 'live:i45'].forEach((key) => expect(isPortableKey(key)).toBe(false));
});

test('names are folded to letters and digits', () => {
  expect(foldName('  Cinéma & Sport! ')).toBe('cinema sport');
  expect(foldName('SPORT')).toBe(foldName('sport'));
  expect(foldName('Фильмы')).toBe('фильмы'); // not only latin
  expect(foldName('!!!')).toBe('!!!'); // nothing to fold: kept as it is
  expect(filterId('category', 7, 'Sport HD')).toBe('sport hd');
  expect(filterId('genre', 'drama', 'Drama')).toBe('drama');
  expect(filterId('category', 7, '')).toBe('7');
});

test('stored keys: shared as they are, a provider own key carries the provider', () => {
  expect(qualifyKey('p1', 'movie:t5')).toBe('movie:t5');
  expect(qualifyKey('p1', 'movie:i5')).toBe('p1@movie:i5');
  expect(visibleKey('p1', 'p1@movie:i5')).toBe('movie:i5');
  expect(visibleKey('p2', 'p1@movie:i5')).toBeNull();
  expect(visibleKey('p2', 'movie:t5')).toBe('movie:t5');
  expect(isOwnKey('p1', 'p1@movie:i5')).toBe(true);
  expect(isOwnKey('p1', 'movie:t5')).toBe(false);
  expect(isOwnKey('p2', 'p1@movie:i5')).toBe(false);
});

test('a provider title gets its shared key from the list row', async () => {
  const db = await openProviderDb(`share-${Math.random()}`);
  await dbPut(db, 'items', { key: 'movie:5', type: 'movie', id: 5, tmdbId: 603 });
  await dbPut(db, 'items', { key: 'series:6', type: 'series', id: 6, tmdbId: null });
  expect(await portableKeyFor(db, 'movie:i5')).toBe('movie:t603');
  expect(await portableKeyFor(db, 'series:i6')).toBeNull();
  expect(await portableKeyFor(db, 'movie:i99')).toBeNull();
  expect(await portableKeyFor(db, 'live:i5')).toBeNull();
  expect(await portableKeyFor(db, 'movie:t603')).toBeNull();
});
