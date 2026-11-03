import { buildEntries, buildEntryCategoryRows } from '../../src/services/grouping.js';

const item = (id, name, extra = {}) => ({
  id,
  name,
  categoryId: '1',
  added: 100,
  tmdbId: null,
  rating: null,
  year: null,
  icon: '',
  ext: 'mp4',
  epgChannelId: null,
  ...extra,
});

describe('buildEntries', () => {
  test('groups items with the same tmdb id and preselects the lowest id', () => {
    const entries = buildEntries('movie', [
      item(30, 'IT - Heat (1995) [4K]', { tmdbId: 949, added: 300, categoryId: '2' }),
      item(10, 'Heat', { tmdbId: 949, added: 100, rating: 8.3 }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: 'movie:t949',
      defaultId: 10,
      memberIds: [10, 30],
      added: 300, // max of members
      name: 'Heat',
      year: 1995,
      rating: 8.3,
    });
    expect(entries[0].categoryIds.sort()).toEqual(['1', '2']);
  });

  test('never merges items without tmdb, even with identical names', () => {
    const entries = buildEntries('movie', [item(1, 'Same Name'), item(2, 'Same Name')]);
    expect(entries).toHaveLength(2);
  });

  test('same tmdb id in different media types stays separate', () => {
    const movie = buildEntries('movie', [item(1, 'X', { tmdbId: 5 })]);
    const series = buildEntries('series', [item(1, 'X', { tmdbId: 5 })]);
    expect(movie[0].key).not.toBe(series[0].key);
  });

  test('excluded categories are dropped before grouping', () => {
    const entries = buildEntries(
      'movie',
      [item(1, 'A', { tmdbId: 7, categoryId: '9' }), item(2, 'A 4K', { tmdbId: 7, categoryId: '1' })],
      { excludedCategories: new Set(['9']) },
    );
    expect(entries[0].memberIds).toEqual([2]);
    expect(buildEntries('movie', [item(1, 'A', { categoryId: '9' })], { excludedCategories: new Set(['9']) })).toEqual([]);
  });

  test('sorted by added, newest first', () => {
    const entries = buildEntries('movie', [item(1, 'Old', { added: 1 }), item(2, 'New', { added: 9 })]);
    expect(entries.map((e) => e.name)).toEqual(['New', 'Old']);
  });

  test('live channels keep their raw name', () => {
    const entries = buildEntries('live', [item(1, 'Sky Cinema HD')]);
    expect(entries[0].name).toBe('Sky Cinema HD');
  });
});

describe('buildEntryCategoryRows', () => {
  test('one row per entry/category pair', () => {
    const entries = buildEntries('movie', [
      item(1, 'A', { tmdbId: 1, categoryId: '1' }),
      item(2, 'A', { tmdbId: 1, categoryId: '2' }),
    ]);
    const rows = buildEntryCategoryRows(entries);
    expect(rows.map((r) => r.key).sort()).toEqual(['movie:t1|1', 'movie:t1|2']);
  });

  test('without cleanTitles movie and series titles stay as the provider wrote them', () => {
    const items = [item(1, 'IT - Heat (1995) [4K]', { year: '1995' })];
    const raw = buildEntries('movie', items, { cleanTitles: false })[0];
    expect(raw.name).toBe('IT - Heat (1995) [4K]');
    expect(raw.year).toBe('1995');
    expect(raw.searchKeys).toHaveLength(1);
    expect(buildEntries('movie', items)[0].name).toBe('Heat');
    expect(buildEntries('live', [item(2, 'IT: Rai 1 HD')], { cleanTitles: false })[0].name).toBe(buildEntries('live', [item(2, 'IT: Rai 1 HD')])[0].name);
  });
});
