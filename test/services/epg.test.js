import { parseXmltvTime, decodeEntities, createXmltvParser } from '../../src/services/xmltv.js';
import { syncEpg, shouldSyncEpg, EPG_TTL_MS } from '../../src/services/epgSync.js';
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
