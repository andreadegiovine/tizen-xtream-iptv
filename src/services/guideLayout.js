import { dbGet, dbPut } from '../core/idb.js';

const KEY = 'guide:layout';

/**
 * How the user arranged the programme guide: the channels taken out of it and the order of the others. Saved in the provider database
 * (`meta`); channels the order does not know (new ones) follow the ordered ones, by name.
 */
export async function readGuideLayout(db) {
  const row = await dbGet(db, 'meta', KEY);
  return { order: (row && row.order) || [], hidden: (row && row.hidden) || [] };
}

export function saveGuideLayout(db, layout) {
  return dbPut(db, 'meta', { key: KEY, order: layout.order, hidden: layout.hidden });
}

/** The rows as the user arranged them: hidden ones out, ordered ones first in their order, the rest after (as given). */
export function applyGuideLayout(rows, layout) {
  const hidden = new Set(layout.hidden);
  const position = new Map(layout.order.map((key, i) => [key, i]));
  const shown = rows.filter((row) => !hidden.has(row.key));
  const placed = shown.filter((row) => position.has(row.key)).sort((a, b) => position.get(a.key) - position.get(b.key));
  return placed.concat(shown.filter((row) => !position.has(row.key)));
}

/** Moves a row one place up (`delta` -1) or down (+1): the whole order of the rows shown is saved from then on. */
export function moveInLayout(rows, layout, key, delta) {
  const keys = rows.map((row) => row.key);
  const from = keys.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= keys.length) return null;
  keys.splice(from, 1);
  keys.splice(to, 0, key);
  return { layout: { order: keys, hidden: layout.hidden }, row: to };
}

export function hideInLayout(layout, key) {
  return { order: layout.order.filter((k) => k !== key), hidden: layout.hidden.includes(key) ? layout.hidden : layout.hidden.concat([key]) };
}
