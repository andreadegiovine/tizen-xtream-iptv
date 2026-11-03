import { summarizeWatch, watchStatus } from '../../src/services/watchStatus.js';

const rec = (extra) => ({ providerId: 'p1', entryKey: 'movie:i1', position: 10, watched: false, ...extra });

test('movie: only a finished movie gets the badge', () => {
  const map = summarizeWatch([rec({ watched: true })]);
  expect(watchStatus('movie', map.get('p1:movie:i1'))).toBe('watched');
  expect(watchStatus('movie', summarizeWatch([rec({})]).get('p1:movie:i1'))).toBeNull();
  expect(watchStatus('movie', undefined)).toBeNull();
});

test('series: partial until every known episode is watched', () => {
  const records = [
    rec({ entryKey: 'series:i2', episodeKey: 's1e1', watched: true }),
    rec({ entryKey: 'series:i2', episodeKey: 's1e2', watched: true }),
    rec({ entryKey: 'series:i2', episodeKey: 's1e3', position: 50 }),
  ];
  const summary = summarizeWatch(records).get('p1:series:i2');
  expect(summary.watchedEpisodes).toBe(2);
  expect(watchStatus('series', summary, 5)).toBe('partial');
  expect(watchStatus('series', summary, 2)).toBe('watched');
  expect(watchStatus('series', summary, null)).toBe('partial');
});

test('tmdb entries share history across providers', () => {
  const map = summarizeWatch([rec({ providerId: 'a', entryKey: 'movie:t5', watched: true })]);
  expect(map.has('movie:t5')).toBe(true);
  expect(watchStatus('live', map.get('movie:t5'))).toBeNull();
});

test('a series with only a started episode is partial', () => {
  const map = summarizeWatch([rec({ entryKey: 'series:i9', episodeKey: 's1e1', position: 20 })]);
  expect(watchStatus('series', map.get('p1:series:i9'), 10)).toBe('partial');
});
