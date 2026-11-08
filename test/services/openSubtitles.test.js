import { parseSubtitles, parseTime, cueAt, searchQuery, pickSubtitle, subtitleLanguages, createOpenSubtitles, movieHash, HASH_CHUNK } from '../../src/services/openSubtitles.js';

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nCiao\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>Due</i>\r\nrighe\r\n\r\nbroken\r\n';
const VTT = 'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nUno\n\nnote\n01:00:00.000 --> 01:00:01.000\nOra';

test('times and SRT / WebVTT cues', () => {
  expect(parseTime('01:02:03,004')).toBe(3723004);
  expect(parseTime('02:03.5')).toBe(123500);
  expect(parseTime('x')).toBeNaN();
  expect(parseSubtitles(SRT)).toEqual([
    { start: 1000, end: 2500, text: 'Ciao' },
    { start: 3000, end: 4000, text: '<i>Due</i>\nrighe' },
  ]);
  expect(parseSubtitles(VTT)).toEqual([
    { start: 1000, end: 2000, text: 'Uno' },
    { start: 3600000, end: 3601000, text: 'Ora' },
  ]);
});

test('the cue on at a time', () => {
  const cues = parseSubtitles(SRT);
  expect(cueAt(cues, 500)).toBeNull();
  expect(cueAt(cues, 1000).text).toBe('Ciao');
  expect(cueAt(cues, 2600)).toBeNull();
  expect(cueAt(cues, 3999).text).toContain('righe');
  expect(cueAt([], 10)).toBeNull();
});

test('query sorted, lowercase; languages; best file', () => {
  expect(searchQuery({ tmdbId: 603, languages: ['it', 'en'] })).toBe('languages=it%2Cen&tmdb_id=603');
  expect(searchQuery({ tmdbId: 1396, season: 1, episode: 2, languages: ['it'] })).toBe('episode_number=2&languages=it&parent_tmdb_id=1396&season_number=1');
  expect(subtitleLanguages('it-IT')).toEqual(['it', 'en']);
  expect(subtitleLanguages('en-US')).toEqual(['en']);
  const item = (language, fileId, extra = {}) => ({ attributes: { language, download_count: 1, files: [{ file_id: fileId }], ...extra } });
  const data = [item('en', 1, { download_count: 999 }), item('it', 2, { machine_translated: true, download_count: 999 }), item('it', 3, { download_count: 5 }), item('it', 4, { download_count: 50 }), { attributes: { language: 'it', files: [] } }];
  expect(pickSubtitle(data, ['it', 'en'])).toEqual({ fileId: 4, language: 'it', matched: false });
  // made for this very file (hash match): first among the same language, even with fewer downloads
  expect(pickSubtitle(data.concat([item('it', 9, { moviehash_match: true })]), ['it', 'en'])).toEqual({ fileId: 9, language: 'it', matched: true });
  expect(searchQuery({ tmdbId: 603, languages: ['it'], moviehash: '8e245d9679d31e12' })).toBe('languages=it&moviehash=8e245d9679d31e12&tmdb_id=603');
  expect(pickSubtitle([], ['it'])).toBeNull();
});

test('search, download link, file; kept in memory for the session; a failure is retried', async () => {
  const calls = [];
  let fail = true;
  const doFetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.headers ? init.headers['Api-Key'] : undefined]);
    if (url.indexOf('/subtitles?') > 0) {
      if (fail) return { ok: false, status: 503, json: async () => ({ message: 'busy' }) };
      return { ok: true, json: async () => ({ data: [{ attributes: { language: 'it', files: [{ file_id: 7 }] } }] }) };
    }
    if (url.endsWith('/download')) {
      expect(JSON.parse(init.body)).toEqual({ file_id: 7 });
      return { ok: true, json: async () => ({ link: 'https://dl.example/7.srt' }) };
    }
    return { ok: true, text: async () => SRT };
  };
  const os = createOpenSubtitles({ getKey: () => 'KEY', doFetch });
  expect(os.enabled).toBe(true);
  const query = { tmdbId: 603, languages: ['it', 'en'] };
  await expect(os.fetch(query)).rejects.toMatchObject({ details: { status: 503 } });
  fail = false;
  const got = await os.fetch(query);
  expect(got.language).toBe('it');
  expect(got.cues).toHaveLength(2);
  await os.fetch(query); // same title again: nothing is downloaded
  expect(calls.map((c) => c[0] + ' ' + c[1].replace('https://api.opensubtitles.com/api/v1', ''))).toEqual([
    'GET /subtitles?languages=it%2Cen&tmdb_id=603',
    'GET /subtitles?languages=it%2Cen&tmdb_id=603',
    'POST /download',
    'GET https://dl.example/7.srt',
  ]);
  expect(calls[0][2]).toBe('KEY');
  expect(createOpenSubtitles({ getKey: () => '' }).enabled).toBe(false);
});

test('nothing found: null', async () => {
  const os = createOpenSubtitles({ getKey: () => 'K', doFetch: async () => ({ ok: true, json: async () => ({ data: [] }) }) });
  expect(await os.fetch({ tmdbId: 1, languages: ['it'] })).toBeNull();
});

test('file hash: size plus the 64-bit words of the first and last 64 KB (carry across the halves)', () => {
  const head = new ArrayBuffer(HASH_CHUNK);
  const tail = new ArrayBuffer(HASH_CHUNK);
  expect(movieHash(HASH_CHUNK * 2, head, tail)).toBe('0000000000020000');
  const v = new DataView(head);
  v.setUint32(0, 0xffffffff, true); // low half overflows into the high half
  v.setUint32(8, 1, true);
  v.setUint32(4, 0xffffffff, true); // high half wraps (modulo 2^64)
  expect(movieHash(0, head, tail)).toBe('0000000000000000');
});

test('with the video address, the hash is read with two range requests and sent; servers without ranges: no hash', async () => {
  const size = HASH_CHUNK * 3;
  const urls = [];
  const doFetch = async (url, init = {}) => {
    if (url === 'http://h/movie/1.mkv') {
      const [from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).slice(1).map(Number);
      urls.push(`range ${from}-${to}`);
      return { status: 206, headers: { get: () => `bytes ${from}-${to}/${size}` }, arrayBuffer: async () => new ArrayBuffer(to - from + 1) };
    }
    if (url === 'http://h/movie/2.mkv') return { status: 200, headers: { get: () => null }, body: { cancel: async () => urls.push('cancelled') } };
    urls.push(url.replace('https://api.opensubtitles.com/api/v1', ''));
    return { ok: true, json: async () => ({ data: [] }) };
  };
  const os = createOpenSubtitles({ getKey: () => 'K', doFetch });
  await os.fetch({ tmdbId: 1, languages: ['it'] }, { url: 'http://h/movie/1.mkv' });
  expect(urls).toEqual([`range 0-${HASH_CHUNK - 1}`, `range ${size - HASH_CHUNK}-${size - 1}`, `/subtitles?languages=it&moviehash=${movieHash(size, new ArrayBuffer(HASH_CHUNK), new ArrayBuffer(HASH_CHUNK))}&tmdb_id=1`]);
  urls.length = 0;
  await os.fetch({ tmdbId: 2, languages: ['it'] }, { url: 'http://h/movie/2.mkv' });
  expect(urls).toEqual(['cancelled', '/subtitles?languages=it&tmdb_id=2']);
});
