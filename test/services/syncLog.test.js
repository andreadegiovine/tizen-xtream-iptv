import { openAppDb } from '../../src/db/appDb.js';
import { createSyncLog } from '../../src/services/syncLog.js';
import { collectDeviceInfo, formatBytes } from '../../src/services/deviceInfo.js';
import { firstBackdrop, parseVodInfo } from '../../src/services/details.js';
import { validity } from '../../src/ui/pages/providersPage.js';
import { describeMeta, deviceRows } from '../../src/ui/components/syncPanel.js';
import { loadSearchRows } from '../../src/services/searchIndex.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';

let n = 0;

describe('sync log', () => {
  test('records time, duration and count of a job, also when it fails', async () => {
    const db = await openAppDb(`synclog-${(n += 1)}`);
    let clock = 1000;
    const log = createSyncLog({ db, now: () => clock });
    await log.track('tmdb', async () => {
      clock += 2500;
      return 7;
    });
    expect((await log.get()).tmdb).toEqual({ lastSync: 3500, durationMs: 2500, count: 7, failed: false });
    await expect(log.track('trakt', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect((await log.get()).trakt.failed).toBe(true);
    await log.clear('tmdb');
    expect((await log.get()).tmdb).toBeUndefined();
  });

  test('table text: not configured, never run, ran', () => {
    expect(describeMeta(undefined, 'en-US', false)).toBeTruthy();
    expect(describeMeta(undefined, 'en-US', true)).not.toBe(describeMeta({ lastSync: 1, count: 3, durationMs: 1200 }, 'en-US', true));
  });
});

describe('search rows', () => {
  test('carry rating and tmdb id so result cards show the same badges as the grids', async () => {
    const db = await openProviderDb(`searchrows-${(n += 1)}`);
    await writeEntries(db, 'movie', buildEntries('movie', [{ key: 'movie:1', type: 'movie', id: 1, name: 'Heat', categoryId: '1', added: 5, tmdbId: 9, rating: 8.2, ext: 'mkv' }]));
    const [row] = await loadSearchRows(db, ['movie']);
    expect(row).toMatchObject({ rating: 8.2, tmdbId: 9, type: 'movie' });
  });
});

describe('device, expiry, backdrop', () => {
  test('device info: Tizen panel size, JS heap, storage quota; missing values stay null', async () => {
    const env = {
      screen: { width: 1920, height: 1080 },
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1.5,
      performance: { memory: { usedJSHeapSize: 50 * 1024 ** 2, jsHeapSizeLimit: 512 * 1024 ** 2 } },
      navigator: { deviceMemory: 2, storage: { estimate: async () => ({ usage: 10 * 1024 ** 2, quota: 4 * 1024 ** 3 }) } },
      tizen: { systeminfo: { getPropertyValue: (name, ok) => ok({ resolutionWidth: 3840, resolutionHeight: 2160 }) } },
    };
    const info = await collectDeviceInfo(env);
    expect(info.panel).toEqual({ width: 3840, height: 2160 });
    expect(info.page).toEqual({ width: 1280, height: 720 });
    expect(info.heap).toEqual({ used: 50 * 1024 ** 2, limit: 512 * 1024 ** 2 });
    expect(info.storage.quota).toBe(4 * 1024 ** 3);
    expect(info.ram).toBe(2 * 1024 ** 3);
    const bare = await collectDeviceInfo({});
    expect(bare).toMatchObject({ panel: null, heap: null, storage: null, ram: null });
    expect(deviceRows(bare)).toHaveLength(5);
    expect(formatBytes(1536 * 1024 ** 2)).toBe('1.5 GB');
    expect(formatBytes(300 * 1024 ** 2)).toBe('300 MB');
  });

  test('provider validity text', () => {
    expect(validity({}, 1)).toBeNull();
    const future = validity({ expiresAt: Date.UTC(2026, 9, 22, 12) }, Date.UTC(2026, 0, 1));
    expect(future.expired).toBe(false);
    expect(future.text).toMatch(/2026/);
    expect(validity({ expiresAt: 1000 }, 5000).expired).toBe(true);
  });

  test('backdrop is the first usable address of the provider list', () => {
    expect(firstBackdrop(['', 'http://x/a.jpg', 'http://x/b.jpg'])).toBe('http://x/a.jpg');
    expect(firstBackdrop('https://x/a.jpg')).toBe('https://x/a.jpg');
    expect(firstBackdrop(undefined)).toBe('');
    expect(parseVodInfo({ info: { backdrop_path: ['http://x/b.jpg'] } }).backdrop).toBe('http://x/b.jpg');
  });
});
