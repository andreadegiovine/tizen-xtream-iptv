/*
 * Text compressed into a URL-safe string (and back): UTF-8 bytes, LZW with codes growing from 9 to 16 bits, packed into base64url.
 * Logs compress to about a third: a QR code holds several times more of them. Self-contained on purpose: the page that shows logs
 * shared by a QR code (site/logs.html) carries a copy of decompressText, inlined when the site is published.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MAX_BITS = 16;

function utf8Bytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return out;
}

export function compressText(text) {
  const bytes = utf8Bytes(String(text));
  const dict = new Map();
  let next = 256;
  let bits = 9;
  let acc = 0; // bits waiting to be written, `have` of them
  let have = 0;
  let out = '';
  const emit = (code) => {
    acc = (acc << bits) | code;
    have += bits;
    while (have >= 6) {
      have -= 6;
      out += ALPHABET[(acc >> have) & 63];
    }
    acc &= (1 << have) - 1;
  };
  let w = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (w < 0) {
      w = b;
      continue;
    }
    const key = w * 256 + b;
    const found = dict.get(key);
    if (found !== undefined) {
      w = found;
      continue;
    }
    emit(w);
    if (next < 1 << MAX_BITS) {
      dict.set(key, next);
      next += 1;
      if (next > 1 << bits && bits < MAX_BITS) bits += 1;
    }
    w = b;
  }
  if (w >= 0) emit(w);
  if (have > 0) out += ALPHABET[(acc << (6 - have)) & 63];
  return `${bytes.length.toString(36)}.${out}`;
}

export function decompressText(packed) {
  const dot = packed.indexOf('.');
  const length = parseInt(packed.slice(0, dot), 36);
  const data = packed.slice(dot + 1);
  const bytes = [];
  const dict = [];
  for (let i = 0; i < 256; i += 1) dict.push([i]);
  let bits = 9;
  let acc = 0;
  let have = 0;
  let prev = null;
  for (let i = 0; i < data.length && bytes.length < length; i += 1) {
    acc = (acc << 6) | ALPHABET.indexOf(data[i]);
    have += 6;
    if (have < bits) continue;
    have -= bits;
    const code = (acc >> have) & ((1 << bits) - 1);
    acc &= (1 << have) - 1;
    let entry;
    if (code < dict.length) entry = dict[code];
    else entry = prev.concat([prev[0]]); // the code being defined right now
    for (let j = 0; j < entry.length; j += 1) bytes.push(entry[j]);
    if (prev && dict.length < 1 << MAX_BITS) dict.push(prev.concat([entry[0]]));
    prev = entry;
    if (dict.length + 1 > 1 << bits && bits < MAX_BITS) bits += 1;
  }
  let text = '';
  for (let i = 0; i < bytes.length && i < length; ) {
    const b = bytes[i];
    let code;
    let n;
    if (b < 0x80) [code, n] = [b, 1];
    else if (b < 0xe0) [code, n] = [((b & 31) << 6) | (bytes[i + 1] & 63), 2];
    else if (b < 0xf0) [code, n] = [((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63), 3];
    else [code, n] = [((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63), 4];
    text += String.fromCodePoint ? String.fromCodePoint(code) : String.fromCharCode(code);
    i += n;
  }
  return text;
}
