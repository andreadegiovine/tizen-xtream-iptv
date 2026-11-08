import { parseXmltvTime, decodeEntities, createXmltvParser, isPlaceholderTitle } from '../../src/services/xmltv.js';
import { isEpgUrl } from '../../src/services/settings.js';
import { syncEpg, shouldSyncEpg, EPG_TTL_MS, probeGuide, runEpgForProvider } from '../../src/services/epgSync.js';
import { createEpgService } from '../../src/services/epgService.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany, dbGetAll } from '../../src/core/idb.js';

describe('xmltv', () => {
  test('time with and without offset', () => {
    expect(parseXmltvTime('20261102203000 +0100')).toBe(Date.UTC(2026, 10, 2, 19, 30, 0));
    expect(parseXmltvTime('20261102203000 -0530')).toBe(Date.UTC(2026, 10, 3, 2, 0, 0));
    expect(parseXmltvTime('20261102203000')).toBe(Date.UTC(2026, 10, 2, 20, 30, 0));
    expect(parseXmltvTime('garbage')).toBeNaN();
  });
  test('entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &#233; &#x41; &unknown;')).toBe('Tom & Jerry é A &unknown;');
  });

  const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
  const prog = (ch, startH, stopH, title) => `<programme start="2026110${2 + Math.floor(startH / 24)}${String(startH % 24).padStart(2, '0')}0000 +0000" stop="2026110${2 + Math.floor(stopH / 24)}${String(stopH % 24).padStart(2, '0')}0000 +0000" channel="${ch}"><title lang="it">${title}</title><desc>D &amp; E</desc></programme>`;

  test('keeps only the window and wanted channels, across arbitrary chunk boundaries', () => {
    const xml = `<?xml version="1.0"?><tv><channel id="a"/>${prog('a', 10, 11, 'Past')}${prog('a', 11, 13, 'Now')}${prog('a', 13, 14, 'Next')}${prog('b', 11, 13, 'Other')}${prog('a', 24 * 3, 24 * 3 + 1, 'TooFar')}</tv>`;
    for (const size of [7, 50, 10000]) {
      const got = [];
      const parser = createXmltvParser({ now: NOW, channels: new Set(['a']), onProgramme: (p) => got.push(p) });
      for (let i = 0; i < xml.length; i += size) parser.push(xml.slice(i, i + size));
      expect(got.map((p) => p.title)).toEqual(['Now', 'Next']);
      expect(got[0]).toMatchObject({ channelId: 'a', desc: 'D & E' });
    }
  });

  test('programmes that only say the guide has nothing are dropped', () => {
    ['EPG non disponibile', '(EPG non disponibile)', 'No EPG', 'No EPG available', 'EPG not available', 'N/A', 'Nessuna informazione', 'Informazioni non disponibili', '', '  '].forEach((title) => expect([title, isPlaceholderTitle(title)]).toEqual([title, true]));
    ['TG1', 'Programma 3', 'Info', 'Data', 'Non disponibile per sempre'].forEach((title) => expect([title, isPlaceholderTitle(title)]).toEqual([title, false]));
    const got = [];
    const parser = createXmltvParser({ now: NOW, onProgramme: (p) => got.push(p) });
    parser.push(`<tv>${prog('a', 11, 13, 'EPG non disponibile')}${prog('a', 13, 14, 'Next')}</tv>`);
    expect(got.map((p) => p.title)).toEqual(['Next']);
  });
});

let n = 0;
const makeDb = async () => {
  const db = await openProviderDb(`epg-test-${(n += 1)}`);
  await dbPutMany(db, 'entries', [{ key: 'live:i1', type: 'live', added: 1, epgChannelId: 'a' }, { key: 'live:i2', type: 'live', added: 2, epgChannelId: null }]);
  return db;
};
const guideFetch = (xml) => async () => ({ ok: true, text: async () => xml });

