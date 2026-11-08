/*
 * Text subtitles embedded in an MP4 (tx3g / mov_text, or WebVTT), read by the app over HTTP ranges like the MKV ones (see mkvSubtitles.js):
 * the file's index (`moov`, found by reading the box headers from the start, wherever it is) gives each subtitle sample's time, place and
 * size; the samples of the chosen track are read while the video plays. The player of the TV lists these tracks but sends no lines.
 */

const TEXT_FORMATS = ['tx3g', 'text', 'wvtt', 'stpp'];
const DRAWN_FORMATS = ['tx3g', 'text', 'wvtt'];
const DEFAULT_LINE_MS = 4000;

const type = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** The boxes of `view` from `start` to `end`: [{ type, start (of the data), end }]. */
export function boxes(view, start = 0, end = view.byteLength) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = view.getUint32(at + 8) * 4294967296 + view.getUint32(at + 12);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) break;
    out.push({ type: type(view, at + 4), start: at + header, end: Math.min(at + size, end), full: at + size <= end });
    at += size;
  }
  return out;
}
const find = (view, box, name) => boxes(view, box.start, box.end).find((b) => b.type === name) || null;
const path = (view, box, names) => names.reduce((b, name) => (b ? find(view, b, name) : null), box);

/** ISO-639-2 language packed in 15 bits (mdhd) → "ita"; 'und' → ''. */
function packedLanguage(code) {
  const lang = String.fromCharCode(((code >> 10) & 31) + 0x60, ((code >> 5) & 31) + 0x60, (code & 31) + 0x60);
  return /^[a-z]{3}$/.test(lang) && lang !== 'und' ? lang : '';
}

