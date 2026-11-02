import {
  XtreamClient,
  normalizeBaseUrl,
  pickLiveFormat,
  parseAuthResponse,
  decodeBase64Utf8,
} from '../../src/services/xtreamClient.js';
import { ErrorCode } from '../../src/core/errors.js';

const authData = (overrides = {}) => ({
  user_info: { auth: 1, status: 'Active', exp_date: '4102444800', max_connections: '2', active_cons: '0', allowed_output_formats: ['m3u8', 'ts'], ...overrides },
  server_info: { url: 'h', port: '80', timezone: 'Europe/Rome' },
});

describe('normalizeBaseUrl', () => {
  test.each([
    ['host:8080', 'http://host:8080'],
    ['http://host:8080/', 'http://host:8080'],
    ['https://host/player_api.php?x=1', 'https://host'],
    ['http://host/panel/get.php', 'http://host/panel'],
    ['  HTTP://Host:80  ', 'http://host'],
  ])('%s -> %s', (input, expected) => expect(normalizeBaseUrl(input)).toBe(expected));

  test('rejects empty and non-http input', () => {
    expect(() => normalizeBaseUrl('')).toThrow();
    expect(() => normalizeBaseUrl('ftp://host')).toThrow();
  });
});

describe('XtreamClient', () => {
  const make = (fetcher = jest.fn()) =>
    new XtreamClient({ baseUrl: 'http://h:80', username: 'bob', password: 'p@ss', fetchJson: fetcher, wrapUrl: (u) => u });

  test('builds API urls with encoded credentials', () => {
    expect(make().apiUrl('get_vod_streams', { category_id: 3 })).toBe(
      'http://h:80/player_api.php?username=bob&password=p%40ss&action=get_vod_streams&category_id=3',
    );
  });

  test('builds stream urls and picks the live format from the account', async () => {
    const client = make(jest.fn().mockResolvedValue(authData({ allowed_output_formats: ['ts'] })));
    await client.authenticate();
    expect(client.streamUrl('live', 5)).toBe('http://h:80/live/bob/p%40ss/5.ts');
    expect(client.streamUrl('movie', 9, 'mkv')).toBe('http://h:80/movie/bob/p%40ss/9.mkv');
    expect(client.streamUrl('series', 11, 'mp4')).toBe('http://h:80/series/bob/p%40ss/11.mp4');
  });

  test('authenticate returns user and server info', async () => {
    const auth = await make(jest.fn().mockResolvedValue(authData())).authenticate();
    expect(auth.user).toMatchObject({ maxConnections: 2, activeConnections: 0 });
    expect(auth.server.timezone).toBe('Europe/Rome');
  });

  test('list endpoints reject auth failures disguised as data', async () => {
    const client = make(jest.fn().mockResolvedValue({ user_info: { auth: 0 } }));
    await expect(client.getStreams('movie')).rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED });
  });

  test('short EPG is decoded and converted to milliseconds', async () => {
    const title = btoa('News');
    const client = make(
      jest.fn().mockResolvedValue({ epg_listings: [{ id: '1', title, description: btoa('Desc'), start_timestamp: '100', stop_timestamp: '200' }, { id: '2', title }] }),
    );
    expect(await client.getShortEpg(5)).toEqual([{ id: '1', title: 'News', description: 'Desc', start: 100000, stop: 200000 }]);
  });
});

describe('parseAuthResponse', () => {
  test('failure modes', () => {
    expect(() => parseAuthResponse({})).toThrow(expect.objectContaining({ code: ErrorCode.AUTH_FAILED }));
    expect(() => parseAuthResponse(authData({ auth: 0 }))).toThrow(expect.objectContaining({ code: ErrorCode.AUTH_FAILED }));
    expect(() => parseAuthResponse(authData({ status: 'Expired' }))).toThrow(expect.objectContaining({ code: ErrorCode.ACCOUNT_EXPIRED }));
    expect(() => parseAuthResponse(authData({ status: 'Banned' }))).toThrow(expect.objectContaining({ code: ErrorCode.ACCOUNT_DISABLED }));
    expect(() => parseAuthResponse(authData({ exp_date: '1000' }), 2_000_000)).toThrow(expect.objectContaining({ code: ErrorCode.ACCOUNT_EXPIRED }));
  });

  test('unlimited accounts (no exp_date) are accepted', () => {
    expect(parseAuthResponse(authData({ exp_date: null })).user.expiresAt).toBeNull();
  });
});

describe('helpers', () => {
  test('pickLiveFormat', () => {
    expect(pickLiveFormat(['ts', 'm3u8'])).toBe('m3u8');
    expect(pickLiveFormat(['ts'])).toBe('ts');
    expect(pickLiveFormat([])).toBe('m3u8');
    expect(pickLiveFormat(['rtmp'])).toBe('rtmp');
  });

  test('decodeBase64Utf8 handles accents and bad input', () => {
    expect(decodeBase64Utf8('Q2l0dMOg')).toBe('Città');
    expect(decodeBase64Utf8('not base64 !!')).toBe('not base64 !!');
  });
});