describe('syncEpg', () => {
  const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
  const xml = `<tv><programme start="20261102110000 +0000" stop="20261102130000 +0000" channel="a"><title>Now</title></programme><programme start="20261102130000 +0000" stop="20261102140000 +0000" channel="a"><title>Next</title></programme><programme start="20261102130000 +0000" stop="20261102140000 +0000" channel="zzz"><title>Unused</title></programme></tv>`;

  test('stores wanted programmes, drops stale rows and records meta', async () => {
    const db = await makeDb();
    await dbPutMany(db, 'epg', [{ channelId: 'a', start: NOW - 7200000, stop: NOW - 3600000, title: 'Old' }]);
    const meta = await syncEpg({ db, url: 'x', now: NOW, fetchImpl: guideFetch(xml) });
    expect(meta).toMatchObject({ programmes: 2, channels: 1 });
    expect((await dbGetAll(db, 'epg')).map((r) => r.title).sort()).toEqual(['Next', 'Now']);
  });

  test('the download stores the channel summary: the service reads channels and genres from it, and clear() deletes everything', async () => {
    const db = await makeDb();
    const tagged = `<tv><programme start="20261102110000 +0000" stop="20261102130000 +0000" channel="a"><title>Derby</title><category>Sport</category></programme><programme start="20261102130000 +0000" stop="20261102140000 +0000" channel="a"><title>Gol</title><category>sport</category></programme></tv>`;
    const meta = await syncEpg({ db, url: 'x', now: NOW, fetchImpl: guideFetch(tagged) });
    expect(meta).toMatchObject({ programmes: 2, guided: 1, genres: 1, until: NOW + 2 * 3600000 });
    const svc = createEpgService({ active: { get: async () => ({ db }) }, providers: {}, createWorker: () => { throw new Error('none'); }, now: () => NOW });
    expect(Array.from(await svc.channelsWithGuide(NOW, NOW + 3600000))).toEqual(['a']);
    expect(Array.from(await svc.channelsWithGuide(NOW + 3 * 3600000, NOW + 4 * 3600000))).toEqual([]);
    const { genres, byChannel } = await svc.genres();
    expect(genres).toEqual([{ key: 'sport', name: 'Sport' }]);
    expect(byChannel.get('a')).toEqual(['sport']);
    expect((await svc.status()).programmes).toBe(2);
    await svc.clear();
    expect(await dbGetAll(db, 'epg')).toEqual([]);
    expect(await svc.status()).toBeUndefined();
    expect((await svc.genres()).genres).toEqual([]);
  });

  test('an empty/invalid guide fails and keeps what was stored', async () => {
    const db = await makeDb();
    await dbPutMany(db, 'epg', [{ channelId: 'a', start: NOW, stop: NOW + 1000, title: 'Keep' }]);
    await expect(syncEpg({ db, url: 'x', now: NOW, fetchImpl: guideFetch('<html>busy</html>') })).rejects.toBeTruthy();
    expect(await dbGetAll(db, 'epg')).toHaveLength(1);
  });

  test('no live channels → skipped; daily ttl', async () => {
    const db = await openProviderDb('epg-test-empty');
    expect((await syncEpg({ db, url: 'x', now: NOW, fetchImpl: guideFetch(xml) })).skipped).toBe(true);
    expect(shouldSyncEpg(null)).toBe(true);
    expect(shouldSyncEpg({ lastSync: NOW }, NOW + EPG_TTL_MS - 1)).toBe(false);
    expect(shouldSyncEpg({ lastSync: NOW }, NOW + EPG_TTL_MS)).toBe(true);
  });
});

describe('epgService', () => {
  const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
  test('now / next / upcoming', async () => {
    const db = await makeDb();
    await dbPutMany(db, 'epg', [
      { channelId: 'a', start: NOW - 3600000, stop: NOW + 3600000, title: 'Now' },
      { channelId: 'a', start: NOW + 3600000, stop: NOW + 7200000, title: 'Next' },
      { channelId: 'a', start: NOW + 25 * 3600000, stop: NOW + 26 * 3600000, title: 'Tomorrow+' },
      { channelId: 'a', start: NOW - 9000000, stop: NOW - 3600000, title: 'Past' },
    ]);
    const svc = createEpgService({ active: { get: async () => ({ db }) }, providers: {}, createWorker: () => { throw new Error('none'); }, now: () => NOW });
    const nn = await svc.nowNext('a');
    expect([nn.now.title, nn.next.title]).toEqual(['Now', 'Next']);
    expect((await svc.upcoming('a', 24)).map((p) => p.title)).toEqual(['Now', 'Next']);
    expect(await svc.nowNext(null)).toEqual({ now: null, next: null });
  });

  test('placeholder programmes stored by an older version are not a guide: the channel is left out, its list is empty', async () => {
    const db = await makeDb();
    await dbPutMany(db, 'epg', [
      { channelId: 'a', start: NOW - 3600000, stop: NOW + 3600000, title: 'Now' },
      { channelId: 'p', start: NOW - 3600000, stop: NOW + 3600000, title: 'EPG non disponibile' },
      { channelId: 'p', start: NOW + 3600000, stop: NOW + 7200000, title: 'EPG non disponibile' },
      { channelId: 'q', start: NOW - 3600000, stop: NOW + 3600000, title: 'No EPG' },
      { channelId: 'q', start: NOW + 3600000, stop: NOW + 7200000, title: 'Late show' },
    ]);
    const svc = createEpgService({ active: { get: async () => ({ db }) }, providers: {}, createWorker: () => { throw new Error('none'); }, now: () => NOW });
    expect(Array.from(await svc.channelsWithGuide(NOW - 3600000, NOW + 24 * 3600000)).sort()).toEqual(['a', 'q']);
    const between = await svc.programmesBetween(['p', 'q'], NOW - 3600000, NOW + 24 * 3600000);
    expect(between.get('p')).toEqual([]);
    expect(between.get('q').map((p) => p.title)).toEqual(['Late show']);
    expect(await svc.upcoming('p')).toEqual([]);
  });

  test('falls back to the main thread when the worker cannot be created', async () => {
    const db = await makeDb();
    const runLocal = jest.fn(async ({ emit }) => { const o = { event: 'done', meta: { programmes: 1 }, error: null }; emit(o); return o; });
    const provider = { id: 'epg-test-fallback', baseUrl: 'http://x', username: 'u', password: 'p' };
    const svc = createEpgService({ active: { get: async () => ({ db }) }, providers: { getActive: async () => provider }, createWorker: () => { throw new Error('blocked'); }, runLocal });
    const outcome = await svc.maybeSync({ force: true });
    expect(runLocal).toHaveBeenCalledTimes(1);
    expect(outcome.meta.programmes).toBe(1);
  });
});

