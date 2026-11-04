import { kvGet, kvSet, kvDelete } from '../db/kv.js';
import { normalizeTitle, makeSearchKey } from './titleNormalizer.js';

/** Key of the pseudo category that lists what the Live TV "show all" view holds (groups + channels that are not grouped). */
export const LIVE_ALL = '@all';
/** Layout of the live catalog: lists synced with an older one are downloaded again once. */
export const LIVE_LAYOUT = 2;
/** Keys of grouped channels start with this; single channels are `live:i<id>`. */
export const GROUP_PREFIX = 'live:g';
export const isGroupKey = (key) => typeof key === 'string' && key.startsWith(GROUP_PREFIX);

/** Words taken out of a channel name before comparing it with the others (quality and feed markers). */
export const DEFAULT_TERMS = Object.freeze([
  'full hd', 'fullhd', 'ultra hd', 'uhd', 'fhd', 'hd', 'sd', '4k', '8k', 'hdr', 'hevc', 'h265', 'h264', 'x265', 'x264',
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '50fps', '60fps', 'raw', 'hq', 'lq', 'backup',
]);

/** "HD, FHD ; 4K" → ['hd', 'fhd', '4k']. */
export function parseTerms(text) {
  const seen = new Set();
  String(text == null ? '' : text)
    .split(/[,;\n]/)
    .map((term) => term.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .forEach((term) => seen.add(term));
  return Array.from(seen);
}

export const termsText = (terms) => terms.join(', ');

/** The terms to use: the ones the user wrote, otherwise the defaults. */
export function resolveTerms(text) {
  const own = parseTerms(text);
  return own.length ? own : Array.from(DEFAULT_TERMS);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regular expression for all the terms (longest first, whole words only); null without terms. */
export function compileTerms(terms) {
  const parts = Array.from(terms || [])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => escapeRegExp(term).replace(/ /g, '\\s+'));
  if (!parts.length) return null;
  return new RegExp(`(^|[^\\p{L}\\p{N}])(?:${parts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
}

/**
 * Quality of a stream from its name: 4 = 4K, 3 = Full HD, 2 = HD, 1.5 = nothing said, 1 = SD.
 * Independent of the user's terms: it only decides which version is preselected.
 */
export function qualityRank(name) {
  const key = ` ${makeSearchKey(name)} `;
  if (/ (4k|8k|uhd|ultra hd|2160p) /.test(key)) return 4;
  if (/ (fhd|full hd|fullhd|1080p|1080i) /.test(key)) return 3;
  if (/ (hd|720p) /.test(key)) return 2;
  if (/ (sd|576p|480p) /.test(key)) return 1;
  return 1.5;
}

/** Channel name without the terms, language prefixes and tag brackets: { display, base }. `base` is the comparison key. */
export function channelBase(name, regex) {
  const original = String(name == null ? '' : name).trim();
  let text = original;
  if (regex) {
    regex.lastIndex = 0;
    text = text.replace(regex, '$1 ');
  }
  text = text.replace(/[[(]\s*[\])]/g, ' '); // brackets left empty
  const display = normalizeTitle(text).cleanTitle.replace(/\s+/g, ' ').trim() || original;
  // "+1" / "+24" mark another feed of the channel: they must survive the punctuation clean-up.
  const base = makeSearchKey(display.replace(/\+\s*(\d)/g, ' plus$1').replace(/\+/g, ' plus '));
  return { display, base };
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }

  find(id) {
    if (!this.parent.has(id)) this.parent.set(id, id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let node = id;
    while (this.parent.get(node) !== root) {
      const next = this.parent.get(node);
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
    return ra;
  }
}

const MAX_NAME_BUCKET = 40; // a name shared by more channels than this is too generic to trust

/**
 * Groups the versions of the same channel. Signals, strongest first:
 *   1. links made by hand (always honoured);
 *   2. same EPG id and same cleaned name;
 *   3. same cleaned name and the same category or the same logo, unless the EPG ids say they differ.
 * A cluster never holds two different EPG ids (except by hand). When in doubt channels stay apart:
 * a duplicate in the list is harmless, a channel swallowed by the wrong group is not.
 * Returns grouped entries (type live, `isGroup`), the best version first.
 */
export function buildChannelGroups(items, { excludedCategories = new Set(), terms = DEFAULT_TERMS, links = [] } = {}) {
  const regex = compileTerms(terms);
  const info = new Map();
  items.forEach((item) => {
    if (excludedCategories.has(item.categoryId)) return;
    const { display, base } = channelBase(item.name, regex);
    info.set(item.id, { item, display, base, epg: item.epgChannelId ? String(item.epgChannelId).toLowerCase() : '', quality: qualityRank(item.name) });
  });

  const sets = new UnionFind();
  const epgOf = new Map(); // root → epg id of the cluster ('' while unknown)
  const byHand = new Set(); // roots of clusters made by hand: they are never refused for their EPG ids
  const epgConflict = (a, b) => {
    const ra = sets.find(a);
    const rb = sets.find(b);
    if (byHand.has(ra) || byHand.has(rb)) return false;
    const ea = epgOf.get(ra) || '';
    const eb = epgOf.get(rb) || '';
    return Boolean(ea && eb && ea !== eb);
  };
  const join = (a, b, force = false) => {
    if (sets.find(a) === sets.find(b)) return;
    if (!force && epgConflict(a, b)) return;
    const hand = force || byHand.has(sets.find(a)) || byHand.has(sets.find(b));
    const epg = epgOf.get(sets.find(a)) || epgOf.get(sets.find(b)) || '';
    const root = sets.union(a, b);
    if (epg) epgOf.set(root, epg);
    if (hand) byHand.add(root);
  };
  info.forEach((entry, id) => {
    sets.find(id);
    if (entry.epg) epgOf.set(sets.find(id), entry.epg);
  });

  // 1. by hand
  (links || []).forEach(([a, b]) => {
    if (info.has(a) && info.has(b)) join(a, b, true);
  });

  // 2. same EPG id + same name
  const byEpg = new Map();
  info.forEach((entry, id) => {
    if (!entry.epg || !entry.base) return;
    const key = `${entry.epg}\u0000${entry.base}`;
    if (!byEpg.has(key)) byEpg.set(key, []);
    byEpg.get(key).push(id);
  });
  byEpg.forEach((ids) => ids.slice(1).forEach((id) => join(ids[0], id)));

  // 3. same name + category or logo
  const byName = new Map();
  info.forEach((entry, id) => {
    if (!entry.base) return;
    if (!byName.has(entry.base)) byName.set(entry.base, []);
    byName.get(entry.base).push(id);
  });
  byName.forEach((ids) => {
    if (ids.length < 2 || ids.length > MAX_NAME_BUCKET) return;
    ids.sort((a, b) => a - b);
    ids.forEach((id, at) => {
      const me = info.get(id).item;
      for (let k = 0; k < at; k += 1) {
        const other = info.get(ids[k]).item;
        const sameCategory = me.categoryId === other.categoryId;
        const sameLogo = Boolean(me.icon) && me.icon === other.icon;
        if ((sameCategory || sameLogo) && sets.find(id) !== sets.find(ids[k])) {
          join(ids[k], id);
          if (sets.find(id) === sets.find(ids[k])) break;
        }
      }
    });
  });

  // Clusters of two or more
  const clusters = new Map();
  info.forEach((entry, id) => {
    const root = sets.find(id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(entry);
  });
  const found = [];
  clusters.forEach((members) => {
    if (members.length < 2) return;
    members.sort((a, b) => b.quality - a.quality || a.item.id - b.item.id);
    found.push(members);
  });
  found.sort((a, b) => (a[0].base < b[0].base ? -1 : a[0].base > b[0].base ? 1 : Math.min(...a.map((m) => m.item.id)) - Math.min(...b.map((m) => m.item.id))));

  const used = new Set();
  return found.map((members) => {
    const best = members[0];
    const slug = (best.base || String(best.item.id)).replace(/ /g, '_');
    let key = `${GROUP_PREFIX}:${slug}`;
    if (used.has(key)) key = `${key}|${best.epg || Math.min(...members.map((m) => m.item.id))}`;
    used.add(key);
    const categoryIds = Array.from(new Set(members.map((m) => m.item.categoryId)));
    const searchKeys = Array.from(new Set([best.base, ...members.map((m) => makeSearchKey(m.item.name))].filter(Boolean)));
    return {
      key,
      type: 'live',
      isGroup: true,
      tmdbId: null,
      name: best.display,
      year: null,
      rating: null,
      added: Math.max(...members.map((m) => m.item.added)),
      defaultId: best.item.id,
      memberIds: members.map((m) => m.item.id),
      members: members.map((m) => ({ id: m.item.id, ext: '', categoryId: m.item.categoryId, name: m.item.name, entryKey: `live:i${m.item.id}` })),
      categoryIds,
      searchKeys,
      genres: [],
      icon: (members.find((m) => m.item.icon) || best).item.icon,
      epgChannelId: (members.find((m) => m.item.epgChannelId) || best).item.epgChannelId || null,
    };
  });
}

/** Marks the single channels that belong to a group (the detail page offers "merge" only to the others). */
export function annotateGroupKeys(entries, groups) {
  const keyOf = new Map();
  groups.forEach((group) => group.memberIds.forEach((id) => keyOf.set(id, group.key)));
  entries.forEach((entry) => {
    const groupKey = keyOf.get(entry.defaultId);
    if (groupKey) entry.groupKey = groupKey;
    else delete entry.groupKey;
  });
}

/** Rows of the "show all" view of Live TV: the groups and the channels that are in none (one row each, newest first by `added`). */
export function buildLiveAllRows(entries, groups) {
  const grouped = new Set();
  groups.forEach((group) => group.memberIds.forEach((id) => grouped.add(id)));
  const rows = [];
  entries.forEach((entry) => {
    if (grouped.has(entry.defaultId)) return;
    rows.push({ key: `${entry.key}|${LIVE_ALL}`, entryKey: entry.key, type: 'live', categoryId: LIVE_ALL, added: entry.added });
  });
  groups.forEach((group) => rows.push({ key: `${group.key}|${LIVE_ALL}`, entryKey: group.key, type: 'live', categoryId: LIVE_ALL, added: group.added }));
  return rows;
}

/** What the catalog sync needs: { enabled, terms, links }. The default when nothing is configured. */
export const DEFAULT_GROUPING = Object.freeze({ enabled: true, terms: DEFAULT_TERMS, links: [] });

/** Grouped entries for a sync / rebuild: none when the feature is off. */
export function groupLiveItems(items, { excludedCategories, grouping = DEFAULT_GROUPING } = {}) {
  if (!grouping || !grouping.enabled) return [];
  return buildChannelGroups(items, { excludedCategories, terms: grouping.terms, links: grouping.links });
}

const linksKey = (providerId) => `liveLinks:${providerId}`;

/** Reads the grouping settings and keeps the links made by hand (they survive syncs). */
export function createLiveGroupingService({ db, settings }) {
  return {
    async config(providerId) {
      const s = await settings.get();
      const links = await kvGet(db, linksKey(providerId), []);
      return { enabled: s.liveGrouping, terms: resolveTerms(s.liveGroupPatterns), links: Array.isArray(links) ? links : [] };
    },
    /** Joins two channels (stream ids) for good. */
    async link(providerId, a, b) {
      const links = await kvGet(db, linksKey(providerId), []);
      if (!links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) links.push([a, b]);
      await kvSet(db, linksKey(providerId), links);
    },
    removeProvider: (providerId) => kvDelete(db, linksKey(providerId)),
  };
}
