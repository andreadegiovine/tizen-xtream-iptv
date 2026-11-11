import { normalizeTitle, makeSearchKey, normalizeChannelName, versionTags } from '../../src/services/titleNormalizer.js';

describe('normalizeTitle', () => {
  test('strips language prefix, year and quality tag', () => {
    const r = normalizeTitle('IT - Inception (2010) [4K]');
    expect(r.cleanTitle).toBe('Inception');
    expect(r.year).toBe(2010);
    expect(r.tags).toEqual(expect.arrayContaining(['it', '4k']));
  });

  test('handles |IT| prefix and trailing quality token', () => {
    expect(normalizeTitle('|IT| The Matrix FHD').cleanTitle).toBe('The Matrix');
    expect(normalizeTitle('[IT] Il Padrino (1972)')).toMatchObject({ cleanTitle: 'Il Padrino', year: 1972 });
  });

  test('removes bracketed sub/lang groups but keeps meaningful parentheses', () => {
    expect(normalizeTitle('Dune - Parte Due (2024) [SUB ITA]').cleanTitle).toBe('Dune - Parte Due');
    expect(normalizeTitle("Alien (Director's Cut)").cleanTitle).toBe("Alien (Director's Cut)");
  });

  test('never treats a bare number as a year', () => {
    expect(normalizeTitle('Blade Runner 2049')).toMatchObject({ cleanTitle: 'Blade Runner 2049', year: null });
    expect(normalizeTitle('2012').cleanTitle).toBe('2012');
  });

  test('does not mistake a normal word before a dash for a language code', () => {
    expect(normalizeTitle('Dune - Parte Due').cleanTitle).toBe('Dune - Parte Due');
    expect(normalizeTitle('Up - Alto').cleanTitle).toBe('Up - Alto');
  });

  test('single-word titles survive and empty input falls back to the raw text', () => {
    expect(normalizeTitle('UP').cleanTitle).toBe('UP');
    expect(normalizeTitle('IT - ').cleanTitle).toBeTruthy();
  });
});

describe('search keys', () => {
  test('removes accents, case and punctuation', () => {
    expect(makeSearchKey('Amélie  (Le Fabuleux Destin!)')).toBe('amelie le fabuleux destin');
  });

  test('channels keep their full name', () => {
    expect(normalizeChannelName('Sky Cinema HD').cleanTitle).toBe('Sky Cinema HD');
  });
});

describe('versionTags', () => {
  test.each([
    ['Matrix (1999) [FHD] [ITA]', ['FHD', 'ITA']],
    ['IT - Matrix 1080p HEVC', ['IT', '1080P', 'HEVC']],
    ['|IT| Matrix CAM', ['IT', 'CAM']],
    ['Spider-Man: No Way Home (2021) [HD ENG]', ['HD', 'ENG']],
    ['Matrix', []],
    ['Blade Runner 2049', []],
    ['Heat (Director\'s Cut)', []],
  ])('%s', (name, tags) => {
    expect(versionTags(name)).toEqual(tags);
  });
});
