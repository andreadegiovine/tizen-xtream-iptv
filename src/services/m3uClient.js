import { wrapApiUrl } from '../core/env.js';
import { AppError, ErrorCode, toAppError } from '../core/errors.js';
import { MediaType } from './mediaType.js';

/*
 * Providers of type "M3U / XMLTV": a playlist address (#EXTM3U, one #EXTINF line per stream) and, optionally, the address of an XMLTV
 * guide (else the one the playlist names in `url-tvg`). The client answers like XtreamClient (categories, streams, stream addresses), so the
 * catalog sync, the grids, the player and the guide work the same; what a playlist cannot give (series with seasons, account expiry,
 * per-title details) is left out, and the sections that need it are hidden (see providerTypes.js).
 */

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|webm|ts)(?:[?#].*)?$/i;

/** Attributes of an #EXTINF line: tvg-id="x" group-title="y" … → { 'tvg-id': 'x', 'group-title': 'y' }. */
function attributes(text) {
  const out = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m = re.exec(text);
  while (m) {
    out[m[1].toLowerCase()] = m[2];
    m = re.exec(text);
  }
  return out;
}

/**
 * A movie when the address says so (an Xtream "/movie/" or "/series/" path, or a video file that is not a live .ts of a "/live/" path),
 * otherwise a live channel.
 */
export function streamType(url) {
  const path = String(url || '').split('?')[0];
  if (/\/(movie|series)\//i.test(path)) return MediaType.MOVIE;
  if (/\/live\//i.test(path) || /\.m3u8$/i.test(path)) return MediaType.LIVE;
  return VIDEO_EXT.test(path) && !/\.ts$/i.test(path) ? MediaType.MOVIE : MediaType.LIVE;
}

/** A stable numeric id for an address (the same stream keeps its id, and its favourites, across playlist downloads). */
export function streamId(url) {
  let hash = 5381;
  const text = String(url);
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return (hash % 2000000000) + 1;
}

/** M3U text → { epgUrl, entries: [{ name, url, logo, group, tvgId, type }] } (lines without an address are skipped). */
export function parseM3u(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!/^#EXTM3U/i.test((lines[0] || '').trim())) throw new AppError(ErrorCode.BAD_RESPONSE, 'Not an M3U playlist');
  const head = attributes(lines[0]);
  const entries = [];
  let pending = null;
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (/^#EXTINF/i.test(line)) {
      const comma = line.lastIndexOf(',');
      const attrs = attributes(line.slice(0, comma >= 0 ? comma : line.length));
      pending = { name: (comma >= 0 ? line.slice(comma + 1) : '').trim() || attrs['tvg-name'] || '', logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '', tvgId: attrs['tvg-id'] || '' };
      return;
    }
    if (/^#EXTGRP:/i.test(line) && pending) {
      pending.group = pending.group || line.slice(8).trim();
      return;
    }
    if (line.charAt(0) === '#') return;
    const entry = pending || { name: line.split('/').pop(), logo: '', group: '', tvgId: '' };
    entries.push({ ...entry, name: entry.name || line.split('/').pop(), url: line, type: streamType(line) });
    pending = null;
  });
  return { epgUrl: head['url-tvg'] || head['x-tvg-url'] || '', entries };
}

/** The extension of a movie address ("mkv"), used like Xtream's container_extension. */
const extensionOf = (url) => {
  const m = /\.([a-z0-9]{2,4})(?:[?#].*)?$/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
};

export class M3uClient {
  constructor({ playlistUrl, epgUrl = '', fetchText = null, wrapUrl = wrapApiUrl }) {
    this.playlistUrl = playlistUrl;
    this.epgUrl = epgUrl;
    this.wrapUrl = wrapUrl;
    this.fetchText = fetchText || (async (url, { signal } = {}) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new AppError(ErrorCode.HTTP, `HTTP ${res.status}`, { details: { status: res.status } });
      return res.text();
    });
    this.allowedFormats = [];
    this.playlist = null;
    this.urls = new Map(); // stream id → address
  }

  /** Downloads and reads the playlist (once per client; `fresh` reads it again, as a catalog sync does). */
  load({ signal, fresh = false } = {}) {
    if (!this.playlist || fresh) {
      this.playlist = this.fetchText(this.wrapUrl(this.playlistUrl), { signal })
        .catch((err) => {
          throw toAppError(err);
        })
        .then((text) => {
          const parsed = parseM3u(text);
          parsed.entries.forEach((entry) => {
            entry.id = streamId(entry.url);
            this.urls.set(entry.id, entry.url);
          });
          return parsed;
        });
      this.playlist.catch(() => {
        this.playlist = null;
      });
    }
    return this.playlist;
  }

  /** Ready to give stream addresses (the player asks for them without waiting). */
  prepare() {
    return this.load().then(() => undefined);
  }

  /** Same shape as XtreamClient.authenticate(): a playlist has no account, so no expiry and no connection limit. */
  async authenticate() {
    const playlist = await this.load({ fresh: true });
    if (!playlist.entries.length) throw new AppError(ErrorCode.BAD_RESPONSE, 'The playlist is empty');
    return { user: { username: '', status: 'Active', expiresAt: null, maxConnections: null, activeConnections: 0, allowedFormats: [] }, server: {}, playlist: { entries: playlist.entries.length, epgUrl: playlist.epgUrl } };
  }

  /** The guide to download: the one typed with the provider, else the one the playlist names. */
  async guideUrl() {
    if (this.epgUrl) return this.epgUrl;
    const playlist = await this.load().catch(() => null);
    return (playlist && playlist.epgUrl) || '';
  }

  async getCategories(type, { signal } = {}) {
    if (type === MediaType.SERIES) return [];
    const playlist = await this.load({ signal });
    const groups = new Map();
    playlist.entries.filter((e) => e.type === type).forEach((e) => {
      const name = e.group || '—';
      if (!groups.has(name)) groups.set(name, String(streamId(`${type}|${name}`)));
    });
    return Array.from(groups.entries()).map(([name, id]) => ({ category_id: id, category_name: name, parent_id: 0 }));
  }

  /** Streams of a type, shaped like Xtream's lists (projectItem reads them the same way). */
  async getStreams(type, { categoryId, signal } = {}) {
    if (type === MediaType.SERIES) return [];
    const playlist = await this.load({ signal });
    return playlist.entries
      .filter((e) => e.type === type)
      .map((e, i) => ({
        num: i + 1,
        name: e.name,
        stream_id: e.id,
        stream_icon: e.logo,
        epg_channel_id: e.tvgId || null,
        category_id: String(streamId(`${type}|${e.group || '—'}`)),
        added: 0,
        container_extension: type === MediaType.MOVIE ? extensionOf(e.url) : '',
      }))
      .filter((s) => categoryId === undefined || categoryId === null || s.category_id === String(categoryId));
  }

  /** A playlist has no per-title details: the detail page shows what the list has. */
  async getVodInfo(vodId) {
    return { info: {}, movie_data: { stream_id: vodId, container_extension: extensionOf(this.urls.get(Number(vodId))) } };
  }

  async getSeriesInfo() {
    return { info: {}, episodes: {}, seasons: [] };
  }

  async getShortEpg() {
    return [];
  }

  /** The address of a stream, from the playlist read by prepare() / a sync. */
  streamUrl(type, id) {
    return this.urls.get(Number(id)) || '';
  }
}
