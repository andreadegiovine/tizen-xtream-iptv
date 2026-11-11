import { MediaType } from './mediaType.js';
import { mergeGenres } from './genres.js';
import { normalizeTitle, normalizeChannelName, makeSearchKey, versionTags } from './titleNormalizer.js';

/**
 * Builds the entries shown in grids.
 * - Items sharing a provider tmdb id (same type) become ONE entry with several members (stream ids).
 * - Items without tmdb id are never merged: each is its own entry.
 * - Items in excluded categories are dropped before grouping.
 * Output is sorted by `added` (newest first), where a group's `added` is the max of its members.
 */
export function buildEntries(type, items, { excludedCategories = new Set(), cleanTitles = true } = {}) {
  let normalize = type === MediaType.LIVE ? normalizeChannelName : normalizeTitle;
  // With the "clean titles" preference off the movie / series titles stay as the provider wrote them.
  if (type !== MediaType.LIVE && !cleanTitles) {
    normalize = (raw) => {
      const cleanTitle = String(raw == null ? '' : raw).trim();
      return { cleanTitle, year: null, searchKey: makeSearchKey(cleanTitle) };
    };
  }
  const groups = new Map();

  for (const item of items) {
    if (excludedCategories.has(item.categoryId)) continue;
    const groupKey = item.tmdbId ? `${type}:t${item.tmdbId}` : `${type}:i${item.id}`;
    const norm = normalize(item.name);
    const member = { item, norm };
    const group = groups.get(groupKey);
    if (group) group.push(member);
    else groups.set(groupKey, [member]);
  }

  const entries = [];
  for (const [key, members] of groups) {
    members.sort((a, b) => a.item.id - b.item.id);
    const base = members[0]; // lowest id is the default stream
    const ratings = members.map((m) => m.item.rating).filter((r) => r);
    entries.push({
      key,
      type,
      tmdbId: base.item.tmdbId,
      name: base.norm.cleanTitle,
      year: members.map((m) => m.norm.year || m.item.year).find(Boolean) || null,
      rating: base.item.rating || (ratings.length ? Math.max(...ratings) : null),
      added: Math.max(...members.map((m) => m.item.added)),
      defaultId: base.item.id,
      memberIds: members.map((m) => m.item.id),
      // `tags`: what each version is, from its own name (HD, FHD, ITA, CAM...): the label of the version (streamLabel).
      members: members.map((m) => {
        const tags = type === MediaType.LIVE ? [] : versionTags(m.item.name);
        return { id: m.item.id, ext: m.item.ext, categoryId: m.item.categoryId, ...(tags.length ? { tags } : {}) };
      }),
      categoryIds: Array.from(new Set(members.map((m) => m.item.categoryId))),
      searchKeys: Array.from(new Set(members.map((m) => m.norm.searchKey))),
      genres: type === MediaType.LIVE ? [] : mergeGenres(members.map((m) => m.item.genre)),
      icon: base.item.icon,
      epgChannelId: base.item.epgChannelId,
      ...(members.some((m) => m.item.adult) ? { adult: true } : {}), // the provider's own flag
    });
  }

  entries.sort((a, b) => b.added - a.added || (a.key < b.key ? -1 : 1));
  return entries;
}

/** One row per (entry, category) so IndexedDB can page "category + newest first" with a single index. */
export function buildEntryCategoryRows(entries) {
  const rows = [];
  for (const entry of entries) {
    for (const categoryId of entry.categoryIds) {
      rows.push({
        key: `${entry.key}|${categoryId}`,
        entryKey: entry.key,
        type: entry.type,
        categoryId,
        added: entry.added,
      });
    }
  }
  return rows;
}

/** One row per (entry, genre) so a genre can be paged "newest first" with a single index. */
export function buildEntryGenreRows(entries) {
  const rows = [];
  for (const entry of entries) {
    for (const genre of entry.genres || []) {
      rows.push({ key: `${entry.key}|${genre.key}`, entryKey: entry.key, type: entry.type, genreKey: genre.key, name: genre.name, added: entry.added });
    }
  }
  return rows;
}
