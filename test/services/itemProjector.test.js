import { projectItem, readTmdbId, readRating, readYear } from '../../src/services/itemProjector.js';

describe('readTmdbId', () => {
  test.each([
    [{ tmdb: '603' }, 603],
    [{ tmdb_id: 603 }, 603],
    [{ tmdb: '0' }, null],
    [{ tmdb: '' }, null],
    [{ tmdb: null }, null],
    [{}, null],
  ])('%j -> %s', (raw, expected) => expect(readTmdbId(raw)).toBe(expected));
});

describe('projectItem', () => {
  test('movie', () => {
    const item = projectItem('movie', {
      stream_id: '15',
      name: ' Heat ',
      category_id: 7,
      added: '1700000000',
      tmdb: '949',
      rating: '8.2',
      stream_icon: 'http://i/p.jpg',
      container_extension: 'mkv',
    });
    expect(item).toMatchObject({
      key: 'movie:15',
      id: 15,
      name: 'Heat',
      categoryId: '7',
      added: 1700000000,
      tmdbId: 949,
      rating: 8.2,
      ext: 'mkv',
    });
  });

  test('series uses series_id and last_modified', () => {
    const item = projectItem('series', { series_id: 9, name: 'Dark', last_modified: '1600000000', releaseDate: '2017-12-01', rating_5based: 4.5 });
    expect(item).toMatchObject({ id: 9, added: 1600000000, year: 2017, rating: 9 });
  });

  test('live has no tmdb, rating or year', () => {
    const item = projectItem('live', { stream_id: 1, name: 'Rai 1', epg_channel_id: 'rai1.it', tmdb: '5' });
    expect(item).toMatchObject({ tmdbId: null, rating: null, year: null, epgChannelId: 'rai1.it' });
  });

  test('drops unusable rows', () => {
    expect(projectItem('movie', null)).toBeNull();
    expect(projectItem('movie', { name: 'x' })).toBeNull();
    expect(projectItem('movie', { stream_id: 1, name: '' })).toBeNull();
  });

  test('rating and year helpers', () => {
    expect(readRating({ rating: '0' })).toBeNull();
    expect(readYear({ release_date: '1999-03-31' })).toBe(1999);
  });
});
