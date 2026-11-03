import { openAppDb } from '../../src/db/appDb.js';
import { WatchStore } from '../../src/services/watchStore.js';
import { createTraktService, createWatchState, historyPayload, flattenWatchedShows } from '../../src/services/traktService.js';
import { kvSet } from '../../src/db/kv.js';

let n = 0;
const appDb = () => openAppDb(`trakt-test-${(n += 1)}`);
const tokenData = { access_token: 'AT', refresh_token: 'RT', created_at: 1000, expires_in: 7776000 };

describe('history payloads', () => {
  test('movie and episode, only for tmdb titles', () => {
    expect(historyPayload({ entryKey: 'movie:t603' }, 'T')).toEqual({ movies: [{ ids: { tmdb: 603 }, watched_at: 'T' }] });
    expect(historyPayload({ entryKey: 'series:t1399', episodeKey: 's2e5' }, 'T')).toEqual({ shows: [{ ids: { tmdb: 1399 }, seasons: [{ number: 2, episodes: [{ number: 5, watched_at: 'T' }] }] }] });
    expect(historyPayload({ entryKey: 'movie:i77' })).toBeNull();
    expect(historyPayload({ entryKey: 'series:t1' })).toBeNull();
  });
});

describe('device login', () => {
  test('polls until approved, slowing down when asked, and stores the token', async () => {
    const db = await appDb();
    const responses = [{ status: 400 }, { status: 429 }, { status: 200, data: tokenData }];
    const waits = [];
    const client = { enabled: true, deviceCode: async () => ({ ok: true, data: { device_code: 'D', user_code: 'ABCD', verification_url: 'https://trakt.tv/activate', interval: 1, expires_in: 600 } }), pollToken: async () => responses.shift() };
    const svc = createTraktService({ db, client, wait: async (ms) => waits.push(ms) });
    const shown = [];
    expect(await svc.connect({ onCode: (c) => shown.push(c) })).toBe(true);
    expect(shown).toEqual([{ code: 'ABCD', url: 'https://trakt.tv/activate' }]);
    expect(waits).toEqual([1000, 1000, 2000]);
    expect(await svc.isConnected()).toBe(true);
    await svc.disconnect();
    expect(await svc.isConnected()).toBe(false);
  });

  test('stops on refusal or cancellation', async () => {
    const db = await appDb();
    const base = { enabled: true, deviceCode: async () => ({ ok: true, data: { device_code: 'D', user_code: 'X', verification_url: 'u', interval: 1, expires_in: 600 } }) };
    expect(await createTraktService({ db, client: { ...base, pollToken: async () => ({ status: 418 }) }, wait: async () => {} }).connect({ onCode() {} })).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(await createTraktService({ db, client: { ...base, pollToken: jest.fn() }, wait: async () => {} }).connect({ onCode() {}, signal: controller.signal })).toBe(false);
  });
});

describe('reporting', () => {
  const connected = async (client, now) => {
    const db = await appDb();
    await kvSet(db, 'trakt.token', { accessToken: 'AT', refreshToken: 'RT', expiresAt: (now || Date.now()) + 90 * 24 * 3600 * 1000 });
    return { db, svc: createTraktService({ db, client }) };
  };

  test('sends finished titles, keeps them queued on server errors', async () => {
    const client = { enabled: true, addHistory: jest.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue({ ok: true, status: 201 }) };
    const { svc } = await connected(client);
    await svc.reportWatched({ entryKey: 'movie:t1' });
    expect(client.addHistory).toHaveBeenCalledTimes(1);
    await svc.flush();
    expect(client.addHistory).toHaveBeenCalledTimes(2); // the queued one went out the second time
    await svc.flush();
    expect(client.addHistory).toHaveBeenCalledTimes(2); // queue is empty now
  });

  test('not connected → nothing is sent', async () => {
    const db = await appDb();
    const client = { enabled: true, addHistory: jest.fn() };
    await createTraktService({ db, client }).reportWatched({ entryKey: 'movie:t1' });
    expect(client.addHistory).not.toHaveBeenCalled();
  });
});

