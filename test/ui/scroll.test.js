import { computeScrollTop, ensureVisible } from '../../src/ui/scroll.js';

const base = { viewTop: 100, viewBottom: 900, scrollTop: 0, margin: 20 };

describe('computeScrollTop', () => {
  test('does nothing when the element is already visible', () => {
    expect(computeScrollTop({ ...base, elTop: 300, elBottom: 400 })).toBe(0);
  });

  test('scrolls down just enough to reveal an element below the view', () => {
    expect(computeScrollTop({ ...base, scrollTop: 50, elTop: 880, elBottom: 980 })).toBe(50 + 100);
  });

  test('scrolls up to reveal an element above the view', () => {
    expect(computeScrollTop({ ...base, scrollTop: 400, elTop: 60, elBottom: 160 })).toBe(400 - 60);
  });

  test('an element taller than the view is aligned to its top', () => {
    expect(computeScrollTop({ ...base, scrollTop: 0, elTop: 300, elBottom: 1500 })).toBe(300 - 20 - 100);
  });
});

describe('ensureVisible', () => {
  function makePage(rects, scrollTop = 0) {
    const page = document.createElement('section');
    page.className = 'page';
    const el = document.createElement('div');
    page.appendChild(el);
    page.scrollTop = scrollTop;
    page.getBoundingClientRect = () => rects.page;
    el.getBoundingClientRect = () => rects.el;
    return { page, el };
  }

  test('writes the computed scrollTop on the closest .page', () => {
    const { page, el } = makePage({ page: { top: 0, bottom: 800 }, el: { top: 900, bottom: 1000 } });
    ensureVisible(el, { margin: 0 });
    expect(page.scrollTop).toBe(200);
  });

  test('first: true goes back to the top so the heading shows', () => {
    const { page, el } = makePage({ page: { top: 0, bottom: 800 }, el: { top: 10, bottom: 20 } }, 300);
    ensureVisible(el, { first: true });
    expect(page.scrollTop).toBe(0);
  });

  test('elements outside a page are ignored', () => {
    expect(() => ensureVisible(document.createElement('div'))).not.toThrow();
  });
});
