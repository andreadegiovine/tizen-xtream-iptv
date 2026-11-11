import { openAppDb } from '../../src/db/appDb.js';
import { dbGet, dbPut } from '../../src/core/idb.js';
import { createTmdbClient, needsLocalTitle, localTitle } from '../../src/services/tmdbClient.js';
import { createTmdbService, metaKey } from '../../src/services/tmdbService.js';

const spirited = { id: 129, title: '千と千尋の神隠し', original_title: '千と千尋の神隠し', original_language: 'ja' };
const titles = {
  ...spirited,
  translations: {
    translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { title: 'Spirited Away' } },
      { iso_639_1: 'it', iso_3166_1: 'IT', data: { title: '' } },
      { iso_639_1: 'fr', iso_3166_1: 'FR', data: { title: 'Le Voyage de Chihiro' } },
    ],
  },
  alternative_titles: { titles: [{ iso_3166_1: 'IT', title: 'La città incantata' }, { iso_3166_1: 'US', title: 'Sen and Chihiro' }] },
};

describe('needsLocalTitle', () => {
  test('only a title left in its original language, different from the asked one', () => {
    expect(needsLocalTitle('movie', spirited, 'it-IT')).toBe(true);
    expect(needsLocalTitle('movie', { ...spirited, title: 'La città incantata' }, 'it-IT')).toBe(false);
    expect(needsLocalTitle('movie', { id: 1, title: 'Heat', original_title: 'Heat', original_language: 'en' }, 'en-US')).toBe(false);
    expect(needsLocalTitle('series', { id: 2, name: '', original_name: '오징어 게임', original_language: 'ko' }, 'it-IT')).toBe(true);
  });
});

describe('localTitle', () => {
  test('the asked language, then the title in its country, then English, then the US / UK one; empty when none', () => {
    expect(localTitle('movie', titles, 'fr-FR')).toBe('Le Voyage de Chihiro');
    expect(localTitle('movie', titles, 'it-IT')).toBe('La città incantata'); // no Italian translation: the title it had in Italy
    expect(localTitle('movie', { ...titles, alternative_titles: { titles: [] } }, 'it-IT')).toBe('Spirited Away');
    expect(localTitle('movie', { ...spirited, alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'Sen and Chihiro' }] } }, 'it-IT')).toBe('Sen and Chihiro');
    expect(localTitle('movie', spirited, 'it-IT')).toBe('');
    expect(localTitle('series', { translations: { translations: [{ iso_639_1: 'it', iso_3166_1: 'IT', data: { name: 'Squid Game' } }] }, alternative_titles: { results: [] } }, 'it-IT')).toBe('Squid Game');
  });
});

describe('client.details', () => {
  const clientWith = (answers) => {
    const urls = [];
    const fetcher = jest.fn(async (url) => {
      urls.push(url);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    });
    return { client: createTmdbClient({ getApiKey: () => '0123456789abcdef0123456789abcdef', fetcher }), urls };
  };

  test('a title only in its original language: one more request for the translations, the readable title replaces it', async () => {
    const { client, urls } = clientWith([spirited, titles]);
    const data = await client.details('movie', 129, 'it-IT', { full: false });
    expect(data.title).toBe('La città incantata');
    expect(data.original_title).toBe('千と千尋の神隠し');
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('append_to_response=translations%2Calternative_titles');
  });

  test('a translated title: one request; the translations failing: empty title (the provider name is shown)', async () => {
    const translated = clientWith([{ ...spirited, title: 'La città incantata' }]);
    expect((await translated.client.details('movie', 129, 'it-IT')).title).toBe('La città incantata');
    expect(translated.urls).toHaveLength(1);
    const failing = clientWith([spirited, new Error('offline')]);
    expect((await failing.client.details('movie', 129, 'it-IT', { full: false })).title).toBe('');
  });
});

test('expireUnreadableTitles: saved titles in another script are marked expired once, the others stay', async () => {
  const db = await openAppDb(`tmdb-titles-${Math.random()}`);
  const future = Date.now() + 1e9;
  await dbPut(db, 'tmdb', { key: metaKey('movie', 129, 'it-IT'), value: { title: '千と千尋の神隠し' }, fetchedAt: 1, expiresAt: future });
  await dbPut(db, 'tmdb', { key: metaKey('movie', 1, 'it-IT'), value: { title: 'Heat' }, fetchedAt: 1, expiresAt: future });
  await dbPut(db, 'tmdb', { key: metaKey('movie', 2, 'it-IT'), value: null, fetchedAt: 1, expiresAt: future });
  const tmdb = createTmdbService({ db, client: { enabled: true }, getLanguage: () => 'it-IT' });
  expect(await tmdb.expireUnreadableTitles()).toBe(1);
  expect((await dbGet(db, 'tmdb', metaKey('movie', 129, 'it-IT'))).expiresAt).toBe(0);
  expect((await dbGet(db, 'tmdb', metaKey('movie', 1, 'it-IT'))).expiresAt).toBe(future);
});
