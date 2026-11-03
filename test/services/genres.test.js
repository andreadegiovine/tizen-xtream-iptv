import { openProviderDb } from '../../src/db/providerDb.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';
import { normalizeGenre, splitGenres, mergeGenres, genreLabel } from '../../src/services/genres.js';
import { createGenreIndex } from '../../src/services/genreIndex.js';
import { listGenres } from '../../src/services/catalogQuery.js';

describe('genre normalisation', () => {
  test('same genre in any language or spelling gives one key', () => {
    expect(normalizeGenre('Animazione')[0].key).toBe('animation');
    expect(normalizeGenre('Animation')[0].key).toBe('animation');
    expect(normalizeGenre('  ANIMAZIONE ')[0].key).toBe('animation');
    expect(normalizeGenre('Sci-Fi')[0].key).toBe('scifi');
    expect(normalizeGenre('Fantascienza')[0].key).toBe('scifi');
  });

  test('combined TMDB names become two genres; unknown ones keep their own key', () => {
    expect(normalizeGenre('Action & Adventure').map((g) => g.key)).toEqual(['action', 'adventure']);
    expect(normalizeGenre('Sci-Fi & Fantasy').map((g) => g.key)).toEqual(['scifi', 'fantasy']);
    expect(normalizeGenre('Eroico')).toEqual([{ key: 'x:eroico', name: 'Eroico' }]);
    expect(normalizeGenre('')).toEqual([]);
  });

  test('lists are split, merged and deduplicated across sources', () => {
    expect(splitGenres('Azione, Commedia / Azione').map((g) => g.key)).toEqual(['action', 'comedy']);
    expect(mergeGenres('Animazione', [{ name: 'Animation' }, { name: 'Comedy' }], ['Commedia']).map((g) => g.key)).toEqual(['animation', 'comedy']);
  });

  test('canonical genres use the app language, others their own name', () => {
    const tr = (k) => ({ 'genre.animation': 'Animazione' })[k];
    expect(genreLabel({ key: 'animation', name: 'animation' }, tr)).toBe('Animazione');
    expect(genreLabel({ key: 'x:eroico', name: 'Eroico' }, tr)).toBe('Eroico');
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
    await index.onMeta('movie', 10, { genreList: [{ id: 16, name: 'Animation' }, { id: 12, name: 'Adventure' }] });
    const keys = (await index.list('movie')).map((g) => g.key).sort();
    expect(keys).toEqual(['action', 'adventure', 'animation', 'comedy']);
    expect(await index.entryKeys('movie', 'animation')).toEqual(['movie:t10']);
  });

  test('a genre disappears when no title has it any more', async () => {
    const { db, index } = await setup([item(1, 'Azione', { tmdbId: 10 }), item(2, 'Azione')]);
    await index.onMeta('movie', 10, { genreList: [{ name: 'War' }] });
    expect((await listGenres(db, 'movie')).map((g) => g.key).sort()).toEqual(['action', 'war']);
    await writeEntries(db, 'movie', buildEntries('movie', [item(2, 'Azione')])); // title 10 left the catalog
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['action']);
  });

  test('clearing TMDB data keeps provider genres', async () => {
    const { db, index } = await setup([item(1, 'Azione', { tmdbId: 10 })]);
    await index.onMeta('movie', 10, { genreList: [{ name: 'War' }] });
    await index.clearTmdb();
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['action']);
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
