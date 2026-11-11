const LANG_CODES = new Set([
  'it', 'en', 'fr', 'de', 'es', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'el', 'ro', 'fi', 'uk', 'us',
  'multi', 'sub', 'ita', 'eng',
]);

const QUALITY_TOKENS = new Set([
  '4k', 'uhd', 'fhd', 'hd', 'sd', 'hdr', 'hdr10', 'hevc', 'h264', 'h265', 'x264', 'x265',
  '2160p', '1080p', '720p', '480p', 'bluray', 'bdrip', 'webrip', 'web-dl', 'webdl', 'dvdrip',
  'hdtv', 'sub', 'subs', 'ita', 'eng', 'multi', 'dub', 'dubbed', 'vo', 'vost', 'vostfr',
]);

const SEPARATORS = /^[\s\-–—:|]+|[\s\-–—:|]+$/g;

/**
 * What a version of a title is (quality, language, source, audio), as the providers write it in the name: the tokens of VERSION_TOKENS
 * in brackets ("[FHD] (ITA) |IT|"), a leading language ("IT - ") and at the end ("Title 1080p HEVC"). Only for the label of a version:
 * the title cleaning (normalizeTitle) is not changed by these extra words.
 */
const VERSION_TOKENS = new Set([
  ...QUALITY_TOKENS,
  ...LANG_CODES,
  'cam', 'hdcam', 'camrip', 'ts', 'hdts', 'telesync', 'tc', 'telecine', 'screener', 'scr', 'dvdscr', '3d',
  'ac3', 'eac3', 'dts', 'aac', 'atmos', 'dolby', 'remux', 'hdrip', 'dvd', 'fullhd', '8k', 'h.264', 'h.265', 'avc',
]);
const VERSION_SPLIT = /[\s,/+_-]+/;

export function versionTags(raw) {
  const text = String(raw == null ? '' : raw);
  const found = [];
  const known = (token) => VERSION_TOKENS.has(token);
  text.replace(/[[(|]([^[\]()|]{1,30})[\])|]/g, (match, inner) => {
    const tokens = inner.toLowerCase().split(VERSION_SPLIT).filter(Boolean);
    if (tokens.length && tokens.every(known)) found.push(...tokens);
    return match;
  });
  const lead = /^\s*([A-Za-z]{2,5})\s*[-:–—|]\s+/.exec(text);
  if (lead && LANG_CODES.has(lead[1].toLowerCase())) found.push(lead[1].toLowerCase());
  const words = text.replace(/[[(|][^[\]()|]*[\])|]/g, ' ').split(/\s+/).filter(Boolean);
  const trailing = [];
  for (let i = words.length - 1; i > 0; i -= 1) {
    const word = words[i].replace(SEPARATORS, '').toLowerCase();
    if (!word) continue;
    if (!known(word)) break;
    trailing.unshift(word);
  }
  found.push(...trailing);
  return Array.from(new Set(found)).map((token) => token.toUpperCase());
}

/** Lowercase, accent-free, punctuation-free key used for search and matching. */
export function makeSearchKey(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Cleans a provider title such as "IT - Inception (2010) [4K]".
 * Returns { cleanTitle, searchKey, year, tags }. A bare year ("Blade Runner 2049") is never touched.
 */
export function normalizeTitle(raw) {
  const original = String(raw ?? '').trim();
  let s = original.normalize('NFC');
  const tags = [];
  let year = null;

  // 1. Leading language prefix: "|IT| Title", "[IT] Title", "(IT) Title", "IT - Title", "IT: Title".
  s = s.replace(/^\s*[[(|]\s*([A-Za-z]{2,5})\s*[\])|]\s*[-:–—]?\s*/, (match, code) => {
    if (!LANG_CODES.has(code.toLowerCase())) return match;
    tags.push(code.toLowerCase());
    return '';
  });
  s = s.replace(/^\s*([A-Za-z]{2,5})\s*[-:–—|]\s+/, (match, code) => {
    if (!LANG_CODES.has(code.toLowerCase())) return match;
    tags.push(code.toLowerCase());
    return '';
  });

  // 2. Year in brackets, then bracketed groups made only of quality/language tokens.
  s = s.replace(/[[(]\s*((?:19|20)\d{2})\s*[\])]/g, (match, y) => {
    if (year === null) year = Number(y);
    return ' ';
  });
  s = s.replace(/[[(]([^[\]()]{1,30})[\])]/g, (match, inner) => {
    const tokens = inner
      .toLowerCase()
      .split(/[\s,/+._-]+/)
      .filter(Boolean);
    const known = tokens.length > 0 && tokens.every((t) => QUALITY_TOKENS.has(t) || LANG_CODES.has(t));
    if (!known) return match;
    tags.push(...tokens);
    return ' ';
  });

  // 3. Trailing quality tokens: "The Matrix FHD".
  const parts = s.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].replace(SEPARATORS, '');
    if (last === '') {
      parts.pop();
    } else if (QUALITY_TOKENS.has(last.toLowerCase())) {
      tags.push(last.toLowerCase());
      parts.pop();
    } else {
      break;
    }
  }

  const cleanTitle = parts.join(' ').replace(/\s+/g, ' ').replace(SEPARATORS, '').trim() || original;
  return { cleanTitle, searchKey: makeSearchKey(cleanTitle), year, tags: Array.from(new Set(tags)) };
}

/** Live channels keep their full name ("Sky Cinema HD" stays as is), with spaces instead of underscores ("RAI_1_HD" → "RAI 1 HD"). */
export function normalizeChannelName(raw) {
  const name = String(raw ?? '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return { cleanTitle: name, searchKey: makeSearchKey(name), year: null, tags: [] };
}
