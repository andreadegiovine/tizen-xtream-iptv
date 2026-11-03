import { openProviderDb } from '../../src/db/providerDb.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';
import { normalizeGenre, splitGenres, mergeGenres } from '../../src/services/genres.js';
import { createGenreIndex } from '../../src/services/genreIndex.js';
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
    const tmdb = { enabled: true, getMeta: jest.fn() };
    return { db, tmdb, index: createGenreIndex({ active, tmdb }) };
  }

  test('provider and TMDB spellings are one sidebar entry; titles are newest first, without duplicates', async () => {
    const { index } = await setup([item(1, 'Animazione, Commedia', { tmdbId: 10 }), item(2, 'Azione'), item(3, '')]);
    await index.onMeta('movie', 10, { genreList: [{ id: 16, name: 'animazione' }, { id: 12, name: 'Avventura' }] });
    const keys = (await index.list('movie')).map((g) => g.key).sort();
    expect(keys).toEqual(['animazione', 'avventura', 'azione', 'commedia']);
    expect(await index.entryKeys('movie', 'animazione')).toEqual(['movie:t10']);
  });

  test('a genre disappears when no title has it any more', async () => {
    const { db, index } = await setup([item(1, 'Azione', { tmdbId: 10 }), item(2, 'Azione')]);
    await index.onMeta('movie', 10, { genreList: [{ name: 'Guerra' }] });
    expect((await listGenres(db, 'movie')).map((g) => g.key).sort()).toEqual(['azione', 'guerra']);
    await writeEntries(db, 'movie', buildEntries('movie', [item(2, 'Azione')])); // title 10 left the catalog
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['azione']);
  });

  test('clearing TMDB data keeps provider genres', async () => {
    const { db, index } = await setup([item(1, 'Azione', { tmdbId: 10 })]);
    await index.onMeta('movie', 10, { genreList: [{ name: 'Guerra' }] });
    await index.clearTmdb();
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['azione']);
  });

  test('genres from provider details work without TMDB and are kept when TMDB data is removed', async () => {
    const { index } = await setup([item(1, '')]);
    await index.recordFor({ key: 'movie:1', type: 'movie', added: 101 }, 'Thriller, Horror', 'info');
    await index.recordFor({ key: 'movie:1', type: 'movie', added: 101 }, [{ name: 'Horror' }], 'tmdb');
    await index.clearTmdb();
    expect((await index.list('movie')).map((g) => g.key).sort()).toEqual(['horror', 'thriller']);
    expect(await index.entryKeys('movie', 'horror')).toEqual(['movie:1']);
  });

  test('backfill asks TMDB only for titles without genres and tries each once', async () => {
    const { tmdb, index } = await setup([item(1, '', { tmdbId: 10 }), item(2, '', { tmdbId: 20 }), item(3, '')]);
    tmdb.getMeta.mockImplementation(async (type, id) => {
      if (id === 10) await index.onMeta(type, id, { genreList: [{ name: 'Drama' }] });
      return {};
    });
    await index.backfill();
    expect(tmdb.getMeta.mock.calls.map((c) => c[1]).sort()).toEqual([10, 20]);
    expect((await index.list('movie')).map((g) => g.key)).toEqual(['drama']);
  });
});
