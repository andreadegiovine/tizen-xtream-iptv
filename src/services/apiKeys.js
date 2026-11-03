import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'apiKeys';
const FIELDS = ['tmdbKey', 'traktId', 'traktSecret'];

/**
 * API keys can be typed in the settings. A value typed by the user wins over the one compiled into the
 * build (`defaults`); clearing the field falls back to the build value again.
 */
export function createApiKeys({ db, defaults = {} }) {
  let stored = {};
  const clean = (value) => String(value || '').trim();
  const current = () => Object.fromEntries(FIELDS.map((field) => [field, clean(stored[field]) || clean(defaults[field])]));

  return {
    async load() {
      stored = await kvGet(db, KEY, {});
      return current();
    },
    /** Synchronous: the clients read it on every request. */
    get: current,
    /** The value the user typed (not the build default), for the settings screen. */
    getStored: (field) => clean(stored[field]),
    async set(patch) {
      const next = { ...stored };
      FIELDS.forEach((field) => {
        if (patch[field] !== undefined) next[field] = clean(patch[field]);
      });
      stored = next;
      await kvSet(db, KEY, stored);
      return current();
    },
  };
}