describe('watch-state adapter', () => {
  test('reports only the transition to watched', async () => {
    const store = new WatchStore(await appDb());
    const trakt = { reportWatched: jest.fn().mockResolvedValue() };
    const ws = createWatchState({ store, trakt });
    const rec = { key: 'movie:t1', entryKey: 'movie:t1', type: 'movie', duration: 100 };
    await ws.save({ ...rec, position: 50 });
    await ws.save({ ...rec, position: 95 });
    await ws.save({ ...rec, position: 99 });
    expect(trakt.reportWatched).toHaveBeenCalledTimes(1);
  });

  test('reads wait for a save that is still being written', async () => {
    const store = new WatchStore(await appDb());
    const ws = createWatchState({ store, trakt: null });
    const rec = { key: 'series:t3|s1e1', entryKey: 'series:t3', episodeKey: 's1e1', type: 'series', duration: 100, position: 99 };
    const saving = ws.save(rec); // not awaited, like the player closing
    const seen = await ws.recentForEntry('series:t3');
    expect(seen).toHaveLength(1);
    expect(seen[0].watched).toBe(true);
    await saving;
    expect(await ws.seenKeys()).toEqual(new Set(['series:t3']));
  });

  test('import adds Trakt movies and episodes without overwriting local progress, and can be undone', async () => {
    const store = new WatchStore(await appDb());
    await store.save({ key: 'movie:t2', entryKey: 'movie:t2', type: 'movie', position: 10, duration: 100 });
    await store.save({ key: 'movie:t9', entryKey: 'movie:t9', type: 'movie', position: 50, duration: 100 });
    const trakt = {
      recentMovies: async () => [{ tmdbId: 1, title: 'A', watchedAt: 5 }, { tmdbId: 2, title: 'B', watchedAt: 6 }],
      watchedEpisodes: async () => [{ tmdbId: 7, title: 'S', season: 1, episode: 2, watchedAt: 8 }],
    };
    const state = createWatchState({ store, trakt });
    expect(await state.importFromTrakt()).toBe(2);
    expect((await store.get('movie:t2')).position).toBe(10);
    expect((await store.get('movie:t1')).watched).toBe(true);
    expect((await store.get('series:t7|s1e2')).watched).toBe(true);
    expect(await state.removeTraktData()).toBe(2);
    expect(await store.get('movie:t1')).toBeUndefined();
    expect((await store.get('movie:t9')).position).toBe(50); // local history stays
  });

  test('watched shows payload becomes a flat, capped episode list', () => {
    const data = [
      { last_watched_at: '2024-01-02T00:00:00Z', show: { title: 'A', ids: { tmdb: 1 } }, seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }] },
      { last_watched_at: '2024-02-01T00:00:00Z', show: { title: 'B', ids: { tmdb: 2 } }, seasons: [{ number: 3, episodes: [{ number: 4 }] }] },
      { show: { title: 'no id', ids: {} }, seasons: [] },
    ];
    const flat = flattenWatchedShows(data, 10);
    expect(flat.map((e) => `${e.tmdbId}:s${e.season}e${e.episode}`)).toEqual(['2:s3e4', '1:s1e1', '1:s1e2']);
    expect(flattenWatchedShows(data, 2).length).toBe(2);
  });

});

test('the connected account name is looked up once and forgotten on disconnect', async () => {
  const { openAppDb } = await import('../../src/db/appDb.js');
  const { createTraktService } = await import('../../src/services/traktService.js');
  const { kvSet } = await import('../../src/db/kv.js');
  const db = await openAppDb('trakt-account-test');
  await kvSet(db, 'trakt.token', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 90 * 24 * 3600 * 1000 });
  const profile = jest.fn(async () => ({ ok: true, status: 200, data: { user: { username: 'andrea' } } }));
  const service = createTraktService({ db, client: { enabled: true, profile } });
  expect(await service.account()).toBe('andrea');
  expect(await service.account()).toBe('andrea');
  expect(profile).toHaveBeenCalledTimes(1);
  await service.disconnect();
  expect(await service.account()).toBe('');
});
