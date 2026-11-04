import { NETWORK_PREFIX } from './liveGrouping.js';
import { makeSearchKey } from './titleNormalizer.js';

/** Fewest channels or groups sharing a first word for a network to exist (with fewer it is dropped). */
export const MIN_NETWORK_UNITS = 2;

/** First words too generic to name a network ("Sport 1", "Sport Italia" are not one broadcaster). */
const GENERIC = new Set([
  'tv', 'canale', 'channel', 'la', 'il', 'lo', 'le', 'the', 'radio', 'sport', 'sports', 'news', 'music', 'musica', 'play', 'free', 'super',
  'kids', 'cinema', 'film', 'movie', 'movies', 'premium', 'live', 'event', 'eventi', 'ppv', 'uk', 'usa', 'it', 'de', 'fr', 'es',
]);

/** Tokens that only tell a version of the same channel apart: numbers and quality marks ("Rai 1 HD" → "1", "hd"). */
const SUFFIX = /^(\d+|hd|fhd|uhd|sd|4k|8k|hevc|h265|h264|raw)$/;
/** Most words a network name can have; longer prefixes are channel titles, not broadcasters. */
const MAX_WORDS = 3;
/** A prefix is extended to its next word when that word holds this share of the units (and at most one unit stays out). */
const EXTEND_SHARE = 0.8;
/** Distinct second words needed to call a single word a network without numbered channels ("Sky Uno", "Sky Cinema", "Sky Sport"). */
const MIN_DISTINCT = 3;

/** Words of a channel name: [{ key, word }] with the normalized key and the word as written. */
function wordsOf(name) {
  const words = [];
  String(name || '')
    .trim()
    .split(/\s+/)
    .forEach((word) => {
      const pieces = makeSearchKey(word).split(' ').filter(Boolean); // "Rai_1" → rai, 1
      const written = word.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      pieces.forEach((key, i) => words.push({ key, word: written.length === pieces.length ? written[i] : key }));
    });
  return words;
}

/** First word of a channel name when it can name a network (3+ letters, not a number, not generic), else ''. */
export function networkToken(name) {
  const token = (wordsOf(name)[0] || { key: '' }).key;
  return token.length >= 3 && !/^\d+$/.test(token) && !GENERIC.has(token) ? token : '';
}

