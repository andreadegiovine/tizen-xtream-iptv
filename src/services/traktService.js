import { kvGet, kvSet, kvDelete } from '../db/kv.js';
import { log } from '../core/logger.js';

const TOKEN_KEY = 'trakt.token';
const QUEUE_KEY = 'trakt.queue';
const ACTIVITIES_KEY = 'trakt.activities'; // the account's last_activities at the last full alignment
const PROGRESS_KEY = 'trakt.progress'; // the point reached that could not be sent: one per title, the latest
const DEFAULT_MOVIE_S = 6000;
const DEFAULT_EPISODE_S = 2700;
const ACCOUNT_KEY = 'trakt.account';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Trakt takes about one write (POST) a second from the same user: the writes sent one after the other wait this long between them. */
const POST_GAP_MS = 1100;

/**
 * An answer that may go through another time: Trakt down (5xx), too many requests (429), the session to renew (401) or refused for now (403).
 * Anything else (400, 404, 409, 420, 422...) would never be taken: dropped.
 */
export const isTransient = (res) => !res || res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403;

/** History payload for one finished title (movie, or one episode of a show). */
export function historyPayload(record, watchedAt = new Date().toISOString()) {
  const match = /^(movie|series):t(\d+)$/.exec(record.entryKey || '');
  if (!match) return null; // only titles with a tmdb id can be reported
  const tmdb = Number(match[2]);
  if (match[1] === 'movie') return { movies: [{ ids: { tmdb }, watched_at: watchedAt }] };
  const ep = /^s(\d+)e(\d+)$/.exec(record.episodeKey || '');
  if (!ep) return null;
  return { shows: [{ ids: { tmdb }, seasons: [{ number: Number(ep[1]), episodes: [{ number: Number(ep[2]), watched_at: watchedAt }] }] }] };
}

/**
 * Payload for a manual "seen / not seen" on a whole title: a movie, or a whole show (every episode). Only titles with a tmdb id.
 * Watched adds it to the history, unwatched takes it out.
 */
export function manualPayload(entryKey, watched, watchedAt = new Date().toISOString()) {
  const match = /^(movie|series):t(\d+)$/.exec(entryKey || '');
  if (!match) return null;
  const ids = { tmdb: Number(match[2]) };
  const item = watched ? { ids, watched_at: watchedAt } : { ids };
  return match[1] === 'movie' ? { movies: [item] } : { shows: [item] };
}

/** Scrobble payload for the point reached in a movie or an episode (progress in percent), or null when it cannot be told. */
export function progressPayload(record) {
  const match = /^(movie|series):t(\d+)$/.exec(record.entryKey || '');
  if (!match || !(record.duration > 1)) return null;
  const progress = Math.round((record.position / record.duration) * 10000) / 100;
  if (!(progress >= 1) || progress >= 99) return null; // from 99 % on the title is a watched one, not a point reached
  const tmdb = Number(match[2]);
  if (match[1] === 'movie') return { movie: { ids: { tmdb } }, progress };
  const ep = /^s(\d+)e(\d+)$/.exec(record.episodeKey || '');
  return ep ? { show: { ids: { tmdb } }, episode: { season: Number(ep[1]), number: Number(ep[2]) }, progress } : null;
}

/** The playback entries of Trakt that are the point reached in `record`'s movie or episode (tmdb ids only). */
export function playbackMatches(items, record) {
  const match = /^(movie|series):t(\d+)$/.exec(record.entryKey || '');
  if (!match || !Array.isArray(items)) return [];
  const tmdb = Number(match[2]);
  if (match[1] === 'movie') return items.filter((item) => item && item.type === 'movie' && item.movie && item.movie.ids && Number(item.movie.ids.tmdb) === tmdb);
  const ep = /^s(\d+)e(\d+)$/.exec(record.episodeKey || '');
  if (!ep) return [];
  return items.filter(
    (item) => item && item.type === 'episode' && item.show && item.show.ids && Number(item.show.ids.tmdb) === tmdb && item.episode && item.episode.season === Number(ep[1]) && item.episode.number === Number(ep[2]),
  );
}

/**
 * Every page of a paginated Trakt list: `fetchPage(page)` → { ok, data, pages }. Resolves with all the items, or null when a page could not
 * be read (a partial list must never be taken for the whole one). Stops at the page count of the headers, on an empty page, or at maxPages.
 */
