import { dbGet, dbPut, dbDelete } from '../core/idb.js';

export async function kvGet(db, key, defaultValue = undefined) {
  const record = await dbGet(db, 'kv', key);
  return record ? record.value : defaultValue;
}

export function kvSet(db, key, value) {
  return dbPut(db, 'kv', { key, value });
}

export function kvDelete(db, key) {
  return dbDelete(db, 'kv', key);
}
