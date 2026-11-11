import { FocusManager, FocusZone } from '../../src/ui/focus/FocusManager.js';
import { ListModel } from '../../src/ui/focus/models.js';
import { createPointer } from '../../src/ui/pointer.js';
import { ensureVisible, scrollHeld, withoutScroll } from '../../src/ui/scroll.js';

function setup() {
  document.body.innerHTML = '';
  const focus = new FocusManager();
  const log = [];
  const make = (id, count) => {
    const box = document.createElement('div');
    const nodes = Array.from({ length: count }, (_, i) => {
      const node = document.createElement('div');
      node.className = `item ${id}-${i}`;
      node.appendChild(document.createElement('span'));
      box.appendChild(node);
      return node;
    });
    document.body.appendChild(box);
    focus.register(
      new FocusZone({
        id,
        nodes: () => nodes,
        model: new ListModel({ orientation: 'horizontal', getCount: () => nodes.length }),
        onFocus: (i) => log.push(`focus ${id}${i}`),
        onBlur: (i) => log.push(`blur ${id}${i}`),
        onActivate: (i) => log.push(`ok ${id}${i}`),
        onLongActivate: id === 'b' ? (i) => log.push(`long ${id}${i}`) : null,
      }),
    );
    return nodes;
  };
  const a = make('a', 3);
  const b = make('b', 2);
  const backs = [];
  const frames = [];
  const pointer = createPointer({ focus, onBack: () => backs.push('back'), win: { requestAnimationFrame: (fn) => frames.push(fn) } });
  const move = (target, x, y) => {
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, screenX: x, screenY: y }));
    while (frames.length) frames.shift()();
  };
  return { focus, log, a, b, backs, pointer, move };
}

test('locate: the zone and index of the element under the pointer (a child of it too); nothing outside the zones', () => {
  const { focus, a, b } = setup();
  expect(focus.locate(a[2].firstChild)).toEqual({ id: 'a', index: 2 });
  expect(focus.locate(b[0])).toEqual({ id: 'b', index: 0 });
  expect(focus.locate(document.body)).toBeNull();
});

test('a moving pointer gives the focus, without scrolling; the same place twice (the page scrolled under it) does nothing', () => {
  const { focus, log, a, move } = setup();
  move(a[1], 10, 10);
  expect(focus.activeId).toBe('a');
  expect(focus.active.index).toBe(1);
  expect(document.body.classList.contains('pointer-mode')).toBe(true);
  focus.focus('b', 0); // a key moved the focus
  log.length = 0;
  move(a[2], 10, 10); // Chromium's mousemove after a scroll: same coordinates
  expect(log).toEqual([]);
  move(a[2], 12, 10);
  expect(log).toEqual(['blur b0', 'focus a2']);
});

test('click is OK, right click the long press, a key leaves pointer mode, the backdrop of a dialog and the mouse back button are Back', () => {
  const { log, a, b, backs } = setup();
  b[1].firstChild.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(log.slice(-1)).toEqual(['ok b1']);
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  b[0].dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  expect(log.slice(-1)).toEqual(['long b0']);
  log.length = 0;
  a[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); // no long press there: only the focus
  expect(log.filter((l) => l.startsWith('ok') || l.startsWith('long'))).toEqual([]);
  document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 40 }));
  expect(document.body.classList.contains('pointer-mode')).toBe(false);
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  document.body.appendChild(backdrop);
  backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 3 }));
  expect(backs).toEqual(['back', 'back']);
});

test('a click an element handled itself (preventDefault) is not an OK again', () => {
  const { log, a } = setup();
  a[0].addEventListener('click', (event) => event.preventDefault());
  a[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  expect(log.filter((l) => l.startsWith('ok'))).toEqual([]);
});

test('withoutScroll holds ensureVisible', () => {
  document.body.innerHTML = '<div class="page"><div class="x"></div></div>';
  const page = document.querySelector('.page');
  page.scrollTop = 0;
  const x = document.querySelector('.x');
  let read = 0;
  x.getBoundingClientRect = () => {
    read += 1;
    return { top: 2000, bottom: 2100 };
  };
  withoutScroll(() => {
    expect(scrollHeld()).toBe(true);
    ensureVisible(x);
  });
  expect(read).toBe(0);
  expect(scrollHeld()).toBe(false);
});
