import { AppError, ErrorCode } from '../core/errors.js';

const API = 'https://api.trakt.tv';
export const TRAKT_CLIENT_ID = typeof __TRAKT_CLIENT_ID__ !== 'undefined' ? __TRAKT_CLIENT_ID__ : '';
export const TRAKT_CLIENT_SECRET = typeof __TRAKT_CLIENT_SECRET__ !== 'undefined' ? __TRAKT_CLIENT_SECRET__ : '';

/** Trakt REST wrapper (device-code OAuth + history). Without a client id the whole feature is off. */
export function createTraktClient({ clientId = TRAKT_CLIENT_ID, clientSecret = TRAKT_CLIENT_SECRET, doFetch = (...args) => fetch(...args) } = {}) {
  const enabled = Boolean(clientId && clientSecret);

  async function call(path, { method = 'GET', body, token } = {}) {
    if (!enabled) throw new AppError(ErrorCode.UNKNOWN, 'Trakt is not configured');
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
    enabled,
    deviceCode: () => call('/oauth/device/code', { method: 'POST', body: { client_id: clientId } }),
    /** status 200 = token; 400 = pending; 429 = slow down; 404/409/410/418 = give up. */
    pollToken: (deviceCode) =>
      call('/oauth/device/token', { method: 'POST', body: { code: deviceCode, client_id: clientId, client_secret: clientSecret } }),
    refresh: (refreshToken) =>
      call('/oauth/token', {
        method: 'POST',
        body: { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', grant_type: 'refresh_token' },
      }),
    addHistory: (token, payload) => call('/sync/history', { method: 'POST', body: payload, token }),
    watchedMovies: (token) => call('/sync/watched/movies', { token }),
  };
}
