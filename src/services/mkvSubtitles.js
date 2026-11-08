/*
 * Text subtitles embedded in a Matroska (MKV) file, read by the app over HTTP ranges, for the TVs whose player lists the tracks but does not
 * send their lines (AVPlay on a 2021 QLED: the track is accepted, no `onsubtitlechange` arrives). Only small parts of the file are read: the
 * start (header, tracks, seek table), the cue index (where the subtitle blocks are) and, while the video plays, the blocks of the chosen
 * track near the position. The lines are drawn by the page like the ones of OpenSubtitles.
 *
 * Needs a server that answers byte ranges (206) and a file whose cue index lists the subtitle blocks (mkvmerge writes them); otherwise the
 * file is reported as not readable and the player's own tracks are used.
 */

// Matroska element ids (with their length marker bits, as written in the file).
const ID = {
  EBML: 0x1a45dfa3,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  SEEK: 0x4dbb,
  SEEK_ID: 0x53ab,
  SEEK_POSITION: 0x53ac,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_TYPE: 0x83,
  CODEC_ID: 0x86,
  LANGUAGE: 0x22b59c,
  LANGUAGE_BCP47: 0x22b59d,
  NAME: 0x536e,
  FLAG_DEFAULT: 0x88,
  FLAG_FORCED: 0x55aa,
  CUES: 0x1c53bb6b,
  CUE_POINT: 0xbb,
  CUE_TIME: 0xb3,
  CUE_TRACK_POSITIONS: 0xb7,
  CUE_TRACK: 0xf7,
  CUE_CLUSTER_POSITION: 0xf1,
  CUE_RELATIVE_POSITION: 0xf0,
  CUE_DURATION: 0xb2,
  CLUSTER: 0x1f43b675,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
  SIMPLE_BLOCK: 0xa3,
};
const SUBTITLE_TYPE = 17;
/** Codecs whose blocks are text the app can draw (ASS / SSA: the text field, without styles). */
export const TEXT_CODECS = ['S_TEXT/UTF8', 'S_TEXT/ASCII', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_ASS', 'S_SSA', 'S_TEXT/WEBVTT'];
const HEAD_BYTES = 65536;
const BLOCK_WINDOW = 4096; // read from where a subtitle block starts: one line of text and its duration fit
const DEFAULT_LINE_MS = 4000; // a block without a duration: until the next one, at most this long

/** A variable-length integer at `at`: { value, length }. `keepMarker` for element ids. null when it does not fit or is invalid. */
export function readVint(view, at, keepMarker = false) {
  if (at >= view.byteLength) return null;
  const first = view.getUint8(at);
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || at + length > view.byteLength) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i += 1) {
    const byte = view.getUint8(at + i);
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** The elements of `view` from `start` to `end`: [{ id, start (of the data), size, end }]; stops at the first that does not fit. */
export function elements(view, start = 0, end = view.byteLength) {
  const out = [];
  let at = start;
  while (at < end) {
    const id = readVint(view, at, true);
    if (!id) break;
    const size = readVint(view, at + id.length);
    if (!size) break;
    const dataStart = at + id.length + size.length;
    const dataEnd = size.unknown ? end : dataStart + size.value;
    out.push({ id: id.value, start: dataStart, size: size.unknown ? Infinity : size.value, end: dataEnd, headerStart: at });
    if (size.unknown || dataEnd > end) break;
    at = dataEnd;
  }
  return out;
}

const uint = (view, el) => {
  let value = 0;
  for (let i = el.start; i < el.end; i += 1) value = value * 256 + view.getUint8(i);
  return value;
};
const text = (view, el) => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + el.start, Math.max(0, el.end - el.start));
  let out = '';
  try {
    out = new TextDecoder('utf-8').decode(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  }
  return out.split('\u0000').join('');
};
const children = (view, el) => elements(view, el.start, Math.min(el.end, view.byteLength));
const child = (view, el, id) => children(view, el).find((c) => c.id === id) || null;

/** Text of one subtitle block: SRT / WebVTT as it is; ASS / SSA: the text after the eighth comma, without override tags. */
export function blockText(codec, raw) {
  let value = String(raw || '');
  if (/ASS|SSA/.test(codec)) {
    const parts = value.split(',');
    value = parts.length > 8 ? parts.slice(8).join(',') : value;
    value = value.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  }
  return value.replace(/\r/g, '').trim();
}

