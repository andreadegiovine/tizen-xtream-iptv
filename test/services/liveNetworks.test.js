import { buildNetworks, analyzeNetworks, annotateNetworkKeys, networkCounts, formatNetworkReport } from '../../src/services/liveNetworks.js';
import { buildChannelGroups, annotateGroupKeys, createLiveGroupingService } from '../../src/services/liveGrouping.js';
import { buildEntries } from '../../src/services/grouping.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { getEntry, listNetworks, createMergeSearch } from '../../src/services/catalogQuery.js';
import { loadSearchRows, searchRows } from '../../src/services/searchIndex.js';
import { groupByType } from '../../src/ui/components/typedRows.js';
import { describeType } from '../../src/ui/components/syncPanel.js';
import { createCard } from '../../src/ui/components/card.js';

const ch = (id, name, extra = {}) => ({ id, name, categoryId: '1', added: 1000 + id, icon: `l${id}.png`, epgChannelId: null, ...extra });
const channels = [ch(1, 'Rai 1 HD'), ch(2, 'Rai 2 HD'), ch(3, 'Rai 3'), ch(4, 'Rai Yoyo'), ch(5, 'Canale 5'), ch(6, 'Sport Italia'), ch(7, 'Sky Uno')];

function build(items, options) {
  const entries = buildEntries('live', items.map((i) => ({ ...i, tmdbId: null, ext: '', genre: '' })));
  const groups = buildChannelGroups(items);
  annotateGroupKeys(entries, groups);
  const networks = buildNetworks(entries, groups, options);
  annotateNetworkKeys(entries, groups, networks);
  return { entries, groups, networks };
}

test('channels whose names begin the same way make a network (the common beginning is its name)', () => {
  const { entries, networks } = build(channels);
  expect(networks.map((n) => n.name)).toEqual(['Rai']); // Rai Yoyo is too far from "Rai 1": the common beginning is under half of it
  expect(networks[0]).toMatchObject({ key: 'live:nrai', isNetwork: true, channelCount: 3 });
  expect(networks[0].memberKeys).toEqual(['live:i1', 'live:i2', 'live:i3']);
  expect(entries.find((e) => e.defaultId === 2).networkKey).toBe('live:nrai');
  expect(entries.find((e) => e.defaultId === 5).networkKey).toBeUndefined();
  expect(networkCounts(networks)).toEqual({ networkCount: 1, networkedCount: 3 });
});

test('a group counts once for the network and a channel in a group takes the group network', () => {
  const items = [ch(1, 'Rai 1 HD'), ch(11, 'Rai 1 FHD', { epgChannelId: 'a' }), ch(2, 'Rai 2'), ch(3, 'Rai 3')];
  items[0].epgChannelId = 'a';
  const { entries, groups, networks } = build(items);
  expect(groups).toHaveLength(1);
  expect(networks[0].memberKeys).toHaveLength(3);
  expect(networks[0].channelCount).toBe(4); // streams, not groups
  expect(entries.find((e) => e.defaultId === 11).networkKey).toBe('live:nrai');
  expect(groups[0].networkKey).toBe('live:nrai');
});

test('hand-made links add a channel to an existing network, and can only target networks that exist', () => {
  const { entries, networks } = build(channels, { links: [[5, 'rai'], [6, 'nothing']] });
  expect(networks[0].memberKeys).toContain('live:i5');
  expect(networks[0].manualKeys).toEqual(['live:i5']);
  expect(entries.find((e) => e.defaultId === 6).networkKey).toBeUndefined();
  expect(build(channels, { enabled: false }).networks).toEqual([]);
});

