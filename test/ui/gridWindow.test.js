import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createBrowsePage } from '../../src/ui/pages/browsePage.js';
import { createPinsService } from '../../src/services/pins.js';
import { createFavoritesService } from '../../src/services/favorites.js';

Element.prototype.scrollIntoView = () => undefined;
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const ROW = 300;

// jsdom has no layout: a card's top is its row (6 columns, 300 px a row) below the spacer.
const realOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get() {
      if (!this.classList.contains('card') || !this.parentNode) return 0;
      const spacer = this.parentNode.querySelector('.grid-spacer');
      const cards = Array.from(this.parentNode.children).filter((c) => c.classList.contains('card'));
      return (spacer ? parseFloat(spacer.style.height) || 0 : 0) + Math.floor(cards.indexOf(this) / 6) * ROW;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetTop', realOffsetTop));

test('walking down a long grid: the rows far above the screen leave the page (a spacer keeps their height) and come back in order', async () => {
  const db = await openProviderDb('grid-window');
  const movies = Array.from({ length: 150 }, (_, i) => ({ stream_id: i + 1, name: `Film ${i + 1}`, category_id: '1', added: String(100000 - i), stream_icon: '', container_extension: 'mkv' }));
  await syncType({ db, client: { getCategories: async () => [{ category_id: '1', category_name: 'All' }], getStreams: async () => movies }, type: 'movie' });
  const appDb = await openAppDb('grid-window-app');
  const ctx = {
    focus: new FocusManager(),
    active: { get: async () => ({ provider: { id: 'p' }, db }) },
    settings: { get: async () => ({}), getExcluded: async () => new Set() },
    pins: createPinsService({ db: appDb }),
    favorites: createFavoritesService({ db: appDb }),
    notices: { success: jest.fn() },
    openEntry: jest.fn(),
  };
  const page = createBrowsePage(ctx, { type: 'movie', section: 'movies' });
  page.mount();
  await tick(60);
  const grid = page.el.querySelector('.browse-grid');
  const onPage = () => Array.from(grid.querySelectorAll('.card')).map((c) => c.querySelector('.card-title').textContent);
  // Down row by row to the 17th row (index 100): the cards are read as the focus goes.
  for (let row = 0; row <= 16; row += 1) {
    ctx.focus.focus('browseGrid', row * 6 + 4);
    await tick(20);
  }
  // Kept: from 3 rows above the screen (the focused row is the last one on screen: one row in jsdom) → rows 13 and below.
  const shown = onPage();
  expect(shown[0]).toBe('Film 79');
  expect(grid.querySelector('.grid-spacer').style.height).toBe(`${13 * ROW}px`);
  expect(grid.firstChild.classList.contains('grid-spacer')).toBe(true);
  // A far jump back to the top: every row is back, in order, and the spacer has no height left.
  ctx.focus.focus('browseGrid', 0);
  await tick(20);
  const all = onPage();
  expect(all.slice(0, 3)).toEqual(['Film 1', 'Film 2', 'Film 3']);
  expect(all.length).toBeGreaterThanOrEqual(102);
  expect(all).toEqual(all.slice().sort((a, b) => Number(a.split(' ')[1]) - Number(b.split(' ')[1])));
  expect(grid.querySelector('.grid-spacer').style.height).toBe('0px');
  expect(grid.querySelector('.card.focused .card-title').textContent).toBe('Film 1');
  page.destroy();
});
