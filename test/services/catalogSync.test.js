import { openProviderDb, deleteProviderDb } from '../../src/db/providerDb.js';
import { dbGetAll, dbGet, dbPutMany } from '../../src/core/idb.js';
import {
  syncType,
  runSync,
  runSyncForProvider,
  rebuildEntries,
  shouldSync,
  getSyncStatus,
  LIST_TTL_MS,
} from '../../src/services/catalogSync.js';
import { ErrorCode } from '../../src/core/errors.js';

let counter = 0;
const newDb = async () => openProviderDb(`sync-test-${(counter += 1)}`);

const movie = (id, name, extra = {}) => ({ stream_id: id, name, category_id: '1', added: String(1000 + id), ...extra });
const makeClient = (lists, categories = [{ category_id: '1', category_name: 'Action' }]) => ({
  authenticate: jest.fn().mockResolvedValue({}),
  getCategories: jest.fn(async () => categories),
  getStreams: jest.fn(async (type) => (lists[type] || []).map((row) => ({ ...row }))),
});

describe('syncType', () => {
  test('stores items, grouped entries, per-category rows, categories and meta', async () => {
    const db = await newDb();
    const client = makeClient({
      movie: [
        movie(30, 'IT - Heat (1995) [4K]', { tmdb: '949', category_id: '2' }),
        movie(10, 'Heat', { tmdb: '949' }),
        movie(20, 'Unknown Film'),
        { name: 'broken row' },
      ],
    });
    const events = [];
    const meta = await syncType({ db, client, type: 'movie', emit: (e) => events.push(e.phase) });

    expect(meta).toMatchObject({ itemCount: 3, entryCount: 2, categoryCount: 1 });
    const entries = await dbGetAll(db, 'entries');
    const heat = entries.find((e) => e.tmdbId === 949);
    expect(heat).toMatchObject({ defaultId: 10, memberIds: [10, 30], name: 'Heat' });
    expect((await dbGetAll(db, 'entry_cat')).map((r) => r.key).sort()).toEqual([
      'movie:i20|1',
      'movie:t949|1',
      'movie:t949|2',
    ]);
    expect(await dbGet(db, 'categories', 'movie:1')).toMatchObject({ name: 'Action' });
    expect(await dbGet(db, 'meta', 'sync:movie')).toMatchObject({ itemCount: 3 });
    expect(events).toEqual(expect.arrayContaining(['categories', 'download', 'write', 'entries', 'done']));
    db.close();
    await deleteProviderDb('sync-test-1');
  });

  test('a second sync deletes rows that disappeared and keeps the other types untouched', async () => {
    const db = await newDb();
    const lists = { movie: [movie(1, 'A'), movie(2, 'B')], series: [{ series_id: 5, name: 'S', category_id: '1', last_modified: '9' }] };
    const client = makeClient(lists);
    await syncType({ db, client, type: 'movie' });
    await syncType({ db, client, type: 'series' });

    lists.movie = [movie(2, 'B')];
    await syncType({ db, client, type: 'movie' });

    expect((await dbGetAll(db, 'items')).map((i) => i.key).sort()).toEqual(['movie:2', 'series:5']);
    expect((await dbGetAll(db, 'entries')).map((i) => i.key).sort()).toEqual(['movie:i2', 'series:i5']);
    expect((await dbGetAll(db, 'entry_cat')).map((i) => i.key).sort()).toEqual(['movie:i2|1', 'series:i5|1']);
    db.close();
  });

  test('excluded categories are applied to entries but items are still stored', async () => {
    const db = await newDb();
    const client = makeClient({ movie: [movie(1, 'A', { category_id: '9' }), movie(2, 'B')] });
    await syncType({ db, client, type: 'movie', excludedCategories: new Set(['9']) });
    expect(await dbGetAll(db, 'items')).toHaveLength(2);
    expect((await dbGetAll(db, 'entries')).map((e) => e.name)).toEqual(['B']);
    db.close();
  });

  test('an empty answer never wipes an existing catalog', async () => {
    const db = await newDb();
    const lists = { movie: [movie(1, 'A')] };
    const client = makeClient(lists);
    await syncType({ db, client, type: 'movie' });
    lists.movie = [];
    await expect(syncType({ db, client, type: 'movie' })).rejects.toMatchObject({ code: ErrorCode.BAD_RESPONSE });
    expect(await dbGetAll(db, 'items')).toHaveLength(1);
    expect(await dbGetAll(db, 'entries')).toHaveLength(1);
    db.close();
  });

  test('cancellation stops between batches', async () => {
    const db = await newDb();
    const many = Array.from({ length: 4500 }, (_, i) => movie(i + 1, `Movie ${i + 1}`));
    const controller = new AbortController();
    const emit = (e) => {
      if (e.phase === 'write' && e.done >= 2000) controller.abort();
    };
    await expect(
      syncType({ db, client: makeClient({ movie: many }), type: 'movie', signal: controller.signal, emit }),
    ).rejects.toMatchObject({ code: ErrorCode.ABORTED });
    expect(await dbGet(db, 'meta', 'sync:movie')).toBeUndefined();
    db.close();
  });

  test('the gate is awaited between batches (pausing)', async () => {
    const db = await newDb();
    const many = Array.from({ length: 4100 }, (_, i) => movie(i + 1, `Movie ${i + 1}`));
    const gate = jest.fn(() => Promise.resolve());
    await syncType({ db, client: makeClient({ movie: many }), type: 'movie', gate });
    expect(gate.mock.calls.length).toBeGreaterThanOrEqual(4); // before download + 3 batches
    db.close();
  });
});

