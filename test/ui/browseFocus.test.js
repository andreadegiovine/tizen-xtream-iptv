import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createBrowsePage } from '../../src/ui/pages/browsePage.js';
import { createPinsService } from '../../src/services/pins.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { createNavCounts } from '../../src/services/navCounts.js';

Element.prototype.scrollIntoView = () => undefined;
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const film = (id, cat) => ({ stream_id: id, name: `Film ${id}`, category_id: cat, added: String(1000 + id), stream_icon: '', container_extension: 'mkv' });

async function setup(name) {
  const db = await openProviderDb(name);
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'Action' }, { category_id: '2', category_name: 'Drama' }], getStreams: async () => [film(1, '1'), film(2, '1'), film(3, '2')] }, type: 'movie' });
  const appDb = await openAppDb(`${name}-app`);
  const navCounts = createNavCounts({ db: appDb, saveDelayMs: 0 });
  await navCounts.load();
  const refreshTopbar = jest.fn(async () => undefined);
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db }) },
    settings: { get: async () => ({}), getExcluded: async () => new Set() },
    pins: createPinsService({ db: appDb }),
    favorites: createFavoritesService({ db: appDb }),
    navCounts,
    refreshTopbar,
    suggestions: { build: () => new Promise(() => undefined), enabled: false },
    notices: { success: jest.fn() },
    openEntry: jest.fn(),
  };
  return { ctx, refreshTopbar };
}


const active = (ctx) => `${ctx.focus.activeId}:${ctx.focus.active ? ctx.focus.active.index : ''}`;
const catName = (page, ctx) => page.el.querySelectorAll('.browse-cat')[ctx.focus.active.index].querySelector('.browse-cat-name').textContent;

test('opened from the top bar: the focus goes to the sidebar entry of the page, not to the grid', async () => {
  const { ctx } = await setup('browse-focus-bar');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  expect(ctx.focus.activeId).toBe('browseCategories');
  expect(catName(page, ctx)).toBe('Show all');
  page.destroy();
});

test('opened from elsewhere (a link to a category): the grid, as before', async () => {
  const { ctx } = await setup('browse-focus-link');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', filter: { kind: 'category', id: '1' } });
  page.mount();
  await tick(150);
  expect(ctx.focus.activeId).toBe('browseGrid');
  page.destroy();
});

test('Back from the grid goes to the sidebar first; from the sidebar of the main entry the page is left', async () => {
  const { ctx } = await setup('browse-focus-back');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies' });
  page.mount();
  await tick(150);
  ctx.focus.focus('browseGrid', 2);
  expect(page.onBack()).toBe(true);
  expect(ctx.focus.activeId).toBe('browseCategories');
  expect(catName(page, ctx)).toBe('Show all');
  expect(page.onBack()).toBe(false); // the main entry: the app goes back (Home)
  page.destroy();
});

test('back from a title: the focus returns to its card in the grid', async () => {
  const { ctx } = await setup('browse-focus-return');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  ctx.focus.focus('browseGrid', 2);
  const state = page.saveState();
  page.destroy();
  const again = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  again.restoreState(state);
  again.mount();
  await tick(150);
  expect(active(ctx)).toBe('browseGrid:2');
  again.destroy();
});

test('the sidebar moves only Up / Down (OK opens its grid), the grid only among its cards', async () => {
  const { Action } = await import('../../src/core/input.js');
  const { ctx } = await setup('browse-focus-moves');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', fromBar: true });
  page.mount();
  await tick(150);
  ctx.focus.handle(Action.RIGHT);
  expect(ctx.focus.activeId).toBe('browseCategories'); // no way right into the grid
  ctx.focus.handle(Action.UP);
  expect(ctx.focus.activeId).toBe('browseCategories'); // nor up to the top bar
  ctx.focus.handle(Action.ENTER); // OK on the entry on screen: into its grid
  await tick(60);
  expect(ctx.focus.activeId).toBe('browseGrid');
  ctx.focus.handle(Action.LEFT);
  expect(ctx.focus.activeId).toBe('browseGrid'); // the first card: no way left to the sidebar
  ctx.focus.handle(Action.UP);
  expect(ctx.focus.activeId).toBe('browseGrid'); // "Show all" has no buttons in its head: nowhere up (not the top bar)
  expect(page.onBack()).toBe(true);
  expect(ctx.focus.activeId).toBe('browseCategories');
  page.destroy();
});
