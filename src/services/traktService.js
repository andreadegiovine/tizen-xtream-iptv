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
    /** Reports a finished title; failures are queued and retried by flush(). Never throws. */
    async reportWatched(record) {
      const payload = historyPayload(record);
      if (!payload || !(await service.isConnected())) return;
      await kvSet(db, QUEUE_KEY, [...(await queue()), payload]);
      await service.flush();
    },
    async flush() {
      try {
        const pending = await queue();
        if (!pending.length) return;
        const access = await token();
        if (!access) return;
        const left = [];
        for (const payload of pending) {
          const res = await client.addHistory(access, payload);
          if (!res.ok && res.status >= 500) left.push(payload); // transient: keep; 4xx would never succeed
        }
        await kvSet(db, QUEUE_KEY, left);
      } catch (err) {
        log.warn('Trakt flush failed', err && err.message);
      }
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
  return {
    get: (key) => store.get(key),
    recent: (options) => store.recent(options),
    recentForEntry: (entryKey) => store.recentForEntry(entryKey),
    seeds: (limit) => store.seeds(limit),
    all: () => store.all(),
    clearEntry: (providerId, entryKey) => store.clearEntry(providerId, entryKey),
    /** "Mark as watched" by hand: stored locally, not reported to Trakt one by one. */
    async markWatched(records, now) {
      for (const record of records) await store.save({ ...record, position: 1, duration: 1 }, now);
    },
    async save(record, now) {
      const before = await store.get(record.key);
      const saved = await store.save(record, now);
      if (saved.watched && !(before && before.watched) && trakt) trakt.reportWatched(saved).catch(() => undefined);
      return saved;
    },
    /**
     * Imports what Trakt knows as watched (movies and episodes) without overwriting local records.
     * Imported records carry `source: 'trakt'`, so they can be removed again on their own.
     */
    async importFromTrakt({ signal = null } = {}) {
      if (!trakt) return 0;
      let count = 0;
      for (const movie of await trakt.recentMovies(500)) {
        const key = `movie:t${movie.tmdbId}`;
        if (signal && signal.aborted) return count;
        if (await store.get(key)) continue;
        await store.save({ key, entryKey: key, type: 'movie', providerId: null, title: movie.title, icon: '', position: 1, duration: 1, source: 'trakt' }, movie.watchedAt);
        count += 1;
      }
      for (const ep of await trakt.watchedEpisodes()) {
        const entryKey = `series:t${ep.tmdbId}`;
        const episodeKey = `s${ep.season}e${ep.episode}`;
        const key = `${entryKey}|${episodeKey}`;
        if (signal && signal.aborted) return count;
        if (await store.get(key)) continue;
        await store.save({ key, entryKey, episodeKey, type: 'series', providerId: null, title: ep.title, icon: '', position: 1, duration: 1, source: 'trakt' }, ep.watchedAt);
        count += 1;
      }
      return count;
    },
    /** Forgets everything that came from Trakt (local history stays). */
    removeTraktData: () => store.removeBySource('trakt'),
  };
}
