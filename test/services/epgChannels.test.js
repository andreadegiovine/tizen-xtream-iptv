import { createChannelSummary, genreKey, summaryValid, channelsBetween, spansOverlap } from '../../src/services/epgChannels.js';
import { createXmltvParser } from '../../src/services/xmltv.js';
import { buildGuideIndex } from '../../src/services/guideIndex.js';
import { describeEpg } from '../../src/ui/components/syncPanel.js';

const H = 3600 * 1000;

test('XMLTV programmes carry their categories (several, decoded, empty ones left out)', () => {
  const out = [];
  const parser = createXmltvParser({ now: 0, horizonMs: Number.MAX_SAFE_INTEGER, onProgramme: (p) => out.push(p) });
  parser.push('<tv><programme start="20260101000000 +0000" stop="20260101010000 +0000" channel="a"><title>Derby</title><category lang="it">Sport</category><category><![CDATA[Calcio &amp; co]]></category><category> </category></programme>');
  parser.push('<programme start="20260101010000 +0000" stop="20260101020000 +0000" channel="a"><title>Tg</title></programme></tv>');
  expect(out[0].categories).toEqual(['Sport', 'Calcio & co']);
  expect(out[1].categories).toBeUndefined();
});

test('channel summary: span, every category of its programmes (most frequent first), names folded', () => {
  const s = createChannelSummary();
  const add = (channelId, start, categories) => s.add({ channelId, start: start * H, stop: (start + 1) * H, categories });
  add('a', 1, ['Sport']);
  add('a', 2, ['sport ', 'Calcio']);
  add('a', 3, ['SPORT']);
  add('a', 4, ['Calcio']);
  add('a', 5, ['News']); // one programme is enough: the category belongs to the programme
  add('a', 6, []);
  add('b', 0, ['Notìzie']);
  add('c', 10);
  const r = s.result();
  expect(r.channels.a).toMatchObject({ from: 1 * H, to: 7 * H, genres: ['sport', 'calcio', 'news'] });
  expect(r.channels.a.genreSpans.news).toEqual([5 * H, 6 * H]); // when the programmes of each category are on
  expect(spansOverlap(r.channels.a.genreSpans.news, 5.5 * H, 9 * H)).toBe(true);
  expect(spansOverlap(r.channels.a.genreSpans.news, 6 * H, 9 * H)).toBe(false);
  expect(r.channels.b.genres).toEqual(['notizie']);
  expect(r.channels.c).toEqual({ from: 10 * H, to: 11 * H });
  expect(r.genres).toEqual({ sport: 'Sport', calcio: 'Calcio', news: 'News', notizie: 'Notìzie' });
  expect(r.until).toBe(11 * H);
  expect(genreKey(' Notìzie  ')).toBe('notizie');
  expect(summaryValid(r, 10 * H)).toBe(true);
  expect(summaryValid(r, 11 * H)).toBe(false);
  expect(Array.from(channelsBetween(r, 6.5 * H, 9 * H))).toEqual(['a']);
});

test('guide index: groups and ungrouped channels with a guide id, by name; networks and grouped channels left out', () => {
  const entries = [
    { key: 'live:1', name: 'Zeta', epgChannelId: 'z' },
    { key: 'live:2', name: 'Rai 1 HD', epgChannelId: 'r1', groupKey: 'live:g1' },
    { key: 'live:3', name: 'No guide' },
    { key: 'live:4', name: 'alfa', epgChannelId: 'a' },
  ];
  const groups = [{ key: 'live:g1', name: 'Rai 1', epgChannelId: 'r1' }, { key: 'live:n1', name: 'Rai', isNetwork: true, epgChannelId: 'x' }];
  expect(buildGuideIndex(entries, groups)).toEqual([['live:4', 'a'], ['live:g1', 'r1'], ['live:1', 'z']]);
});

test('settings row of the guide', () => {
  expect(describeEpg(null, null, 'en-US')).toBe('Never run');
  const text = describeEpg({ programmes: 18250, guided: 412, genres: 14, until: Date.UTC(2026, 10, 9, 10), lastSync: Date.UTC(2026, 10, 7, 10) }, null, 'en-US');
  expect(text).toMatch(/^18,250 programmes · 412 channels · 14 genres · valid until .+ · updated .+$/);
  expect(describeEpg({ programmes: 3, lastSync: 0 }, { queued: true }, 'en-US')).toBe('Queued');
});
