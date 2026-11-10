import { parseM3u, streamType, streamId, M3uClient } from '../../src/services/m3uClient.js';
import { createProviderClient, providerHiddenSections, providerMediaTypes, providerType } from '../../src/services/providerTypes.js';
import { XtreamClient } from '../../src/services/xtreamClient.js';
import { xmltvUrl } from '../../src/services/epgSync.js';

const PLAYLIST = [
  '#EXTM3U url-tvg="http://h/epg.xml"',
  '#EXTINF:-1 tvg-id="rai1.it" tvg-logo="http://h/rai1.png" group-title="Italia",Rai 1 HD',
  'http://h/live/u/p/101.ts',
  '#EXTINF:-1 tvg-id="bbc1.uk" group-title="UK",BBC One',
  'http://h/stream/bbc1.m3u8',
  '#EXTINF:-1 tvg-logo="http://h/m.png" group-title="Film",Matrix',
  'http://h/movie/u/p/603.mkv',
  '#EXTINF:-1,Nameless group',
  '#EXTGRP:Altro',
  'http://h/files/clip.mp4',
  '',
].join('\r\n');

test('M3U: header guide, entries with logo, group, guide id and type', () => {
  const { epgUrl, entries } = parseM3u(PLAYLIST);
  expect(epgUrl).toBe('http://h/epg.xml');
  expect(entries.map((e) => [e.name, e.group, e.tvgId, e.type])).toEqual([
    ['Rai 1 HD', 'Italia', 'rai1.it', 'live'],
    ['BBC One', 'UK', 'bbc1.uk', 'live'],
    ['Matrix', 'Film', '', 'movie'],
    ['Nameless group', 'Altro', '', 'movie'],
  ]);
  expect(() => parseM3u('<html>')).toThrow();
  expect(streamType('http://h/live/u/p/1.ts')).toBe('live');
  expect(streamType('http://h/x/1.ts')).toBe('live');
  expect(streamId('http://a')).toBe(streamId('http://a'));
  expect(streamId('http://a')).not.toBe(streamId('http://b'));
});

test('M3U client answers like the Xtream one: categories, streams, addresses, no series, the guide of the playlist', async () => {
  const fetchText = jest.fn(async () => PLAYLIST);
  const client = new M3uClient({ playlistUrl: 'http://h/list.m3u', fetchText, wrapUrl: (u) => u });
  const auth = await client.authenticate();
  expect(auth.user.expiresAt).toBeNull();
  expect(auth.playlist).toEqual({ entries: 4, epgUrl: 'http://h/epg.xml' });
  const live = await client.getStreams('live');
  expect(live.map((s) => [s.name, s.epg_channel_id, s.stream_icon])).toEqual([['Rai 1 HD', 'rai1.it', 'http://h/rai1.png'], ['BBC One', 'bbc1.uk', '']]);
  const cats = await client.getCategories('live');
  expect(cats.map((c) => c.category_name)).toEqual(['Italia', 'UK']);
  expect((await client.getStreams('live', { categoryId: cats[1].category_id })).map((s) => s.name)).toEqual(['BBC One']);
  const movies = await client.getStreams('movie');
  expect(movies.map((m) => [m.name, m.container_extension])).toEqual([['Matrix', 'mkv'], ['Nameless group', 'mp4']]);
  expect(client.streamUrl('live', live[0].stream_id, '')).toBe('http://h/live/u/p/101.ts');
  expect(client.streamUrl('movie', movies[0].stream_id, 'mkv')).toBe('http://h/movie/u/p/603.mkv');
  expect(await client.getStreams('series')).toEqual([]);
  expect(await client.getCategories('series')).toEqual([]);
  expect(await client.guideUrl()).toBe('http://h/epg.xml');
  expect(await new M3uClient({ playlistUrl: 'x', epgUrl: 'http://typed/epg.xml', fetchText, wrapUrl: (u) => u }).guideUrl()).toBe('http://typed/epg.xml');
  await expect(new M3uClient({ playlistUrl: 'x', fetchText: async () => '#EXTM3U\n', wrapUrl: (u) => u }).authenticate()).rejects.toBeTruthy();
});

test('provider types: client, sections, media types and guide of each kind (old providers are Xtream)', () => {
  const xtream = { baseUrl: 'http://h', username: 'u', password: 'p' };
  const m3u = { type: 'm3u', playlistUrl: 'http://h/list.m3u', epgUrl: 'http://h/epg.xml' };
  expect(providerType(xtream)).toBe('xtream');
  expect(createProviderClient(xtream)).toBeInstanceOf(XtreamClient);
  expect(createProviderClient(m3u)).toBeInstanceOf(M3uClient);
  expect(providerHiddenSections(xtream)).toEqual([]);
  expect(providerHiddenSections(m3u)).toEqual(['series']);
  expect(providerMediaTypes(m3u)).toEqual(['movie', 'live']);
  expect(xmltvUrl(m3u)).toBe('http://h/epg.xml');
  expect(xmltvUrl({ ...m3u, epgUrl: '' })).toBe('');
  expect(xmltvUrl(xtream)).toBe('http://h/xmltv.php?username=u&password=p');
});
