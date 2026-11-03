import { continueWatching, isSeriesFinished } from '../../src/services/continueWatching.js';

const rec = (key, extra = {}) => ({ key, episodeKey: key.split('|')[1], entryKey: key.split('|')[0], type: key.startsWith('series') ? 'series' : 'movie', providerId: 'p', watched: true, position: 1, duration: 1, updatedAt: 1, ...extra });

describe('isSeriesFinished', () => {
  test('all known episodes watched, or marked by hand until the total grows', () => {
    expect(isSeriesFinished(rec('series:t1|s1e1'), 10, 10)).toBe(true);
    expect(isSeriesFinished(rec('series:t1|s1e1'), 9, 10)).toBe(false);
    expect(isSeriesFinished(rec('series:t1|s1e1'), 5, null)).toBe(false);
    expect(isSeriesFinished(rec('series:t1|s1e1', { seriesDone: 10 }), 8, 10)).toBe(true);
    expect(isSeriesFinished(rec('series:t1|s1e1', { seriesDone: 10 }), 8, null)).toBe(true);
    expect(isSeriesFinished(rec('series:t1|s1e1', { seriesDone: 10 }), 10, 12)).toBe(false); // new episodes
  });
});

describe('continueWatching', () => {
  test('hides finished series, keeps the ones with episodes left', async () => {
    const records = [rec('series:t1|s1e1'), rec('series:t1|s1e2'), rec('series:t2|s1e1'), rec('series:t3|s1e1', { seriesDone: 4 })];
    const ctx = {
      watch: {
        recent: async () => [records[1], records[2], records[3]],
        all: async () => records,
      },
      tmdb: { getMeta: async (type, id) => ({ 1: { episodes: 2 }, 2: { episodes: 5 }, 3: { episodes: 6 } }[id]) },
    };
    const list = await continueWatching(ctx, { providerId: 'p', limit: 10 });
    expect(list.map((r) => r.entryKey)).toEqual(['series:t2', 'series:t3']); // t1 done, t3 got new episodes
  });
});