describe('custom guide', () => {
  const xml = '<tv><programme start="20261102110000 +0000" stop="20261102130000 +0000" channel="a"><title>Custom</title></programme></tv>';
  test('address check', () => {
    expect(isEpgUrl('https://epg.example.com/guide.xml')).toBe(true);
    expect(isEpgUrl('http://10.0.0.5:8080/x?y=1')).toBe(true);
    for (const bad of ['', 'epg.example.com', 'ftp://a/b', 'http://', 'javascript:alert(1)', 'https://a b/c']) expect(isEpgUrl(bad)).toBe(false);
  });
  test('probe: XMLTV yes, a web page or an error no', async () => {
    expect(await probeGuide('https://x/g.xml', { fetchImpl: async () => ({ ok: true, text: async () => `<?xml version="1.0"?><tv>${xml}` }) })).toBe(true);
    expect(await probeGuide('https://x/g', { fetchImpl: async () => ({ ok: true, text: async () => '<html></html>' }) })).toBe(false);
    expect(await probeGuide('https://x/g', { fetchImpl: async () => ({ ok: false }) })).toBe(false);
    expect(await probeGuide('https://x/g', { fetchImpl: async () => { throw new Error('down'); } })).toBe(false);
  });
  test('the custom guide replaces the provider one; when it fails the provider one is used', async () => {
    const provider = { id: 'p', baseUrl: 'http://prov', username: 'u', password: 'p' };
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (url.includes('custom-ok')) return { ok: true, text: async () => xml };
      if (url.includes('xmltv.php')) return { ok: true, text: async () => xml.replace('Custom', 'Provider') };
      return { ok: false, status: 404, text: async () => '' };
    };
    const db1 = await makeDb();
    db1.close = () => undefined;
    const ok = await runEpgForProvider({ provider, customUrl: 'http://custom-ok/g.xml', force: true, openDb: async () => db1, fetchImpl, now: Date.UTC(2026, 10, 2, 12) });
    expect(ok.error).toBeNull();
    expect((await dbGetAll(db1, 'epg')).map((r) => r.title)).toEqual(['Custom']);
    expect(urls.some((u) => u.includes('xmltv.php'))).toBe(false);
    const db2 = await makeDb();
    db2.close = () => undefined;
    const back = await runEpgForProvider({ provider, customUrl: 'http://custom-bad/g.xml', force: true, openDb: async () => db2, fetchImpl, now: Date.UTC(2026, 10, 2, 12) });
    expect(back.error).toBeNull();
    expect((await dbGetAll(db2, 'epg')).map((r) => r.title)).toEqual(['Provider']);
  });
});

describe('programme search', () => {
  const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
  const H = 3600000;
  test('titles of the next 24 hours, best match first, on air first, one per channel and title, with the Live TV row', async () => {
    const db = await openProviderDb('epg-search-test');
    await dbPutMany(db, 'entries', [
      { key: 'live:i1', type: 'live', added: 1, name: 'Uno', epgChannelId: 'a' },
      { key: 'live:i2', type: 'live', added: 2, name: 'Due', epgChannelId: 'b' },
    ]);
    await dbPutMany(db, 'epg', [
      { channelId: 'a', start: NOW + H, stop: NOW + 2 * H, title: 'Il Commissario Montalbano' },
      { channelId: 'a', start: NOW + 5 * H, stop: NOW + 6 * H, title: 'Il Commissario Montalbano' }, // a later airing: left out
      { channelId: 'b', start: NOW - H, stop: NOW + H, title: 'Montalbano' }, // whole title, on air
      { channelId: 'b', start: NOW - 3 * H, stop: NOW - 2 * H, title: 'Montalbano' }, // ended
      { channelId: 'b', start: NOW + 30 * H, stop: NOW + 31 * H, title: 'Montalbano speciale' }, // after 24 h
      { channelId: 'z', start: NOW, stop: NOW + H, title: 'Montalbano' }, // no Live TV row
      { channelId: 'a', start: NOW + 3 * H, stop: NOW + 4 * H, title: 'EPG non disponibile' },
    ]);
    const svc = createEpgService({ active: { get: async () => ({ db }) }, providers: {}, createWorker: () => { throw new Error('none'); }, now: () => NOW });
    const found = await svc.searchProgrammes('montàlbano');
    expect(found.map((p) => [p.title, p.rowKey, p.start])).toEqual([
      ['Montalbano', 'live:i2', NOW - H],
      ['Il Commissario Montalbano', 'live:i1', NOW + H],
    ]);
    expect(await svc.searchProgrammes('m')).toEqual([]);
    expect(await svc.searchProgrammes('disponibile')).toEqual([]);
  });
});