function utf8(bytes) {
  try {
    return new TextDecoder(bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8').decode(bytes);
  } catch {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }
}

/** The text of one sample: tx3g = 16-bit length + text (+ style boxes); WebVTT = the `payl` boxes of its `vttc` cues. */
export function sampleText(format, view) {
  if (format === 'wvtt') {
    const lines = [];
    boxes(view).forEach((cue) => {
      if (cue.type !== 'vttc') return;
      const payload = find(view, cue, 'payl');
      if (payload) lines.push(utf8(new Uint8Array(view.buffer, view.byteOffset + payload.start, payload.end - payload.start)));
    });
    return lines.join('\n').trim();
  }
  if (view.byteLength < 2) return '';
  const length = Math.min(view.getUint16(0), view.byteLength - 2);
  return utf8(new Uint8Array(view.buffer, view.byteOffset + 2, length)).split('\u0000').join('').replace(/\r/g, '').trim();
}

/** Top-level boxes read from the start of the file (headers only) until `moov`: its absolute position and size. */
async function locateMoov(reader, report) {
  let at = 0;
  for (let n = 0; n < 32; n += 1) {
    const head = await reader.read(at, at + 15);
    if (head.byteLength < 8) break;
    let size = head.getUint32(0);
    if (size === 1 && head.byteLength >= 16) size = head.getUint32(8) * 4294967296 + head.getUint32(12);
    const name = type(head, 4);
    if (n === 0 && name !== 'ftyp') {
      report('not an MP4');
      return null;
    }
    if (name === 'moov') return { pos: at, size };
    if (size < 8 || (reader.size > 0 && at + size >= reader.size)) break;
    at += size;
  }
  report('no moov box');
  return null;
}

/** Sample table of a track → entries [{ time (ms), duration (ms), offset, size }] (empty samples left out). */
function sampleEntries(view, stbl, timescale) {
  const box = (name) => find(view, stbl, name);
  const stts = box('stts');
  const stsc = box('stsc');
  const stsz = box('stsz');
  const stco = box('stco');
  const co64 = box('co64');
  if (!stts || !stsc || !stsz || !(stco || co64)) return [];
  const sizes = [];
  const fixed = view.getUint32(stsz.start + 4);
  const count = view.getUint32(stsz.start + 8);
  for (let i = 0; i < count; i += 1) sizes.push(fixed || view.getUint32(stsz.start + 12 + i * 4));
  const chunks = [];
  if (co64) {
    const n = view.getUint32(co64.start + 4);
    for (let i = 0; i < n; i += 1) chunks.push(view.getUint32(co64.start + 8 + i * 8) * 4294967296 + view.getUint32(co64.start + 12 + i * 8));
  } else {
    const n = view.getUint32(stco.start + 4);
    for (let i = 0; i < n; i += 1) chunks.push(view.getUint32(stco.start + 8 + i * 4));
  }
  const runs = [];
  const nRuns = view.getUint32(stsc.start + 4);
  for (let i = 0; i < nRuns; i += 1) runs.push({ first: view.getUint32(stsc.start + 8 + i * 12) - 1, perChunk: view.getUint32(stsc.start + 12 + i * 12) });
  const offsets = [];
  runs.forEach((run, r) => {
    const last = r + 1 < runs.length ? runs[r + 1].first : chunks.length;
    for (let c = run.first; c < last; c += 1) {
      let at = chunks[c];
      for (let k = 0; k < run.perChunk && offsets.length < sizes.length; k += 1) {
        offsets.push(at);
        at += sizes[offsets.length - 1];
      }
    }
  });
  const out = [];
  let time = 0;
  let sample = 0;
  const nTimes = view.getUint32(stts.start + 4);
  for (let i = 0; i < nTimes; i += 1) {
    const n = view.getUint32(stts.start + 8 + i * 8);
    const delta = view.getUint32(stts.start + 12 + i * 8);
    for (let k = 0; k < n && sample < sizes.length; k += 1) {
      // A tx3g sample of 2 bytes is an empty line (the gap between two lines).
      if (sizes[sample] > 2 && offsets[sample] !== undefined) out.push({ time: (time / timescale) * 1000, duration: (delta / timescale) * 1000, offset: offsets[sample], size: sizes[sample] });
      time += delta;
      sample += 1;
    }
  }
  return out;
}

/**
 * The text subtitle tracks of an MP4: `{ tracks: [{ number, codec, language, name, forced, cues, readEntry }] }`, or null (not an MP4, no text
 * track, no ranges). `readEntry(reader, entry)` reads one line.
 */
export async function probeMp4(reader, report = () => undefined) {
  const moovAt = await locateMoov(reader, report);
  if (!moovAt) return null;
  const view = await reader.read(moovAt.pos, moovAt.pos + moovAt.size - 1);
  const moov = boxes(view)[0];
  if (!moov || moov.type !== 'moov') {
    report('unreadable moov box');
    return null;
  }
  const found = [];
  const formats = [];
  boxes(view, moov.start, moov.end)
    .filter((b) => b.type === 'trak')
    .forEach((trak) => {
      const mdia = find(view, trak, 'mdia');
      const hdlr = mdia && find(view, mdia, 'hdlr');
      const handler = hdlr ? type(view, hdlr.start + 8) : '';
      if (['sbtl', 'text', 'subt'].indexOf(handler) < 0) return;
      const stsd = path(view, mdia, ['minf', 'stbl', 'stsd']);
      const entry = stsd && boxes(view, stsd.start + 8, stsd.end)[0];
      const format = entry ? entry.type : '';
      formats.push(format);
      if (DRAWN_FORMATS.indexOf(format) < 0) return;
      const mdhd = find(view, mdia, 'mdhd');
      const version = mdhd ? view.getUint8(mdhd.start) : 0;
      const timescale = mdhd ? view.getUint32(mdhd.start + (version === 1 ? 20 : 12)) : 1000;
      const language = mdhd ? packedLanguage(view.getUint16(mdhd.start + (version === 1 ? 32 : 20))) : '';
      const tkhd = find(view, trak, 'tkhd');
      const number = tkhd ? view.getUint32(tkhd.start + (view.getUint8(tkhd.start) === 1 ? 20 : 12)) : found.length + 1;
      const cues = sampleEntries(view, path(view, mdia, ['minf', 'stbl']), timescale || 1000);
      if (!cues.length) return;
      found.push({
        number,
        codec: format,
        language,
        name: '',
        forced: false,
        cues,
        readEntry: async (r, cue, next) => {
          const sample = await r.read(cue.offset, cue.offset + cue.size - 1);
          const line = sampleText(format, sample);
          if (!line) return null;
          const end = cue.time + (cue.duration > 0 ? cue.duration : Math.min(DEFAULT_LINE_MS, next ? next.time - cue.time : DEFAULT_LINE_MS));
          return { start: cue.time, end, text: line };
        },
      });
    });
  if (!found.length) {
    report(formats.length ? `no text subtitles (${formats.join(', ')})` : 'no subtitle tracks');
    return null;
  }
  return { tracks: found, scaleMs: 1 };
}

export { TEXT_FORMATS };
