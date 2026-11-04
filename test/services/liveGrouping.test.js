import { manualIds, buildChannelGroups, buildLiveAllRows, annotateGroupKeys, parseTerms, resolveTerms, DEFAULT_TERMS, qualityRank, channelBase, compileTerms, LIVE_ALL } from '../../src/services/liveGrouping.js';
import { buildEntries } from '../../src/services/grouping.js';
import { openProviderDb, deleteProviderDb } from '../../src/db/providerDb.js';
import { syncType, rebuildEntries } from '../../src/services/catalogSync.js';
import { loadSearchRows, searchRows } from '../../src/services/searchIndex.js';
import { describeType } from '../../src/ui/components/syncPanel.js';
import { pageEntries, getEntry, countEntries, createMergeSearch } from '../../src/services/catalogQuery.js';

const ch = (id, name, extra = {}) => ({ id, name, categoryId: '81', added: 1000 + id, icon: 'logo.png', epgChannelId: null, ...extra });
const yoyo = [
  ch(25311, 'Rai Yoyo Full HD', { epgChannelId: 'RaiYoyo.it' }),
  ch(133, 'Rai Yoyo HD', { epgChannelId: 'RaiYoyo.it' }),
  ch(25310, 'Rai Yoyo SD', { epgChannelId: 'RaiYoyo.it' }),
  ch(461110, 'Rai YoYo Fhd', { epgChannelId: 'RaiYoyo.it', categoryId: '1047' }),
];

describe('terms', () => {
  test('parsed from text, defaults when empty', () => {
    expect(parseTerms('HD, Full  HD ; hd\n4K')).toEqual(['hd', 'full hd', '4k']);
    expect(resolveTerms('')).toEqual(Array.from(DEFAULT_TERMS));
    expect(resolveTerms('xx')).toEqual(['xx']);
  });
  test('channelBase strips quality words as whole words only', () => {
    const re = compileTerms(DEFAULT_TERMS);
    expect(channelBase('Rai Yoyo Full HD', re).base).toBe('rai yoyo');
    expect(channelBase('IT: Rai YoYo Fhd', re).base).toBe('rai yoyo');
    expect(channelBase('Shadow TV', re).base).toBe('shadow tv'); // "hd" inside a word stays
    expect(channelBase('Sky Sport +1 HD', re).base).toBe('sky sport plus1');
    expect(channelBase('Rai 1 HD', re).base).not.toBe(channelBase('Rai 1 +1 HD', re).base);
  });
  test('quality ranks', () => {
    expect([qualityRank('X 4K'), qualityRank('X Full HD'), qualityRank('X FHD'), qualityRank('X HD'), qualityRank('X'), qualityRank('X SD')]).toEqual([4, 3, 3, 2, 1.5, 1]);
  });
});

describe('buildChannelGroups', () => {
  test('the four Rai Yoyo versions become one group, best quality first, categories of all', () => {
    const [group, ...rest] = buildChannelGroups(yoyo);
    expect(rest).toHaveLength(0);
    expect(group).toMatchObject({ isGroup: true, name: 'Rai Yoyo', defaultId: 25311, epgChannelId: 'RaiYoyo.it', key: 'live:g:rai_yoyo' });
    expect(group.memberIds).toEqual([25311, 461110, 133, 25310]);
    expect(group.categoryIds.sort()).toEqual(['1047', '81']);
    expect(group.members[0]).toMatchObject({ id: 25311, categoryId: '81', name: 'Rai Yoyo Full HD', entryKey: 'live:i25311' });
  });

  test('same name without EPG needs the same category or logo', () => {
    const items = [ch(1, 'Canale A HD'), ch(2, 'Canale A SD'), ch(3, 'Canale B HD', { categoryId: '5', icon: 'b.png' }), ch(4, 'Canale B SD', { categoryId: '6', icon: 'c.png' })];
    const groups = buildChannelGroups(items);
    expect(groups.map((g) => g.name)).toEqual(['Canale A']);
  });

  test('different EPG ids never merge by name, and "+1" feeds stay apart', () => {
    const items = [ch(1, 'Sky Sport HD', { epgChannelId: 'a' }), ch(2, 'Sky Sport SD', { epgChannelId: 'b' }), ch(3, 'Sky Sport +1 HD'), ch(4, 'Sky Sport HD ')];
    const groups = buildChannelGroups(items);
    const ids = groups.map((g) => g.memberIds.sort());
    expect(ids.some((m) => m.includes(3))).toBe(false);
    expect(ids.some((m) => m.includes(1) && m.includes(2))).toBe(false);
  });

  test('links made by hand join anything, categories excluded are ignored', () => {
    const items = [ch(1, 'Alpha'), ch(2, 'Beta', { categoryId: '9', icon: '' }), ch(3, 'Gamma', { categoryId: 'x' })];
    const [group] = buildChannelGroups(items, { links: [[1, 2]], excludedCategories: new Set(['x']) });
    expect(group.memberIds.sort()).toEqual([1, 2]);
    expect(buildChannelGroups(items, { links: [[1, 3]], excludedCategories: new Set(['x']) })).toHaveLength(0);
  });

  test('show-all rows hold the groups and the channels in none', () => {
    const items = [...yoyo, ch(7, 'Other')];
    const entries = buildEntries('live', items.map((i) => ({ ...i, tmdbId: null, ext: '', genre: '' })));
    const groups = buildChannelGroups(items);
    annotateGroupKeys(entries, groups);
    expect(entries.find((e) => e.defaultId === 133).groupKey).toBe('live:g:rai_yoyo');
    expect(entries.find((e) => e.defaultId === 7).groupKey).toBeUndefined();
    expect(buildLiveAllRows(entries, groups).map((r) => r.entryKey).sort()).toEqual(['live:g:rai_yoyo', 'live:i7']);
  });
});

