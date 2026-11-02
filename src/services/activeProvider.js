import { openProviderDb } from '../db/providerDb.js';
import { XtreamClient } from './xtreamClient.js';

/**
 * Shared handle on the active provider: its database (opened once, kept open) and an API client that
 * authenticates lazily (needed for the live stream format). Pages never close the shared database;
 * call `release()` before a provider is deleted so the delete is not blocked.
 */
export function createActiveProvider({ providers, openDb = openProviderDb, makeClient = (p) => new XtreamClient({ baseUrl: p.baseUrl, username: p.username, password: p.password }) }) {
  let cache = null;
  let pending = null;

  const same = (a, b) => a.id === b.id && a.baseUrl === b.baseUrl && a.username === b.username && a.password === b.password;

  function release() {
    if (cache) {
      try {
        cache.db.close();
      } catch {
        /* already closed */
      }
    }
    cache = null;
  }

  async function load() {
    const provider = await providers.getActive();
    if (!provider) {
      release();
      return null;
    }
    if (cache && same(cache.provider, provider)) return cache;
    release();
    const db = await openDb(provider.id);
    db.onversionchange = () => db.close();
    cache = { provider, db, client: makeClient(provider), auth: null };
    return cache;
  }

  return {
    /** { provider, db, client } for the active provider, or null when there is none. */
    get() {
      if (!pending) pending = load().finally(() => { pending = null; });
      return pending;
    },
    /** Client that has authenticated at least once (allowed live formats are known). */
    async authenticatedClient() {
      const current = await this.get();
      if (!current) return null;
      if (!current.auth) {
        current.auth = current.client.authenticate().catch((err) => {
          current.auth = null;
          throw err;
        });
      }
      await current.auth;
      return current.client;
    },
    release,
  };
}
