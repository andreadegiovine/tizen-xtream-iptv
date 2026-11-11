import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbGet, dbGetAllRange } from '../../src/core/idb.js';
import { runSync, retryPolicy, rebuildEntries } from '../../src/services/catalogSync.js';
import { readInfo, enrichItem, enrichType, RECHECK_MS } from '../../src/services/catalogEnrich.js';
import { runTitleInfoForProvider, readTitleInfo } from '../../src/services/titleInfo.js';

/** The title details worker's run on the provider database of the test. */
const details = (db, client, extra = {}) => runTitleInfoForProvider({ provider: { id: db.name.replace(/^provider_/, '') }, makeClient: () => client, ...extra });

retryPolicy.delays = [];
let counter = 0;
const newDb = async () => openProviderDb(`enrich-test-${(counter += 1)}`);
const movie = (id, name, extra = {}) => ({ stream_id: id, name, category_id: '1', added: String(1000 + id), ...extra });
const items = (db, type = 'movie') => dbGetAllRange(db, 'items', IDBKeyRange.bound(`${type}:`, `${type}:￿`));
const entries = (db, type = 'movie') => dbGetAllRange(db, 'entries', IDBKeyRange.bound(`${type}:`, `${type}:￿`));

function makeClient(list, infos = {}) {
  return {
    authenticate: jest.fn().mockResolvedValue({}),
    getCategories: jest.fn(async () => [{ category_id: '1', category_name: 'Action' }]),
    getStreams: jest.fn(async (type) => (type === 'movie' ? list.map((row) => ({ ...row })) : [])),
    getVodInfo: jest.fn(async (id) => {
      const answer = infos[id];
      if (answer instanceof Error) throw answer;
      return answer || { info: {} };
    }),
    getSeriesInfo: jest.fn(async () => ({ info: {} })),
  };
}

describe('readInfo / enrichItem', () => {
  test('the details give the TMDB id (either field), year, rating, poster and genre', () => {
    expect(readInfo({ info: { tmdb_id: '603', releasedate: '1999-03-31', rating: '8.7', movie_image: 'http://p/m.jpg', genre: 'Sci-Fi' } })).toEqual({ tmdbId: 603, year: 1999, rating: 8.7, icon: 'http://p/m.jpg', genre: 'Sci-Fi' });
    expect(readInfo({ info: { tmdb: '1396', cover: 'http://p/c.jpg' } })).toMatchObject({ tmdbId: 1396, icon: 'http://p/c.jpg' });
    expect(readInfo({ info: { tmdb_id: '0' } }).tmdbId).toBeNull();
  });

  test('the list wins; a searched id counts only while the search is on; only the missing fields are filled', () => {
    const fromList = { key: 'movie:1', id: 1, tmdbId: 5, year: 2001 };
    expect(enrichItem(fromList, { tmdbId: 9, source: 'info' })).toBe(fromList);
    const bare = { key: 'movie:2', id: 2, tmdbId: null, year: 2010, icon: '' };
    expect(enrichItem(bare, { tmdbId: 9, source: 'info', year: 1999, icon: 'p.jpg' })).toEqual({ key: 'movie:2', id: 2, tmdbId: 9, tmdbFrom: 'info', year: 2010, icon: 'p.jpg' });
    const searched = enrichItem(bare, { tmdbId: 7, source: 'search' }, { titleSearch: true });
    expect(searched).toMatchObject({ tmdbId: 7, tmdbFrom: 'search' });
    expect(enrichItem(searched, { tmdbId: 7, source: 'search' }, { titleSearch: false })).toMatchObject({ tmdbId: null });
    expect(enrichItem(bare, null)).toBe(bare);
  });
});

