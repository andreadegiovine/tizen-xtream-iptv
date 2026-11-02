import { openAppDb } from '../../src/db/appDb.js';
import { ProviderStore } from '../../src/services/providerStore.js';
import { SettingsService, DEFAULT_SETTINGS } from '../../src/services/settings.js';

const data = { name: 'Main', baseUrl: 'http://h', username: 'u', password: 'p' };

describe('ProviderStore', () => {
  test('add, list, activate, remove', async () => {
    const db = await openAppDb('store-test');
    const removed = [];
    const store = new ProviderStore(db, { removeProviderDb: async (id) => removed.push(id) });

    const a = await store.add(data);
    const b = await store.add({ ...data, name: 'Second' });
    expect((await store.list()).map((p) => p.name)).toEqual(['Main', 'Second']);

    await store.setActiveId(a.id);
    expect((await store.getActive()).name).toBe('Main');

    await store.remove(a.id);
    expect(removed).toEqual([a.id]);
    expect(await store.getActiveId()).toBe(b.id);

    await store.remove(b.id);
    expect(await store.getActive()).toBeNull();
    db.close();
  });

  test('rejects incomplete providers', async () => {
    const db = await openAppDb('store-test-2');
    await expect(new ProviderStore(db).add({ name: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    db.close();
  });
});

describe('SettingsService', () => {
  test('defaults, validation and per-provider exclusions', async () => {
    const db = await openAppDb('settings-test');
    const settings = new SettingsService(db);
    expect(await settings.get()).toEqual(DEFAULT_SETTINGS);

    await settings.update({ bufferSeconds: 20, gridItems: 13, language: 'xx' });
    expect(await settings.get()).toMatchObject({ bufferSeconds: 20, gridItems: 24, language: 'auto' });

    await settings.setExcluded('p1', 'movie', [3, '4', 3]);
    const excluded = await settings.getExcluded('p1', 'movie');
    expect(Array.from(excluded).sort()).toEqual(['3', '4']);
    expect((await settings.getExcluded('p2', 'movie')).size).toBe(0);
    db.close();
  });
});
