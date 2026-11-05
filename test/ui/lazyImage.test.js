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
    disconnect() { this.targets.clear(); }
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

test('the margins count from the scroll container (page / carousel track), not from the screen', () => {
  const { lazySrc } = require('../../src/ui/lazyImage.js');
  const page = document.createElement('div');
  page.className = 'page';
  const track = document.createElement('div');
  track.className = 'carousel-track';
  const gridImg = document.createElement('img');
  const trackImg = document.createElement('img');
  const inPage = document.createElement('div');
  inPage.appendChild(gridImg);
  page.append(inPage);
  track.appendChild(trackImg);
  page.appendChild(track);
  document.body.appendChild(page);
  lazySrc(gridImg, 'http://x/g.jpg');
  lazySrc(trackImg, 'http://x/t.jpg');
  const roots = observers.map((o) => o.options.root);
  expect(roots).toContain(page);
  expect(roots).toContain(track);
  expect(observers.every((o) => o.options.root !== null)).toBe(true);
  page.remove();
});

test('a picture that is not in the page yet is watched one frame later, once it is', () => {
  const { lazySrc } = require('../../src/ui/lazyImage.js');
  const frames = [];
  global.requestAnimationFrame = (fn) => frames.push(fn);
  const page = document.createElement('div');
  page.className = 'page';
  const img = document.createElement('img');
  lazySrc(img, 'http://x/c.jpg');
  expect(observers).toHaveLength(0);
  page.appendChild(img);
  document.body.appendChild(page);
  frames.shift()();
  expect(observers).toHaveLength(2);
  expect(observers[0].options.root).toBe(page);
  page.remove();
  delete global.requestAnimationFrame;
});

test('without IntersectionObserver the picture is set at once', () => {
  delete global.IntersectionObserver;
  const { lazySrc } = require('../../src/ui/lazyImage.js');
  const img = document.createElement('img');
  lazySrc(img, 'http://x/b.jpg');
  expect(img.getAttribute('src')).toBe('http://x/b.jpg');
});