test('the scan reads the details of the titles listed without a TMDB id, keeps them and groups the versions', async () => {
  const db = await newDb();
  const list = [movie(1, 'Matrix (1999) [FHD]'), movie(2, 'Matrix (1999) [IT]'), movie(3, 'Heat', { tmdb: '949' }), movie(4, 'Unknown')];
  const client = makeClient(list, { 1: { info: { tmdb_id: '603' } }, 2: { info: { tmdb: '603', rating: '8' } } });
  await runSync({ db, client, types: ['movie'] });
  expect(client.getVodInfo).not.toHaveBeenCalled(); // the scan itself asks nothing: the title details run in their own worker
  const outcome = await details(db, client);
  expect(outcome.byType.movie).toMatchObject({ asked: 3, found: 2 });
  expect((await readTitleInfo(db.name.replace(/^provider_/, ''))).movie).toMatchObject({ asked: 3, found: 2 });
  expect(client.getVodInfo.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2, 4]); // not the one the list has an id for
  const stored = await items(db);
  expect(stored.find((i) => i.id === 1)).toMatchObject({ tmdbId: 603, tmdbFrom: 'info' });
  expect(stored.find((i) => i.id === 2)).toMatchObject({ tmdbId: 603, rating: 8 });
  expect((await entries(db)).find((e) => e.key === 'movie:t603').memberIds.sort()).toEqual([1, 2]);
  expect(await dbGet(db, 'enrich', 'movie:4')).toMatchObject({ tmdbId: null, source: null });

  // The next scan (the list downloaded again): nothing asked again, the ids applied before writing (no change).
  client.getVodInfo.mockClear();
  const again = await runSync({ db, client, types: ['movie'], force: true });
  await details(db, client);
  expect(client.getVodInfo).not.toHaveBeenCalled();
  expect(again[0].meta.changes).toBe(0);
  expect((await items(db)).find((i) => i.id === 1).tmdbId).toBe(603);

  // A month later the title without an id is asked again.
  client.getVodInfo.mockClear();
  await details(db, client, { now: () => Date.now() + RECHECK_MS + 1000 });
  expect(client.getVodInfo.mock.calls.map((c) => c[0])).toEqual([4]);

  // Forgotten: the ids the details gave go, nothing is asked.
  client.getVodInfo.mockClear();
  await details(db, client, { mode: 'forget' });
  expect(client.getVodInfo).not.toHaveBeenCalled();
  expect((await items(db)).find((i) => i.id === 1).tmdbId).toBeNull();
  expect((await items(db)).find((i) => i.id === 3).tmdbId).toBe(949); // the list's own
  db.close();
});

test('failures in a row stop the details for this scan; a playlist (no details) is not asked', async () => {
  const db = await newDb();
  const list = Array.from({ length: 12 }, (_, i) => movie(i + 1, `T${i + 1}`));
  const infos = Object.fromEntries(list.map((row) => [row.stream_id, new Error('429')]));
  const client = makeClient(list, infos);
  const messages = [];
  await runSync({ db, client, types: ['movie'] });
  await details(db, client, { emit: (e) => e.event === 'info' && messages.push(e.message) });
  expect(client.getVodInfo.mock.calls.length).toBeLessThan(12);
  expect(messages.some((m) => /stopped after/.test(m))).toBe(true);
  expect(await dbGet(db, 'enrich', 'movie:12')).toBeUndefined(); // asked again next time

  const playlist = { ...makeClient(list), detailsInLists: true };
  const other = await newDb();
  await runSync({ db: other, client: playlist, types: ['movie'] });
  await details(other, playlist);
  expect(playlist.getVodInfo).not.toHaveBeenCalled();
  db.close();
  other.close();
});

test('title search: only for titles the details have no id for, conservative, undone when switched off', async () => {
  const db = await newDb();
  const list = [movie(1, 'IT - Heat (1995)'), movie(2, 'Same Name')];
  const client = makeClient(list);
  await runSync({ db, client, types: ['movie'] });
  const search = jest.fn(async (type, title) =>
    title === 'Heat'
      ? { results: [{ id: 949, title: 'Heat', original_title: 'Heat', release_date: '1995-12-15' }, { id: 1, title: 'Heat', release_date: '1986-01-01' }] }
      : { results: [{ id: 10, title: 'Same Name', release_date: '2000-01-01' }, { id: 11, title: 'Same Name', release_date: '2003-01-01' }] },
  );
  const rebuild = () => rebuildEntries({ db, type: 'movie' });
  const counts = await enrichType({ db, client, type: 'movie', search: { tmdbKey: 'k', language: 'it-IT' }, rebuild, makeTmdb: () => ({ search }) });
  expect(counts).toMatchObject({ asked: 2, searched: 2, matched: 1 });
  expect(search).toHaveBeenCalledWith('movie', 'Heat', 1995, 'it-IT');
  expect((await items(db)).find((i) => i.id === 1)).toMatchObject({ tmdbId: 949, tmdbFrom: 'search' });
  expect((await items(db)).find((i) => i.id === 2).tmdbId).toBeNull(); // two candidates: no guess
  expect((await entries(db)).some((e) => e.key === 'movie:t949')).toBe(true);

  // Searched once: not again; switched off: the searched id goes, the record stays for when it is on again.
  search.mockClear();
  await enrichType({ db, client, type: 'movie', search: { tmdbKey: 'k', language: 'it-IT' }, rebuild, makeTmdb: () => ({ search }) });
  expect(search).not.toHaveBeenCalled();
  await enrichType({ db, client, type: 'movie', search: null, rebuild });
  expect((await items(db)).find((i) => i.id === 1).tmdbId).toBeNull();
  expect((await entries(db)).some((e) => e.key === 'movie:t949')).toBe(false);
  db.close();
});

