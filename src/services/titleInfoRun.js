import { dbDeleteMany, dbGetAllKeys, dbPut, dbGet } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { createProviderClient } from './providerTypes.js';
import { rebuildEntries } from './catalogSync.js';
import { ENRICHABLE, enrichType } from './catalogEnrich.js';
import { toAppError } from '../core/errors.js';
import { TITLE_INFO_KEY } from './titleInfo.js';


/**
 * The details of the titles listed without a TMDB id (catalogEnrich.js), for the movies and series of a provider: run in their own worker,
 * after the catalog scan. `mode` "forget": what was learned is deleted and the ids it gave are taken back (nothing is asked).
 * Emits { event: 'progress', mediaType, done, total }, { event: 'info', message } and ends with { event: 'done', count, byType }.
 */
export async function runTitleInfoForProvider({ provider, search = null, excluded = {}, cleanTitles = true, grouping, mode = 'run', signal, gate, emit = () => {}, openDb = openProviderDb, makeClient = createProviderClient, now = Date.now, paces = null }) {
  let db = null;
  const byType = {};
  let count = 0;
  try {
    db = await openDb(provider.id);
    const client = makeClient(provider);
    for (const type of ENRICHABLE) {
      if (signal && signal.aborted) break;
      if (mode === 'forget') await dbDeleteMany(db, 'enrich', await dbGetAllKeys(db, 'enrich', { range: IDBKeyRange.bound(`${type}:`, `${type}:￿`) }));
      const counts = await enrichType({
        db,
        client,
        type,
        search,
        signal,
        gate,
        now,
        ask: mode !== 'forget',
        ...(paces || {}), // tests: { providerPace, tmdbPace } without real pauses
        progress: ({ done, total }) => emit({ event: 'progress', mediaType: type, done, total }),
        log: (message) => emit({ event: 'info', level: 'warn', message }),
        rebuild: () => rebuildEntries({ db, type, excludedCategories: new Set(excluded[type] || []), cleanTitles, grouping }),
      });
      byType[type] = { ...counts, at: now() };
      count += counts.asked + counts.searched;
      if (counts.asked || counts.searched || counts.changed) {
        emit({ event: 'info', message: `Title details ${type}: ${counts.asked} asked (${counts.found} TMDB ids), ${counts.searched} searched on TMDB (${counts.matched} found), ${counts.changed} titles updated` });
      }
    }
    const previous = (await dbGet(db, 'meta', TITLE_INFO_KEY)) || { key: TITLE_INFO_KEY, byType: {} };
    await dbPut(db, 'meta', { key: TITLE_INFO_KEY, byType: { ...previous.byType, ...byType } });
  } catch (err) {
    const error = toAppError(err);
    emit({ event: 'info', level: 'warn', message: `Title details stopped: ${error.code} ${error.message}` });
  } finally {
    if (db) db.close();
  }
  const outcome = { event: 'done', count, byType };
  emit(outcome);
  return outcome;
}