test('networks are stored with the groups, found by key, and kept out of the merge search', async () => {
  const rows = channels.map((c) => ({ stream_id: c.id, name: c.name, category_id: '1', added: String(c.added), stream_icon: c.icon, epg_channel_id: c.epgChannelId }));
  const client = { getCategories: async () => [{ category_id: '1', category_name: 'All' }], getStreams: async () => rows };
  const db = await openProviderDb('live-networks-1');
  const meta = await syncType({ db, client, type: 'live' });
  expect(meta).toMatchObject({ networkCount: 1, networkedCount: 3 });
  expect((await listNetworks(db)).map((n) => n.key)).toEqual(['live:nrai']);
  expect((await getEntry(db, 'live:nrai')).name).toBe('Rai');
  expect((await getEntry(db, 'live:i2')).networkKey).toBe('live:nrai');
  const search = await loadSearchRows(db, ['live']);
  const found = searchRows(search, 'rai');
  expect(found[0]).toMatchObject({ key: 'live:nrai', isNetwork: true, group: false });
  expect((await createMergeSearch(db, 5)('rai')).map((r) => r.key)).not.toContain('live:nrai');
  // the setting off: no networks
  const off = await openProviderDb('live-networks-2');
  const noNetworks = await syncType({ db: off, client, type: 'live', grouping: { enabled: true, terms: [], links: [], splits: [], networks: { enabled: false, links: [] } } });
  expect(noNetworks.networkCount).toBe(0);
  expect(await listNetworks(off)).toEqual([]);
});

test('network links are kept per provider and replace the previous ones', async () => {
  const svc = createLiveGroupingService({ db: await openAppDb('live-network-links'), settings: { get: async () => ({ liveGrouping: true, liveNetworks: true, liveGroupPatterns: '' }) } });
  await svc.linkNetwork('p', [1, 2], 'rai');
  await svc.linkNetwork('p', [2], 'sky');
  expect(await svc.networkLinks('p')).toEqual([[1, 'rai'], [2, 'sky']]);
  expect((await svc.config('p')).networks).toEqual({ enabled: true, links: [[1, 'rai'], [2, 'sky']] });
  await svc.unlinkNetwork('p', [1]);
  expect(await svc.networkLinks('p')).toEqual([[2, 'sky']]);
  await svc.removeProvider('p');
  expect(await svc.networkLinks('p')).toEqual([]);
});

test('networks come first among the channels, have their own badge and a line in the catalog', () => {
  const groups = groupByType([{ type: 'live', name: 'A' }, { type: 'live', name: 'Rai', isNetwork: true }]);
  expect(groups[0].entries.map((e) => e.name)).toEqual(['Rai', 'A']);
  const card = createCard({ name: 'Rai', icon: '', isNetwork: true }, 'live');
  expect(card.el.querySelector('.card-status .icon-network')).not.toBeNull();
  const text = describeType({ phase: 'done' }, { itemCount: 5321, groupCount: 681, groupedCount: 2220, networkCount: 12, networkedCount: 840, lastSync: Date.UTC(2026, 10, 4, 12, 0) }, 'en-US');
  expect(text).toMatch(/^5,321 items · 681 groups \(2,220 channels\) · 12 networks \(840 channels\) · updated /);
});

test('"show all" lists the networks, then the groups in none, then the channels in no group and no network', async () => {
  const { buildLiveAllRows } = await import('../../src/services/liveGrouping.js');
  const items = [ch(1, 'Rai 1'), ch(2, 'Rai 2'), ch(3, 'Zeta'), ch(4, 'Zeta', { epgChannelId: 'z' }), ch(5, 'Zeta HD', { epgChannelId: 'z' }), ch(6, 'Other', { added: 99999 })];
  const { entries, groups, networks } = build(items);
  const rows = buildLiveAllRows(entries, groups, networks);
  const sorted = rows.slice().sort((a, b) => b.added - a.added).map((r) => r.entryKey);
  expect(networks.map((n) => n.key)).toEqual(['live:nrai']);
  expect(sorted[0]).toBe('live:nrai');
  expect(sorted[1].startsWith('live:g')).toBe(true); // a group in no network, ahead of the newer lone channels
  expect(sorted).not.toContain('live:i1'); // in a network: only the network is listed
  expect(sorted.slice(2)).toEqual(['live:i6']);
});

