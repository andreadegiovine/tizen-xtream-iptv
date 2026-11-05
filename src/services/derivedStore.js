import { dbGet, dbPut, dbGetAll, dbDeleteMany } from '../core/idb.js';

/**
 * Data that is worked out from the catalog (sidebar lists and counts, search rows...) kept in the provider database, in the `meta`
 * store, so a start with an unchanged catalog reads it back instead of working it out again. Each record carries the version it was
 * built on and is valid only while that version is the current one:
 *   - `catalogRev`: bumped when a sync (or a rebuild of the Live groups) starts and again when it ends, so data read during a sync is
 *     never trusted and an interrupted sync leaves everything invalid;
 *   - `genresRev`: bumped when the TMDB / genre job ends (the genre lists and their counts depend on it);
 *   - the language (genre names) and `DERIVED_SCHEMA` (the app changed how the data is worked out).
 */
export const DERIVED_SCHEMA = 1;
const CATALOG_REV = 'catalogRev';
const GENRES_REV = 'genresRev';
const PREFIX = 'derived:';

let counter = 0;
/** A value that is different every time, also within the same millisecond. */
const stamp = () => `${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export const bumpCatalogRev = (db) => dbPut(db, 'meta', { key: CATALOG_REV, n: stamp() });
export const bumpGenresRev = (db) => dbPut(db, 'meta', { key: GENRES_REV, n: stamp() });

/** The version derived data must have to be valid now. `genres`: the data depends on the genre job; `locale`: on the language. */
export async function derivedVersion(db, { genres = false, locale = '' } = {}) {
  const catalog = await dbGet(db, 'meta', CATALOG_REV);
  const genre = genres ? await dbGet(db, 'meta', GENRES_REV) : null;
  return `${DERIVED_SCHEMA}|${catalog ? catalog.n : '0'}|${genres ? (genre ? genre.n : '0') : '-'}|${locale}`;
}

/** The value saved under `name`, or null when there is none or it was built on another version. */
export async function readDerived(db, name, version) {
  const row = await dbGet(db, 'meta', `${PREFIX}${name}`);
  return row && row.version === version ? row.value : null;
}

/** Saves a value built on `version` (read BEFORE working it out: if the catalog changed meanwhile, the record is born invalid). */
export function writeDerived(db, name, value, version) {
  return dbPut(db, 'meta', { key: `${PREFIX}${name}`, version, value });
}

/** Same for a long list (the search rows): saved in chunks, so no single record is huge. */
export async function writeDerivedList(db, name, list, version, chunkSize = 3000) {
  const chunks = Math.ceil(list.length / chunkSize);
  for (let i = 0; i < chunks; i += 1) await dbPut(db, 'meta', { key: `${PREFIX}${name}:${i}`, rows: list.slice(i * chunkSize, (i + 1) * chunkSize) });
  await dbPut(db, 'meta', { key: `${PREFIX}${name}`, version, chunks }); // the manifest last: a half-written list is never read
}

export async function readDerivedList(db, name, version) {
  const manifest = await dbGet(db, 'meta', `${PREFIX}${name}`);
  if (!manifest || manifest.version !== version || !(manifest.chunks >= 0)) return null;
  const out = [];
  for (let i = 0; i < manifest.chunks; i += 1) {
    const chunk = await dbGet(db, 'meta', `${PREFIX}${name}:${i}`);
    if (!chunk) return null; // a chunk is missing: not trusted
    for (const row of chunk.rows) out.push(row);
  }
  return out;
}

/** Removes every derived record (they are worked out again on the next need). */
export async function clearDerived(db) {
  const all = await dbGetAll(db, 'meta');
  await dbDeleteMany(db, 'meta', all.filter((row) => row.key.startsWith(PREFIX)).map((row) => row.key));
}
