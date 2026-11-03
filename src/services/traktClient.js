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
    return { status: res.status, ok: res.ok, data };
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
    addHistory: (token, payload) => call('/sync/history', { method: 'POST', body: payload, token }),
    watchedMovies: (token) => call('/sync/watched/movies', { token }),
    watchedShows: (token) => call('/sync/watched/shows', { token }),
    /** Personalised picks for the signed-in user. */
    recommendations: (token, kind) => call(`/recommendations/${kind}?limit=40`, { token }),
    /** tmdb id → trakt ids (slug), needed by the "related" call. */
    lookupTmdb: (kind, tmdbId) => call(`/search/tmdb/${tmdbId}?type=${kind === 'shows' ? 'show' : 'movie'}`),
    related: (kind, slug) => call(`/${kind}/${slug}/related?limit=20`),
  };
}
