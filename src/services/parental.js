import { kvGet, kvSet } from '../db/kv.js';
import { listCategories } from './catalogQuery.js';

const KEY = 'parental';
export const PIN_LENGTH = 4;
const TYPES = ['movie', 'series', 'live'];

// Category names that mark adult content (English and Italian); the provider gives no other signal.
const ADULT_NAME = /(^|[^a-z0-9])(adults?|adulti|xxx|porn\w*|erotic\w*|erotico|sex\w*|hentai|18\s*\+|\+\s*18)($|[^a-z0-9])/i;

export const isAdultCategoryName = (name) => ADULT_NAME.test(String(name || ''));

/** cyrb53: a small salted hash. It keeps the PIN from sitting in the database as plain text (it is not strong crypto). */
export function hashPin(pin, salt) {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  const text = `${salt}:${pin}`;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
}

/**
 * Parental control: one PIN for the app (stored hashed in the app database) and the adult check of
 *  titles: the flag the provider puts on a title (`is_adult`) and, as a fallback, the names of its categories (the provider gives no flag on categories).
 */
export function createParentalService({ db, random = Math.random }) {
  let record = null; // { salt, hash }
  let adultIds = { movie: new Set(), series: new Set(), live: new Set() };

  async function load() {
    if (record === null) record = (await kvGet(db, KEY, null)) || false;
    return record;
  }

  return {
    async hasPin() {
      return Boolean(await load());
    },
    async setPin(pin) {
      const salt = String(Math.floor(random() * 1e9));
      record = { salt, hash: hashPin(pin, salt) };
      await kvSet(db, KEY, record);
    },
    async verify(pin) {
      const stored = await load();
      return Boolean(stored) && hashPin(pin, stored.salt) === stored.hash;
    },
    /** Reads the categories of the active provider and remembers which ones are adult. */
    async loadCategories(providerDb) {
      const next = { movie: new Set(), series: new Set(), live: new Set() };
      const lists = await Promise.all(TYPES.map((type) => listCategories(providerDb, type)));
      TYPES.forEach((type, i) => lists[i].filter((c) => isAdultCategoryName(c.name)).forEach((c) => next[type].add(String(c.id))));
      adultIds = next;
    },
    /** Adult title? The provider's own flag (`is_adult`) first; otherwise the entry sits in a category whose name marks it. */
    isAdult(entry) {
      if (entry && entry.adult) return true;
      const ids = entry && entry.categoryIds;
      if (!ids || !adultIds[entry.type]) return false;
      return ids.some((id) => adultIds[entry.type].has(String(id)));
    },
  };
}
