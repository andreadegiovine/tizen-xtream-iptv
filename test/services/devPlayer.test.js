import { devMediaUrl, devStreamKind } from '../../src/services/playerEngines.js';

const { rewritePlaylist } = require('../../scripts/dev-media-proxy');

describe('desktop player (development)', () => {
  const dev = global.__DEV__;
  afterEach(() => {
    global.__DEV__ = dev;
  });

  test('streams go through the dev media proxy and are classified by type', () => {
    global.__DEV__ = true;
    expect(devMediaUrl('http://h/a b.ts')).toBe(`/__media?u=${encodeURIComponent('http://h/a b.ts')}`);
    expect(devStreamKind('http://h/live/u/p/12.m3u8?x=1')).toBe('hls');
    expect(devStreamKind('http://h/live/u/p/12.ts')).toBe('ts');
    expect(devStreamKind('http://h/live/u/p/12')).toBe('ts');
    expect(devStreamKind('http://h/movie/u/p/12.mp4')).toBe('native');
  });

  test('production never touches the stream URL or loads a demuxer', () => {
    global.__DEV__ = false;
    expect(devMediaUrl('http://h/a.ts')).toBe('http://h/a.ts');
    expect(devStreamKind('http://h/a.m3u8')).toBe('native');
  });

  test('HLS playlist: segments, sub-playlists and keys come back through the proxy', () => {
    const out = rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n#EXTINF:4,\nseg1.ts\n', new URL('http://h/p/list.m3u8'));
    expect(out).toContain(`URI="/__media?u=${encodeURIComponent('http://h/p/k.key')}"`);
    expect(out).toContain(`/__media?u=${encodeURIComponent('http://h/p/seg1.ts')}`);
  });
});