test('a tag typed as [DVS] keeps its case and is taken out of the names, so the network is not named after it', async () => {
  const { parseTerms, compileTerms, resolveTerms, channelBase, cleanChannelNames } = await import('../../src/services/liveGrouping.js');
  expect(parseTerms('[DVS], hd')).toEqual(['[DVS]', 'hd']);
  expect(channelBase('[DVS] BEACHSOCCER-3', compileTerms(resolveTerms('[DVS]'))).display).toBe('BEACHSOCCER-3');
  const items = [ch(1, '[DVS] A LIGA HIPERMOTION 1'), ch(2, '[DVS] BEACHSOCCER-3'), ch(3, '[DVS] BEACHSOCCER-4')];
  const entries = buildEntries('live', items.map((i) => ({ ...i, tmdbId: null, ext: '', genre: '' })));
  cleanChannelNames(entries, compileTerms(['[DVS]']));
  expect(entries.map((e) => e.name).sort()).toEqual(['A LIGA HIPERMOTION 1', 'BEACHSOCCER-3', 'BEACHSOCCER-4']);
  expect(entries[0].searchKeys.length).toBeGreaterThan(1); // the old spelling can still be searched
  expect(buildNetworks(entries, [], {}).map((n) => n.name)).toEqual(['Beachsoccer']);
});

test('terms can be /regular expressions/ (commas allowed inside), a bad one is ignored', async () => {
  const { parseTerms, compileTerms, channelBase } = await import('../../src/services/liveGrouping.js');
  expect(parseTerms('hd, /^\\[[^\\]]{1,5}\\]\\s*/, 4k')).toEqual(['hd', '/^\\[[^\\]]{1,5}\\]\\s*/', '4k']);
  const regex = compileTerms(['/^\\[[^\\]]+\\]/', '/(/', 'hd']);
  expect(channelBase('[XYZ] Canale Uno HD', regex).display).toBe('Canale Uno');
  expect(compileTerms(['/(/'])).toBeNull();
});

test('underscores in channel names become spaces', async () => {
  const { channelBase, compileTerms } = await import('../../src/services/liveGrouping.js');
  const { normalizeChannelName } = await import('../../src/services/titleNormalizer.js');
  expect(normalizeChannelName('RAI_1__HD ').cleanTitle).toBe('RAI 1 HD');
  expect(channelBase('IT_Rai_Yoyo_HD', compileTerms(['hd'])).display).toBe('IT Rai Yoyo');
  const entries = buildEntries('live', [ch(1, 'Rai_1'), ch(2, 'Rai_2')].map((i) => ({ ...i, tmdbId: null, ext: '', genre: '' })));
  expect(entries.map((e) => e.name).sort()).toEqual(['Rai 1', 'Rai 2']);
  expect(buildNetworks(entries, [], {}).map((n) => n.name)).toEqual(['Rai']);
});

test('a term made of symbols ("==", "[DVS]") is removed wherever it is, words still match whole', async () => {
  const { channelBase, compileTerms } = await import('../../src/services/liveGrouping.js');
  const regex = compileTerms(['==', '[DVS]', 'hd']);
  expect(channelBase('==SKY CINEMA==', regex).display).toBe('SKY CINEMA');
  expect(channelBase('[DVS]A LIGA', regex).display).toBe('A LIGA');
  expect(channelBase('Chd Hd', regex).display).toBe('Chd'); // "hd" inside a word stays
});

test('the network is named by what all its names have in common, as written, whole words only', () => {
  const alessandro = [ch(1, 'Alessandro Borghese 4 ristoranti'), ch(2, 'Alessandro Borghese Celebrity Chef Channel 1'), ch(3, 'Alessandro Borghese Celebrity Chef Channel 2'), ch(4, 'Alessandro Siani Channel')];
  expect(build(alessandro).networks.map((n) => n.name)).toEqual(['Alessandro Borghese Celebrity Chef Channel']);
  const amazon = build([ch(1, 'AMAZON PRIME 1'), ch(2, 'Amazon Prime 2'), ch(3, 'Amazon Prime Movies')]).networks;
  expect(amazon.map((n) => [n.name, n.networkId])).toEqual([['Amazon Prime', 'amazonprime']]);
  expect(build([ch(1, 'AMICHEVOLI 01'), ch(2, 'AMICHEVOLI 02'), ch(3, 'AMICHEVOLI 03')]).networks.map((n) => n.name)).toEqual(['Amichevoli']); // not "Amichevoli 0"
  expect(build([ch(1, 'Café TV 1'), ch(2, 'Cafe TV 2')]).networks.map((n) => n.name)).toEqual(['Café TV']); // accents and symbols do not count
  expect(build([ch(1, 'Real Time 1'), ch(2, 'Real Time 2'), ch(3, 'RealTime 3')]).networks[0]).toMatchObject({ name: 'Real Time', channelCount: 3 }); // spaces do not count
});

