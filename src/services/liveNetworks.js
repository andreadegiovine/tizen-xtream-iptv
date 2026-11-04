import { NETWORK_PREFIX } from './liveGrouping.js';
import { makeSearchKey } from './titleNormalizer.js';

/** Fewest channels or groups sharing a first word for it to be a network by itself. */
export const MIN_NETWORK_UNITS = 3;

/** First words too generic to name a network ("Sport 1", "Sport Italia" are not one broadcaster). */
const GENERIC = new Set([
  'tv', 'canale', 'channel', 'la', 'il', 'lo', 'le', 'the', 'radio', 'sport', 'sports', 'news', 'music', 'musica', 'play', 'free', 'super',
  'kids', 'cinema', 'film', 'movie', 'movies', 'premium', 'live', 'event', 'eventi', 'ppv', 'uk', 'usa', 'it', 'de', 'fr', 'es',
]);

/** First word of a channel name when it can name a network (3+ letters, not a number, not generic), else ''. */
export function networkToken(name) {
  const token = makeSearchKey(name).split(' ')[0] || '';
  return token.length >= 3 && !/^\d+$/.test(token) && !GENERIC.has(token) ? token : '';
}

/** "Rai 1 HD" → "Rai"; a long all-caps word ("SKY" stays, "DISCOVERY" becomes "Discovery"). */
function displayWord(name, token) {
  const word = String(name || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{N}]+$/u, '');
  if (makeSearchKey(word) !== token) return token.charAt(0).toUpperCase() + token.slice(1);
  return word === word.toUpperCase() && word.length > 4 ? word.charAt(0) + word.slice(1).toLowerCase() : word;
}

/** What a network holds: a group or a channel that is in none (one card each in the lists). */
function unitsOf(entries, groups) {
  const grouped = new Set();
  const units = groups.map((group) => {
    group.memberIds.forEach((id) => grouped.add(id));
    return { key: group.key, name: group.name, ids: group.memberIds, icon: group.icon, added: group.added };
  });
  entries.forEach((entry) => {
    if (!grouped.has(entry.defaultId)) units.push({ key: entry.key, name: entry.name, ids: [entry.defaultId], icon: entry.icon, added: entry.added });
  });
  return units;
}

/**
 * Networks of Live TV: every channel or group whose name starts with the same word (Rai 1, Rai 2, Rai 3 → "Rai").
 * Hand-made links `[streamId, networkId]` put a channel in an existing network, whatever its name.
 * Returns rows for the `groups` store: { key: 'live:n<id>', isNetwork, name, icon, memberKeys, manualKeys, channelCount, added, ... }.
 */
export function buildNetworks(entries, groups, { enabled = true, links = [], min = MIN_NETWORK_UNITS } = {}) {
  if (!enabled) return [];
  const units = unitsOf(entries, groups);
  const byToken = new Map();
  units.forEach((unit) => {
    unit.token = networkToken(unit.name);
    if (!unit.token) return;
    if (!byToken.has(unit.token)) byToken.set(unit.token, []);
    byToken.get(unit.token).push(unit);
  });
  const known = new Map(); // networks that exist by their own: id → display name
  byToken.forEach((list, token) => {
    if (list.length >= min) known.set(token, displayWord(list.slice().sort((a, b) => (a.name < b.name ? -1 : 1))[0].name, token));
  });
  const linkOf = new Map((links || []).map(([id, network]) => [id, network]));
  const members = new Map(); // network id → [{ unit, manual }]
  units.forEach((unit) => {
    const handmade = unit.ids.map((id) => linkOf.get(id)).find((network) => network && known.has(network));
    const id = handmade || (known.has(unit.token) ? unit.token : '');
    if (!id) return;
    if (!members.has(id)) members.set(id, []);
    members.get(id).push({ unit, manual: Boolean(handmade) && handmade !== unit.token });
  });
  return Array.from(members, ([id, list]) => {
    list.sort((a, b) => (a.unit.name < b.unit.name ? -1 : a.unit.name > b.unit.name ? 1 : 0));
    const own = list.find(({ unit }) => unit.icon && unit.token === id) || list.find(({ unit }) => unit.icon);
    return {
      key: `${NETWORK_PREFIX}${id}`,
      type: 'live',
      isNetwork: true,
      networkId: id,
      tmdbId: null,
      name: known.get(id),
      year: null,
      rating: null,
      added: Math.max(...list.map(({ unit }) => unit.added || 0)),
      defaultId: null,
      members: [],
      categoryIds: [],
      searchKeys: [id],
      genres: [],
      icon: own ? own.unit.icon : '',
      epgChannelId: null,
      memberKeys: list.map(({ unit }) => unit.key),
      manualKeys: list.filter((m) => m.manual).map(({ unit }) => unit.key),
      channelCount: list.reduce((sum, { unit }) => sum + unit.ids.length, 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Marks the groups and the channels that belong to a network (`networkKey`); a channel inside a group takes its group's network. */
export function annotateNetworkKeys(entries, groups, networks) {
  const networkOf = new Map();
  networks.forEach((network) => network.memberKeys.forEach((key) => networkOf.set(key, network.key)));
  const mark = (item, key) => {
    if (key) item.networkKey = key;
    else delete item.networkKey;
  };
  groups.forEach((group) => mark(group, networkOf.get(group.key)));
  entries.forEach((entry) => mark(entry, networkOf.get(entry.groupKey || entry.key)));
}

/** Networks and the channels in them (streams, not groups): { networkCount, networkedCount }. */
export function networkCounts(networks) {
  return { networkCount: networks.length, networkedCount: networks.reduce((sum, network) => sum + network.channelCount, 0) };
}
