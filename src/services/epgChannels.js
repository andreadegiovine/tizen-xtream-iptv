/**
 * What the downloaded guide says about each channel, worked out once per download (in the EPG worker) and kept in `meta` until the
 * guide expires: the span of its programmes and its genres (the XMLTV `<category>` of its programmes). The guide page and the Live TV
 * sidebar read this one record instead of walking every programme.
 */
export const EPG_CHANNELS_KEY = 'epg:channels';

/** Same genre whatever the case, accents or spacing ("Sport", "SPORT ", "Spòrt"). */
export function genreKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Display name: spaces collapsed, first letter upper case ("sport" → "Sport"). */
function genreName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Feed it the programmes as they are written (`add`), then `result()` gives the record to store. */
export function createChannelSummary() {
  const channels = new Map(); // id → { from, to, tagged, counts: Map(key → count) }
  const names = new Map(); // genre key → the name seen first

  return {
    add(p) {
      let c = channels.get(p.channelId);
      if (!c) {
        c = { from: p.start, to: p.stop, tagged: 0, counts: new Map() };
        channels.set(p.channelId, c);
      }
      if (p.start < c.from) c.from = p.start;
      if (p.stop > c.to) c.to = p.stop;
      const keys = new Set();
      (p.categories || []).forEach((name) => {
        const key = genreKey(name);
        if (!key || keys.has(key)) return;
        keys.add(key);
        if (!names.has(key)) names.set(key, genreName(name));
      });
      if (!keys.size) return;
      c.tagged += 1;
      keys.forEach((key) => c.counts.set(key, (c.counts.get(key) || 0) + 1));
    },
    /** `{ key, until, channels: { id: { from, to, genres?: [key] } }, genres: { key: name } }` (only the genres some channel has). */
    result() {
      const out = {};
      const used = {};
      let until = 0;
      channels.forEach((c, id) => {
        const row = { from: c.from, to: c.to };
        if (c.to > until) until = c.to;
        if (c.tagged) {
          // The category belongs to the programme: a channel is listed under every category one of its programmes has (most frequent first).
          const sorted = Array.from(c.counts.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
          const genres = sorted.map(([key]) => key);
          genres.forEach((key) => {
            used[key] = names.get(key);
          });
          row.genres = genres;
        }
        out[id] = row;
      });
      return { key: EPG_CHANNELS_KEY, until, channels: out, genres: used };
    },
  };
}

/** True when the stored summary still describes the guide (its programmes have not all ended). */
export const summaryValid = (summary, now = Date.now()) => Boolean(summary && summary.channels && summary.until > now);

/** The channel ids whose programmes cover part of [from, to). */
export function channelsBetween(summary, from, to) {
  const out = new Set();
  Object.keys(summary.channels).forEach((id) => {
    const c = summary.channels[id];
    if (c.from < to && c.to > from) out.add(id);
  });
  return out;
}
