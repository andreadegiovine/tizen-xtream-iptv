let observers;
beforeEach(() => {
  jest.resetModules();
  observers = [];
  global.IntersectionObserver = class {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      observers.push(this);
    }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
  };
});
afterEach(() => { delete global.IntersectionObserver; });

const fire = (observer, target, isIntersecting) => observer.callback([{ target, isIntersecting }]);

test('images load near the screen, are dropped far from it (skeleton back) and load again on return', () => {
  const { lazySrc } = require('../../src/ui/lazyImage.js');
  const poster = document.createElement('div');
  poster.className = 'card-poster';
  const img = document.createElement('img');
  poster.appendChild(img);
  document.body.appendChild(poster);
  lazySrc(img, 'http://x/a.jpg');
  const [near, far] = observers;
  expect(near.options.rootMargin).toBe('600px'); // the load margin is unchanged
  expect(far.options.rootMargin).toBe('1800px');
  expect(img.decoding).toBe('async');
  expect(img.getAttribute('src')).toBeNull();
  fire(near, img, true);
  expect(img.getAttribute('src')).toBe('http://x/a.jpg');
  fire(far, img, false); // scrolled far away
  expect(img.getAttribute('src')).toBeNull();
  expect(poster.classList.contains('loading')).toBe(true);
  fire(near, img, true); // back near
  expect(img.getAttribute('src')).toBe('http://x/a.jpg');
  poster.remove();
});

test('without IntersectionObserver the picture is set at once', () => {
  delete global.IntersectionObserver;
  const { lazySrc } = require('../../src/ui/lazyImage.js');
  const img = document.createElement('img');
  lazySrc(img, 'http://x/b.jpg');
  expect(img.getAttribute('src')).toBe('http://x/b.jpg');
});