describe('runSync / runSyncForProvider', () => {
  test('skips fresh types, syncs stale or forced ones', async () => {
    const db = await newDb();
    const client = makeClient({ movie: [movie(1, 'A')], series: [], live: [] });
    let t = 1_000_000;
    const now = () => t;
    await runSync({ db, client, types: ['movie'], now });
    const events = [];
    const results = await runSync({ db, client, types: ['movie'], now: () => t + 1000, emit: (e) => events.push(e.phase) });
    expect(results[0].skipped).toBe(true);
    expect(events).toEqual(['skipped']);

    const forced = await runSync({ db, client, types: ['movie'], force: true, now: () => t + 2000 });
    expect(forced[0].meta).toBeTruthy();
    t += LIST_TTL_MS + 10_000; // well past the last sync (t0 + 2000)
    expect((await runSync({ db, client, types: ['movie'], now: () => t }))[0].meta).toBeTruthy();
    db.close();
  });

  test('shouldSync honours the 12 h TTL', () => {
    expect(shouldSync(null)).toBe(true);
    expect(shouldSync({ lastSync: 1000 }, 1000 + LIST_TTL_MS - 1)).toBe(false);
    expect(shouldSync({ lastSync: 1000 }, 1000 + LIST_TTL_MS + 1)).toBe(true);
  });

  test('one failing type does not stop the next, but a blocking error does', async () => {
    const db = await newDb();
    const client = makeClient({ series: [{ series_id: 1, name: 'S', category_id: '1' }] });
    client.getStreams.mockImplementationOnce(async () => {
      throw Object.assign(new Error('boom'), { code: 'NETWORK' });
    });
    const results = await runSync({ db, client, types: ['movie', 'series'], force: true });
    expect(results.map((r) => r.error || 'ok')).toEqual(['UNKNOWN', 'ok']);

    const blocking = makeClient({});
    const { AppError } = await import('../../src/core/errors.js');
    blocking.getStreams.mockRejectedValue(new AppError(ErrorCode.AUTH_FAILED, 'no'));
    const stopped = await runSync({ db, client: blocking, types: ['movie', 'series'], force: true });
    expect(stopped).toHaveLength(1);
    db.close();
  });

  test('runSyncForProvider always ends with a done event and closes the database', async () => {
    const events = [];
    const outcome = await runSyncForProvider({
      provider: { id: 'sync-test-fp' },
      types: ['movie'],
      excluded: {},
      force: true,
      emit: (e) => events.push(e),
      makeClient: () => makeClient({ movie: [movie(1, 'A')] }),
    });
    expect(outcome.results[0].meta.itemCount).toBe(1);
    expect(events[events.length - 1].event).toBe('done');
    const db = await openProviderDb('sync-test-fp');
    expect((await getSyncStatus(db)).movie.itemCount).toBe(1);
    db.close();
  });

  test('authentication failures are reported, not thrown', async () => {
    const { AppError } = await import('../../src/core/errors.js');
    const events = [];
    const outcome = await runSyncForProvider({
      provider: { id: 'sync-test-auth' },
      types: ['movie'],
      excluded: {},
      emit: (e) => events.push(e),
      makeClient: () => ({ authenticate: () => Promise.reject(new AppError(ErrorCode.ACCOUNT_EXPIRED, 'expired')) }),
    });
    expect(outcome.error).toMatchObject({ code: ErrorCode.ACCOUNT_EXPIRED });
    expect(events[events.length - 1].event).toBe('done');
  });
});

describe('rebuildEntries', () => {
  test('applies new exclusions from the stored items, without downloading anything', async () => {
    const db = await newDb();
    const client = makeClient({ movie: [movie(1, 'A', { category_id: '9' }), movie(2, 'B')] });
    await syncType({ db, client, type: 'movie' });
    expect(await dbGetAll(db, 'entries')).toHaveLength(2);

    expect(await rebuildEntries({ db, type: 'movie', excludedCategories: new Set(['9']) })).toBe(1);
    expect((await dbGetAll(db, 'entries')).map((e) => e.name)).toEqual(['B']);
    expect((await dbGetAll(db, 'entry_cat')).map((r) => r.key)).toEqual(['movie:i2|1']);
    expect(await dbGetAll(db, 'items')).toHaveLength(2);
    expect((await dbGet(db, 'meta', 'sync:movie')).entryCount).toBe(1);
    db.close();
    client.getStreams.mockClear();
    expect(client.getStreams).not.toHaveBeenCalled();
  });
});

describe('idb helpers used by the sync', () => {
  test('dbPutMany reports progress after every batch', async () => {
    const db = await newDb();
    const calls = [];
    await dbPutMany(db, 'meta', Array.from({ length: 25 }, (_, i) => ({ key: `k${i}` })), 10, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([[10, 25], [20, 25], [25, 25]]);
    db.close();
  });
});
