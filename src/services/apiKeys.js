import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'apiKeys';
const FIELDS = ['tmdbKey', 'traktId', 'traktSecret'];

/** API keys come only from the settings (nothing is compiled into the build). */
export function createApiKeys({ db }) {
  let stored = {};
  const clean = (value) => String(value || '').trim();
  const current = () => Object.fromEntries(FIELDS.map((field) => [field, clean(stored[field])]));

  return {
    async load() {
      stored = await kvGet(db, KEY, {});
      return current();
    },
    /** Synchronous: the clients read it on every request. */
    get: current,
    /** The value the user typed, for the settings screen. */
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
