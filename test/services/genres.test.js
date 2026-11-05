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
  test('restart stops the work running and starts again from the first phase', async () => {
    let calls = 0;
    const index = createGenreIndex({ active: { get: async () => { calls += 1; return null; } }, getTmdbKey: () => 'k' });
    const first = index.backfill();
    const again = index.restart(); // waits for the first run, then starts a new one
    expect(await first).toBe(0);
    expect(await again).toBe(0);
    expect(calls).toBe(2); // with a TMDB key only the TMDB phase runs (no provider genre search): once, then again after the restart
  });
  test('the provider is asked one title at a time with a pause, and at most the daily limit', async () => {
    const { db } = await setup([item(1, ''), item(2, ''), item(3, '')]);
    const xtream = fakeXtream({ 1: 'Dramma', 2: 'Azione', 3: 'Horror' });
    const waits = [];
    const day = Date.UTC(2026, 10, 5, 12);
    const done = await runGenreBackfill({ db, xtream, tmdb: null, language: 'it', dailyLimit: 2, wait: async (ms) => waits.push(ms), now: () => day });
    expect(done).toBe(2);
    expect(xtream.getVodInfo).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1000]); // a pause between two requests, none before the first
    expect(await runGenreBackfill({ db, xtream, tmdb: null, language: 'it', dailyLimit: 2, wait: async () => undefined, now: () => day })).toBe(0); // today's are used
    expect(await runGenreBackfill({ db, xtream, tmdb: null, language: 'it', dailyLimit: 2, wait: async () => undefined, now: () => day + 86400000 })).toBe(1); // the next day
  });
  const fakeTmdb = (genresById) => ({ enabled: true, details: jest.fn(async (type, id) => ({ genres: (genresById[id] || []).map((name) => ({ name })) })) });
  const fakeXtream = (genreById) => ({ getVodInfo: jest.fn(async (id) => ({ info: { genre: genreById[id] || '' } })), getSeriesInfo: jest.fn() });

  test('provider and TMDB spellings are one sidebar entry; titles are newest first, without duplicates', async () => {
    const { db, index } = await setup([item(1, 'Animazione, Commedia', { tmdbId: 10 }), item(2, 'Azione'), item(3, '')]);
    await writeGenres(db, { key: 'movie:t10', type: 'movie', added: 101 }, [{ name: 'animazione' }, { name: 'Avventura' }], 'tmdb');
    const keys = (await index.list('movie')).map((g) => g.key).sort();
    expect(keys).toEqual(['animazione', 'avventura', 'azione']); // TMDB's genres replace the provider's ones for title 10 (commedia is gone)
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

  test('TMDB genres replace the provider list of a title, and a new sync does not bring it back', async () => {
    const { db } = await setup([item(1, 'Azione', { tmdbId: 10 })]);
    await writeGenres(db, { key: 'movie:t10', type: 'movie', added: 101 }, ['Guerra'], 'tmdb');
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['guerra']);
    await writeEntries(db, 'movie', buildEntries('movie', [item(1, 'Azione', { tmdbId: 10 })]));
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['guerra']);
  });

  test('the background pass asks only for titles without genres, TMDB first then the provider, once each', async () => {
    const { db, index } = await setup([item(1, '', { tmdbId: 10 }), item(2, '', { tmdbId: 20 }), item(3, ''), item(4, 'Azione')]);
    const tmdb = fakeTmdb({ 10: ['Drama'] });
    const xtream = fakeXtream({ 3: 'Horror' }); // items 2 (no TMDB genres, id 2) and 3 go to the provider
    await runGenreBackfill({ db, xtream, tmdb, language: 'en', pauseMs: 0 });
    expect(tmdb.details.mock.calls.map((c) => c[1]).sort()).toEqual([10, 20]);
    expect(xtream.getVodInfo.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3]);
    expect((await index.list('movie')).map((g) => g.key).sort()).toEqual(['azione', 'drama', 'horror']);
    // second run: nothing is missing any more (titles with no genre anywhere are remembered)
    xtream.getVodInfo.mockClear();
    tmdb.details.mockClear();
    await runGenreBackfill({ db, xtream, tmdb, language: 'en', pauseMs: 0 });
    expect(tmdb.details).not.toHaveBeenCalled();
    expect(xtream.getVodInfo).not.toHaveBeenCalled();
  });

  test('without TMDB the provider details supply the genres', async () => {
    const { db, index } = await setup([item(1, '')]);
    await runGenreBackfill({ db, xtream: fakeXtream({ 1: 'Thriller / Horror' }), tmdb: null, language: 'it', pauseMs: 0 });
    expect((await index.list('movie')).map((g) => g.key).sort()).toEqual(['horror', 'thriller']);
  });
});

