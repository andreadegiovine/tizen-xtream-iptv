import fs from 'fs';
import path from 'path';
import { TextDecoder as NodeTextDecoder } from 'util';
import { createRangeReader, probeMkv, createTrackLoader, blockText, readVint, elements } from '../../src/services/mkvSubtitles.js';

if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// A small MKV made with mkvmerge: 25 s of video, an Italian SRT track (3 lines) and a forced English ASS track (1 line).
const file = fs.readFileSync(path.join(__dirname, '../fixtures/subs.mkv'));

/** A server that answers byte ranges of the file (206 with Content-Range), or 200 when `ranges` is false. */
function server({ ranges = true } = {}) {
  const calls = [];
  const doFetch = async (url, init = {}) => {
    const m = /bytes=(\d+)-(\d+)/.exec((init.headers && init.headers.Range) || '');
    calls.push(m ? `${m[1]}-${m[2]}` : 'all');
    if (!ranges || !m) return { status: 200, headers: { get: () => null }, body: { cancel: async () => undefined } };
    const from = Number(m[1]);
    const to = Math.min(Number(m[2]), file.length - 1);
    const slice = file.subarray(from, to + 1);
    return { status: 206, headers: { get: () => `bytes ${from}-${to}/${file.length}` }, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) };
  };
  return { doFetch, calls };
}

test('EBML numbers: ids keep their marker, sizes lose it; unknown sizes are flagged', () => {
  const view = new DataView(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x01, 0x01, 0xff]).buffer);
  expect(readVint(view, 0, true)).toMatchObject({ value: 0x1a45dfa3, length: 4 });
  expect(readVint(view, 4)).toMatchObject({ value: 1, length: 1, unknown: false });
  expect(readVint(view, 7)).toMatchObject({ unknown: true });
  expect(elements(view, 0, 6)).toEqual([{ id: 0x1a45dfa3, start: 5, size: 1, end: 6, headerStart: 0 }]);
});

test('ASS lines: the text field without override tags; SRT as it is', () => {
  expect(blockText('S_TEXT/ASS', '0,0,Default,,0,0,0,,{\\i1}Hello{\\i0}\\Nworld, again')).toBe('Hello\nworld, again');
  expect(blockText('S_TEXT/UTF8', ' <i>Ciao</i>\r\n')).toBe('<i>Ciao</i>');
});

test('a real MKV: text tracks from the header and the cue index, lines read a window at a time with a few range requests', async () => {
  const { doFetch, calls } = server();
  const reader = createRangeReader('http://h/movie/1.mkv', doFetch);
  const info = await probeMkv(reader);
  expect(info.tracks.map((t) => [t.codec, t.language, t.forced, t.cues.length])).toEqual([
    ['S_TEXT/UTF8', 'it', false, 3],
    ['S_TEXT/ASS', 'en', true, 1],
  ]);
  expect(calls.length).toBeLessThanOrEqual(3);
  const it = createTrackLoader(reader, info.tracks[0], { scaleMs: info.scaleMs, aheadMs: 10000 });
  await it.ensure(0); // the first 10 s: two lines
  expect(it.cues).toEqual([
    { start: 1000, end: 2500, text: 'Prima riga' },
    { start: 4000, end: 6000, text: '<i>Seconda</i>\nriga' },
  ]);
  const before = calls.length;
  await it.ensure(2000); // nothing new to read
  expect(calls.length).toBe(before);
  await it.ensure(15000);
  expect(it.cues.map((c) => c.text)).toEqual(['Prima riga', '<i>Seconda</i>\nriga', 'Terza']);
  const en = createTrackLoader(reader, info.tracks[1], { scaleMs: info.scaleMs });
  await en.ensure(0);
  expect(en.cues).toEqual([{ start: 3000, end: 5000, text: 'Hello\nworld, again' }]);
});

test('a server without ranges, or a file that is not an MKV: nothing to read', async () => {
  await expect(probeMkv(createRangeReader('http://h/1.mkv', server({ ranges: false }).doFetch))).rejects.toThrow('no ranges');
  const mp4 = async () => ({ status: 206, headers: { get: () => 'bytes 0-7/8' }, arrayBuffer: async () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]).buffer });
  expect(await probeMkv(createRangeReader('http://h/1.mp4', mp4))).toBeNull();
});
