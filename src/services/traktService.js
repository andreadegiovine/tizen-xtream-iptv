import { kvGet, kvSet, kvDelete } from '../db/kv.js';
import { log } from '../core/logger.js';

const TOKEN_KEY = 'trakt.token';
const QUEUE_KEY = 'trakt.queue';
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
    enabled: client.enabled,
    async isConnected() {
      return Boolean(await kvGet(db, TOKEN_KEY, null));
    },
    async disconnect() {
      await kvDelete(db, TOKEN_KEY);
      await kvDelete(db, QUEUE_KEY);
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
    async save(record, now) {
      const before = await store.get(record.key);
      const saved = await store.save(record, now);
      if (saved.watched && !(before && before.watched) && trakt) trakt.reportWatched(saved).catch(() => undefined);
      return saved;
    },
    /** Imports Trakt's recent movies as watched history (without overwriting what exists locally). */
    async importFromTrakt() {
      if (!trakt) return 0;
      let count = 0;
      for (const movie of await trakt.recentMovies()) {
        const key = `movie:t${movie.tmdbId}`;
        if (await store.get(key)) continue;
        await store.save({ key, entryKey: key, type: 'movie', providerId: null, title: movie.title, icon: '', position: 1, duration: 1 }, movie.watchedAt);
        count += 1;
      }
      return count;
    },
  };
}
