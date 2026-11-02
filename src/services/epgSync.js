import { dbPutMany, dbGetAllKeys, dbDeleteMany, dbGet, dbPut, requestToPromise } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { createXmltvParser } from './xmltv.js';
import { wrapApiUrl } from '../core/env.js';
import { toAppError, AppError, ErrorCode } from '../core/errors.js';

export const EPG_TTL_MS = 24 * 3600 * 1000;
const META_KEY = 'epg';

export const xmltvUrl = (provider) =>
  `${provider.baseUrl}/xmltv.php?username=${encodeURIComponent(provider.username)}&password=${encodeURIComponent(provider.password)}`;

/** Channel ids used by the live entries: only their programmes are worth storing. */
export async function liveChannelIds(db) {
  const tx = db.transaction('entries', 'readonly');
  const all = await requestToPromise(tx.objectStore('entries').index('byTypeAdded').getAll(IDBKeyRange.bound(['live', 0], ['live', Number.MAX_SAFE_INTEGER])));
  return new Set(all.map((e) => e.epgChannelId).filter(Boolean));
}

export const shouldSyncEpg = (meta, now = Date.now()) => !meta || now - meta.lastSync >= EPG_TTL_MS;

export async function getEpgMeta(db) {
  return dbGet(db, 'meta', META_KEY);
}

/** Streams the guide through the parser (chunk by chunk when the browser can, whole text otherwise). */
export async function readGuide(url, onText, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new AppError(ErrorCode.HTTP, `HTTP ${res.status}`, { details: { status: res.status } });
  if (res.body && res.body.getReader && typeof TextDecoder !== 'undefined') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onText(decoder.decode(value, { stream: true }));
    }
    onText(decoder.decode());
  } else {
    onText(await res.text());
  }
}

/** Downloads the XMLTV guide and replaces the stored programmes. Old programmes are deleted afterwards. */
export async function syncEpg({ db, url, now = Date.now(), signal, emit = () => {}, fetchImpl, channels }) {
  const wanted = channels || (await liveChannelIds(db));
  if (wanted.size === 0) {
    emit({ event: 'progress', phase: 'skipped' });
    return { programmes: 0, skipped: true };
  }
  const rows = [];
  const parser = createXmltvParser({ now, channels: wanted, onProgramme: (p) => rows.push(p) });
  emit({ event: 'progress', phase: 'download' });
  const t0 = Date.now();
  await readGuide(url, (text) => parser.push(text), { signal, fetchImpl });
  if (rows.length === 0 && parser.stats().total === 0) throw new AppError(ErrorCode.BAD_RESPONSE, 'Guide is empty');
  emit({ event: 'progress', phase: 'write', done: 0, total: rows.length });
  await dbPutMany(db, 'epg', rows);
  const stale = await dbGetAllKeys(db, 'epg', { index: 'byStop', range: IDBKeyRange.upperBound(now) });
  await dbDeleteMany(db, 'epg', stale);
  const meta = { key: META_KEY, lastSync: now, programmes: rows.length, channels: wanted.size, totalInFile: parser.stats().total, durationMs: Date.now() - t0 };
  await dbPut(db, 'meta', meta);
  return meta;
}

export async function runEpgForProvider({ provider, force = false, signal, emit = () => {}, openDb = openProviderDb, fetchImpl, now = Date.now() }) {
  let db = null;
  let failure = null;
  let meta = null;
  try {
    db = await openDb(provider.id);
    if (!force && !shouldSyncEpg(await getEpgMeta(db), now)) {
      emit({ event: 'progress', phase: 'skipped' });
    } else {
      meta = await syncEpg({ db, url: wrapApiUrl(xmltvUrl(provider)), now, signal, emit, fetchImpl });
    }
  } catch (err) {
    const error = toAppError(err);
    failure = { code: error.code, message: error.message };
  } finally {
    if (db) db.close();
  }
  const outcome = { event: 'done', meta, error: failure };
  emit(outcome);
  return outcome;
}
