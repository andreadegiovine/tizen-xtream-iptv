import { fetchJson } from '../core/http.js';
import { wrapApiUrl } from '../core/env.js';
import { AppError, ErrorCode } from '../core/errors.js';
import { MediaType } from './mediaType.js';

export { MediaType };

const CATEGORY_ACTIONS = {
  [MediaType.MOVIE]: 'get_vod_categories',
  [MediaType.SERIES]: 'get_series_categories',
  [MediaType.LIVE]: 'get_live_categories',
};
const STREAM_ACTIONS = {
  [MediaType.MOVIE]: 'get_vod_streams',
  [MediaType.SERIES]: 'get_series',
  [MediaType.LIVE]: 'get_live_streams',
};
const STREAM_PATH = {
  [MediaType.MOVIE]: 'movie',
  [MediaType.SERIES]: 'series',
  [MediaType.LIVE]: 'live',
};

/** "host:8080/player_api.php?x" -> "http://host:8080". Keeps a sub-path if the panel lives under one. */
export function normalizeBaseUrl(input) {
  let value = String(input ?? '').trim();
  if (!value) throw new AppError(ErrorCode.INVALID_INPUT, 'URL is empty');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new AppError(ErrorCode.INVALID_INPUT, 'Invalid URL', { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(ErrorCode.INVALID_INPUT, 'Only http and https are supported');
  }
  const path = url.pathname.replace(/\/(?:player_api|get|panel_api|xmltv)\.php$/i, '').replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Live format: HLS when allowed (or unknown), otherwise TS, otherwise whatever the account allows. */
export function pickLiveFormat(allowed) {
  const list = Array.isArray(allowed) ? allowed.map((f) => String(f).toLowerCase()) : [];
  if (list.length === 0 || list.includes('m3u8')) return 'm3u8';
  if (list.includes('ts')) return 'ts';
  return list[0];
}

export function decodeBase64Utf8(value) {
  const text = String(value ?? '');
  try {
    return decodeURIComponent(escape(atob(text)));
  } catch {
    try {
      return atob(text);
    } catch {
      return text;
    }
  }
}

export function parseAuthResponse(data, now = Date.now()) {
  const user = data && data.user_info;
  if (!user || Number(user.auth) !== 1) throw new AppError(ErrorCode.AUTH_FAILED, 'Authentication failed');
  const status = String(user.status ?? '').toLowerCase();
  if (status === 'banned' || status === 'disabled') {
    throw new AppError(ErrorCode.ACCOUNT_DISABLED, 'Account disabled');
  }
  const expSeconds = Number(user.exp_date);
  const expiresAt = Number.isFinite(expSeconds) && expSeconds > 0 ? expSeconds * 1000 : null;
  if (status === 'expired' || (expiresAt !== null && expiresAt < now)) {
    throw new AppError(ErrorCode.ACCOUNT_EXPIRED, 'Account expired', { details: { expiresAt } });
  }
  const server = data.server_info || {};
  return {
    user: {
      username: String(user.username ?? ''),
      status: user.status ?? '',
      expiresAt,
      maxConnections: Number(user.max_connections) || null,
      activeConnections: Number(user.active_cons) || 0,
      allowedFormats: Array.isArray(user.allowed_output_formats) ? user.allowed_output_formats : [],
    },
    server: {
      url: server.url ?? '',
      port: server.port ?? '',
      httpsPort: server.https_port ?? '',
      protocol: server.server_protocol ?? '',
      timezone: server.timezone ?? '',
      timeNow: server.time_now ?? '',
    },
  };
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && data.user_info) throw new AppError(ErrorCode.AUTH_FAILED, 'Authentication failed');
  return [];
}

export class XtreamClient {
  constructor({ baseUrl, username, password, fetchJson: fetcher = fetchJson, wrapUrl = wrapApiUrl }) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.fetcher = fetcher;
    this.wrapUrl = wrapUrl;
    this.allowedFormats = [];
  }

  apiUrl(action, params = {}) {
    const query = new URLSearchParams({ username: this.username, password: this.password });
    if (action) query.set('action', action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) query.set(key, String(value));
    });
    return `${this.baseUrl}/player_api.php?${query.toString()}`;
  }

  request(action, params, options) {
    return this.fetcher(this.wrapUrl(this.apiUrl(action, params)), options);
  }

  async authenticate() {
    const auth = parseAuthResponse(await this.request(null, {}, { timeoutMs: 15000 }));
    this.allowedFormats = auth.user.allowedFormats;
    return auth;
  }

  async getCategories(type) {
    return asArray(await this.request(CATEGORY_ACTIONS[type], {}, { timeoutMs: 30000 }));
  }

  async getStreams(type, { categoryId } = {}) {
    const data = await this.request(STREAM_ACTIONS[type], { category_id: categoryId }, { timeoutMs: 60000 });
    return asArray(data);
  }

  getVodInfo(vodId) {
    return this.request('get_vod_info', { vod_id: vodId }, { timeoutMs: 15000 });
  }

  getSeriesInfo(seriesId) {
    return this.request('get_series_info', { series_id: seriesId }, { timeoutMs: 15000 });
  }

  /** Returns [{ id, title, description, start, stop }] with epoch milliseconds. */
  async getShortEpg(streamId, limit = 10) {
    const data = await this.request('get_short_epg', { stream_id: streamId, limit }, { timeoutMs: 15000 });
    const listings = data && Array.isArray(data.epg_listings) ? data.epg_listings : [];
    return listings
      .map((l) => ({
        id: String(l.id ?? ''),
        title: decodeBase64Utf8(l.title),
        description: decodeBase64Utf8(l.description),
        start: Number(l.start_timestamp) * 1000,
        stop: Number(l.stop_timestamp) * 1000,
      }))
      .filter((l) => Number.isFinite(l.start) && Number.isFinite(l.stop));
  }

  streamUrl(type, id, ext) {
    const extension = ext || (type === MediaType.LIVE ? pickLiveFormat(this.allowedFormats) : 'mp4');
    const user = encodeURIComponent(this.username);
    const pass = encodeURIComponent(this.password);
    return `${this.baseUrl}/${STREAM_PATH[type]}/${user}/${pass}/${id}.${extension}`;
  }
}