describe('live catalog with groups', () => {
  const rows = (list) => list.map((c) => ({ stream_id: c.id, name: c.name, category_id: c.categoryId, added: String(c.added), stream_icon: c.icon, epg_channel_id: c.epgChannelId }));
  const client = { getCategories: async () => [{ category_id: '81', category_name: 'Kids' }, { category_id: '1047', category_name: 'Fhd' }, { category_id: '2', category_name: 'News' }], getStreams: async () => rows([...yoyo, ch(7, 'Other', { categoryId: '2', icon: '' })]) };

  test('show all lists the group once, categories keep every channel, groups open by key', async () => {
    const db = await openProviderDb('live-groups-1');
    const meta = await syncType({ db, client, type: 'live' });
    expect(meta).toMatchObject({ layout: 2, groupCount: 1, entryCount: 5 });
    const all = await pageEntries(db, { type: 'live', categoryId: LIVE_ALL, offset: 0, limit: 20 });
    expect(all.entries.map((e) => e.key).sort()).toEqual(['live:g:rai_yoyo', 'live:i7']);
    expect(await countEntries(db, { type: 'live', categoryId: LIVE_ALL })).toBe(2);
    const kids = await pageEntries(db, { type: 'live', categoryId: '81', offset: 0, limit: 20 });
    expect(kids.entries.map((e) => e.defaultId).sort((a, b) => a - b)).toEqual([133, 25310, 25311]);
    expect((await getEntry(db, 'live:g:rai_yoyo')).members).toHaveLength(4);
    const search = createMergeSearch(db, 7);
    expect((await search('yoyo')).map((r) => [r.key, r.group])).toEqual([['live:g:rai_yoyo', true]]);
    // grouping off: the same view lists every channel
    await rebuildEntries({ db, type: 'live', grouping: { enabled: false, terms: DEFAULT_TERMS, links: [] } });
    expect(await countEntries(db, { type: 'live', categoryId: LIVE_ALL })).toBe(5);
    expect(await getEntry(db, 'live:g:rai_yoyo')).toBeUndefined();
    db.close();
    await deleteProviderDb('live-groups-1');
  });
});

describe('manual links and EPG ids', () => {
  test('a channel linked by hand to a version joins the whole group, whatever its EPG id', () => {
    const items = [...yoyo, ch(9000, 'Aurora News 24', { epgChannelId: 'c11', categoryId: '2', icon: '' })];
    const groups = buildChannelGroups(items, { links: [[9000, 25311]] });
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds.sort((a, b) => a - b)).toEqual([133, 9000, 25310, 25311, 461110]);
    expect(groups[0].defaultId).toBe(25311);
  });
});

describe('removing a channel from a group', () => {
  test('a channel taken out by hand is not joined again by the rules', () => {
    expect(buildChannelGroups(yoyo, { splits: [133] })[0].memberIds).not.toContain(133);
    expect(buildChannelGroups(yoyo, { splits: [133] })[0].memberIds).toHaveLength(3);
  });
  test('manual streams: the moved channel, and the target only when it was a lone channel', () => {
    expect([...manualIds([[1, 2], [3, 4, 1]])].sort()).toEqual([1, 3, 4]);
  });
  test('group counts are stored in the live meta', async () => {
    const db = await openProviderDb('live-groups-2');
    const rows = [...yoyo, ch(7, 'Other', { categoryId: '2', icon: '' }), ch(8, 'Hidden', { categoryId: '99' })].map((c) => ({ stream_id: c.id, name: c.name, category_id: c.categoryId, added: String(c.added), stream_icon: c.icon, epg_channel_id: c.epgChannelId }));
    const client = { getCategories: async () => [], getStreams: async () => rows };
    const meta = await syncType({ db, client, type: 'live', excludedCategories: new Set(['99']) });
    expect(meta).toMatchObject({ itemCount: 5, groupCount: 1, groupedCount: 4, singleCount: 1 });
    db.close();
    await deleteProviderDb('live-groups-2');
  });
});

describe('search and catalog line', () => {
  test('search finds the groups and the channels in none, not the channels inside a group', async () => {
    const db = await openProviderDb('live-groups-3');
    const rows = [...yoyo, ch(7, 'Yoyo Extra', { categoryId: '2', icon: '', epgChannelId: 'x' })].map((c) => ({ stream_id: c.id, name: c.name, category_id: c.categoryId, added: String(c.added), stream_icon: c.icon, epg_channel_id: c.epgChannelId }));
    await syncType({ db, client: { getCategories: async () => [], getStreams: async () => rows }, type: 'live' });
    const found = searchRows(await loadSearchRows(db, ['live']), 'yoyo').map((r) => [r.key, Boolean(r.isGroup)]);
    expect(found.sort()).toEqual([['live:g:rai_yoyo', true], ['live:i7', false]]);
    db.close();
    await deleteProviderDb('live-groups-3');
  });

  test('the live line: items, groups (channels in them) and the time', () => {
    const text = describeType({ phase: 'idle' }, { itemCount: 5321, entryCount: 3000, groupCount: 683, groupedCount: 2219, lastSync: 0, layout: 2 }, 'en-US');
    expect(text).toMatch(/^5,?321 items · 683 groups \(2,?219 channels\) · updated /);
  });
});
