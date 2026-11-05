import { openAppDb } from '../../src/db/appDb.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createCollectionsService } from '../../src/services/collections.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { createCollectionPage } from '../../src/ui/pages/collectionPage.js';
import { createCollectionsPage } from '../../src/ui/pages/collectionsPage.js';
import { Action } from '../../src/core/input.js';
import { createPinsService } from '../../src/services/pins.js';

Element.prototype.scrollIntoView = () => undefined;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

let n = 0;
async function setup() {
  const db = await openAppDb(`collection-page-test-${(n += 1)}`);
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db }) },
    collections: createCollectionsService({ db }),
    favorites: createFavoritesService({ db }),
    pins: createPinsService({ db }),
    notices: { success: jest.fn(), error: jest.fn() },
    dialogs: {},
    router: { push: jest.fn(), back: jest.fn() },
  };
  return ctx;
}

test('collection page: title, count and the three buttons', async () => {
  const ctx = await setup();
  const collection = await ctx.collections.create('p', 'Marvel', ['movie:i1']);
  const page = createCollectionPage(ctx, { id: collection.id });
  page.mount();
  await tick();
  expect(page.el.querySelector('.detail-title').textContent).toBe('Marvel');
  expect(page.el.querySelectorAll('.detail-actions .icon-btn')).toHaveLength(3);
  expect(ctx.focus.activeId).toBe('collectionActions');
  page.destroy();
});

test('collections page: one card per collection and a click opens it', async () => {
  const ctx = await setup();
  const a = await ctx.collections.create('p', 'A', []);
  const page = createCollectionsPage(ctx, {});
  page.mount();
  await tick();
  expect(page.el.querySelectorAll('.browse-grid .card')).toHaveLength(1);
  expect(page.el.querySelector('.card-title').textContent).toBe('A');
  expect(ctx.focus.activeId).toBe('collectionsGrid');
  ctx.focus.handle(Action.ENTER);
  expect(ctx.router.push).toHaveBeenCalledWith('collection', { id: a.id, section: 'collections' });
  page.destroy();
});

test('search shows the collections whose name matches, and Favorites lists the favourite ones, first', async () => {
  const { createSearchPage } = await import('../../src/ui/pages/searchPage.js');
  const { createFavoritesPage } = await import('../../src/ui/pages/favoritesPage.js');
  const ctx = await setup();
  const a = await ctx.collections.create('p', 'Marvel', []);
  await ctx.collections.create('p', 'Other', []);
  await ctx.favorites.toggle('p', `collection:${a.id}`, 'collection');
  ctx.search = { search: async () => [{ key: 'movie:i1', type: 'movie', name: 'Marvelous', icon: '' }] };
  ctx.syncSearchLinks = () => undefined;
  const search = createSearchPage(ctx, { query: 'marv' });
  search.mount();
  await tick();
  const titles = Array.from(search.el.querySelectorAll('.carousel-title')).map((n) => n.textContent);
  expect(titles[0]).toBe('Collections');
  expect(search.el.querySelector('.carousel .card-title').textContent).toBe('Marvel');
  search.destroy();
  const favorites = createFavoritesPage(ctx);
  favorites.mount();
  await tick();
  expect(favorites.el.querySelector('.carousel-title').textContent).toBe('Collections');
  expect(favorites.el.querySelectorAll('.card')).toHaveLength(1);
  favorites.destroy();
});

test('collection page: rectangular poster, rotating images with their own random pick', async () => {
  jest.useFakeTimers();
  try {
    const { createImageRotator, pickRandom } = await import('../../src/ui/components/imageRotator.js');
    expect(pickRandom(['a', 'b'], 'a', () => 0)).toBe('b');
    expect(pickRandom(['a'], 'a', () => 0.9)).toBe('a');
    expect(pickRandom([], '')).toBe('');
    const host = document.createElement('div');
    const picks = [0.9, 0];
    const rotator = createImageRotator({ host, intervalMs: 1000, random: () => picks.shift(), preload: (url, done) => done(true) });
    rotator.setUrls(['a', 'b', 'c']);
    rotator.start();
    jest.advanceTimersByTime(1);
    expect(rotator.current).toBe('c');
    expect(host.querySelectorAll('.rot-layer.visible')).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(rotator.current).toBe('a');
    expect(host.querySelectorAll('.rot-layer.visible')).toHaveLength(1); // the other one faded out
    rotator.stop();
  } finally {
    jest.useRealTimers();
  }
  const ctx = await setup();
  const collection = await ctx.collections.create('p', 'Marvel', []);
  const page = createCollectionPage(ctx, { id: collection.id });
  page.mount();
  await tick();
  expect(page.el.querySelector('.detail-poster').classList.contains('square')).toBe(false);
  page.destroy();
});

test('device info: network row', async () => {
  const { collectDeviceInfo } = await import('../../src/services/deviceInfo.js');
  const { deviceRows } = await import('../../src/ui/components/syncPanel.js');
  const info = await collectDeviceInfo({ navigator: { onLine: true, connection: { type: 'wifi', effectiveType: '4g', downlink: 10, rtt: 50 } } });
  expect(deviceRows(info)[0].value).toBe('Online · Wi-Fi · 4g · 10 Mbps · 50 ms');
  const off = await collectDeviceInfo({ navigator: { onLine: false } });
  expect(deviceRows(off)[0].value).toBe('Offline');
});
