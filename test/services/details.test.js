import { parseSeriesInfo, parseVodInfo, createDetailsService } from '../../src/services/details.js';
import { openProviderDb } from '../../src/db/providerDb.js';

const seriesData = {
  info: { plot: 'P', genre: 'Drama' },
  episodes: {
    2: [{ id: '22', episode_num: 1, title: 'B1', container_extension: 'mkv', info: { duration_secs: 60 } }],
    1: [{ id: '12', episode_num: 2, title: 'A2' }, { id: '11', episode_num: 1, title: 'A1', container_extension: 'mp4' }],
  },
};

test('series info: seasons and episodes sorted', () => {
  const s = parseSeriesInfo(seriesData);
  expect(s.seasons.map((x) => x.season)).toEqual([1, 2]);
  expect(s.seasons[0].episodes.map((e) => e.id)).toEqual([11, 12]);
  expect(s.episodeCount).toBe(3);
  expect(s.seasons[1].episodes[0]).toMatchObject({ ext: 'mkv', duration: 60 });
});

test('vod info tolerates missing fields', () => {
  expect(parseVodInfo({})).toMatchObject({ plot: '', year: null });
  expect(parseVodInfo({ info: { plot: 'x', releasedate: '1999-03-31' } })).toMatchObject({ plot: 'x', year: 1999 });
});

test('details cache: hits within ttl, refreshes after, stale on failure', async () => {
  const db = await openProviderDb('details-test');
  let t = 1000;
  const client = { getSeriesInfo: jest.fn().mockResolvedValue(seriesData) };
  const svc = createDetailsService({ active: { get: async () => ({ db, client }) }, now: () => t, ttlMs: 100 });
  await svc.series(1);
  await svc.series(1);
  expect(client.getSeriesInfo).toHaveBeenCalledTimes(1);
  t += 200;
  client.getSeriesInfo.mockRejectedValueOnce(new Error('offline'));
  expect((await svc.series(1)).episodeCount).toBe(3);
  expect(client.getSeriesInfo).toHaveBeenCalledTimes(2);
});
