import { Router } from '../../src/ui/router.js';

function setup() {
  const container = document.createElement('div');
  const log = [];
  const makePage = (name) => (params) => {
    let counter = 0;
    const el = document.createElement('section');
    el.textContent = name;
    return {
      el,
      mount: () => log.push(`mount ${name}`),
      destroy: () => log.push(`destroy ${name}`),
      saveState: () => ({ scroll: ++counter + (params.base || 0) }),
      restoreState: (s) => log.push(`restore ${name} ${s.scroll}`),
    };
  };
  const router = new Router({
    container,
    routes: { a: makePage('a'), b: makePage('b') },
    onChange: (entry) => log.push(`change ${entry.name}`),
  });
  return { router, container, log };
}

describe('Router', () => {
  test('push destroys the previous page, back restores its state', () => {
    const { router, container, log } = setup();
    router.reset('a', { base: 10 });
    router.push('b');
    expect(container.textContent).toBe('b');
    expect(router.back()).toBe(true);
    expect(container.textContent).toBe('a');
    expect(log).toContain('destroy a');
    expect(log).toContain('restore a 11');
  });

  test('back at the root returns false', () => {
    const { router } = setup();
    router.reset('a');
    expect(router.back()).toBe(false);
  });

  test('a page can consume Back itself', () => {
    const { router } = setup();
    router.routes.a = () => ({ el: document.createElement('div'), onBack: () => true });
    router.reset('a');
    router.push('b');
    router.back();
    router.reset('a');
    expect(router.back()).toBe(true);
    expect(router.depth).toBe(1);
  });

  test('reload re-creates the current page and keeps its state', () => {
    const { router, log } = setup();
    router.reset('a');
    router.reload();
    expect(log.filter((l) => l === 'mount a')).toHaveLength(2);
    expect(log).toContain('restore a 1');
  });

  test('unknown routes fail loudly', () => {
    const { router } = setup();
    expect(() => router.reset('nope')).toThrow(/Unknown route/);
  });
});
