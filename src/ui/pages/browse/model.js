/*
 * The model of the browse pages (src/ui/pages/browsePage.js), kept apart from the page: the window of a grid that grows as the focus
 * goes down, the entries of the sidebar and the constants they share.
 */
import { GridModel } from '../../focus/models.js';

/** Icon before the label of the fixed sidebar entries (genres and categories get an empty slot to stay aligned). */
export const SIDEBAR_ICON = { guide: 'clock', scheduled: 'scheduled', all: 'all', continue: 'continue', favorites: 'heart', suggestions: 'suggestions', genresToggle: 'genres', epgGenresToggle: 'genres', toggle: 'categories', networksToggle: 'network' };
/** Placeholder rows shown while the genres load: enough that the "Categories" entry stays below the screen. */
export const GENRE_SKELETONS = 12;
/** Views that are loaded as one in-memory list and paged locally. */
export const LIST_KINDS = ['continue', 'favorites', 'suggestions', 'genre', 'network'];
/** Sidebar entries shown as a programme guide instead of a grid: the guide, the scheduled programmes, a genre of the guide. */
export const isGuideKind = (kind) => kind === 'guide' || kind === 'scheduled' || kind === 'epgGenre';
/** Views read from the catalog only (so their first page can be cached); continue, favourites and suggestions come from the user. */
export const CACHED_KINDS = ['all', 'category', 'genre', 'network'];
/** Every media type uses the same 6-column grid of equally sized cards (channels included). */
export const columnsFor = () => 6;

/** Rows loaded beyond the bottom of the screen (the grid grows as the focus goes down; no pages). */
export const PREFETCH_ROWS = 3;
/** Rows on screen before they can be measured. */
export const DEFAULT_SCREEN_ROWS = 3;
/** Cards loaded at least each time the grid grows. */
export const BATCH_ROWS = 4;

/**
 * Rows of the grid that keep their pictures for the focus on `index`: from PREFETCH_ROWS rows above the screen down (the rows further
 * up free theirs and show the skeleton again until they are near the screen). `screenRows`: rows on screen. Returns the first such row.
 */
export function firstKeptRow(index, columns, screenRows = DEFAULT_SCREEN_ROWS, margin = PREFETCH_ROWS) {
  const row = Math.floor(Math.max(0, index) / columns);
  return Math.max(0, row - Math.max(1, screenRows) + 1 - margin); // the focused row can be the last one on screen
}

/** How many cards must be loaded for the focus on `index`: up to its row, the rows on screen below it and PREFETCH_ROWS more. */
export function wantedCount(index, columns, screenRows = DEFAULT_SCREEN_ROWS, ahead = PREFETCH_ROWS) {
  const row = Math.floor(Math.max(0, index) / columns);
  return (row + Math.max(1, screenRows) + ahead) * columns;
}

/**
 * Grid navigation of a grid that grows while scrolling: a plain GridModel, but Down from the last loaded row waits for the next cards
 * (`more()` is asked for them) instead of leaving the grid when the view has more.
 */
export function createGrowingGridModel({ columns, getCount, hasMore, more }) {
  const grid = new GridModel({ columns, getCount });
  return {
    getCount,
    navigate(dir, index) {
      const result = grid.navigate(dir, index);
      if (result.type === 'exit' && result.dir === 'down' && hasMore()) {
        more();
        return { type: 'move', index };
      }
      return result;
    },
  };
}

/**
 * Sidebar entries. Movies and series: show all, continue watching, favourites, suggestions, a "Genres"
 * entry (open by default) with the genres, then a "Categories" entry that expands into the provider categories. Channels: show all, favourites, pinned categories,
 * the "Genres" entry of the guide's categories (open, only when the guide has them), the "Networks" entry (open, closed when the guide genres
 * are there) and the categories (closed).
 */
export function sidebarItems({ type, hidden = null, genres = [], epgGenres = [], epgGenresExpanded = true, categories = [], pinned = [], networks = [], networksExpanded = true, expanded = false, genresExpanded = true, genresLoading = false, scheduled = false, labels }) {
  // Live TV opens on the programme guide; "show all" follows it.
  // "Scheduled" (programmes whose viewing is scheduled) follows the guide when there are any.
  // The programme guide (Live TV) is listed only when it has rows (a channel with programmes in the hours shown).
  const guide = hidden && hidden.has('guide') ? [] : [{ kind: 'guide', name: labels.guide }];
  const items = type === 'live' ? guide.concat(scheduled ? [{ kind: 'scheduled', name: labels.scheduled }] : [], [{ kind: 'all', name: labels.all }]) : [{ kind: 'all', name: labels.all }];
  if (type === 'live') {
    if (!(hidden && hidden.has('favorites'))) items.push({ kind: 'favorites', name: labels.favorites });
    pinned.forEach((p) => items.push({ kind: p.kind, id: String(p.id), name: p.name, pinned: true }));
    if (epgGenres.length) {
      items.push({ kind: 'epgGenresToggle', name: labels.genres, expanded: epgGenresExpanded });
      if (epgGenresExpanded) epgGenres.forEach((g) => items.push({ kind: 'epgGenre', id: g.key, name: g.name, depth: 1 }));
    }
    if (networks.length) {
      items.push({ kind: 'networksToggle', name: labels.networks, expanded: networksExpanded });
      if (networksExpanded) networks.forEach((n) => items.push({ kind: 'network', id: n.key, name: n.name, depth: 1 }));
    }
    if (categories.length) {
      items.push({ kind: 'toggle', name: labels.categories, expanded });
      if (expanded) categories.forEach((c) => items.push({ kind: 'category', id: c.id, name: c.name, depth: 1 }));
    }
    return items;
  }
  // Continue watching, favourites and suggestions are listed only when they have something to show (`hidden`).
  [{ kind: 'continue', name: labels.continue }, { kind: 'favorites', name: labels.favorites }, { kind: 'suggestions', name: labels.suggestions }].forEach((item) => {
    if (!(hidden && hidden.has(item.kind))) items.push(item);
  });
  // Pinned categories and genres sit between the suggestions and the genres.
  pinned.forEach((p) => items.push({ kind: p.kind, id: String(p.id), name: p.name, pinned: true }));
  if (genres.length || genresLoading) {
    items.push({ kind: 'genresToggle', name: labels.genres, expanded: genresExpanded });
    if (genresExpanded) genres.forEach((g) => items.push({ kind: 'genre', id: String(g.key), name: g.name, depth: 1 }));
  }
  if (categories.length) {
    items.push({ kind: 'toggle', name: labels.categories, expanded });
    if (expanded) categories.forEach((c) => items.push({ kind: 'category', id: c.id, name: c.name, depth: 1 }));
  }
  return items;
}

/** Index of the entry matching a filter ({ kind, id }); 0 ("show all") when it is not there. */
export function indexOfFilter(items, filter) {
  if (!filter) return 0;
  const index = items.findIndex((item) => item.kind === filter.kind && String(item.id) === String(filter.id));
  return Math.max(0, index);
}

/** Movies / Series / Live: sidebar on the left, paged grid of grouped titles on the right. */
