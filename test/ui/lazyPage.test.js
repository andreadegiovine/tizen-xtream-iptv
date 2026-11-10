import { createLazyPage, preloadPages } from '../../src/ui/lazyPage.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function realPage(log) {
  const el = document.createElement('div');
  el.className = 'page real';
  return {
    el,
    mount: () => log.push('mount'),
    destroy: () => log.push('destroy'),
    onAction: (a) => log.push(`action:${a}`) && true,
    saveState: () => ({ at: 3 }),
    restoreState: (s) => log.push(`restore:${s.at}`),
  };
}

test('a page whose code arrives later: placeholder first, then the real page in its place with its methods and the saved state', async () => {
  const log = [];
  const container = document.createElement('main');
  const page = createLazyPage(() => Promise.resolve(() => realPage(log)), (factory) => factory());
  container.appendChild(page.el);
  page.mount();
  page.restoreState({ at: 7 }); // the router restores right after mount, before the code is there
  expect(page.onAction).toBeUndefined();
  expect(page.saveState()).toEqual({ at: 7 }); // left before the code arrived: the state is kept
  await flush();
  expect(container.firstChild.className).toBe('page real');
  expect(page.el).toBe(container.firstChild);
  expect(log).toEqual(['mount', 'restore:7']);
  expect(page.onAction('UP')).toBe(true);
  expect(page.saveState()).toEqual({ at: 3 });
  page.destroy();
  expect(log).toEqual(['mount', 'restore:7', 'action:UP', 'destroy']);
});

test('left before its code arrived: never built; code that cannot be read: a message', async () => {
  const log = [];
  const page = createLazyPage(() => Promise.resolve(() => realPage(log)), (factory) => factory());
  page.mount();
  page.destroy();
  await flush();
  expect(log).toEqual([]);
  const broken = createLazyPage(() => Promise.reject(new Error('offline')), (factory) => factory(), { errorText: 'Something went wrong.' });
  broken.mount();
  await flush();
  expect(broken.el.textContent).toBe('Something went wrong.');
});

test('preloadPages reads every page code one after the other, a failure does not stop the others', async () => {
  const read = [];
  await preloadPages([async () => read.push('a'), async () => Promise.reject(new Error('x')), async () => read.push('c')]);
  expect(read).toEqual(['a', 'c']);
});