export async function readAllPages(fetchPage, maxPages = 200) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchPage(page);
    if (!res || !res.ok || !Array.isArray(res.data)) return null;
    all.push(...res.data);
    if (!res.data.length || (res.pages > 0 && page >= res.pages)) break; // no page count in the headers: until an empty page
  }
  return all;
}

/** What Trakt did not take from a /sync/history answer: { movies: Set(tmdb), shows: Set(tmdb) } (ids it could not match). */
export function notFoundIds(data) {
  const nf = (data && data.not_found) || {};
  const ids = (list) => new Set((Array.isArray(list) ? list : []).map((item) => item && item.ids && item.ids.tmdb).filter(Boolean).map(Number));
  return { movies: ids(nf.movies), shows: ids(nf.shows) };
}

/** True when Trakt matched none of the titles of an /sync/history payload (every movie and show of it is in `not_found`). */
export function unmatched(payload, data) {
  const missing = notFoundIds(data);
  const tmdbOf = (item) => Number(item && item.ids && item.ids.tmdb);
  const movies = (payload && payload.movies) || [];
  const shows = (payload && payload.shows) || [];
  if (!movies.length && !shows.length) return false;
  return movies.every((m) => missing.movies.has(tmdbOf(m))) && shows.every((sh) => missing.shows.has(tmdbOf(sh)));
}

/**
 * One show of the watched list → { tmdbId, aired, watched, complete }: `aired` the episodes aired so far (Trakt's `aired_episodes`, or the
 * show's own `aired_episodes`), `watched` the ones watched out of the regular seasons (specials do not count, as in Trakt's count).
 */
export function showProgress(entry) {
  const aired = Number(entry.aired_episodes || (entry.show && entry.show.aired_episodes)) || 0;
  let watched = 0;
  (entry.seasons || []).forEach((season) => {
    if (Number(season.number) > 0) watched += (season.episodes || []).length;
  });
  return { tmdbId: Number(entry.show.ids.tmdb), aired, watched, complete: aired > 0 && watched >= aired };
}

/** Trakt "watched shows" payload → flat episode list, newest shows first. */
export function flattenWatchedShows(data, limit = 3000, fallbackAt = Date.now()) {
  const out = [];
  const shows = data
    .filter((entry) => entry.show && entry.show.ids && entry.show.ids.tmdb)
    .sort((a, b) => String(b.last_watched_at).localeCompare(String(a.last_watched_at)));
  for (const entry of shows) {
    const watchedAt = Date.parse(entry.last_watched_at) || fallbackAt;
    for (const season of entry.seasons || []) {
      for (const episode of season.episodes || []) {
        if (out.length >= limit) return out;
        out.push({ tmdbId: entry.show.ids.tmdb, title: entry.show.title || '', season: season.number, episode: episode.number, watchedAt });
      }
    }
  }
  return out;
}

/**
 * Trakt playback list → [{ key, entryKey, episodeKey, type, title, episodeTitle, progress, pausedAt, duration }] with the keys the local
 * watch records use. `duration` (seconds) comes from the runtime Trakt gives, or a typical one.
 */
export function playbackItems(data) {
  const out = [];
  data.forEach((item) => {
    const progress = Number(item.progress);
    const pausedAt = Date.parse(item.paused_at) || 0;
    if (item.type === 'movie' && item.movie && item.movie.ids && item.movie.ids.tmdb) {
      const entryKey = `movie:t${item.movie.ids.tmdb}`;
      const duration = Number(item.movie.runtime) > 0 ? Number(item.movie.runtime) * 60 : DEFAULT_MOVIE_S;
      out.push({ key: entryKey, entryKey, episodeKey: null, type: 'movie', title: item.movie.title || '', episodeTitle: '', progress, pausedAt, duration });
    } else if (item.type === 'episode' && item.show && item.show.ids && item.show.ids.tmdb && item.episode) {
      const entryKey = `series:t${item.show.ids.tmdb}`;
      const episodeKey = `s${item.episode.season}e${item.episode.number}`;
      const runtime = Number(item.episode.runtime) || Number(item.show.runtime) || 0;
      out.push({ key: `${entryKey}|${episodeKey}`, entryKey, episodeKey, type: 'series', title: item.show.title || '', episodeTitle: item.episode.title || '', progress, pausedAt, duration: runtime > 0 ? runtime * 60 : DEFAULT_EPISODE_S });
    }
  });
  return out;
}

