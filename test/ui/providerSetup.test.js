import { createProviderSetupPage, normalizeAddress } from '../../src/ui/pages/providerSetupPage.js';
import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { Action } from '../../src/core/input.js';

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeCtx() {
  return {
    focus: new FocusManager(),
    router: { back: jest.fn(), reset: jest.fn() },
    providers: { add: jest.fn(async (data) => ({ id: 'p1', ...data })), setActiveId: jest.fn(async () => undefined), get: jest.fn(), getActiveId: jest.fn() },
    refreshAdult: jest.fn(async () => undefined),
    catalog: { start: jest.fn() },
    notices: { success: jest.fn() },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete global.fetch;
});

test('addresses: http added when missing, only http(s), the optional one may be empty', () => {
  expect(normalizeAddress('h.example/list.m3u')).toBe('http://h.example/list.m3u');
  expect(normalizeAddress('', { required: false })).toBe('');
  expect(() => normalizeAddress('ftp://h/x')).toThrow();
  expect(() => normalizeAddress('')).toThrow();
});

test('first the kind of provider, then its data: an M3U playlist is checked and saved with the guide it names', async () => {
  const ctx = makeCtx();
  const page = createProviderSetupPage(ctx, {});
  document.body.appendChild(page.el);
  page.mount();
  expect(page.step()).toBe('type');
  const buttons = () => Array.from(page.el.querySelectorAll('.form-actions .btn')).map((b) => b.textContent);
  expect(buttons()).toEqual(['Cancel', 'Xtream API', 'M3U / XMLTV']); // Cancel on the left
  expect(page.el.querySelector('.btn.focused').textContent).toBe('Xtream API'); // the focus on the first kind
  ctx.focus.handle(Action.RIGHT); // Xtream API → M3U / XMLTV
  ctx.focus.handle(Action.ENTER);
  expect(page.step()).toBe('m3u');
  const inputs = page.el.querySelectorAll('input');
  expect(inputs).toHaveLength(3); // name, playlist, guide
  expect(buttons()).toEqual(['Back', 'Confirm']);
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => '#EXTM3U url-tvg="http://h/epg.xml"\n#EXTINF:-1,A\nhttp://h/live/1.ts\n' }));
  inputs[0].value = 'My list';
  inputs[1].value = 'h/list.m3u';
  ctx.focus.focus('providerSetup', 2); // the last field
  ctx.focus.handle(Action.DOWN); // → Confirm, on the right of Back
  expect(page.el.querySelector('.btn.focused').textContent).toBe('Confirm');
  ctx.focus.handle(Action.ENTER);
  await wait();
  await wait();
  expect(ctx.providers.add).toHaveBeenCalledWith({ type: 'm3u', name: 'My list', playlistUrl: 'http://h/list.m3u', epgUrl: 'http://h/epg.xml', baseUrl: 'http://h/list.m3u', username: '', password: '' });
  expect(ctx.catalog.start).toHaveBeenCalled();
  page.destroy();
});

test('Back from the data goes to the choice; Xtream shows server, user and password', () => {
  const ctx = makeCtx();
  const page = createProviderSetupPage(ctx, { firstRun: true });
  document.body.appendChild(page.el);
  page.mount();
  expect(Array.from(page.el.querySelectorAll('.form-actions .btn')).map((b) => b.textContent)).toEqual(['Xtream API', 'M3U / XMLTV']); // first start: no cancel
  ctx.focus.handle(Action.ENTER);
  expect(page.step()).toBe('xtream');
  expect(page.el.querySelectorAll('input')).toHaveLength(4);
  ctx.focus.focus('providerSetup', 4); // Back (4 fields, then Back, Confirm)
  ctx.focus.handle(Action.ENTER);
  expect(page.step()).toBe('type');
  page.destroy();
});

test('in a dialog over the provider list: editing opens on the data, Cancel closes it, saving resolves with true', async () => {
  const { createDialogService } = await import('../../src/ui/components/dialog.js');
  const { openProviderDialog } = await import('../../src/ui/pages/providerSetupPage.js');
  const ctx = makeCtx();
  ctx.dialogs = createDialogService({ focus: ctx.focus });
  ctx.providers.get = jest.fn(async () => ({ id: 'p1', type: 'm3u', name: 'Mine', playlistUrl: 'http://h/a.m3u', epgUrl: '' }));
  ctx.providers.update = jest.fn(async () => undefined);
  ctx.providers.getActiveId = jest.fn(async () => 'p2');
  const cancelled = openProviderDialog(ctx, { providerId: 'p1' });
  await wait();
  const dialog = document.querySelector('.dialog.provider-dialog');
  expect(dialog.querySelectorAll('input')[0].value).toBe('Mine');
  expect(Array.from(dialog.querySelectorAll('.form-actions .btn')).map((b) => b.textContent)).toEqual(['Cancel', 'Confirm']);
  ctx.dialogs.dismiss(); // Back
  expect(await cancelled).toBe(false);
  expect(document.querySelector('.dialog')).toBeNull();
  const saved = openProviderDialog(ctx, { providerId: 'p1' });
  await wait();
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => '#EXTM3U\n#EXTINF:-1,A\nhttp://h/live/1.ts\n' }));
  ctx.focus.focus(ctx.focus.activeId, 2);
  ctx.focus.handle(Action.DOWN);
  ctx.focus.handle(Action.ENTER); // Confirm
  expect(await saved).toBe(true);
  expect(ctx.providers.update).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Mine', playlistUrl: 'http://h/a.m3u' }));
  expect(document.querySelector('.dialog')).toBeNull();
});