/** Reads byte ranges of `url`: `read(from, to)` → DataView. `size` is known after the first read (Content-Range). */
export function createRangeReader(url, doFetch = (...args) => fetch(...args)) {
  const reader = {
    size: NaN,
    requests: 0,
    async read(from, to) {
      if (to < from) return new DataView(new ArrayBuffer(0));
      if (reader.size > 0) to = Math.min(to, reader.size - 1);
      reader.requests += 1;
      const res = await doFetch(url, { headers: { Range: `bytes=${from}-${to}` } });
      if (res.status !== 206) {
        if (res.body && res.body.cancel) res.body.cancel().catch(() => undefined);
        throw new Error(`no ranges (HTTP ${res.status})`);
      }
      const total = /\/(\d+)\s*$/.exec((res.headers && res.headers.get('Content-Range')) || '');
      if (total) reader.size = Number(total[1]);
      return new DataView(await res.arrayBuffer());
    },
  };
  return reader;
}

/** Reads the whole element whose header starts at `pos` (absolute): { view, el } with `el` relative to `view`. */
async function readElement(reader, pos, guess = 4096) {
  let view = await reader.read(pos, pos + guess - 1);
  let el = elements(view, 0, view.byteLength)[0];
  if (!el && view.byteLength >= 12) {
    // The data does not fit in the guess: the header says how long it is.
    const id = readVint(view, 0, true);
    const size = id && readVint(view, id.length);
    if (!size || size.unknown) return null;
    const total = id.length + size.length + size.value;
    view = await reader.read(pos, pos + total - 1);
    el = elements(view, 0, view.byteLength)[0];
  }
  return el ? { view, el } : null;
}

/**
 * The text subtitle tracks of an MKV with their cue entries, or null when the file is not an MKV, the server does not serve ranges, or no
 * text track has cue entries. `{ tracks: [{ number, codec, language, name, default, forced, cues: [{ time, cluster, relative, duration }] }],
 * segmentStart, scaleMs }` (times in ms; positions absolute in the file).
 */
export async function probeMkv(reader) {
  const head = await reader.read(0, HEAD_BYTES - 1);
  const top = elements(head, 0, head.byteLength);
  if (!top.length || top[0].id !== ID.EBML) return null;
  const segment = top.find((el) => el.id === ID.SEGMENT);
  if (!segment) return null;
  const segmentStart = segment.start;
  const level1 = elements(head, segment.start, head.byteLength);
  const at = (id) => level1.find((el) => el.id === id && el.end <= head.byteLength) || null;
  // Where the parts are: the seek table, else what is in the first bytes.
  const positions = {};
  const seekHead = at(ID.SEEK_HEAD);
  if (seekHead) {
    children(head, seekHead)
      .filter((el) => el.id === ID.SEEK)
      .forEach((seek) => {
        const idEl = child(head, seek, ID.SEEK_ID);
        const posEl = child(head, seek, ID.SEEK_POSITION);
        if (idEl && posEl) positions[uint(head, idEl)] = segmentStart + uint(head, posEl);
      });
  }
  const load = async (id) => {
    const here = at(id);
    if (here) return { view: head, el: here };
    return positions[id] !== undefined ? readElement(reader, positions[id], id === ID.CUES ? 262144 : 16384) : null;
  };
  const info = await load(ID.INFO);
  const scaleEl = info && child(info.view, info.el, ID.TIMESTAMP_SCALE);
  const scaleMs = (scaleEl ? uint(info.view, scaleEl) : 1000000) / 1000000;
  const tracksEl = await load(ID.TRACKS);
  if (!tracksEl) return null;
  const tracks = children(tracksEl.view, tracksEl.el)
    .filter((el) => el.id === ID.TRACK_ENTRY)
    .map((entry) => {
      const get = (id) => child(tracksEl.view, entry, id);
      const num = (id, fallback) => (get(id) ? uint(tracksEl.view, get(id)) : fallback);
      const str = (id) => (get(id) ? text(tracksEl.view, get(id)) : '');
      return {
        number: num(ID.TRACK_NUMBER, 0),
        type: num(ID.TRACK_TYPE, 0),
        codec: str(ID.CODEC_ID),
        language: str(ID.LANGUAGE_BCP47) || (str(ID.LANGUAGE) === 'und' ? '' : str(ID.LANGUAGE)),
        name: str(ID.NAME),
        default: num(ID.FLAG_DEFAULT, 1) === 1,
        forced: num(ID.FLAG_FORCED, 0) === 1,
        cues: [],
      };
    })
    .filter((track) => track.type === SUBTITLE_TYPE && TEXT_CODECS.indexOf(track.codec) >= 0);
  if (!tracks.length) return null;
  const cuesEl = await load(ID.CUES);
  if (!cuesEl) return null;
  const byNumber = new Map(tracks.map((track) => [track.number, track]));
  children(cuesEl.view, cuesEl.el)
    .filter((el) => el.id === ID.CUE_POINT)
    .forEach((point) => {
      const parts = children(cuesEl.view, point);
      const timeEl = parts.find((el) => el.id === ID.CUE_TIME);
      if (!timeEl) return;
      const time = uint(cuesEl.view, timeEl) * scaleMs;
      parts
        .filter((el) => el.id === ID.CUE_TRACK_POSITIONS)
        .forEach((pos) => {
          const get = (id) => child(cuesEl.view, pos, id);
          const track = get(ID.CUE_TRACK) && byNumber.get(uint(cuesEl.view, get(ID.CUE_TRACK)));
          if (!track || !get(ID.CUE_CLUSTER_POSITION) || !get(ID.CUE_RELATIVE_POSITION)) return;
          track.cues.push({
            time,
            cluster: segmentStart + uint(cuesEl.view, get(ID.CUE_CLUSTER_POSITION)),
            relative: uint(cuesEl.view, get(ID.CUE_RELATIVE_POSITION)),
            duration: get(ID.CUE_DURATION) ? uint(cuesEl.view, get(ID.CUE_DURATION)) * scaleMs : null,
          });
        });
    });
  const usable = tracks.filter((track) => track.cues.length);
  usable.forEach((track) => track.cues.sort((a, b) => a.time - b.time));
  return usable.length ? { tracks: usable, segmentStart, scaleMs } : null;
}

