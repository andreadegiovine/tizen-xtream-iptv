import { NETWORK_PREFIX } from './liveGrouping.js';

/** Fewest channels or groups for a network to exist (with fewer it is dropped). */
export const MIN_NETWORK_UNITS = 2;
/** Least share (%) of every name that the common beginning of the network must be. Found on the names of real reports: 50 keeps "Rai 1/2/3" and "Eurosport 01/02" together and "Tele Arena" apart from "Tele Universo". */
export const DEFAULT_SIMILARITY = 50;
/** Most characters a name can have beyond the common beginning of its network. Above 13 nothing more is gathered, only wrong things. */
export const DEFAULT_MAX_DIFF = 13;
/** Shortest network name, in letters and digits. */
const MIN_NAME_CHARS = 3;

/** Names too generic to be a network on their own ("Sport 1", "Sport 2" are not one broadcaster). */
const GENERIC = new Set([
  'tv', 'canale', 'channel', 'radio', 'sport', 'sports', 'news', 'music', 'musica', 'play', 'free', 'super', 'kids', 'cinema', 'film',
  'movie', 'movies', 'premium', 'live', 'event', 'eventi', 'ppv',
]);

/**
 * A name for comparing: its words (letters and digits; every other character separates them), a word repeated right after itself
 * counts once ("Dazn: Dazn 1" → "Dazn 1"), and the key is those words lowercase, without accents and spaces ("rai31"). `starts` are the
 * key positions where a word starts.
 */
function analyseName(name) {
  const words = [];
  (String(name || '').normalize('NFC').match(/[\p{L}\p{N}]+/gu) || []).forEach((text) => {
    const key = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (words.length && words[words.length - 1].key === key) words.pop(); // the repeat replaces the first
    words.push({ text, key });
  });
  const starts = new Set();
  let length = 0;
  words.forEach((word) => {
    starts.add(length);
    length += word.key.length;
  });
  return { key: words.map((w) => w.key).join(''), words, starts };
}

const commonLength = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** The written name of the first `cut` characters of a unit: its words with single spaces; in capitals ("AMAZON PRIME") it becomes "Amazon Prime", acronyms stay. */
function writtenName(info, cut) {
  const words = [];
  let length = 0;
  for (let i = 0; i < info.words.length && length < cut; i++) {
    words.push(info.words[i].text);
    length += info.words[i].key.length;
  }
  const text = words.join(' ');
  if (text !== text.toUpperCase() || text === text.toLowerCase()) return text;
  return text.replace(/\p{L}+/gu, (word) => (word.length <= 3 ? word : word.charAt(0) + word.slice(1).toLowerCase()));
}

