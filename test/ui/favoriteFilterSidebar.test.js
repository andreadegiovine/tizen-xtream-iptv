import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createBrowsePage } from '../../src/ui/pages/browsePage.js';
import { createPinsService } from '../../src/services/pins.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { createNavCounts } from '../../src/services/navCounts.js';
import { Action } from '../../src/core/input.js';

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

const sidebar = (page) => Array.from(page.el.querySelectorAll('.browse-cat')).map((n) => `${n.querySelector('.browse-cat-name').textContent}:${n.querySelector('.browse-cat-count').textContent}`);

test('a category added to the favourites from its own grid: the Favorites entry shows with its number, the top bar is told; removed: it goes', async () => {
  const { ctx, refreshTopbar } = await setup('fav-filter-sidebar');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies', filter: { kind: 'category', id: '1' } });
  page.mount();
  await tick(120);
  expect(sidebar(page).some((s) => s.startsWith('Favorites'))).toBe(false);
  ctx.focus.focus('browseHead', 1); // the heart (pin, heart)
  ctx.focus.handle(Action.ENTER);
  await tick(120);
  expect(sidebar(page)).toContain('Favorites:1');
  expect(refreshTopbar).toHaveBeenCalled();
  ctx.focus.focus('browseHead', 1);
  ctx.focus.handle(Action.ENTER);
  await tick(120);
  expect(sidebar(page).some((s) => s.startsWith('Favorites'))).toBe(false);
  page.destroy();
});
