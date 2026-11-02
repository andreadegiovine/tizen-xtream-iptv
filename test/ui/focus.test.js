import { GridModel, ListModel } from '../../src/ui/focus/models.js';
import { FocusManager, FocusZone } from '../../src/ui/focus/FocusManager.js';
import { Action } from '../../src/core/input.js';

describe('GridModel', () => {
  const grid = (count, columns = 4) => new GridModel({ columns, getCount: () => count });

  test('moves inside the grid', () => {
    const g = grid(10);
    expect(g.navigate('right', 0)).toEqual({ type: 'move', index: 1 });
    expect(g.navigate('down', 1)).toEqual({ type: 'move', index: 5 });
    expect(g.navigate('up', 5)).toEqual({ type: 'move', index: 1 });
    expect(g.navigate('left', 1)).toEqual({ type: 'move', index: 0 });
  });

  test('exits at the borders', () => {
    const g = grid(10);
    expect(g.navigate('left', 0).type).toBe('exit');
    expect(g.navigate('up', 2).type).toBe('exit');
    expect(g.navigate('right', 3).type).toBe('exit');
    expect(g.navigate('down', 9).type).toBe('exit');
  });

  test('partial last row: down lands on the last item, right stops at the end', () => {
    const g = grid(10); // rows: 0-3, 4-7, 8-9
    expect(g.navigate('down', 6)).toEqual({ type: 'move', index: 9 });
    expect(g.navigate('right', 9).type).toBe('exit');
  });
});

describe('ListModel', () => {
  test('horizontal list ignores vertical keys', () => {
    const list = new ListModel({ orientation: 'horizontal', getCount: () => 3 });
    expect(list.navigate('right', 0)).toEqual({ type: 'move', index: 1 });
    expect(list.navigate('left', 0).type).toBe('exit');
    expect(list.navigate('down', 1).type).toBe('exit');
  });
});

describe('FocusManager', () => {
  function setup() {
    const events = [];
    const manager = new FocusManager();
    const make = (id, count, orientation = 'vertical') =>
      new FocusZone({
        id,
        model: new ListModel({ orientation, getCount: () => count }),
        onFocus: (i) => events.push(`${id}+${i}`),
        onBlur: (i) => events.push(`${id}-${i}`),
        onActivate: (i) => events.push(`${id}!${i}`),
      });
    return { manager, events, make };
  }

  test('moves within a zone and activates', () => {
    const { manager, events, make } = setup();
    manager.register(make('list', 3));
    manager.focus('list', 0);
    manager.handle(Action.DOWN);
    manager.handle(Action.ENTER);
    expect(events).toEqual(['list+0', 'list-0', 'list+1', 'list!1']);
  });

  test('jumps between linked zones and remembers the index', () => {
    const { manager, events, make } = setup();
    manager.register(make('top', 3, 'horizontal'));
    manager.register(make('body', 4));
    manager.link('body', 'up', 'top');
    manager.link('top', 'down', 'body');
    manager.focus('body', 2);
    manager.handle(Action.UP); // body index 2 -> 1
    manager.handle(Action.UP); // -> 0
    manager.handle(Action.UP); // exit to top
    expect(manager.activeId).toBe('top');
    manager.handle(Action.DOWN);
    expect(manager.activeId).toBe('body');
    expect(manager.active.index).toBe(0);
    expect(events[events.length - 1]).toBe('body+0');
  });

  test('skips empty zones along a link chain', () => {
    const { manager, make } = setup();
    manager.register(make('a', 2));
    manager.register(make('empty', 0));
    manager.register(make('c', 2));
    manager.link('a', 'down', 'empty');
    manager.link('empty', 'down', 'c');
    manager.focus('a', 1);
    manager.handle(Action.DOWN);
    expect(manager.activeId).toBe('c');
  });

  test('unregistering the active zone clears focus', () => {
    const { manager, make } = setup();
    manager.register(make('a', 2));
    manager.focus('a');
    manager.unregister('a');
    expect(manager.active).toBeNull();
    expect(manager.handle(Action.DOWN)).toBe(false);
  });

  test('removing a zone also removes the links that pointed to it', () => {
    const { manager, make } = setup();
    manager.register(make('top', 3, 'horizontal'));
    manager.register(make('page', 3));
    manager.link('top', 'down', 'page');
    manager.focus('top', 0);
    manager.unregister('page');
    manager.handle(Action.DOWN);
    expect(manager.activeId).toBe('top');
    expect(manager.links.get('top')).toEqual({});
  });
});
