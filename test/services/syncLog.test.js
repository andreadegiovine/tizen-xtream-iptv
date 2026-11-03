import { openAppDb } from '../../src/db/appDb.js';
import { createSyncLog } from '../../src/services/syncLog.js';
import { describeMeta } from '../../src/ui/components/syncPanel.js';
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
