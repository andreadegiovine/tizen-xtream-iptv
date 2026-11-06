import { AppError, ErrorCode } from '../core/errors.js';

/*
 * OpenSubtitles (REST API v1): subtitles for a title that has none of its own, found by its TMDB id. Nothing is stored by the app:
 * a downloaded file stays in memory for the session (the same title does not spend the daily quota twice) and in the browser cache.
 * Without an API key (typed in Settings) the feature is off. Downloads without an account are limited by OpenSubtitles (a few a day).
 */
const API = 'https://api.opensubtitles.com/api/v1';
const APP = `XtreamIPTV v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0'}`;

/** "00:01:02,500" / "01:02.500" → ms; NaN when it is not a time. */
export function parseTime(text) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(String(text).trim());
  if (!m) return NaN;
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0'));
}

/** SRT or WebVTT text → cues [{ start, end, text }] (ms), sorted by start. Blocks without a valid time line are skipped. */
export function parseSubtitles(text) {
  const blocks = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  const cues = [];
  blocks.forEach((block) => {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.indexOf('-->') >= 0);
    if (at < 0) return;
    const [from, rest] = lines[at].split('-->');
    const start = parseTime(from);
    const end = parseTime(String(rest).trim().split(/\s+/)[0]);
    const body = lines.slice(at + 1).join('\n').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && body) cues.push({ start, end, text: body });
  });
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue on at `ms` (binary search on the sorted cues; overlapping cues: the latest that started). */
export function cueAt(cues, ms) {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = found; i >= 0 && i > found - 5; i -= 1) if (cues[i].end > ms) return cues[i];
  return null;
}

/** Query string with the parameters in alphabetical order and lowercase values (what the API asks, to avoid a redirect). */
export function searchQuery({ tmdbId, season = null, episode = null, languages }) {
  const params = season !== null && episode !== null
    ? { episode_number: episode, languages: languages.join(','), parent_tmdb_id: tmdbId, season_number: season }
    : { languages: languages.join(','), tmdb_id: tmdbId };
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(String(params[k]).toLowerCase())}`)
    .join('&');
}

/** The best file of a search: language in the order asked, then not machine / AI translated, then the most downloaded. */
export function pickSubtitle(data, languages) {
  const rank = (lang) => {
    const i = languages.indexOf(String(lang || '').toLowerCase());
    return i < 0 ? languages.length : i;
  };
  const list = (Array.isArray(data) ? data : [])
    .map((item) => item && item.attributes)
    .filter((a) => a && Array.isArray(a.files) && a.files.length && a.files[0].file_id);
  list.sort(
    (a, b) =>
      rank(a.language) - rank(b.language) ||
      Number(Boolean(a.machine_translated || a.ai_translated)) - Number(Boolean(b.machine_translated || b.ai_translated)) ||
      (b.download_count || 0) - (a.download_count || 0),
  );
  const best = list[0];
  return best ? { fileId: best.files[0].file_id, language: String(best.language || '').toLowerCase() } : null;
}

/** Languages to ask for: the app's language, then English. */
export function subtitleLanguages(locale) {
  const main = String(locale || 'en').toLowerCase().split('-')[0];
  return main === 'en' ? ['en'] : [main, 'en'];
}

export function createOpenSubtitles({ getKey = () => '', doFetch = (...args) => fetch(...args) } = {}) {
  const memo = new Map(); // query → Promise<{ language, cues } | null>, for this session only

  async function call(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json', 'Api-Key': getKey(), 'X-User-Agent': APP };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await doFetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (cause) {
      throw new AppError(ErrorCode.NETWORK, 'OpenSubtitles unreachable', { cause });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw new AppError(ErrorCode.HTTP, `OpenSubtitles HTTP ${res.status}`, { details: { status: res.status, message: data && data.message } });
    return data;
  }

  async function find(query) {
    const found = await call(`/subtitles?${searchQuery(query)}`);
    const best = pickSubtitle(found && found.data, query.languages);
    if (!best) return null;
    const link = await call('/download', { method: 'POST', body: { file_id: best.fileId } });
    if (!link || !link.link) return null;
    let res;
    try {
      res = await doFetch(link.link);
    } catch (cause) {
      throw new AppError(ErrorCode.NETWORK, 'Subtitle file unreachable', { cause });
    }
    if (!res.ok) throw new AppError(ErrorCode.HTTP, `Subtitle file HTTP ${res.status}`);
    const cues = parseSubtitles(await res.text());
    return cues.length ? { language: best.language, cues } : null;
  }

  return {
    get enabled() {
      return Boolean(getKey());
    },
    /**
     * Subtitles of a movie ({ tmdbId, languages }) or of an episode ({ tmdbId of the series, season, episode, languages }):
     * { language, cues } or null when OpenSubtitles has none. A failure is not remembered (it is tried again next time).
     */
    fetch(query) {
      const key = searchQuery(query);
      if (!memo.has(key)) {
        const job = find(query);
        memo.set(key, job);
        job.catch(() => memo.delete(key));
      }
      return memo.get(key);
    },
  };
}
