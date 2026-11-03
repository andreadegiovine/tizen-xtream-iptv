import { openAppDb } from '../../src/db/appDb.js';
import { WatchStore, watchKey, isWatched, shouldResume } from '../../src/services/watchStore.js';

let n = 0;
const newStore = async () => new WatchStore(await openAppDb(`watch-test-${(n += 1)}`));

describe('watch rules', () => {
  test('watched at 90 %, resume only when in the middle', () => {
    expect(isWatched(90, 100)).toBe(true);
    expect(isWatched(89, 100)).toBe(false);
    expect(isWatched(10, 0)).toBe(false);
    expect(shouldResume(10, 1000)).toBe(false);
    expect(shouldResume(300, 1000)).toBe(true);
    expect(shouldResume(950, 1000)).toBe(false);
  });
  test('keys: tmdb shared across providers, others tied to the provider, episodes appended', () => {
    expect(watchKey('pA', 'movie:t5')).toBe('movie:t5');
    expect(watchKey('pA', 'movie:i77')).toBe('pA:movie:i77');
    expect(watchKey('pA', 'series:t9', 's1e2')).toBe('series:t9|s1e2');
  });
});

describe('WatchStore', () => {
  test('saves with watched flag and lists recent, one row per title', async () => {
    const store = await newStore();
    await store.save({ key: 'movie:t1', entryKey: 'movie:t1', type: 'movie', providerId: 'p', position: 100, duration: 1000 }, 1);
    await store.save({ key: 'movie:t2', entryKey: 'movie:t2', type: 'movie', providerId: 'p', position: 995, duration: 1000 }, 2);
    await store.save({ key: 'series:t3|s1e1', entryKey: 'series:t3', type: 'series', providerId: 'p', position: 50, duration: 100 }, 3);
    await store.save({ key: 'series:t3|s1e2', entryKey: 'series:t3', type: 'series', providerId: 'p', position: 10, duration: 100 }, 4);
    const recent = await store.recent();
    expect(recent.map((r) => r.key)).toEqual(['series:t3|s1e2', 'movie:t1']); // finished movie is hidden
    expect((await store.get('movie:t2')).watched).toBe(true);
  });
  test('seeds are distinct tmdb titles, newest first', async () => {
    const store = await newStore();
    await store.save({ key: 'movie:t1', entryKey: 'movie:t1', type: 'movie', position: 1, duration: 10 }, 1);
    await store.save({ key: 'p:movie:i2', entryKey: 'movie:i2', type: 'movie', position: 1, duration: 10 }, 2);
    await store.save({ key: 'series:t3|s1e1', entryKey: 'series:t3', type: 'series', position: 1, duration: 10 }, 3);
    expect(await store.seeds()).toEqual([{ type: 'series', tmdbId: 3 }, { type: 'movie', tmdbId: 1 }]);
  });
});

describe('clearEntry', () => {
  test('forgets a title and all its episodes, nothing else', async () => {
    const store = await newStore();
    const rec = (key, entryKey, episodeKey) => ({ key, entryKey, episodeKey, type: 'series', providerId: 'p', position: 1, duration: 1 });
    await store.save(rec('p:series:i1|s1e1', 'series:i1', 's1e1'));
    await store.save(rec('p:series:i1|s1e2', 'series:i1', 's1e2'));
    await store.save(rec('p:series:i10|s1e1', 'series:i10', 's1e1'));
    expect(await store.clearEntry('p', 'series:i1')).toBe(2);
    expect((await store.all()).map((r) => r.key)).toEqual(['p:series:i10|s1e1']);
  });
});
