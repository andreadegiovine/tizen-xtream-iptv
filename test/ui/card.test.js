import { createCard, cardMeta, formatRating, setAdultCheck } from '../../src/ui/components/card.js';

test('meta line: year, seasons, episodes, tag; subtitle wins', () => {
  expect(cardMeta({ year: 2019, seasons: 7, episodes: 87 })).toBe('2019 · S7 · E87');
  expect(cardMeta({ year: 2001 })).toBe('2001');
  expect(cardMeta({ seasons: 2, tag: 'Series' })).toBe('S2 · Series');
  expect(cardMeta({ year: 2020, subtitle: 'News at 8' })).toBe('News at 8');
  expect(cardMeta({})).toBe('');
});

test('rating text', () => {
  expect(formatRating(7.14)).toBe('7.1');
  expect(formatRating(0)).toBe('');
  expect(formatRating(null)).toBe('');
});

test('card shows title and meta on separate lines, rating and status badges', () => {
  const card = createCard({ name: 'Dark', year: 2017, rating: 8.7, icon: '' }, 'series');
  expect(card.el.querySelector('.card-title').textContent).toBe('Dark');
  expect(card.el.querySelector('.card-meta').textContent).toBe('2017');
  expect(card.el.querySelector('.card-rating').textContent).toBe('8.7');
  expect(card.el.querySelector('.card-rating').classList.contains('visible')).toBe(true);
  expect(card.el.querySelector('.card-status').classList.contains('visible')).toBe(false);
  card.update({ seasons: 3, episodes: 26, status: 'partial' });
  expect(card.el.querySelector('.card-meta').textContent).toBe('2017 · S3 · E26');
  expect(card.el.querySelector('.card-status .icon-hourglass')).not.toBeNull();
  card.update({ status: 'watched' });
  expect(card.el.querySelector('.card-status .icon-check')).not.toBeNull();
  card.update({ status: null });
  expect(card.el.querySelector('.card-status').classList.contains('visible')).toBe(false);
});

test('no rating → no badge', () => {
  const card = createCard({ name: 'X', rating: null }, 'movie');
  expect(card.el.querySelector('.card-rating').classList.contains('visible')).toBe(false);
});

test('adult entries never show a poster: a lock stands in for it', () => {
  setAdultCheck((entry) => entry.adult === true);
  const locked = createCard({ name: 'X', icon: 'http://img/x.jpg', adult: true }, 'movie');
  locked.update({ poster: 'http://img/y.jpg' });
  expect(locked.el.querySelector('img')).toBeNull();
  expect(locked.el.querySelector('.card-placeholder.locked')).not.toBeNull();
  const normal = createCard({ name: 'Y', icon: 'http://img/y.jpg' }, 'movie');
  expect(normal.el.querySelector('.card-placeholder.locked')).toBeNull();
  setAdultCheck(null);
});

test('a favourite filter card shows a skeleton after the dot until the count is known', () => {
  const card = createCard({ name: 'Drama', icon: '', filterKind: 'genre' }, 'movie', { placeholder: 'genres', subtitle: 'Genre' });
  expect(card.el.querySelector('.card-meta').textContent).toBe('Genre');
  card.update({ countLoading: true });
  expect(card.el.querySelector('.card-meta').textContent).toBe('Genre · ');
  expect(card.el.querySelector('.card-meta .skeleton-line')).not.toBeNull();
  card.update({ count: 1033 });
  expect(card.el.querySelector('.card-meta .skeleton-line')).toBeNull();
  expect(card.el.querySelector('.card-meta').textContent).toMatch(/^Genre · 1.?033$/);
});
