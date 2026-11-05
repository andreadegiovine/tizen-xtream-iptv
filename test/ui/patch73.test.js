import { createAvPlayEngine } from '../../src/services/playerEngines.js';
import { createCard } from '../../src/ui/components/card.js';
import { createNoticeService } from '../../src/ui/components/notice.js';

describe('AVPlay availability', () => {
  afterEach(() => {
    delete global.webapis;
  });
  test('a partial webapis (outside the TV) does not count: the <video> engine is used', () => {
    global.webapis = { avplay: { open() {} } };
    expect(createAvPlayEngine().available()).toBe(false);
    global.webapis = { avplay: { open() {}, setDisplayRect() {}, prepareAsync() {} } };
    expect(createAvPlayEngine().available()).toBe(true);
  });
});

test('card: the heart badge is under the rating, in the same column, and follows `favorite`', () => {
  const card = createCard({ key: 'movie:1', name: 'A', rating: 7 }, 'movie', {});
  const badges = card.el.querySelector('.card-badges');
  expect(badges.children[0].classList.contains('card-rating')).toBe(true);
  expect(badges.children[1].classList.contains('card-favorite')).toBe(true);
  const heart = card.el.querySelector('.card-favorite');
  expect(heart.classList.contains('visible')).toBe(false);
  card.update({ favorite: true });
  expect(heart.classList.contains('visible')).toBe(true);
  card.update({ favorite: false });
  expect(heart.classList.contains('visible')).toBe(false);
});

test('a permanent playback notice stays until it is closed', () => {
  jest.useFakeTimers();
  const notices = createNoticeService({ root: document.body });
  notices.setPlayback(true);
  const id = notices.error('boom', { scope: 'playback', key: 'player-error', permanent: true });
  jest.advanceTimersByTime(60000);
  expect(notices.isOpen()).toBe(true);
  notices.close(id);
  expect(notices.isOpen()).toBe(false);
  jest.useRealTimers();
});
