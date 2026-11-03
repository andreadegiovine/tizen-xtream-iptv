/**
 * Genre normalisation. Providers and TMDB spell the same genre differently ("Animazione", "Animation",
 * "Sci-Fi & Fantasy"...): every spelling maps to one key, so the sidebar shows a single entry.
 */
export const CANONICAL_GENRES = [
  'action', 'adventure', 'animation', 'comedy', 'crime', 'documentary', 'drama', 'family', 'fantasy', 'history',
  'horror', 'kids', 'music', 'mystery', 'news', 'reality', 'romance', 'scifi', 'soap', 'talk', 'thriller', 'tvmovie', 'war', 'western',
];

const ALIASES = {
  action: ['azione', 'action', 'accion', 'azione e avventura'],
  adventure: ['avventura', 'adventure', 'aventura', 'avventuroso'],
  animation: ['animazione', 'animation', 'animacion', 'animated', 'cartoni', 'cartoni animati', 'anime'],
  comedy: ['commedia', 'comedy', 'comedia', 'comico', 'commedie'],
  crime: ['crimine', 'crime', 'criminale', 'poliziesco', 'polizieschi'],
  documentary: ['documentario', 'documentary', 'documentari', 'documental'],
  drama: ['dramma', 'drama', 'drammatico', 'drammatici', 'drammi'],
  family: ['famiglia', 'family', 'familia'],
  fantasy: ['fantasy', 'fantastico', 'fantasia'],
  history: ['storia', 'history', 'storico', 'storici', 'historia'],
  horror: ['horror', 'orrore', 'terror'],
  kids: ['kids', 'bambini', 'ragazzi', 'infantil', 'per bambini'],
  music: ['musica', 'music', 'musical', 'musicale'],
  mystery: ['mistero', 'mystery', 'giallo', 'misterio'],
  news: ['news', 'notizie', 'telegiornale', 'informazione'],
  reality: ['reality', 'reality tv'],
  romance: ['romantico', 'romance', 'sentimentale', 'romantici', 'romantica'],
  scifi: ['fantascienza', 'science fiction', 'sci-fi', 'sci fi', 'scifi', 'ciencia ficcion'],
  soap: ['soap', 'soap opera'],
  talk: ['talk', 'talk show'],
  thriller: ['thriller', 'suspense'],
  tvmovie: ['film tv', 'tv movie', 'televisione film', 'film per la tv'],
  war: ['guerra', 'war', 'guerra e politica', 'war & politics', 'war and politics', 'bellico'],
  western: ['western'],
};

// Combined TMDB-style names that stand for two genres.
const COMBINED = {
  'action & adventure': ['action', 'adventure'],
  'azione e avventura': ['action', 'adventure'],
  'azione & avventura': ['action', 'adventure'],
  'sci-fi & fantasy': ['scifi', 'fantasy'],
  'fantascienza e fantasy': ['scifi', 'fantasy'],
  'fantascienza & fantasy': ['scifi', 'fantasy'],
};

const fold = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const LOOKUP = new Map();
Object.keys(ALIASES).forEach((key) => ALIASES[key].forEach((alias) => LOOKUP.set(fold(alias), key)));

const titleCase = (text) => text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/** One genre name → [{ key, name }] (usually one; combined names give two). Unknown genres keep their own folded key. */
export function normalizeGenre(name) {
  const text = String(name || '').trim();
  const folded = fold(text);
  if (!folded) return [];
  if (COMBINED[folded]) return COMBINED[folded].map((key) => ({ key, name: key }));
  const key = LOOKUP.get(folded);
  if (key) return [{ key, name: key }];
  return [{ key: `x:${folded.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || folded}`, name: titleCase(text) }];
}

/** "Action, Drama / Thriller" → unique normalised genres, in order. */
export function splitGenres(text) {
  const out = new Map();
  String(text || '')
    .split(/[,/|;]/)
    .forEach((part) => normalizeGenre(part).forEach((g) => out.set(g.key, g)));
  return Array.from(out.values());
}

/** Several sources (provider text, TMDB list of names or { name }) → unique normalised genres. */
export function mergeGenres(...sources) {
  const out = new Map();
  sources.forEach((source) => {
    const names = Array.isArray(source) ? source.map((g) => (g && typeof g === 'object' ? g.name : g)) : [source];
    names.forEach((name) => splitGenres(name).forEach((g) => out.set(g.key, g)));
  });
  return Array.from(out.values());
}

/** Display name: canonical genres use the app language, the others keep the provider's spelling. */
export function genreLabel(genre, translate) {
  return CANONICAL_GENRES.indexOf(genre.key) >= 0 ? translate(`genre.${genre.key}`) : genre.name;
}
