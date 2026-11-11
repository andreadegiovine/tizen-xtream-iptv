import { compressText } from '../core/lzw.js';

/** The page that shows logs shared by a QR code (site/logs.html, published with the online builds on GitHub Pages). */
export const LOGS_PAGE_URL = 'https://andreadegiovine.github.io/xtream-iptv-client/logs.html';
/**
 * Characters of the link at most: a QR code holds 2,953 bytes at the lowest error correction, but a TV screen photographed by a phone
 * reads a smaller one more easily.
 */
export const MAX_LINK = 2300;

const lineOf = (e) => `${new Date(e.ts).toISOString().slice(11, 19)} ${e.level} ${e.message}`;

/**
 * A link to the logs page carrying the newest log lines that fit, compressed (lzw.js) after `#`: the part of a link a browser never
 * sends to the server, so the logs go from the TV to the phone only. `header` (app version, platform) comes first.
 * Returns { url, lines } (lines: how many fitted).
 */
export function buildLogLink(entries, { header = '', base = LOGS_PAGE_URL, max = MAX_LINK } = {}) {
  const all = entries.map(lineOf);
  const link = (n) => `${base}#${compressText([header].concat(all.slice(all.length - n)).join('\n'))}`;
  let low = 0;
  let high = all.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (link(mid).length <= max) low = mid;
    else high = mid - 1;
  }
  return { url: link(low), lines: low };
}