export function createTraktService({ db, client, now = Date.now, wait = sleep }) {
  let lastPost = 0;
  /** One write to Trakt: spaced from the previous one, tried once more after the wait Trakt asks for when it answers 429. */
  async function post(send) {
    const gap = lastPost + POST_GAP_MS - now();
    if (gap > 0) await wait(gap);
    let res = await send();
    lastPost = now();
    if (res && res.status === 429) {
      await wait(Math.min(10, Math.max(1, res.retryAfter || 1)) * 1000);
      res = await send();
      lastPost = now();
    }
    return res;
  }

  async function token() {
    const stored = await kvGet(db, TOKEN_KEY, null);
    if (!stored) return null;
    if (stored.expiresAt - now() > 24 * 3600 * 1000) return stored.accessToken;
    const res = await client.refresh(stored.refreshToken);
    if (!res.ok) return null; // expired for good: the user must reconnect
    await saveToken(res.data);
    return res.data.access_token;
  }

  const saveToken = (data) => kvSet(db, TOKEN_KEY, { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: (data.created_at + data.expires_in) * 1000 });

  async function queue() {
    return kvGet(db, QUEUE_KEY, []);
  }

  /** The point reached waiting for Trakt, one per title (the latest replaces the one before). */
  async function setWaiting(entryKey, value) {
    const waiting = await kvGet(db, PROGRESS_KEY, {});
    waiting[entryKey] = value;
    await kvSet(db, PROGRESS_KEY, waiting);
  }

  /** Taken out once Trakt has it (or would never take it): only if no newer point of the title was kept meanwhile. */
  async function forgetWaiting(entryKey, savedAt) {
    const waiting = await kvGet(db, PROGRESS_KEY, {});
    if (!waiting[entryKey] || waiting[entryKey].savedAt !== savedAt) return; // (points kept by older versions have none: undefined both)
    delete waiting[entryKey];
    await kvSet(db, PROGRESS_KEY, waiting);
  }

  /** The points reached not sent yet (one per title): tried again, whatever the history queue holds. */
  async function sendWaitingProgress() {
    try {
      const waiting = await kvGet(db, PROGRESS_KEY, {});
      const titles = Object.keys(waiting);
      if (!titles.length) return;
      const access = await token();
      if (!access) return;
      for (const title of titles) {
        const res = await post(() => client.scrobble(access, 'pause', waiting[title].payload));
        if (res.ok || !isTransient(res)) await forgetWaiting(title, waiting[title].savedAt);
      }
    } catch (err) {
      log.warn('Trakt progress retry failed', err && err.message);
    }
  }

  let seq = 0;
  /** Queues one change and tries to send it now. Resolves true when it went out. */
  async function enqueue(op, payload) {
    if (!payload || !(await service.isConnected())) return false;
    seq += 1;
    const id = `${now()}-${seq}`;
    await kvSet(db, QUEUE_KEY, [...(await queue()), { op, payload, id }]);
    return (await service.flush()).includes(id);
  }

  const service = {
    get enabled() {
      return client.enabled;
    },
    async isConnected() {
      return Boolean(await kvGet(db, TOKEN_KEY, null));
    },
    async disconnect() {
      await kvDelete(db, TOKEN_KEY);
      await kvDelete(db, QUEUE_KEY);
      await kvDelete(db, PROGRESS_KEY);
      await kvDelete(db, ACCOUNT_KEY);
    },
    /** Username of the connected account (kept after the first lookup), or '' when unknown. */
    async account() {
      const stored = await kvGet(db, ACCOUNT_KEY, '');
      if (stored) return stored;
      try {
        const access = await token();
        if (!access) return '';
        const res = await client.profile(access);
        const name = res.ok && res.data && res.data.user ? String(res.data.user.username || '') : '';
        if (name) await kvSet(db, ACCOUNT_KEY, name);
        return name;
      } catch {
        return '';
      }
    },
    /**
     * Device-code login. `onCode({ code, url })` shows the code to the user; resolves true when the
     * user approved, false when it expired/was refused/cancelled (`signal.aborted`).
     */
    async connect({ onCode, signal }) {
      const res = await client.deviceCode();
      if (!res.ok) return false;
      const { device_code: deviceCode, user_code: code, verification_url: url, interval = 5, expires_in: expiresIn = 600 } = res.data;
      onCode({ code, url });
      let delay = interval * 1000;
      const deadline = now() + expiresIn * 1000;
      while (now() < deadline && !(signal && signal.aborted)) {
        await wait(delay);
        if (signal && signal.aborted) return false;
        const poll = await client.pollToken(deviceCode);
        if (poll.status === 200) {
          await saveToken(poll.data);
          return true;
        }
        if (poll.status === 429) delay += 1000; // asked to slow down
        else if (poll.status !== 400) return false; // not found / used / expired / denied
      }
      return false;
    },
    /** Reports a finished title; failures are queued and retried by flush(). Never throws. Resolves true when Trakt took it. */
    async reportWatched(record) {
      return enqueue('add', historyPayload(record));
    },
    /** A manual "seen" (true) or "not seen" (false) on a whole title: a movie, or a whole show. Resolves true when Trakt took it. */
    async reportManual(entryKey, watched) {
      return enqueue(watched ? 'add' : 'remove', manualPayload(entryKey, watched));
    },
    /**
     * The point reached in a movie / episode (when paused or closed). Never throws. When Trakt cannot be reached it is kept
     * (one per title, the latest) and sent by flush(). Resolves true when Trakt took it.
     */
    async reportProgress(record) {
      try {
        const payload = progressPayload(record);
        if (!payload || !(await service.isConnected())) return false;
        // Kept first, sent after: an app closed while the request waits (spacing, 429) still has it for the next start.
        const savedAt = now();
        await setWaiting(record.entryKey, { payload, savedAt });
        let ok = false;
        let drop = false;
        try {
          const access = await token();
          if (access) {
            const res = await post(() => client.scrobble(access, 'pause', payload));
            ok = res.ok;
            drop = !res.ok && !isTransient(res); // a 400 / 404 would never succeed; 429, 401 and 5xx are tried again
          }
        } catch {
          /* unreachable: stays kept */
        }
        if (ok || drop) await forgetWaiting(record.entryKey, savedAt);
        return ok;
      } catch (err) {
        log.warn('Trakt progress failed', err && err.message);
        return false;
      }
    },
    /**
     * "Rewind": the point reached in a movie / episode removed from Trakt (its playback progress), and the one waiting to be sent with it.
     * Never throws. Resolves true when Trakt has no point for it any more.
     */
    async clearProgress(record) {
      try {
        const payload = progressPayload({ ...record, position: 1, duration: 2 }); // the same title / episode as a point would name
        if (!payload || !(await service.isConnected())) return false;
        const waiting = await kvGet(db, PROGRESS_KEY, {});
        const kept = waiting[record.entryKey];
        if (kept && JSON.stringify({ ...kept.payload, progress: 0 }) === JSON.stringify({ ...payload, progress: 0 })) await forgetWaiting(record.entryKey, kept.savedAt);
        const access = await token();
        if (!access) return false;
        const list = await client.playback(access);
        if (!list.ok) return false;
        let ok = true;
        for (const item of playbackMatches(list.data, record)) {
          const res = await post(() => client.removePlayback(access, item.id));
          if (!res.ok && res.status !== 404) ok = false;
        }
        return ok;
      } catch (err) {
        log.warn('Trakt rewind failed', err && err.message);
        return false;
      }
    },
    /**
     * Sends watched records Trakt does not have yet, in bulk (movies, and the episodes of each show). Resolves with the keys Trakt took;
     * what fails stays unsent and goes out the next time.
     */
    async sendHistory(records, { onNotFound = () => undefined } = {}) {
      const sent = [];
      const notFound = [];
      try {
        const access = await token();
        if (!access) return sent;
        for (let from = 0; from < records.length; from += 200) {
          const chunk = records.slice(from, from + 200);
          const movies = [];
          const shows = new Map();
          const keys = [];
          chunk.forEach((rec) => {
            const match = /^(movie|series):t(\d+)$/.exec(rec.entryKey || '');
            if (!match) return;
            const watchedAt = new Date(rec.updatedAt || now()).toISOString();
            const tmdb = Number(match[2]);
            if (match[1] === 'movie') movies.push({ ids: { tmdb }, watched_at: watchedAt });
            else {
              const ep = /^s(\d+)e(\d+)$/.exec(rec.episodeKey || '');
              if (!ep) return;
              const show = shows.get(tmdb) || { ids: { tmdb }, seasons: new Map() };
              const season = show.seasons.get(Number(ep[1])) || [];
              season.push({ number: Number(ep[2]), watched_at: watchedAt });
              show.seasons.set(Number(ep[1]), season);
              shows.set(tmdb, show);
            }
            keys.push(rec.key);
          });
          if (!keys.length) continue;
          const payload = {
            ...(movies.length ? { movies } : {}),
            ...(shows.size ? { shows: [...shows.values()].map((s) => ({ ids: s.ids, seasons: [...s.seasons].map(([number, episodes]) => ({ number, episodes })) })) } : {}),
          };
          const res = await post(() => client.addHistory(access, payload));
          if (!res.ok) continue;
          // The titles Trakt could not match by their TMDB id were not added: not sent (told to the caller, not sent again every time).
          const missing = notFoundIds(res.data);
          chunk.forEach((rec) => {
            const match = /^(movie|series):t(\d+)$/.exec(rec.entryKey || '');
            if (!match || !keys.includes(rec.key)) return;
            const lost = match[1] === 'movie' ? missing.movies.has(Number(match[2])) : missing.shows.has(Number(match[2]));
            if (lost) notFound.push(rec.key);
            else sent.push(rec.key);
          });
        }
      } catch (err) {
        log.warn('Trakt history upload failed', err && err.message);
      }
      if (notFound.length) await Promise.resolve(onNotFound(notFound)).catch(() => undefined);
      return sent;
    },
    /** Sends what is waiting. Resolves with the ids of the entries Trakt took. */
    async flush() {
      const sent = [];
      try {
        const pending = (await queue()).map((item, i) => (item && item.op ? item : { op: 'add', payload: item, id: `old${i}` }));
        if (!pending.length) {
          await sendWaitingProgress();
          return sent;
        }
        const access = await token();
        if (!access) return sent;
        const left = [];
        for (const item of pending) {
          let res = null;
          try {
            res = await post(() => (item.op === 'remove' ? client.removeHistory(access, item.payload) : client.addHistory(access, item.payload)));
          } catch {
            res = null; // unreachable: kept, tried again later
          }
          if (res && res.ok && item.op !== 'remove' && unmatched(item.payload, res.data)) {
            // 201, but Trakt does not know the title (its TMDB id): nothing was added, it would never be (not kept, not counted as sent).
            log.warn('Trakt did not find the title', JSON.stringify(item.payload).slice(0, 120));
          } else if (res && res.ok) sent.push(item.id);
          else if (isTransient(res)) left.push(item); // kept: Trakt down, too many requests, session to renew
        }
        await kvSet(db, QUEUE_KEY, left);
      } catch (err) {
        log.warn('Trakt flush failed', err && err.message);
      }
      await sendWaitingProgress();
      return sent;
    },
    /** Personalised recommendations as ranked lists [{ type, items: [{ id (tmdb), popularity }] }]. */
    async recommendations() {
      const access = await token();
      if (!access) return [];
      const lists = [];
      for (const [kind, type] of [['movies', 'movie'], ['shows', 'series']]) {
        const res = await client.recommendations(access, kind);
        if (!res.ok || !Array.isArray(res.data)) continue;
        const ids = res.data.map((item) => item.ids && item.ids.tmdb).filter(Boolean);
        lists.push({ type, items: ids.map((id, i) => ({ id, popularity: ids.length - i })) });
      }
      return lists;
    },
    /** Titles related to one tmdb title: [{ id, popularity }] (cached for a day). */
    async related(type, tmdbId) {
      const cacheKey = `trakt.related:${type}:${tmdbId}`;
      const hit = await kvGet(db, cacheKey, null);
      if (hit && now() - hit.savedAt < 24 * 3600 * 1000) return hit.items;
      const kind = type === 'series' ? 'shows' : 'movies';
      const found = await client.lookupTmdb(kind, tmdbId);
      const node = found.ok && Array.isArray(found.data) && found.data[0] && (found.data[0].movie || found.data[0].show);
      const slug = node && node.ids && node.ids.slug;
      if (!slug) return [];
      const res = await client.related(kind, slug);
      if (!res.ok || !Array.isArray(res.data)) return [];
      const ids = res.data.map((item) => item.ids && item.ids.tmdb).filter(Boolean);
      const items = ids.map((id, i) => ({ id, popularity: ids.length - i }));
      await kvSet(db, cacheKey, { savedAt: now(), items });
      return items;
    },
    /** Every watched episode on Trakt (tmdb show id + season/episode), capped. */
    async watchedEpisodes(limit = 3000) {
      const access = await token();
      if (!access) return [];
      const shows = await readAllPages((page) => client.watchedShows(access, { page }));
      return shows ? flattenWatchedShows(shows, limit, now()) : [];
    },
    /**
     * Everything Trakt knows: { movies, episodes, playback }, or null when the watched lists could not be read
     * (then nothing must be removed locally). `playback`: titles stopped half way, [{ key, progress, pausedAt }].
     */
    /** A string that changes when the account's watched titles or progress change (Trakt's last_activities), or null when unreadable. */
    async activitiesStamp() {
      const access = await token();
      if (!access) return null;
      const res = await client.lastActivities(access).catch(() => ({ ok: false }));
      if (!res.ok || !res.data) return null;
      const { movies = {}, episodes = {} } = res.data;
      return [movies.watched_at, movies.paused_at, episodes.watched_at, episodes.paused_at].join('|');
    },
    async savedActivities() {
      return kvGet(db, ACTIVITIES_KEY, '');
    },
    saveActivities(stamp) {
      return kvSet(db, ACTIVITIES_KEY, stamp);
    },
    async fetchState() {
      const access = await token();
      if (!access) return null;
      // Every page of both lists (Trakt gives 100 items a page): a list read only in part would make the rest look removed from Trakt.
      const [movies, shows, playback] = await Promise.all([
        readAllPages((page) => client.watchedMovies(access, { page })),
        readAllPages((page) => client.watchedShows(access, { page })),
        client.playback(access).catch(() => ({ ok: false })),
      ]);
      if (!movies || !shows) return null;
      const valid = shows.filter((entry) => entry.show && entry.show.ids && entry.show.ids.tmdb);
      return {
        movies: movies
          .filter((m) => m.movie && m.movie.ids && m.movie.ids.tmdb)
          .map((m) => ({ tmdbId: m.movie.ids.tmdb, title: m.movie.title || '', watchedAt: Date.parse(m.last_watched_at) || now() })),
        episodes: flattenWatchedShows(valid, Infinity, now()),
        // Shows Trakt gives without their episodes (an answer without seasons): watched there, their episodes here are left as they are.
        showsWithoutEpisodes: valid.filter((entry) => !Array.isArray(entry.seasons)).map((entry) => Number(entry.show.ids.tmdb)),
        // Per show: the episodes aired (Trakt's count, specials left out) and the ones watched of them: complete when none is left to watch.
        showsProgress: valid.filter((entry) => Array.isArray(entry.seasons)).map((entry) => showProgress(entry)),
        playback: playback.ok && Array.isArray(playback.data) ? playbackItems(playback.data) : [],
      };
    },
    /** Most recently watched movies (tmdb ids), used to seed local history and suggestions. */
    async recentMovies(limit = 30) {
      const access = await token();
      if (!access) return [];
      const movies = await readAllPages((page) => client.watchedMovies(access, { page }));
      if (!movies) return [];
      return movies
        .filter((m) => m.movie && m.movie.ids && m.movie.ids.tmdb)
        .sort((a, b) => String(b.last_watched_at).localeCompare(String(a.last_watched_at)))
        .slice(0, limit)
        .map((m) => ({ tmdbId: m.movie.ids.tmdb, title: m.movie.title || '', watchedAt: Date.parse(m.last_watched_at) || now() }));
    },
  };
  return service;
}

