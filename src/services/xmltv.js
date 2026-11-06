const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] || match;
  });
}

/** "20261102203000 +0100" → epoch ms (offset optional, default UTC). Returns NaN when malformed. */
export function parseXmltvTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(String(value || '').trim());
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const offset = m[7] ? (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000 : 0;
  return utc - offset;
}

function attributes(text) {
  const out = {};
  text.replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (_, key, val) => {
    out[key] = val;
    return '';
  });
  return out;
}

function firstTag(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : '';
}

// Titles some guides give to the hours they know nothing about ("EPG non disponibile", "No EPG", "N/A"…): no programme at all.
const PLACEHOLDER_TITLES = [
  /^(?:n\/?a|n\.?d\.?|tba|tbd|-+|\.+|\?+)$/,
  /^no\s+(?:epg|guide|info|information|data|programme|program|programs|programmes|details)(?:\s+(?:info|information|data|available|found))*$/,
  /^(?:epg|guide|guida|info|information|informazioni|informazione|dati|data|programma|programme|program|programmazione)(?:\s+(?:epg|info|information|data))?\s+(?:not\s+available|unavailable|non\s+disponibil[ei]|n\/?[ad])$/,
  /^nessun[ao]?\s+(?:epg|guida|informazione|informazioni|info|programma|programmazione|dato|dati)(?:\s+disponibil[ei])?$/,
  /^(?:not\s+available|non\s+disponibile|unavailable|no\s+information\s+available)$/,
];

/** True for a programme title that only says the guide has nothing for those hours (empty included). */
export function isPlaceholderTitle(title) {
  const text = String(title || '')
    .toLowerCase()
    .replace(/[[\](){}"'«»:;!.,–—_*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return true;
  return PLACEHOLDER_TITLES.some((re) => re.test(text));
}

/**
 * Incremental XMLTV reader: feed text chunks, get the programmes inside the window
 * (ends after `now`, starts before `now + horizonMs`) of the wanted channels. Never holds more than one
 * partial programme in memory, so a very large guide is fine.
 */
export function createXmltvParser({ now, horizonMs = 48 * 3600 * 1000, channels = null, onProgramme }) {
  let buffer = '';
  let total = 0;
  let kept = 0;

  function consume() {
    const re = /<programme\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/programme>)/g;
    let lastEnd = 0;
    let match = re.exec(buffer);
    while (match) {
      lastEnd = re.lastIndex;
      total += 1;
      const attrs = attributes(match[1]);
      const start = parseXmltvTime(attrs.start);
      const stop = parseXmltvTime(attrs.stop);
      if (attrs.channel && Number.isFinite(start) && Number.isFinite(stop) && stop > now && start < now + horizonMs && (!channels || channels.has(attrs.channel))) {
        const body = match[2] || '';
        const title = firstTag(body, 'title');
        if (!isPlaceholderTitle(title)) {
          kept += 1;
          onProgramme({ channelId: attrs.channel, start, stop, title, desc: firstTag(body, 'desc').slice(0, 400) });
        }
      }
      match = re.exec(buffer);
    }
    // Keep only what may still complete: from the last unfinished <programme.
    const open = buffer.lastIndexOf('<programme', buffer.length);
    buffer = open >= lastEnd ? buffer.slice(open) : buffer.slice(Math.max(lastEnd, buffer.length - 16));
  }

  return {
    push(text) {
      buffer += text;
      consume();
    },
    stats: () => ({ total, kept }),
  };
}
