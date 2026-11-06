import { createCard } from '../../src/ui/components/card.js';

test('a card far above the screen frees its picture and shows the skeleton; back near the screen it loads it again', () => {
  const card = createCard({ key: 'movie:1', name: 'A', icon: 'http://x/a.jpg' }, 'movie', {});
  const poster = card.el.querySelector('.card-poster');
  expect(poster.querySelector('img')).not.toBeNull();
  card.release();
  expect(poster.querySelector('img')).toBeNull();
  expect(poster.classList.contains('loading')).toBe(true);
  card.update({ poster: 'http://x/b.jpg' }); // a better picture arriving meanwhile is kept for later
  expect(poster.querySelector('img')).toBeNull();
  card.restore();
  const img = poster.querySelector('img');
  expect(img).not.toBeNull();
  expect(poster.classList.contains('loading')).toBe(true); // until it has loaded
});
