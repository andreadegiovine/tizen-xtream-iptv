import { dbGet, dbPut } from '../core/idb.js';
import { kvGet, kvSet } from '../db/kv.js';
import { qualifyKey, visibleKey } from './shareKeys.js';

const KEY = 'guide:layout';

/**
 * How the user arranged the programme guide: the channels taken out of it and the order of the others. The arrangement is shared by all
 * providers (see `createGuideLayoutStore`); channels the order does not know (new ones) follow the ordered ones, by name.
 * `readGuideLayout` / `saveGuideLayout` are the old per-provider copy in the provider database (`meta`), read once to move it to the shared one.
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

const SHARED_KEY = 'guide:layout';
const MIGRATED_KEY = 'guide:layout:migrated';

/**
 * The guide arrangement in the app database, shared by all providers: a channel group has the same key everywhere, so its place in the guide
 * is the same; a provider's own channel (no group) is stored with the provider and only that provider uses it. Saving from a provider
 * rewrites only the places its keys had, so the order the other providers saw does not move.
 */
export function createGuideLayoutStore({ db }) {
  const state = async () => {
    const value = await kvGet(db, SHARED_KEY, null);
    return { order: (value && value.order) || [], hidden: (value && value.hidden) || [] };
  };
  const put = (order, hidden) => kvSet(db, SHARED_KEY, { order, hidden });

  async function write(providerId, layout) {
    const current = await state();
    const fill = layout.order.map((key) => qualifyKey(providerId, key));
    const order = [];
    let next = 0;
    current.order.forEach((key) => {
      if (visibleKey(providerId, key) === null) order.push(key);
      else if (next < fill.length) order.push(fill[next++]);
    });
    while (next < fill.length) order.push(fill[next++]);
    const hidden = current.hidden.filter((key) => visibleKey(providerId, key) === null).concat(layout.hidden.map((key) => qualifyKey(providerId, key)));
    await put(order, hidden);
  }

  return {
    /** The arrangement as `providerId` sees it. The first time, the old copy in `providerDb` is added (without moving what is already there). */
    async read(providerId, providerDb) {
      const done = new Set(await kvGet(db, MIGRATED_KEY, []));
      if (!done.has(providerId) && providerDb) {
        const old = await readGuideLayout(providerDb).catch(() => ({ order: [], hidden: [] }));
        const current = await state();
        const known = new Set(current.order.concat(current.hidden));
        const add = (keys) => keys.map((key) => qualifyKey(providerId, key)).filter((key) => !known.has(key));
        await put(current.order.concat(add(old.order)), current.hidden.concat(add(old.hidden)));
        done.add(providerId);
        await kvSet(db, MIGRATED_KEY, Array.from(done));
      }
      const { order, hidden } = await state();
      const mine = (keys) => keys.map((key) => visibleKey(providerId, key)).filter(Boolean);
      return { order: mine(order), hidden: mine(hidden) };
    },
    save: write,
  };
}
