import { foldName } from './shareKeys.js';

/** Favourite categories and genres as card entries, and the navigation they trigger. */

const SECTION_OF_TYPE = { movie: 'movies', series: 'series', live: 'live' };

/**
 * Saved filter records → pseudo entries (`filterKind` set) for the cards, newest first, ahead of the titles.
 * Favourite categories are saved by their folded name (shared by all providers); a category this provider does not list is skipped (not
 * deleted) and the others open by this provider's own id. `categoriesOf(type)` → [{ id, name }].
 */
export async function favoriteFilterEntries(saved, categoriesOf) {
  const known = new Map();
  const out = [];
  for (const item of saved.filter((f) => f.kind)) {
    if (item.kind === 'category') {
      if (!known.has(item.type)) known.set(item.type, new Map((await categoriesOf(item.type).catch(() => [])).map((c) => [foldName(c.name), String(c.id)])));
      const own = known.get(item.type).get(String(item.refId));
      if (own === undefined) continue;
      out.push({ key: item.entryKey, type: item.type, name: item.name, icon: '', filterKind: item.kind, filterId: own });
      continue;
    }
    out.push({ key: item.entryKey, type: item.type, name: item.name, icon: '', filterKind: item.kind, filterId: item.refId });
  }
  return out;
}

/** Opens the grid of a favourite category / genre (movies, series or live), with that entry selected. */
export function openFilter(ctx, entry, { push = true } = {}) {
  const params = { type: entry.type, section: SECTION_OF_TYPE[entry.type] || 'home', filter: { kind: entry.filterKind, id: String(entry.filterId) } };
  if (push) ctx.router.push('browse', params);
  else ctx.router.reset('browse', params);
}
