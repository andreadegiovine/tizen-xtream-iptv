import { openAppDb } from '../../src/db/appDb.js';
import { createApiKeys } from '../../src/services/apiKeys.js';
import { scrubTarget, positionFromPointer } from '../../src/services/playerController.js';

let n = 0;
const db = () => openAppDb(`apikeys-test-${(n += 1)}`);

describe('api keys', () => {
  test('keys come only from the settings: empty at first, trimmed, persisted, clearable', async () => {
    const d = await db();
    const keys = createApiKeys({ db: d });
    expect((await keys.load()).tmdbKey).toBe('');
    await keys.set({ tmdbKey: '  mine ', traktId: 'id' });
    expect(keys.get()).toMatchObject({ tmdbKey: 'mine', traktId: 'id', traktSecret: '' });
    const again = createApiKeys({ db: d });
    expect((await again.load()).tmdbKey).toBe('mine');
    await again.set({ tmdbKey: '' });
    expect(again.get().tmdbKey).toBe('');
  });
});

describe('progress bar helpers', () => {
  test('scrub is clamped to the stream', () => {
    expect(scrubTarget(10, -30, 100)).toBe(0);
    expect(scrubTarget(90, 30, 100)).toBe(100);
    expect(scrubTarget(50, 30, 100)).toBe(80);
  });
  test('pointer maps to a position', () => {
    expect(positionFromPointer(150, 100, 200, 1000)).toBe(250);
    expect(positionFromPointer(0, 100, 200, 1000)).toBe(0);
    expect(positionFromPointer(999, 100, 200, 1000)).toBe(1000);
    expect(positionFromPointer(150, 100, 0, 1000)).toBe(0);
  });
});

describe('tmdb credentials', () => {
  const { createTmdbClient, isBearerToken } = require('../../src/services/tmdbClient.js');
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.signature';
  test('a read access token goes in the Authorization header, a v3 key in the query', async () => {
    expect(isBearerToken(JWT)).toBe(true);
    expect(isBearerToken('0123456789abcdef0123456789abcdef')).toBe(false);
    const calls = [];
    const fetcher = async (url, options) => calls.push({ url, options });
    await createTmdbClient({ getApiKey: () => JWT, fetcher }).details('movie', 5, 'en-US');
    await createTmdbClient({ getApiKey: () => '0123456789abcdef0123456789abcdef', fetcher }).details('movie', 5, 'en-US');
    expect(calls[0].url).not.toContain('api_key');
    expect(calls[0].options.headers).toMatchObject({ Authorization: `Bearer ${JWT}`, accept: 'application/json' });
    expect(calls[1].url).toContain('api_key=0123456789abcdef0123456789abcdef');
    expect(calls[1].options.headers).toBeUndefined();
  });
});
