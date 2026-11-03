import { detailMetaParts, formatRuntime, castFrom, seasonOptionLabel, seasonIndexOf, seasonsLabel, episodesLabel } from '../../src/ui/pages/detailPage.js';

test('runtime formatting', () => {
  expect(formatRuntime(112)).toBe('1h 52m');
  expect(formatRuntime(120)).toBe('2h 00m');
  expect(formatRuntime(45)).toBe('45 min');
  expect(formatRuntime(0)).toBe('');
});

test('meta line: movie shows year, rating, duration', () => {
  const parts = detailMetaParts({ type: 'movie', year: 1999, rating: 8.4, runtime: 136 });
  expect(parts.map((p) => p.text)).toEqual(['1999', '8.4', '2h 16m']);
  expect(parts[1].kind).toBe('rating');
});

test('meta line: series shows year, rating, seasons, episodes (singular/plural)', () => {
  expect(detailMetaParts({ type: 'series', year: 2016, rating: 8.7, seasons: 4, episodes: 34 }).map((p) => p.text)).toEqual(['2016', '8.7', '4 seasons', '34 episodes']);
  expect(seasonsLabel(1)).toBe('1 season');
  expect(episodesLabel(1)).toBe('1 episode');
});

test('meta line skips what is missing; live shows nothing extra', () => {
  expect(detailMetaParts({ type: 'movie', year: null, rating: 0, runtime: null })).toEqual([]);
  expect(detailMetaParts({ type: 'live', year: 2020, rating: 5, runtime: 90 }).map((p) => p.text)).toEqual(['2020', '5.0']);
});

test('cast: TMDB credits win, otherwise the provider string', () => {
  expect(castFrom({ castList: [{ name: 'A', character: 'x', photo: 'p' }] }, { cast: 'B, C' })[0].name).toBe('A');
  expect(castFrom(null, { cast: 'B, C; D' }).map((c) => c.name)).toEqual(['B', 'C', 'D']);
  expect(castFrom(null, null)).toEqual([]);
});

test('season option label and initial season', () => {
  const seasons = [
    { season: 1, episodes: new Array(10).fill({}) },
    { season: 2, episodes: new Array(1).fill({}) },
  ];
  expect(seasonOptionLabel(seasons[0])).toBe('Season 1 (10 episodes)');
  expect(seasonOptionLabel(seasons[1])).toBe('Season 2 (1 episode)');
  expect(seasonIndexOf(seasons, { season: 2 })).toBe(1);
  expect(seasonIndexOf(seasons, null)).toBe(0);
});