/**
 * Watch-state adapter: local store first (the source of truth for resume), Trakt as an add-on.
 * Same surface as WatchStore, so pages do not know whether Trakt is connected.
 */
/** A record changed this recently is never taken out because Trakt does not have it yet. */
const RECENT_MS = 15 * 60 * 1000;

export function createWatchState({ store, trakt, nowMs = () => Date.now() }) {
  let importOk = false;
  // Saves run one after the other, and every read waits for the ones already requested: a page that opens right
  // after the player (which saves while it closes) must see the progress that was just written.
  let pending = Promise.resolve();
  const queued = (job) => {
    const run = pending.then(job);
    pending = run.catch(() => undefined);
    return run;
  };
  const read = (fn) => (...args) => pending.then(() => fn(...args));
  return {
    get: read((key) => store.get(key)),
    recent: read((options) => store.recent(options)),
    recentForEntry: read((entryKey) => store.recentForEntry(entryKey)),
    seeds: read((limit) => store.seeds(limit)),
    seenKeys: read(() => store.seenKeys()),
    all: read(() => store.all()),
    /**
     * "Seen" by hand on a whole title (a movie, or a series with all its episodes): stored locally, and told to Trakt as ONE
     * change on the title (episodes of a series are reported one by one only when they are really watched). It runs in the
     * background queue: the page shows the title as seen at once and reads the episodes again when the returned promise resolves.
     * All the records go in one transaction (a long series used to take seconds, one write per episode).
     */
    markWatched: (records, now) =>
      queued(async () => {
        if (!records.length) return;
        const seen = records.map((record) => ({ ...record, position: 1, duration: 1 }));
        if (store.saveMany) await store.saveMany(seen, now);
        else for (const record of seen) await store.save(record, now);
        if (!trakt) return;
        if (await trakt.reportManual(records[0].entryKey, true).catch(() => false)) {
          if (store.saveMany) await store.saveMany(seen.map((record) => ({ ...record, traktSynced: true })), now);
          else for (const record of records) await store.patch(record.key, { traktSynced: true });
        }
      }),
    /** "Not seen" by hand: local history of the title forgotten, and the title taken out of the Trakt history. */
    clearEntry: (providerId, entryKey) =>
      queued(async () => {
        const count = await store.clearEntry(providerId, entryKey);
        if (trakt) await trakt.reportManual(entryKey, false).catch(() => false);
        return count;
      }),
    /**
     * "Rewind" a movie or an episode: the point reached goes back to the start (kept as a record at 0, newer than Trakt's, so an alignment
     * never brings the old point back) and Trakt forgets its playback progress. Resolves with the saved record.
     */
    rewind: (record, now) =>
      queued(async () => {
        const saved = await store.save({ ...record, position: 0 }, now);
        if (trakt && trakt.clearProgress) await trakt.clearProgress(record).catch(() => false);
        return saved;
      }),
    /** The point reached in a title (pause, close): told to Trakt, which keeps it as playback progress. Never throws. */
    reportProgress(record) {
      if (!trakt || !trakt.reportProgress) return Promise.resolve(false);
      return trakt.reportProgress(record).catch(() => false);
    },
    save: (record, now) =>
      queued(async () => {
        const before = await store.get(record.key);
        const saved = await store.save(record, now);
        if (saved.watched && !(before && before.watched) && trakt) {
          trakt.reportWatched(saved).then((sent) => sent && store.patch(saved.key, { traktSynced: true })).catch(() => undefined);
        }
        return saved;
      }),
    /**
     * Aligns the local state with Trakt (every time Trakt is read):
     * - what Trakt has as watched becomes watched here (records imported this way carry `source: 'trakt'`);
     * - what was reported to Trakt (or imported from it) and is no longer watched there, is not watched here either;
     * - the point reached in a title, when Trakt's is newer than the local one and the local duration is known.
     * Nothing is removed when Trakt could not be read. Resolves with the number of records that changed.
     */
    /** The alignment, but only when Trakt says something changed since the last one (one small request otherwise). */
    async syncIfChanged({ signal = null } = {}) {
      if (!trakt || !trakt.activitiesStamp) return 0;
      const activities = await trakt.activitiesStamp();
      // Read again also once a day: the episodes aired since (a complete show with a new episode comes back to Continue watching).
      const stamp = activities ? `${activities}#${new Date(nowMs()).toISOString().slice(0, 10)}` : null;
      if (stamp && stamp === (await trakt.savedActivities())) {
        await this.pushUnsent();
        return 0;
      }
      const changed = await this.importFromTrakt({ signal });
      if (stamp && importOk) await trakt.saveActivities(stamp); // only when Trakt could be read in full
      return changed;
    },
    async importFromTrakt({ signal = null } = {}) {
      if (!trakt) return 0;
      await trakt.flush(); // what is waiting goes out first: Trakt must not look behind
      const state = await trakt.fetchState();
      importOk = Boolean(state);
      if (!state) return 0;
      const all = await store.all();
      const local = new Map(all.map((r) => [r.key, r]));
      const onTrakt = new Set();
      let changed = 0;
      const aborted = () => Boolean(signal && signal.aborted);
      const watched = async (key, base, at, synced = true) => {
        onTrakt.add(key);
        const mine = local.get(key);
        if (mine && mine.watched) {
          if (synced && !mine.traktSynced) await store.patch(key, { traktSynced: true });
          return;
        }
        const duration = mine && mine.duration > 1 ? mine.duration : 1;
        await store.save({ ...(mine || { ...base, providerId: null, icon: '', source: 'trakt' }), position: duration, duration, traktSynced: synced }, at);
        changed += 1;
      };
      for (const movie of state.movies) {
        if (aborted()) return changed;
        const key = `movie:t${movie.tmdbId}`;
        await watched(key, { key, entryKey: key, type: 'movie', title: movie.title }, movie.watchedAt);
      }
      for (const ep of state.episodes) {
        if (aborted()) return changed;
        const entryKey = `series:t${ep.tmdbId}`;
        const key = `${entryKey}|s${ep.season}e${ep.episode}`;
        await watched(key, { key, entryKey, episodeKey: `s${ep.season}e${ep.episode}`, type: 'series', title: ep.title }, ep.watchedAt);
      }
      // Not taken for removed on Trakt: the episodes of a show Trakt gives without them, and what changed in the last minutes (Trakt can
      // take a while to show what it was just sent).
      const noEpisodes = new Set((state.showsWithoutEpisodes || []).map((id) => `series:t${id}`));
      const settled = (rec) => !(rec.updatedAt > nowMs() - RECENT_MS);
      for (const rec of all) {
        if (aborted()) return changed;
        if (noEpisodes.has(rec.entryKey) || !settled(rec)) continue;
        if (rec.watched && (rec.source === 'trakt' || rec.traktSynced) && /:t\d+/.test(rec.key) && !onTrakt.has(rec.key)) {
          await store.remove(rec.key);
          local.delete(rec.key);
          changed += 1;
        }
      }
      // A show Trakt has as complete (every aired episode watched) is finished here too: out of Continue watching, whatever TMDB counts
      // (TMDB also counts the episodes announced and not aired yet). It comes back when Trakt has a new aired episode not watched.
      const complete = new Map((state.showsProgress || []).map((show) => [`series:t${show.tmdbId}`, show.complete]));
      for (const rec of await store.all()) {
        if (aborted()) return changed;
        if (rec.type !== 'series' || !complete.has(rec.entryKey)) continue;
        const done = complete.get(rec.entryKey);
        if (Boolean(rec.traktComplete) !== done) await store.patch(rec.key, { traktComplete: done });
      }
      // Every point reached that Trakt holds (a series started there: its season, episode and progress) comes here when it is newer than ours.
      for (const item of state.playback) {
        if (aborted()) return changed;
        const mine = local.get(item.key);
        if (item.progress >= 99) {
          // 99 % or more is a watched title: here now, and Trakt gets it as watched (below).
          if (!onTrakt.has(item.key)) await watched(item.key, { key: item.key, entryKey: item.entryKey, episodeKey: item.episodeKey || undefined, type: item.type, title: item.title }, item.pausedAt, false);
          continue;
        }
        if (onTrakt.has(item.key) || (mine && (mine.watched || item.pausedAt <= (mine.updatedAt || 0)))) continue;
        const duration = mine && mine.duration > 1 ? mine.duration : item.duration;
        const position = Math.round((item.progress / 100) * duration);
        if (mine && duration === mine.duration && Math.abs(position - mine.position) < duration * 0.01) continue;
        const base = mine || { key: item.key, entryKey: item.entryKey, ...(item.episodeKey ? { episodeKey: item.episodeKey } : {}), type: item.type, title: item.title, episodeTitle: item.episodeTitle, providerId: null, icon: '', source: 'trakt' };
        await store.save({ ...base, position, duration }, item.pausedAt);
        changed += 1;
      }
      await this.pushUnsent(); // what was watched only here goes to Trakt too
      return changed;
    },
    /**
     * How many titles are aligned with Trakt: watched and in progress (continue watching). A series counts once, however many of its
     * episodes are watched (Trakt receives the show as one title when it is marked as seen).
     */
    async traktCounts() {
      const watched = new Set();
      const progress = new Set();
      for (const r of await store.all()) {
        const title = r.entryKey || r.key;
        if (r.watched) {
          if (r.source === 'trakt' || r.traktSynced) watched.add(title);
        } else if (r.source === 'trakt' && r.position > 0) progress.add(title);
      }
      return { watched: watched.size, progress: progress.size };
    },
    /** Watched titles Trakt has never received (watched before connecting, or when it was unreachable): sent in bulk. Resolves with how many went. */
    async pushUnsent() {
      if (!trakt || !trakt.sendHistory) return 0;
      const pending = (await store.all()).filter((r) => r.watched && !r.traktSynced && !r.traktUnknown && /^(movie|series):t\d+$/.test(r.entryKey || ''));
      if (!pending.length) return 0;
      // Titles Trakt does not know (their TMDB id): kept here, not sent again at every alignment.
      const sent = await trakt.sendHistory(pending, { onNotFound: async (keys) => { for (const key of keys) await store.patch(key, { traktUnknown: true }); } });
      for (const key of sent) await store.patch(key, { traktSynced: true });
      return sent.length;
    },
    /** Forgets everything that came from Trakt (local history stays). */
    removeTraktData: () => store.removeBySource('trakt'),
  };
}