/** One written form of a word out of many: the most common, preferring one that is not all caps ("AMAZON" vs "Amazon"). */
function voteWord(forms, key) {
  const count = new Map();
  forms.forEach((f) => count.set(f, (count.get(f) || 0) + 1));
  const ranked = Array.from(count).sort((a, b) => {
    const capsA = a[0] === a[0].toUpperCase() && a[0] !== a[0].toLowerCase() ? 1 : 0;
    const capsB = b[0] === b[0].toUpperCase() && b[0] !== b[0].toLowerCase() ? 1 : 0;
    return capsA - capsB || b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  });
  const word = ranked[0] ? ranked[0][0] : key;
  if (word === word.toLowerCase() || (word === word.toUpperCase() && word.length > 4)) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return word;
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
 * Finds the networks: the longest run of first words (at most three) that channels and groups share, with proof.
 * "Rai 1", "Rai 2" → Rai (numbered versions); "Sky Uno", "Sky Cinema", "Sky Sport" → Sky (many different second words);
 * "Amazon Prime 1", "Amazon Prime 2" → Amazon Prime (one second word holds almost everything: the name is that long).
 * A word with few units and no proof ("Alessandro Borghese …" next to "Alessandro Siani") is not a network, but its longer
 * parts can be ("Alessandro Borghese"). Returns { networks: [{ id, name, units, proof }], rejected: [{ name, units, reason }] }.
 */
export function analyzeNetworks(units, { min = MIN_NETWORK_UNITS } = {}) {
  units.forEach((unit) => {
    unit.words = wordsOf(unit.name);
  });
  const networks = [];
  const rejected = [];
  const wordAt = (unit, depth) => (unit.words[depth] ? unit.words[depth].key : '');
  const nameable = (key, depth) => key.length >= 2 && !SUFFIX.test(key) && !(depth === 0 && (key.length < 3 || GENERIC.has(key) || /^\d+$/.test(key)));
  const split = (list, depth) => {
    const children = new Map();
    list.forEach((unit) => {
      const key = wordAt(unit, depth);
      if (!key) return;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(unit);
    });
    return children;
  };
  const suffixOnly = (unit, depth) => unit.words.length > depth && unit.words.slice(depth).every((w) => SUFFIX.test(w.key));

  const visit = (list, depth, prefix) => {
    // list: units sharing the first `depth` words (prefix); look at what comes next.
    const children = split(list, depth);
    const numbered = list.filter((unit) => suffixOnly(unit, depth)).length;
    const named = Array.from(children).filter(([key]) => nameable(key, depth));
    const top = named.sort((a, b) => b[1].length - a[1].length)[0];
    const label = prefix.join(' ');

    // One second word holds (almost) all the units: the network name is that long ("Amazon" → "Amazon Prime").
    if (depth === 1 && top && top[1].length >= min && top[1].length >= EXTEND_SHARE * list.length && list.length - top[1].length <= 1) {
      return visit(top[1], 2, prefix.concat(top[0]));
    }
    let proof = '';
    if (depth >= 2) proof = 'specific';
    else if (numbered >= 2) proof = 'numbered';
    else if (named.length >= MIN_DISTINCT && list.length >= MIN_DISTINCT) proof = 'distinct';
    if (proof && list.length >= min) {
      const name = prefix.map((key, i) => voteWord(list.map((unit) => unit.words[i] && unit.words[i].word).filter(Boolean), key)).join(' ');
      networks.push({ id: prefix.join('-'), name, units: list, proof, words: prefix.length });
      return undefined;
    }
    if (depth < MAX_WORDS) {
      let deeper = false;
      named.forEach(([key, sub]) => {
        if (sub.length >= min) {
          deeper = true;
          visit(sub, depth + 1, prefix.concat(key));
        }
      });
      rejected.push({ name: label, units: list.length, reason: deeper ? 'split' : 'noProof', sample: list.slice(0, 3).map((u) => u.name) });
      return undefined;
    }
    rejected.push({ name: label, units: list.length, reason: 'noProof', sample: list.slice(0, 3).map((u) => u.name) });
    return undefined;
  };

  const first = new Map();
  units.forEach((unit) => {
    const key = unit.words[0] && nameable(unit.words[0].key, 0) ? unit.words[0].key : '';
    if (!key) return;
    if (!first.has(key)) first.set(key, []);
    first.get(key).push(unit);
  });
  first.forEach((list, key) => {
    if (list.length >= min) visit(list, 1, [key]);
  });
  return { networks, rejected: rejected.filter((r) => r.reason === 'noProof' || r.reason === 'split') };
}

/**
 * Networks of Live TV (see analyzeNetworks). Hand-made links `[streamId, networkId]` put a channel in an existing network, whatever its name.
 * Returns rows for the `groups` store: { key: 'live:n<id>', isNetwork, name, icon, memberKeys, manualKeys, channelCount, added, ... };
 * `report` (when given an object) receives { networks, rejected } for the Diagnostics page.
 */
export function buildNetworks(entries, groups, { enabled = true, links = [], min = MIN_NETWORK_UNITS, report = null } = {}) {
  if (!enabled) return [];
  const units = unitsOf(entries, groups);
  const analysis = analyzeNetworks(units, { min });
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
    const network = known.get(id);
    return {
      key: `${NETWORK_PREFIX}${id}`,
      type: 'live',
      isNetwork: true,
      networkId: id,
      tmdbId: null,
      name: network.name,
      year: null,
      rating: null,
      added: Math.max(...list.map(({ unit }) => unit.added || 0)),
      defaultId: null,
      members: [],
      categoryIds: [],
      searchKeys: [id.replace(/-/g, ' ')],
      genres: [],
      icon: icon ? icon.unit.icon : '',
      epgChannelId: null,
      memberKeys: list.map(({ unit }) => unit.key),
      manualKeys: list.filter((m) => m.manual).map(({ unit }) => unit.key),
      channelCount: list.reduce((sum, { unit }) => sum + unit.ids.length, 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (report) {
    const proofOf = new Map(analysis.networks.map((n) => [n.id, n.proof]));
    report.networks = rows.map((row) => ({ name: row.name, proof: proofOf.get(row.networkId), units: row.memberKeys.length, channels: row.channelCount, manual: row.manualKeys.length, sample: members.get(row.networkId).slice(0, 3).map(({ unit }) => unit.name) }));
    report.rejected = analysis.rejected.slice(0, 60);
    report.unassigned = units.filter((unit) => !own.has(unit.key)).length;
  }
  return rows;
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

/** Text of the networks report (what the Diagnostics page shows); `tr(key, vars)` translates the labels. */
export function formatNetworkReport(report, tr) {
  const lines = [tr('diag.networks.summary', { n: report.networks.length, u: report.unassigned || 0, r: report.rejected.length })];
  report.networks.forEach((n) => {
    lines.push(`+ ${n.name} [${tr(`diag.networks.${n.proof}`)}] ${n.units}/${n.channels}${n.manual ? ` (+${n.manual})` : ''}: ${n.sample.join(' | ')}`);
  });
  report.rejected.forEach((r) => {
    lines.push(`- ${r.name} (${r.units}) ${tr(`diag.networks.${r.reason}`)}: ${r.sample.join(' | ')}`);
  });
  return lines.join('\n');
}
