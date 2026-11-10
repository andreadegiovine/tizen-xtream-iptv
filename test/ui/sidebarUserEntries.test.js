import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createBrowsePage } from '../../src/ui/pages/browsePage.js';
import { createPinsService } from '../../src/services/pins.js';
import { createFavoritesService } from '../../src/services/favorites.js';
import { createNavCounts } from '../../src/services/navCounts.js';
import { pageEntries } from '../../src/services/catalogQuery.js';

Element.prototype.scrollIntoView = () => undefined;
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const film = (id) => ({ stream_id: id, name: `Film ${id}`, category_id: '1', added: String(1000 + id), stream_icon: '', container_extension: 'mkv' });

async function setup(name) {
  const db = await openProviderDb(name);
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'All' }], getStreams: async () => [film(1), film(2), film(3)] }, type: 'movie' });
  const appDb = await openAppDb(`${name}-app`);
  const favorites = createFavoritesService({ db: appDb });
  const navCounts = createNavCounts({ db: appDb, saveDelayMs: 0 });
  await navCounts.load();
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db }) },
    settings: { get: async () => ({}), getExcluded: async () => new Set() },
    pins: createPinsService({ db: appDb }),
    favorites,
    navCounts,
    // TMDB / Trakt never answer: the suggestions count never arrives.
    suggestions: { build: () => new Promise(() => undefined), enabled: true },
    notices: { success: jest.fn() },
    openEntry: jest.fn(),
  };
  const first = (await pageEntries(db, { type: 'movie', offset: 0, limit: 1 })).entries[0];
  return { ctx, favorites, navCounts, firstKey: first.key };
}

const entries = (page) => Array.from(page.el.querySelectorAll('.browse-cat-name')).map((n) => n.textContent);

test('a sidebar entry shows as soon as its own number is known: favourites do not wait for the suggestions', async () => {
  const { ctx, favorites, navCounts, firstKey } = await setup('user-entries-1');
  await favorites.toggle('p', firstKey, 'movie');
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies' });
  page.mount();
  await tick(80);
  const names = entries(page);
  expect(names).toContain('Favorites');
  expect(names).not.toContain('Suggestions'); // never counted, nothing known: not shown
  expect(navCounts.get('p', 'movie:favorites')).toBe(1); // remembered for the next visit
  page.destroy();
});

test('the entries that had something last time are there at the first drawing of the sidebar, with that number', async () => {
  const { ctx, navCounts } = await setup('user-entries-2');
  navCounts.set('p', 'movie:suggestions', 12);
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies' });
  page.mount();
  await tick(0);
  await tick(20);
  const names = entries(page);
  expect(names).toContain('Suggestions');
  const slot = Array.from(page.el.querySelectorAll('.browse-cat')).find((n) => n.textContent.includes('Suggestions'));
  expect(slot.querySelector('.browse-cat-count').textContent).toBe('12');
  // Favourites: remembered with nothing, and none now: still out.
  expect(names).not.toContain('Favorites');
  page.destroy();
});
