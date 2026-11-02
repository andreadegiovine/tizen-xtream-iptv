import { FocusManager, FocusZone } from '../../src/ui/focus/FocusManager.js';
import { ListModel } from '../../src/ui/focus/models.js';
import { createDialogService } from '../../src/ui/components/dialog.js';
import { createBackHandler } from '../../src/ui/backHandler.js';
import { sectionForEntry, SECTIONS } from '../../src/ui/components/topbar.js';
import { Action } from '../../src/core/input.js';

const texts = { title: 'T', message: 'M', confirmLabel: 'Exit', cancelLabel: 'Stay' };

function setup() {
  const root = document.createElement('div');
  const focus = new FocusManager();
  focus.register(
    new FocusZone({ id: 'page', model: new ListModel({ orientation: 'vertical', getCount: () => 3 }) }),
  );
  focus.focus('page', 2);
  return { root, focus, dialogs: createDialogService({ focus, root }) };
}

describe('dialog service', () => {
  test('traps focus, cancel is the default, and focus returns to the previous zone', async () => {
    const { root, focus, dialogs } = setup();
    const promise = dialogs.confirm(texts);
    expect(dialogs.isOpen()).toBe(true);
    expect(focus.activeId).toBe('dialog');
    expect(root.querySelectorAll('button')).toHaveLength(2);
    focus.handle(Action.UP); // no way out
    expect(focus.activeId).toBe('dialog');
    focus.handle(Action.ENTER); // default button = Stay
    expect(await promise).toBe(false);
    expect(dialogs.isOpen()).toBe(false);
    expect(root.children).toHaveLength(0);
    expect(focus.activeId).toBe('page');
    expect(focus.active.index).toBe(2);
  });

  test('right + enter confirms', async () => {
    const { focus, dialogs } = setup();
    const promise = dialogs.confirm(texts);
    focus.handle(Action.RIGHT);
    focus.handle(Action.ENTER);
    expect(await promise).toBe(true);
  });

  test('dismiss (Back) cancels and a second confirm() while open reuses the same dialog', async () => {
    const { root, dialogs } = setup();
    const first = dialogs.confirm(texts);
    expect(dialogs.confirm(texts)).toBe(first);
    expect(root.children).toHaveLength(1);
    dialogs.dismiss();
    expect(await first).toBe(false);
  });
});

describe('back handler', () => {
  function make({ canGoBack = false, section = 'home', params = {}, answer = true } = {}) {
    const calls = [];
    const dialogs = {
      isOpen: () => false,
      dismiss: () => calls.push('dismiss'),
      confirm: jest.fn(async () => answer),
    };
    const router = { back: () => canGoBack, current: { name: 'x', params } };
    const onBack = createBackHandler({
      dialogs,
      router,
      getSection: () => section,
      goHome: () => calls.push('home'),
      requestExit: () => calls.push('exit'),
      texts: () => texts,
    });
    return { onBack, calls, dialogs };
  }

  test('on Home it asks for confirmation and exits only when confirmed', async () => {
    const yes = make({ answer: true });
    expect(await yes.onBack()).toBe('exit');
    expect(yes.calls).toEqual(['exit']);
    expect(yes.dialogs.confirm).toHaveBeenCalledWith(texts);

    const no = make({ answer: false });
    expect(await no.onBack()).toBe('stay');
    expect(no.calls).toEqual([]);
  });

  test('from another section it goes Home without asking', async () => {
    const h = make({ section: 'settings' });
    expect(await h.onBack()).toBe('home');
    expect(h.calls).toEqual(['home']);
    expect(h.dialogs.confirm).not.toHaveBeenCalled();
  });

  test('a page that can go back wins over everything', async () => {
    const h = make({ canGoBack: true, section: 'settings' });
    expect(await h.onBack()).toBe('router');
    expect(h.calls).toEqual([]);
  });

  test('first run asks to exit even though the section is not Home', async () => {
    const h = make({ section: 'provider', params: { firstRun: true } });
    expect(await h.onBack()).toBe('exit');
  });

  test('an open dialog is dismissed first', async () => {
    const h = make();
    h.dialogs.isOpen = () => true;
    expect(await h.onBack()).toBe('dialog');
    expect(h.calls).toEqual(['dismiss']);
  });
});

describe('topbar sections', () => {
  test('explicit section wins, otherwise it is derived from the route', () => {
    expect(sectionForEntry({ name: 'comingSoon', params: { section: 'movies' } })).toBe('movies');
    expect(sectionForEntry({ name: 'diagnostics', params: {} })).toBe('settings');
    expect(sectionForEntry({ name: 'providerSetup', params: {} })).toBe('provider');
    expect(sectionForEntry({ name: 'home', params: {} })).toBe('home');
    expect(sectionForEntry(null)).toBe('home');
  });

  test('every placeholder section is distinct (only one can be highlighted)', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