describe('tmdb download', () => {
  let m = 0;
  test('downloads every title once per tmdb id, skips fresh records, writes genres for all its entries', async () => {
    const { openAppDb } = await import('../../src/db/appDb.js');
    const { runTmdbDownload } = await import('../../src/services/genreBackfill.js');
    const db = await openProviderDb(`tmdb-dl-${(m += 1)}`);
    const appDb = await openAppDb(`tmdb-dl-app-${m}`);
    const item = (id, tmdbId, extra = {}) => ({ key: `movie:${id}`, type: 'movie', id, name: `Film ${id}`, categoryId: '1', added: 100 + id, tmdbId, ext: 'mkv', genre: '', ...extra });
    await writeEntries(db, 'movie', buildEntries('movie', [item(1, 7), item(2, 8), item(3, 0)]));
    const tmdb = { enabled: true, details: jest.fn(async (type, id) => ({ id, title: `T${id}`, genres: [{ id: 1, name: 'Dramma' }], production_companies: [{ id: 3, name: 'Acme', logo_path: '/a.png' }] })) };
    let t = 1000;
    const args = { db, appDb, tmdb, language: 'it-IT', now: () => t };
    expect(await runTmdbDownload(args)).toBe(2);
    expect(tmdb.details).toHaveBeenCalledTimes(2);
    const { dbGet } = await import('../../src/core/idb.js');
    const record = await dbGet(appDb, 'tmdb', 'meta:movie:7:it-IT');
    expect(record.value).toMatchObject({ title: 'T7', genreList: [{ id: 1, name: 'Dramma' }] });
    expect(record.value.companies).toBeUndefined(); // the light record: only what the grids need
    expect(tmdb.details.mock.calls[0][3]).toEqual({ full: false });
    expect(record.expiresAt).toBe(1000 + 120 * 24 * 3600 * 1000);
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['dramma']);
    await runTmdbDownload(args); // fresh: nothing to do
    expect(tmdb.details).toHaveBeenCalledTimes(2);
    t += 121 * 24 * 3600 * 1000; // expired: downloaded again
    await runTmdbDownload(args);
    expect(tmdb.details).toHaveBeenCalledTimes(4);
    await runTmdbDownload({ ...args, force: true });
    expect(tmdb.details).toHaveBeenCalledTimes(6);
  });

  test('fresh metadata whose genres were lost is written again from the saved record, without a request', async () => {
    const { openAppDb } = await import('../../src/db/appDb.js');
    const { runTmdbDownload } = await import('../../src/services/genreBackfill.js');
    const appDb = await openAppDb(`app-${Math.random()}`);
    const db = await openProviderDb(`genres-restore-${Math.random()}`);
    const item = { key: 'movie:1', type: 'movie', id: 1, name: 'Film 1', categoryId: '1', added: 101, tmdbId: 7, ext: 'mkv', genre: '' };
    await writeEntries(db, 'movie', buildEntries('movie', [item]));
    const tmdb = { enabled: true, details: jest.fn(async () => ({ id: 7, title: 'T', genres: [{ id: 1, name: 'Dramma' }] })) };
    const args = { db, appDb, tmdb, language: 'it-IT', now: () => 1000 };
    await runTmdbDownload(args);
    const { dbGetAllKeys, dbDeleteMany } = await import('../../src/core/idb.js');
    await dbDeleteMany(db, 'entry_genre_tmdb', await dbGetAllKeys(db, 'entry_genre_tmdb'));
    expect((await listGenres(db, 'movie')).length).toBe(0);
    await runTmdbDownload(args);
    expect(tmdb.details).toHaveBeenCalledTimes(1);
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['dramma']);
  });
  test('once every title went through TMDB only its genres remain (also for titles without a match); before that the provider\'s are there', async () => {
    const { openAppDb } = await import('../../src/db/appDb.js');
    const { runTmdbDownload, runGenreBackfill } = await import('../../src/services/genreBackfill.js');
    const appDb = await openAppDb(`app-${Math.random()}`);
    const db = await openProviderDb(`genres-only-${Math.random()}`);
    const item = (id, tmdbId) => ({ key: `movie:${id}`, type: 'movie', id, name: `Film ${id}`, categoryId: '1', added: 100 + id, tmdbId, ext: 'mkv', genre: 'Azione', ...{} });
    await writeEntries(db, 'movie', buildEntries('movie', [item(1, 7), item(2, 0)]));
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['azione']); // provider's, before TMDB
    const tmdb = { enabled: true, details: jest.fn(async () => ({ id: 7, title: 'T', genres: [{ id: 1, name: 'Dramma' }] })) };
    await runTmdbDownload({ db, appDb, tmdb, language: 'it-IT', now: () => 1000 });
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['dramma']); // title 2 has no TMDB id: no genre, the provider's are gone
    await writeEntries(db, 'movie', buildEntries('movie', [item(1, 7), item(2, 0)]));
    expect((await listGenres(db, 'movie')).map((g) => g.key)).toEqual(['dramma']);
    expect(await runGenreBackfill({ db, xtream: { getVodInfo: jest.fn(), getSeriesInfo: jest.fn() }, tmdb: null, language: 'it' })).toBe(0);
  });
});
