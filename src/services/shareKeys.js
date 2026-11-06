import { dbGet } from '../core/idb.js';

/**
 * Keys that mean the same thing for every provider, so favourites, collections, pins and the guide layout can be shared between them:
 *  - a title with a TMDB id (`movie:t603`, `series:t1396`): the id is the same whoever lists it;
 *  - a Live TV channel group / network (`live:g<name>`, `live:n<name>`): named after the normalised channel name;
 *  - a collection (`collection:<id>`) and a favourite filter (`genre:…`, `category:…`, the latter named after the category).
 * A title without a TMDB id (`movie:i123`, `live:i45`) is the provider's own: its number means another title in another provider.
 */
export const isPortableKey = (key) => /^(movie|series):t\d+$/.test(String(key)) || /^live:[gn]/.test(String(key)) || /^(collection|genre|category):/.test(String(key));

/** Name folded to letters and digits, lowercase, no accents, single spaces: "Cinéma & Sport" and "cinema sport" are the same. */
export function foldName(text) {
  const base = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return base.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || base.trim();
}

/** Id under which a category / genre is saved as a favourite or a pin: categories by name (ids belong to a provider), genres by their key. */
export const filterId = (kind, id, name) => (kind === 'category' ? foldName(name) || String(id) : String(id));

/** The key as stored in a record shared by all providers: a provider's own key carries the provider (`p1abc@movie:i12`). */
export const qualifyKey = (providerId, key) => (isPortableKey(key) ? String(key) : `${providerId}@${key}`);

/** The key a stored one stands for in this provider, or null when it is another provider's own title. */
export function visibleKey(providerId, stored) {
  const key = String(stored);
  if (isPortableKey(key)) return key;
  const at = key.indexOf('@');
  return at > 0 && key.slice(0, at) === providerId ? key.slice(at + 1) : null;
}

/** True for a stored key of this provider's own (non-portable) titles. */
export const isOwnKey = (providerId, stored) => !isPortableKey(stored) && visibleKey(providerId, stored) !== null;

/**
 * The portable key a provider's own title has become, when its list row now carries a TMDB id (`movie:i123` → `movie:t603`), else null.
 * Used to move what was saved under the provider's key to the shared one, whenever the id shows up.
 */
export async function portableKeyFor(db, key) {
  const m = /^(movie|series):i(\d+)$/.exec(String(key));
  if (!m) return null;
  const row = await dbGet(db, 'items', `${m[1]}:${m[2]}`).catch(() => null);
  return row && row.tmdbId ? `${m[1]}:t${row.tmdbId}` : null;
}
