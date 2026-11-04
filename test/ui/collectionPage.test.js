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
