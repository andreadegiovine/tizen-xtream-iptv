import { createCarousel, VISIBLE_CARDS, AHEAD_CARDS } from '../../src/ui/components/carousel.js';

const item = (n) => ({ entry: { key: `movie:${n}`, name: `M${n}` }, type: 'movie' });
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a long row starts with the cards on screen plus five, the next ones come while the focus moves right', async () => {
  const asked = [];
  const more = jest.fn(async (offset, count) => {
    asked.push([offset, count]);
    return Array.from({ length: Math.max(0, Math.min(count, 40 - offset)) }, (_, i) => item(offset + i));
  });
  const added = [];
  const c = createCarousel({ id: 'row', title: 'Row', items: [item(0), item(1), item(2)], more, onAdded: (list, cards) => added.push([list.length, cards.length]) });
  await wait();
  expect(c.cards).toHaveLength(VISIBLE_CARDS + AHEAD_CARDS); // 3 given, the rest read at once
  expect(asked).toEqual([[3, VISIBLE_CARDS + AHEAD_CARDS - 3]]);
  expect(added).toEqual([[9, 9]]);
  c.zone.onFocus(3); // the focus moves right: five past the screen are always there
  await wait();
  expect(c.cards).toHaveLength(3 + VISIBLE_CARDS + AHEAD_CARDS);
  for (let i = 4; i < 40; i += 1) {
    c.zone.onFocus(i); // one card at a time, like the remote
    await wait();
  }
  expect(c.cards).toHaveLength(40); // the end of the row: no more requests
  const calls = more.mock.calls.length;
  c.zone.onFocus(39);
  await wait();
  expect(more.mock.calls.length).toBe(calls);
});

test('a row without `more` shows the cards it was given', () => {
  const c = createCarousel({ id: 'r', title: '', items: [item(1)] });
  expect(c.cards).toHaveLength(1);
});