/** Where the name ends so that it ends a word for every member ("amazonprime1" of "…1" and "…10": before the number); 0 when there is no such place. */
function wordEnd(members, length) {
  const ends = (u, p) => p >= u.info.key.length || u.info.starts.has(p);
  if (members.every((u) => ends(u, length))) return length;
  for (let p = length - 1; p >= MIN_NAME_CHARS; p--) if (members.every((u) => u.info.starts.has(p))) return p;
  return 0;
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
 * Finds the networks by what the names have in common at the beginning. The names are compared as lowercase letters and digits
 * without spaces or accents; sorted, a name joins the network before it while the common beginning of all of them stays at least
 * `similarity`% of every name and no name goes more than `maxDiff` characters beyond it. The network is named by that common beginning.
 * Returns { networks: [{ id, name, units }], rejected: [{ name, units, reason, sample }] }: gatherings of one name written many ways
 * ("duplicates", also "X" and "X Channel"), of a generic word ("generic") and whose common part cuts a word ("partial") are not networks.
 */
export function analyzeNetworks(units, { similarity = DEFAULT_SIMILARITY, maxDiff = DEFAULT_MAX_DIFF, min = MIN_NETWORK_UNITS } = {}) {
  const items = units
    .map((unit) => ({ unit, info: analyseName(unit.name) }))
    .filter((item) => item.info.key)
    .sort((a, b) => (a.info.key < b.info.key ? -1 : a.info.key > b.info.key ? 1 : 0));
  const fits = (list, length) => length >= MIN_NAME_CHARS && list.every((u) => 100 * length >= similarity * u.info.key.length && u.info.key.length - length <= maxDiff);
  const gatherings = [];
  let members = [];
  let prefix = '';
  items.forEach((item) => {
    if (members.length) {
      const length = commonLength(prefix, item.info.key);
      if (fits(members.concat(item), length)) {
        members.push(item);
        prefix = prefix.slice(0, length);
        return;
      }
      gatherings.push({ members, prefix });
    }
    members = [item];
    prefix = item.info.key;
  });
  if (members.length) gatherings.push({ members, prefix });

  const networks = new Map();
  const rejected = [];
  gatherings
    .filter((g) => g.members.length >= min)
    .forEach(({ members: list, prefix: common }) => {
      const length = wordEnd(list, common.length);
      const sample = list.slice(0, 3).map((u) => u.unit.name);
      const shown = length ? length : common.length;
      const mixed = list.find((u) => writtenName(u.info, shown) !== writtenName(u.info, shown).toUpperCase()) || list[0];
      const name = writtenName(mixed.info, shown);
      const id = common.slice(0, length);
      if (new Set(list.map((u) => u.info.key.replace(/(?<=.{3})channel$/, ''))).size < 2) rejected.push({ name, units: list.length, reason: 'duplicates', sample });
      else if (!length) rejected.push({ name, units: list.length, reason: 'partial', sample });
      else if (GENERIC.has(id) || /^\d+$/.test(id)) rejected.push({ name, units: list.length, reason: 'generic', sample });
      else if (networks.has(id)) networks.get(id).units.push(...list.map((u) => u.unit));
      else networks.set(id, { id, name, units: list.map((u) => u.unit) });
    });
  return { networks: Array.from(networks.values()), rejected };
}

/**
 * Networks of Live TV (see analyzeNetworks). Hand-made links `[streamId, networkId]` put a channel in an existing network, whatever its name.
 * Returns rows for the `groups` store: { key: 'live:n<id>', isNetwork, name, icon, memberKeys, manualKeys, channelCount, added, ... };
 * `report` (when given an object) receives what the Diagnostics page shows.
 */
export function buildNetworks(entries, groups, { enabled = true, links = [], min = MIN_NETWORK_UNITS, similarity = DEFAULT_SIMILARITY, maxDiff = DEFAULT_MAX_DIFF, report = null } = {}) {
  if (!enabled) return [];
  const units = unitsOf(entries, groups);
  const analysis = analyzeNetworks(units, { similarity, maxDiff, min });
  const known = new Map(analysis.networks.map((n) => [n.id, n]));
  const linkOf = new Map((links || []).map(([id, network]) => [id, network]));
  const members = new Map(); // network id → [{ unit, manual }]
  const own = new Map(); // unit key → network id by name
  analysis.networks.forEach((n) => n.units.forEach((unit) => own.set(unit.key, n.id)));
  units.forEach((unit) => {
    const handmade = unit.ids.map((id) => linkOf.get(id)).find((network) => network && known.has(network));
    const id = handmade || own.get(unit.key) || '';
    if (!id) return;
    if (!members.has(id)) members.set(id, []);
    members.get(id).push({ unit, manual: Boolean(handmade) && handmade !== own.get(unit.key) });
  });
  const rows = Array.from(members, ([id, list]) => {
    list.sort((a, b) => (a.unit.name < b.unit.name ? -1 : a.unit.name > b.unit.name ? 1 : 0));
    const icon = list.find(({ unit }) => unit.icon && own.get(unit.key) === id) || list.find(({ unit }) => unit.icon);
    return {
      key: `${NETWORK_PREFIX}${id}`,
      type: 'live',
      isNetwork: true,
      networkId: id,
      tmdbId: null,
      name: known.get(id).name,
      year: null,
      rating: null,
      added: Math.max(...list.map(({ unit }) => unit.added || 0)),
      defaultId: null,
      members: [],
      categoryIds: [],
      searchKeys: [id],
      genres: [],
      icon: icon ? icon.unit.icon : '',
      epgChannelId: null,
      memberKeys: list.map(({ unit }) => unit.key),
      manualKeys: list.filter((m) => m.manual).map(({ unit }) => unit.key),
      channelCount: list.reduce((sum, { unit }) => sum + unit.ids.length, 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (report) {
    report.params = { similarity, maxDiff };
    report.networks = rows.map((row) => ({ name: row.name, id: row.networkId, units: row.memberKeys.length, channels: row.channelCount, manual: row.manualKeys.length, sample: members.get(row.networkId).slice(0, 3).map(({ unit }) => unit.name) }));
    report.rejected = analysis.rejected.slice().sort((a, b) => b.units - a.units).slice(0, MAX_REPORT_REJECTED); // the biggest first: they matter most
    report.unassigned = units.filter((unit) => !own.has(unit.key)).length;
  }
  return rows;
}

/** Discarded gatherings kept in the Diagnostics report. */
const MAX_REPORT_REJECTED = 150;

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

/** Text of the networks report (what the Diagnostics page shows); `tr(key, vars)` translates the labels. */
export function formatNetworkReport(report, tr) {
  const params = report.params || {};
  const lines = [tr('diag.networks.summary', { n: report.networks.length, u: report.unassigned || 0, r: report.rejected.length, s: params.similarity, d: params.maxDiff })];
  report.networks.forEach((n) => {
    lines.push(`+ ${n.name} [${n.id}] ${n.units}/${n.channels}${n.manual ? ` (+${n.manual})` : ''}: ${n.sample.join(' | ')}`);
  });
  report.rejected.forEach((r) => {
    lines.push(`- ${r.name} (${r.units}) ${tr(`diag.networks.${r.reason}`)}: ${r.sample.join(' | ')}`);
  });
  return lines.join('\n');
}