test('similarity and the most different characters decide what is gathered', () => {
  const units = (names) => names.map((name, i) => ({ key: `k${i}`, name, ids: [i], icon: '', added: 1 }));
  const rai = units(['Rai 1 HD', 'Rai 2 HD', 'Rai Sport HD']);
  expect(analyzeNetworks(rai, { similarity: 50 }).networks.map((n) => n.name)).toEqual(['Rai']); // "Rai" is half of "Rai 1 HD"; "Rai Sport HD" (a quarter) stays out
  expect(analyzeNetworks(units(['Tele Arena Siena (Toscana)', 'Tele Universo (Campania)'])).networks).toEqual([]); // "tele" is a fifth of each
  expect(analyzeNetworks(units(['Eurosport 01', 'Eurosport 02'])).networks).toHaveLength(1);
  expect(analyzeNetworks(units(['Rai 1 HD', 'Rai 2 HD']), { similarity: 80 }).networks).toEqual([]); // stricter: apart
  expect(analyzeNetworks(units(['Eurosport 1', 'Eurosport 2 Plus Extra Large']), { maxDiff: 6 }).networks).toEqual([]); // too far beyond the common part
});

test('the same name more than once, and generic names, are not networks; the report says why, biggest first', () => {
  const report = {};
  const items = [...channels, ch(8, 'Aaa'), ch(9, 'Aaa'), ch(10, 'Bbb'), ch(11, 'Bbb'), ch(12, 'Bbb'), ch(13, 'Sport 1'), ch(14, 'Sport 2')];
  buildNetworks(buildEntries('live', items.map((i) => ({ ...i, tmdbId: null, ext: '', genre: '' }))), [], { report });
  expect(report.networks[0]).toMatchObject({ name: 'Rai', id: 'rai', units: 3 });
  expect(report.rejected.map((r) => [r.name, r.reason])).toEqual([['Bbb', 'duplicates'], ['Aaa', 'duplicates'], ['Sport', 'generic']]);
  expect(report.params).toEqual({ similarity: 50, maxDiff: 13 });
  const text = formatNetworkReport(report, (key) => key);
  expect(text).toContain('+ Rai [rai] 3/3');
  expect(text).toContain('- Bbb (3) diag.networks.duplicates');
});

test('the network preferences are whole numbers inside a range, a bad value brings back the default, and reach the sync config', async () => {
  const { SettingsService } = await import('../../src/services/settings.js');
  const settings = new SettingsService(await openAppDb('network-prefs'));
  expect(await settings.get()).toMatchObject({ liveNetworkSimilarity: 50, liveNetworkMaxDiff: 13 });
  expect(await settings.update({ liveNetworkSimilarity: '65', liveNetworkMaxDiff: 7.4 })).toMatchObject({ liveNetworkSimilarity: 65, liveNetworkMaxDiff: 7 });
  expect(await settings.update({ liveNetworkSimilarity: 500, liveNetworkMaxDiff: -3 })).toMatchObject({ liveNetworkSimilarity: 100, liveNetworkMaxDiff: 0 });
  expect(await settings.update({ liveNetworkSimilarity: 'abc', liveNetworkMaxDiff: '' })).toMatchObject({ liveNetworkSimilarity: 50, liveNetworkMaxDiff: 13 });
  await settings.update({ liveNetworkSimilarity: 70, liveNetworkMaxDiff: 5 });
  const svc = createLiveGroupingService({ db: await openAppDb('network-prefs-svc'), settings });
  expect((await svc.config('p')).networks).toMatchObject({ enabled: true, similarity: 70, maxDiff: 5 });
});
