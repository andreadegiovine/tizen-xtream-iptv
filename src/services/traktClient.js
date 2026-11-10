import { AppError, ErrorCode } from '../core/errors.js';

const API = 'https://api.trakt.tv';

/** Trakt REST wrapper (device-code OAuth + history). Without a client id the whole feature is off. */
export function createTraktClient({ clientId = '', clientSecret = '', getCredentials = () => ({ clientId, clientSecret }), doFetch = (...args) => fetch(...args) } = {}) {
  const isEnabled = () => {
    const c = getCredentials();
    return Boolean(c.clientId && c.clientSecret);
  };

  async function call(path, { method = 'GET', body, token } = {}) {
    if (!isEnabled()) throw new AppError(ErrorCode.UNKNOWN, 'Trakt is not configured');
    const { clientId } = getCredentials();
    const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await doFetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (cause) {
      throw new AppError(ErrorCode.NETWORK, 'Trakt unreachable', { cause });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    // Paginated lists (the watched lists since July 2026): the pages there are, from the headers.
    const header = (name) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null);
    const pages = Number(header('X-Pagination-Page-Count')) || 0;
    // 429 (too many requests: Trakt takes about one POST a second): how long to wait, in seconds.
    const retryAfter = Number(header('Retry-After')) || 0;
    return { status: res.status, ok: res.ok, data, pages, retryAfter };
  }

  return {
    get enabled() {
      return isEnabled();
    },
    deviceCode: () => call('/oauth/device/code', { method: 'POST', body: { client_id: getCredentials().clientId } }),
    /** status 200 = token; 400 = pending; 429 = slow down; 404/409/410/418 = give up. */
    pollToken: (deviceCode) =>
      call('/oauth/device/token', { method: 'POST', body: { code: deviceCode, client_id: getCredentials().clientId, client_secret: getCredentials().clientSecret } }),
    refresh: (refreshToken) =>
      call('/oauth/token', {
        method: 'POST',
        body: { refresh_token: refreshToken, client_id: getCredentials().clientId, client_secret: getCredentials().clientSecret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' },
      }),
    /** Signed-in user (username) for the settings page. */
    profile: (token) => call('/users/settings', { token }),
    addHistory: (token, payload) => call('/sync/history', { method: 'POST', body: payload, token }),
    /** Takes titles out of the history (a movie, or a whole show with all its episodes). */
    removeHistory: (token, payload) => call('/sync/history/remove', { method: 'POST', body: payload, token }),
    /** Playback progress: action = start | pause | stop. `pause` keeps the point reached, so it can be resumed anywhere. */
    scrobble: (token, action, payload) => call(`/scrobble/${action}`, { method: 'POST', body: payload, token }),
    /** Titles stopped half way, with their progress (percent). */
    playback: (token) => call('/sync/playback?extended=full', { token }), // full: the runtime, to turn the percentage into a position
    lastActivities: (token) => call('/sync/last_activities', { token }), // when each kind of data last changed: tells if a full read is needed
    /**
     * The watched lists are paginated (100 items without `limit`, at most 250 a page; `extended=progress` at most 100): one page here, the
     * service reads them all. Shows need `extended=progress` for their seasons and episodes (not given by default any more).
     */
    watchedMovies: (token, { page = 1, limit = 250 } = {}) => call(`/sync/watched/movies?page=${page}&limit=${limit}`, { token }),
    watchedShows: (token, { page = 1, limit = 100 } = {}) => call(`/sync/watched/shows?extended=progress&page=${page}&limit=${limit}`, { token }),
    /** Personalised picks for the signed-in user. */
    recommendations: (token, kind) => call(`/recommendations/${kind}?limit=100`, { token }), // the most Trakt gives
    /** tmdb id → trakt ids (slug), needed by the "related" call. */
    lookupTmdb: (kind, tmdbId) => call(`/search/tmdb/${tmdbId}?type=${kind === 'shows' ? 'show' : 'movie'}`),
    related: (kind, slug) => call(`/${kind}/${slug}/related?limit=100`),
  };
}
