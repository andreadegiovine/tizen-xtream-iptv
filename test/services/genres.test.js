import { openProviderDb } from '../../src/db/providerDb.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';
import { normalizeGenre, splitGenres, mergeGenres } from '../../src/services/genres.js';
import { createGenreIndex } from '../../src/services/genreIndex.js';
import { writeGenres, runGenreBackfill } from '../../src/services/genreBackfill.js';
import { listGenres } from '../../src/services/catalogQuery.js';

describe('genre normalisation', () => {
  test('case, accents, spacing and separators are ignored; names are not translated', () => {
    expect(normalizeGenre('Animazione')).toEqual({ key: 'animazione', name: 'Animazione' });
    expect(normalizeGenre('  ANIMAZIONE ').key).toBe('animazione');
    expect(normalizeGenre('Sci-Fi').key).toBe('sci-fi');
    expect(normalizeGenre('Fantascienza').key).not.toBe(normalizeGenre('Sci-Fi').key);
    expect(normalizeGenre('Città')).toEqual({ key: 'citta', name: 'Città' });
    expect(normalizeGenre('')).toBeNull();
  });

  test('lists are split, merged and deduplicated across sources; the first spelling wins', () => {
    expect(splitGenres('Azione, Commedia / azione').map((g) => g.key)).toEqual(['azione', 'commedia']);
    expect(mergeGenres('animazione', [{ name: 'Animazione' }, { name: 'Commedia' }], ['COMMEDIA'])).toEqual([
      { key: 'animazione', name: 'Animazione' },
      { key: 'commedia', name: 'Commedia' },
    ]);
  });
});

describe('genre index', () => {
  let n = 0;
  const item = (id, genre, extra = {}) => ({ key: `movie:${id}`, type: 'movie', id, name: `Film ${id}`, categoryId: '1', added: 100 + id, tmdbId: null, ext: 'mkv', genre, ...extra });
  async function setup(items) {
    const db = await openProviderDb(`genres-test-${(n += 1)}`);
    await writeEntries(db, 'movie', buildEntries('movie', items));
    const active = { get: async () => ({ db }) };
    return { db, index: createGenreIndex({ active }) };
  }
  const fakeTmdb = (genresById) => ({ enabled: true, details: jest.fn(async (type, id) => ({ genres: (genresById[id] || []).map((name) => ({ name })) })) });
  const fakeXtream = (genreById) => ({ getVodInfo: jest.fn(async (id) => ({ info: { genre: genreById[id] || '' } })), getSeriesInfo: jest.fn() });

  test('provider and TMDB spellings are one sidebar entry; titles are newest first, without duplicates', async () => {
    const { db, index } = await setup([item(1, 'Animazione, Commedia', { tmdbId: 10 }), item(2, 'Azione'), item(3, '')]);
    await writeGenres(db, { key: 'movie:t10', type: 'movie', added: 101 }, [{ name: 'animazione' }, { name: 'Avventura' }], 'tmdb');
    const keys = (await index.list('movie')).map((g) => g.key).sort();
    expect(keys).toEqual(['animazione', 'avventura', 'azione', 'commedia']);
    expect(await index.entryKeys('movie', 'animazione')).toEqual(['movie:t10']);
  });

  test('a genre disappears when no title has it any more', async () => {
    const { db, index } = await setup([item(1, 'Azione', { tmdbId: 10 }), item(2, 'Azione')]);
    await writeGenres(db, { key: 'movie:t10', type: 'movie', added: 101 }, ['Guerra'], 'tmdb');
    expect((await listGenres(db, 'movie')).map((g) => g.key).sort()).toEqual(['azione', 'guerra']);
    await writeEntries(db, 'movie', buildEntries('movie', [item(2, 'Azione')])); // title 10 left the catalog
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['azione']);
    expect(index).toBeTruthy();
  });

  test('clearing TMDB data keeps provider genres and the ones from provider details', async () => {
    const { db, index } = await setup([item(1, 'Azione', { tmdbId: 10 }), item(2, '')]);
    await writeGenres(db, { key: 'movie:t10', type: 'movie', added: 101 }, ['Guerra'], 'tmdb');
    await writeGenres(db, { key: 'movie:i2', type: 'movie', added: 102 }, 'Thriller', 'info');
    await index.clearTmdb();
    expect((await listGenres(db, 'movie')).map((g) => g.key).sort()).toEqual(['azione', 'thriller']);
  });

  test('the background pass asks only for titles without genres, TMDB first then the provider, once each', async () => {
    const { db, index } = await setup([item(1, '', { tmdbId: 10 }), item(2, '', { tmdbId: 20 }), item(3, ''), item(4, 'Azione')]);
    const tmdb = fakeTmdb({ 10: ['Drama'] });
    const xtream = fakeXtream({ 3: 'Horror' }); // items 2 (no TMDB genres, id 2) and 3 go to the provider
    await runGenreBackfill({ db, xtream, tmdb, language: 'en' });
    expect(tmdb.details.mock.calls.map((c) => c[1]).sort()).toEqual([10, 20]);
    expect(xtream.getVodInfo.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3]);
    expect((await index.list('movie')).map((g) => g.key).sort()).toEqual(['azione', 'drama', 'horror']);
    // second run: nothing is missing any more (titles with no genre anywhere are remembered)
    xtream.getVodInfo.mockClear();
    tmdb.details.mockClear();
    await runGenreBackfill({ db, xtream, tmdb, language: 'en' });
    expect(tmdb.details).not.toHaveBeenCalled();
    expect(xtream.getVodInfo).not.toHaveBeenCalled();
  });

  test('without TMDB the provider details supply the genres', async () => {
    const { db, index } = await setup([item(1, '')]);
    await runGenreBackfill({ db, xtream: fakeXtream({ 1: 'Thriller / Horror' }), tmdb: null, language: 'it' });
    expect((await index.list('movie')).map((g) => g.key).sort()).toEqual(['horror', 'thriller']);
  });
});
