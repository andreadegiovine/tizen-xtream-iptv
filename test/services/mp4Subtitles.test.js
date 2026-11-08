import fs from 'fs';
import path from 'path';
import { TextDecoder as NodeTextDecoder } from 'util';
import { createRangeReader, createTrackLoader } from '../../src/services/mkvSubtitles.js';
import { probeMp4, sampleText } from '../../src/services/mp4Subtitles.js';

if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;

// An MP4 made with ffmpeg (index at the end of the file): 25 s of video, an Italian and an English mov_text (tx3g) track.
const file = fs.readFileSync(path.join(__dirname, '../fixtures/subs.mp4'));
const doFetch = async (url, init) => {
  const [from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).slice(1).map(Number);
  const end = Math.min(to, file.length - 1);
  const slice = file.subarray(from, end + 1);
  return { status: 206, headers: { get: () => `bytes ${from}-${end}/${file.length}` }, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) };
};

test('tx3g sample: 16-bit length then the text', () => {
  const bytes = new Uint8Array([0, 4, 0x43, 0x69, 0x61, 0x6f, 0, 0, 0, 8]);
  expect(sampleText('tx3g', new DataView(bytes.buffer))).toBe('Ciao');
});

test('a real MP4: text tracks from the index wherever it is, lines read from their samples', async () => {
  const reader = createRangeReader('http://h/movie/1.mp4', doFetch);
  const info = await probeMp4(reader);
  expect(info.tracks.map((t) => [t.codec, t.language, t.cues.length])).toEqual([
    ['tx3g', 'ita', 3],
    ['tx3g', 'eng', 1],
  ]);
  const it = createTrackLoader(reader, info.tracks[0], { scaleMs: 1 });
  await it.ensure(0);
  expect(it.cues.map((c) => [Math.round(c.start), Math.round(c.end), c.text])).toEqual([
    [1000, 2500, 'Prima riga'],
    [4000, 6000, 'Seconda\nriga'],
    [20000, 21000, 'Terza'],
  ]);
  const en = createTrackLoader(reader, info.tracks[1], { scaleMs: 1 });
  await en.ensure(0);
  expect(en.cues.map((c) => c.text)).toEqual(['Hello\nworld, again']);
});

test('not an MP4: nothing, with the reason', async () => {
  const reasons = [];
  const mkv = async () => ({ status: 206, headers: { get: () => 'bytes 0-15/16' }, arrayBuffer: async () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer });
  expect(await probeMp4(createRangeReader('http://h/1.mkv', mkv), (why) => reasons.push(why))).toBeNull();
  expect(reasons).toEqual(['not an MP4']);
});