/** The data start of the cluster whose header begins at `pos` (absolute), from its first bytes. */
async function clusterDataStart(reader, pos, cache) {
  if (cache.has(pos)) return cache.get(pos);
  const job = reader.read(pos, pos + 15).then((view) => {
    const id = readVint(view, 0, true);
    const size = id && readVint(view, id.length);
    if (!id || id.value !== ID.CLUSTER || !size) throw new Error('not a cluster');
    return pos + id.length + size.length;
  });
  cache.set(pos, job);
  job.catch(() => cache.delete(pos));
  return job;
}

/** The line of one cue entry: { start, end, text } or null (a block that is not of the track, or laced). */
async function readCue(reader, track, cue, next, cache) {
  const dataStart = await clusterDataStart(reader, cue.cluster, cache);
  const pos = dataStart + cue.relative;
  const view = await reader.read(pos, pos + BLOCK_WINDOW - 1);
  const el = elements(view, 0, view.byteLength)[0];
  if (!el) return null;
  let blockEl = null;
  let duration = cue.duration;
  if (el.id === ID.SIMPLE_BLOCK) blockEl = el;
  else if (el.id === ID.BLOCK_GROUP) {
    blockEl = child(view, el, ID.BLOCK);
    const dur = child(view, el, ID.BLOCK_DURATION);
    if (dur) duration = uint(view, dur) * (track.scaleMs || 1);
  }
  if (!blockEl) return null;
  const num = readVint(view, blockEl.start);
  if (!num || num.value !== track.number) return null;
  const flags = view.getUint8(blockEl.start + num.length + 2);
  if (flags & 0x06) return null; // laced: not used for text subtitles
  const raw = text(view, { start: blockEl.start + num.length + 3, end: Math.min(blockEl.end, view.byteLength) });
  const line = blockText(track.codec, raw);
  if (!line) return null;
  const end = cue.time + (duration > 0 ? duration : Math.min(DEFAULT_LINE_MS, next ? next.time - cue.time : DEFAULT_LINE_MS));
  return { start: cue.time, end, text: line };
}

/**
 * The lines of one track, read a window at a time around the position: `cues` (sorted, growing) and `ensure(ms)` (reads, in the
 * background, the blocks from a little before `ms` to `aheadMs` after it that were not read yet; a few at a time).
 */
export function createTrackLoader(reader, track, { scaleMs = 1, behindMs = 15000, aheadMs = 180000, parallel = 4 } = {}) {
  const entries = track.cues;
  const state = entries.map(() => 0); // 0 to read, 1 reading, 2 done
  const cache = new Map();
  const loader = {
    cues: [],
    failures: 0,
    ensure(ms) {
      const want = [];
      for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].time > ms + aheadMs) break;
        if (state[i] === 0 && entries[i].time >= ms - behindMs) want.push(i);
      }
      if (!want.length) return loader.running || Promise.resolve();
      want.forEach((i) => {
        state[i] = 1;
      });
      let next = 0;
      const work = async () => {
        while (next < want.length) {
          const i = want[next];
          next += 1;
          try {
            const cue = await readCue(reader, { ...track, scaleMs }, entries[i], entries[i + 1], cache);
            if (cue) insert(loader.cues, cue);
            state[i] = 2;
          } catch {
            state[i] = 0; // tried again at the next ensure
            loader.failures += 1;
          }
        }
      };
      const workers = [];
      for (let w = 0; w < Math.min(parallel, want.length); w += 1) workers.push(work());
      loader.running = Promise.all(workers).then(() => {
        loader.running = null;
      });
      return loader.running;
    },
    running: null,
  };
  return loader;
}

function insert(list, cue) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start < cue.start) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, cue);
}
