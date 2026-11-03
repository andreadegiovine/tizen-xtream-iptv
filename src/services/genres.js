/**
 * Genre normalisation (not translation): case, accents, spacing and separators are ignored, so "Animazione",
 * "animazione " and "ANIMAZIONE" are one genre. The name shown is the first spelling found, capitalised.
 */
const fold = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const capitalise = (text) => text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/** One genre name → { key, name }, or null when it is empty. */
export function normalizeGenre(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  const key = fold(text);
  return key ? { key, name: capitalise(text) } : null;
}

/** "Action, Drama / Thriller" → unique normalised genres, in order. */
export function splitGenres(text) {
  const out = new Map();
  String(text || '')
    .split(/[,/|;]/)
    .forEach((part) => {
      const g = normalizeGenre(part);
      if (g && !out.has(g.key)) out.set(g.key, g);
    });
  return Array.from(out.values());
}

/** Several sources (provider text, TMDB list of names or { name }) → unique normalised genres; the first source's spelling wins. */
export function mergeGenres(...sources) {
  const out = new Map();
  sources.forEach((source) => {
    const names = Array.isArray(source) ? source.map((g) => (g && typeof g === 'object' ? g.name : g)) : [source];
    names.forEach((name) =>
      splitGenres(name).forEach((g) => {
        if (!out.has(g.key)) out.set(g.key, g);
      }),
    );
  });
  return Array.from(out.values());
}
