import { kvGet, kvSet, kvDelete } from '../db/kv.js';
import { log } from '../core/logger.js';

const TOKEN_KEY = 'trakt.token';
const QUEUE_KEY = 'trakt.queue';
const ACCOUNT_KEY = 'trakt.account';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (!(progress >= 1) || progress >= 100) return null;
  const tmdb = Number(match[2]);
  if (match[1] === 'movie') return { movie: { ids: { tmdb } }, progress };
  const ep = /^s(\d+)e(\d+)$/.exec(record.episodeKey || '');
  return ep ? { show: { ids: { tmdb } }, episode: { season: Number(ep[1]), number: Number(ep[2]) }, progress } : null;
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

/** Trakt playback list → [{ key, progress, pausedAt }] with the keys the local watch records use. */
export function playbackItems(data) {
  const out = [];
  data.forEach((item) => {
    const progress = Number(item.progress);
    const pausedAt = Date.parse(item.paused_at) || 0;
    if (item.type === 'movie' && item.movie && item.movie.ids && item.movie.ids.tmdb) out.push({ key: `movie:t${item.movie.ids.tmdb}`, progress, pausedAt });
    else if (item.type === 'episode' && item.show && item.show.ids && item.show.ids.tmdb && item.episode) {
      out.push({ key: `series:t${item.show.ids.tmdb}|s${item.episode.season}e${item.episode.number}`, progress, pausedAt });
    }
  });
  return out;
}

export function createTraktService({ db, client, now = Date.now, wait = sleep }) {
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
    /** The point reached in a movie / episode (when paused or closed). Best effort: never throws, nothing is queued. */
    async reportProgress(record) {
      try {
        const payload = progressPayload(record);
        if (!payload || !(await service.isConnected())) return false;
        const access = await token();
        if (!access) return false;
        return (await client.scrobble(access, 'pause', payload)).ok;
      } catch (err) {
        log.warn('Trakt progress failed', err && err.message);
        return false;
      }
    },
    /** Sends what is waiting. Resolves with the ids of the entries Trakt took. */
    async flush() {
      const sent = [];
      try {
        const pending = (await queue()).map((item, i) => (item && item.op ? item : { op: 'add', payload: item, id: `old${i}` }));
        if (!pending.length) return sent;
        const access = await token();
        if (!access) return sent;
        const left = [];
        for (const item of pending) {
          const res = item.op === 'remove' ? await client.removeHistory(access, item.payload) : await client.addHistory(access, item.payload);
          if (res.ok) sent.push(item.id);
          else if (res.status >= 500) left.push(item); // transient: keep; 4xx would never succeed
        }
        await kvSet(db, QUEUE_KEY, left);
      } catch (err) {
        log.warn('Trakt flush failed', err && err.message);
      }
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
      const res = await client.watchedShows(access);
      if (!res.ok || !Array.isArray(res.data)) return [];
      return flattenWatchedShows(res.data, limit, now());
    },
    /**
     * Everything Trakt knows: { movies, episodes, playback }, or null when the watched lists could not be read
     * (then nothing must be removed locally). `playback`: titles stopped half way, [{ key, progress, pausedAt }].
     */
    async fetchState() {
      const access = await token();
      if (!access) return null;
      const [movies, shows, playback] = await Promise.all([client.watchedMovies(access), client.watchedShows(access), client.playback(access).catch(() => ({ ok: false }))]);
      if (!movies.ok || !Array.isArray(movies.data) || !shows.ok || !Array.isArray(shows.data)) return null;
      return {
        movies: movies.data
          .filter((m) => m.movie && m.movie.ids && m.movie.ids.tmdb)
          .map((m) => ({ tmdbId: m.movie.ids.tmdb, title: m.movie.title || '', watchedAt: Date.parse(m.last_watched_at) || now() })),
        episodes: flattenWatchedShows(shows.data, Infinity, now()),
        playback: playback.ok && Array.isArray(playback.data) ? playbackItems(playback.data) : [],
      };
    },
    /** Most recently watched movies (tmdb ids), used to seed local history and suggestions. */
    async recentMovies(limit = 30) {
      const access = await token();
      if (!access) return [];
      const res = await client.watchedMovies(access);
      if (!res.ok || !Array.isArray(res.data)) return [];
      return res.data
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
export function createWatchState({ store, trakt }) {
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
     * change on the title (episodes of a series are reported one by one only when they are really watched).
     */
    markWatched: (records, now) =>
      queued(async () => {
        for (const record of records) await store.save({ ...record, position: 1, duration: 1 }, now);
        if (!trakt || !records.length) return;
        if (await trakt.reportManual(records[0].entryKey, true).catch(() => false)) {
          for (const record of records) await store.patch(record.key, { traktSynced: true });
        }
      }),
    /** "Not seen" by hand: local history of the title forgotten, and the title taken out of the Trakt history. */
    clearEntry: (providerId, entryKey) =>
      queued(async () => {
        const count = await store.clearEntry(providerId, entryKey);
        if (trakt) await trakt.reportManual(entryKey, false).catch(() => false);
        return count;
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
    async importFromTrakt({ signal = null } = {}) {
      if (!trakt) return 0;
      await trakt.flush(); // what is waiting goes out first: Trakt must not look behind
      const state = await trakt.fetchState();
      if (!state) return 0;
      const all = await store.all();
      const local = new Map(all.map((r) => [r.key, r]));
      const onTrakt = new Set();
      let changed = 0;
      const aborted = () => Boolean(signal && signal.aborted);
      const watched = async (key, base, at) => {
        onTrakt.add(key);
        const mine = local.get(key);
        if (mine && mine.watched) {
          if (!mine.traktSynced) await store.patch(key, { traktSynced: true });
          return;
        }
        const duration = mine && mine.duration > 1 ? mine.duration : 1;
        await store.save({ ...(mine || { ...base, providerId: null, icon: '', source: 'trakt' }), position: duration, duration, traktSynced: true }, at);
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
      for (const rec of all) {
        if (aborted()) return changed;
        if (rec.watched && (rec.source === 'trakt' || rec.traktSynced) && /:t\d+/.test(rec.key) && !onTrakt.has(rec.key)) {
          await store.remove(rec.key);
          changed += 1;
        }
      }
      for (const item of state.playback) {
        if (aborted()) return changed;
        const mine = local.get(item.key);
        if (!mine || mine.watched || onTrakt.has(item.key) || !(mine.duration > 1) || item.pausedAt <= (mine.updatedAt || 0)) continue;
        const position = Math.round((item.progress / 100) * mine.duration);
        if (Math.abs(position - mine.position) < mine.duration * 0.01) continue;
        await store.save({ ...mine, position }, item.pausedAt);
        changed += 1;
      }
      return changed;
    },
    /** Forgets everything that came from Trakt (local history stays). */
    removeTraktData: () => store.removeBySource('trakt'),
  };
}
