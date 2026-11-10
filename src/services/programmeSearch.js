import { makeSearchKey } from './titleNormalizer.js';
import { isPlaceholderTitle } from './xmltv.js';
import { readGuideIndex } from './guideIndex.js';

const DAY = 24 * 3600 * 1000;

/**
 * The programme titles the search looks in, read once per guide: `{ titles: [{ key, title, start, stop, channelId }], rowOf: Map(epgChannelId
 * → Live TV row key) }`. Read with a cursor, keeping only the light fields of the programmes not ended at `now` (the descriptions and the
 * past days of a large guide never reach memory). Runs in the search worker; in the page only when the worker is not available.
 */
export async function loadProgrammeRows(db, now) {
  const titles = [];
  await new Promise((resolve, reject) => {
    const request = db.transaction('epg', 'readonly').objectStore('epg').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const p = cursor.value;
      if (p.stop > now && !isPlaceholderTitle(p.title)) titles.push({ key: makeSearchKey(p.title), title: p.title, start: p.start, stop: p.stop, channelId: p.channelId });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  const rowOf = new Map();
  (await readGuideIndex(db)).forEach((row) => {
    if (!rowOf.has(row.epgChannelId)) rowOf.set(row.epgChannelId, row.key);
  });
  return { titles, rowOf };
}

/**
 * Programmes of the next 24 hours whose title has every word of `query` (folded like the catalog search): `[{ title, start, stop, channelId,
 * rowKey }]`, the Live TV row (group or channel in no group) that shows the channel. Whole title first, then titles starting with the
 * query, then the rest; inside a rank on air first, then by start. One per channel and title (the next airing).
 */
export function searchProgrammeRows(data, query, { limit = 20, now = Date.now() } = {}) {
  const normalized = makeSearchKey(query);
  if (normalized.length < 2 || !data) return [];
  const words = normalized.split(' ');
  const rank = (key) => (key === normalized ? 3 : key.indexOf(normalized) === 0 ? 2 : 1);
  const found = [];
  for (const p of data.titles) {
    if (p.stop > now && p.start < now + DAY && data.rowOf.has(p.channelId) && words.every((w) => p.key.indexOf(w) >= 0)) found.push({ p, rank: rank(p.key), live: p.start <= now });
  }
  found.sort((a, b) => b.rank - a.rank || Number(b.live) - Number(a.live) || a.p.start - b.p.start);
  const seen = new Set();
  const out = [];
  for (const { p } of found) {
    const id = `${p.channelId}|${p.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ title: p.title, start: p.start, stop: p.stop, channelId: p.channelId, rowKey: data.rowOf.get(p.channelId) });
    if (out.length >= limit) break;
  }
  return out;
}

