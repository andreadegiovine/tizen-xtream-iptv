import { setTip, placeTip, startTooltips, TIP_DELAY } from '../../src/ui/tooltip.js';

const view = { width: 1920, height: 1080 };

test('setTip: text and direction, removed when empty', () => {
  const el = document.createElement('button');
  setTip(el, 'Pause');
  expect(el.getAttribute('data-tip')).toBe('Pause');
  expect(el.getAttribute('data-tip-dir')).toBeNull();
  setTip(el, 'Back', 'down');
  expect(el.getAttribute('data-tip-dir')).toBe('down');
  setTip(el, '');
  expect(el.hasAttribute('data-tip')).toBe(false);
});

test('placeTip: above and centred, below when asked, flipped without room, kept inside the screen', () => {
  const box = { width: 200, height: 40 };
  expect(placeTip({ top: 500, bottom: 560, left: 900, width: 100 }, box, null, view)).toEqual({ top: 448, left: 850, down: false });
  expect(placeTip({ top: 500, bottom: 560, left: 900, width: 100 }, box, 'down', view)).toEqual({ top: 572, left: 850, down: true });
  expect(placeTip({ top: 20, bottom: 80, left: 900, width: 100 }, box, null, view).down).toBe(true); // no room above
  expect(placeTip({ top: 1000, bottom: 1060, left: 900, width: 100 }, box, 'down', view).down).toBe(false); // no room below
  expect(placeTip({ top: 500, bottom: 560, left: 1880, width: 40 }, box, null, view).left).toBe(1920 - 16 - 200); // right edge
  expect(placeTip({ top: 500, bottom: 560, left: 0, width: 40 }, box, null, view).left).toBe(16); // left edge
});

describe('the floating box', () => {
  let stop;
  beforeEach(() => {
    jest.useFakeTimers();
    stop = startTooltips();
    // jsdom has no layout: a size for every element.
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 500, bottom: 560, left: 900, right: 1000, width: 100, height: 60 });
  });
  afterEach(() => {
    stop();
    jest.restoreAllMocks();
    jest.useRealTimers();
    document.body.innerHTML = '';
    document.body.className = '';
  });
  const box = () => document.querySelector('.tooltip');

  test('shown after TIP_DELAY of focus, gone as soon as the focus leaves', () => {
    const a = setTip(document.createElement('button'), 'Favourite');
    const b = document.createElement('button');
    document.body.append(a, b);
    a.classList.add('focused');
    document.dispatchEvent(new KeyboardEvent('keydown'));
    jest.advanceTimersByTime(TIP_DELAY - 300);
    expect(box().classList.contains('shown')).toBe(false);
    jest.advanceTimersByTime(400);
    expect(box().classList.contains('shown')).toBe(true);
    expect(box().textContent).toBe('Favourite');
    a.classList.remove('focused');
    b.classList.add('focused');
    document.dispatchEvent(new KeyboardEvent('keydown'));
    jest.advanceTimersByTime(1);
    expect(box().classList.contains('shown')).toBe(false);
    jest.advanceTimersByTime(TIP_DELAY * 2);
    expect(box().classList.contains('shown')).toBe(false); // no tooltip of its own
  });

  test('hidden with an ancestor faded out (the player controls), the text follows the element', () => {
    const controls = document.createElement('div');
    const a = setTip(document.createElement('button'), 'Pause');
    controls.appendChild(a);
    document.body.appendChild(controls);
    a.classList.add('focused');
    jest.advanceTimersByTime(TIP_DELAY + 600);
    expect(box().classList.contains('shown')).toBe(true);
    setTip(a, 'Play');
    jest.advanceTimersByTime(300);
    expect(box().textContent).toBe('Play');
    controls.style.opacity = '0';
    jest.advanceTimersByTime(300);
    expect(box().classList.contains('shown')).toBe(false);
  });

  test('with the pointer: the element under it, not the focused one', () => {
    const a = setTip(document.createElement('button'), 'Settings', 'down');
    const b = setTip(document.createElement('button'), 'Search', 'down');
    document.body.append(a, b);
    document.body.classList.add('pointer-mode');
    a.classList.add('focused');
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    jest.advanceTimersByTime(TIP_DELAY + 600);
    expect(box().textContent).toBe('Search');
    expect(box().classList.contains('down')).toBe(true);
  });
});