test('title search again: nothing found and a month gone by, or the title in the list changed (found or not)', async () => {
  const db = await newDb();
  let list = [movie(1, 'Rare Film (2004)'), movie(2, 'Old Name (2010)')];
  const client = {
    ...makeClient([]),
    getStreams: jest.fn(async (type) => (type === 'movie' ? list.map((row) => ({ ...row })) : [])),
  };
  await runSync({ db, client, types: ['movie'] });
  const known = { 'Old Name': [{ id: 50, title: 'Old Name', release_date: '2010-01-01' }], 'New Name': [{ id: 60, title: 'New Name', release_date: '2010-01-01' }] };
  const search = jest.fn(async (type, title) => ({ results: known[title] || [] }));
  const rebuild = () => rebuildEntries({ db, type: 'movie' });
  const opts = { db, client, type: 'movie', search: { tmdbKey: 'k', language: 'it-IT' }, rebuild, makeTmdb: () => ({ search }) };
  await enrichType(opts);
  expect(search.mock.calls.map((c) => c[1]).sort()).toEqual(['Old Name', 'Rare Film']);
  expect((await items(db)).find((i) => i.id === 2).tmdbId).toBe(50);

  // Nothing changed: no search. A month later: only the one never found.
  search.mockClear();
  await enrichType(opts);
  expect(search).not.toHaveBeenCalled();
  await enrichType({ ...opts, now: () => Date.now() + RECHECK_MS + 1000 });
  expect(search.mock.calls.map((c) => c[1])).toEqual(['Rare Film']);

  // The provider renames a title: searched again at once, the new answer replaces the old one.
  search.mockClear();
  list = [movie(1, 'Rare Film (2004)'), movie(2, 'New Name (2010)')];
  await runSync({ db, client, types: ['movie'], force: true });
  await enrichType(opts);
  expect(search.mock.calls.map((c) => c[1])).toEqual(['New Name']);
  expect((await items(db)).find((i) => i.id === 2)).toMatchObject({ tmdbId: 60, tmdbFrom: 'search' });
  db.close();
});

test('createTitleInfo: one run at a time (another asked meanwhile runs after), listed as the "info" operation, titles changed reported', async () => {
  const { createTitleInfo } = await import('../../src/services/titleInfo.js');
  const { createOperations } = await import('../../src/services/operations.js');
  const db = await newDb();
  const id = db.name.replace(/^provider_/, '');
  const client = makeClient([movie(1, 'Matrix'), movie(2, 'Heat')], { 1: { info: { tmdb_id: '603' } } });
  await runSync({ db, client, types: ['movie'] });
  db.close();
  const operations = createOperations();
  const seen = [];
  operations.onChange(() => seen.push(operations.list().map((op) => op.id).join(',')));
  const tracked = [];
  const syncLog = { track: async (name, job, options) => { tracked.push(name); const end = operations.start(name, { cancel: options.cancel }); try { return await job(); } finally { end(); } } };
  const onChanged = jest.fn();
  const service = createTitleInfo({
    active: { get: async () => ({ provider: { id, type: 'xtream' } }) },
    settings: { getExcluded: async () => new Set() },
    syncLog,
    onChanged,
  });
  jest.spyOn(await import('../../src/services/providerTypes.js'), 'createProviderClient').mockReturnValue(client);
  const first = service.run();
  service.run(); // asked while running: once more afterwards
  await first;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(tracked).toEqual(['info', 'info']);
  expect(seen).toContain('info');
  expect(onChanged).toHaveBeenCalledTimes(1); // the second run changed nothing
  expect(client.getVodInfo).toHaveBeenCalledTimes(2); // each title once
});
