/** Favourite categories and genres as card entries, and the navigation they trigger. */

const SECTION_OF_TYPE = { movie: 'movies', series: 'series', live: 'live' };

/**
 * Saved filter records → pseudo entries (`filterKind` set) for the cards, newest first, ahead of the titles.
 * A category the provider no longer lists is skipped (not deleted). `categoriesOf(type)` → [{ id }].
 */
export async function favoriteFilterEntries(saved, categoriesOf) {
  const known = new Map();
  const out = [];
  for (const item of saved.filter((f) => f.kind)) {
    if (item.kind === 'category') {
      if (!known.has(item.type)) known.set(item.type, new Set((await categoriesOf(item.type).catch(() => [])).map((c) => String(c.id))));
      if (!known.get(item.type).has(String(item.refId))) continue;
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
