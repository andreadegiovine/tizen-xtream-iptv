import { kvGet, kvSet } from '../db/kv.js';
import { qualifyKey } from './shareKeys.js';

const KEY = 'creditsStart';

/**
 * Where the end credits start, per series, set by the user in the player: seconds before the end of an episode (the same for every
 * episode of the series). Stored in the app database with the series key shared between providers (`series:t1396`), or with the
 * provider for a series without a TMDB id.
 */
export function createCreditsStore({ db }) {
  let cache = null;
  const load = async () => {
    if (!cache) cache = { ...(await kvGet(db, KEY, {})) };
    return cache;
  };
  const save = () => kvSet(db, KEY, cache);
  return {
    /** Seconds before the end, or null when it was never set. */
    async get(providerId, seriesKey) {
      const value = (await load())[qualifyKey(providerId, seriesKey)];
      return value > 0 ? value : null;
    },
    async set(providerId, seriesKey, secondsBeforeEnd) {
      const map = await load();
      map[qualifyKey(providerId, seriesKey)] = Math.round(secondsBeforeEnd);
      await save();
    },
    async remove(providerId, seriesKey) {
      const map = await load();
      delete map[qualifyKey(providerId, seriesKey)];
      await save();
    },
  };
}
