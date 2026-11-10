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
  expect(buttons()).toEqual(['Xtream API', 'M3U / XMLTV', 'Cancel']);
  ctx.focus.handle(Action.RIGHT); // Xtream API → M3U / XMLTV
  ctx.focus.handle(Action.ENTER);
  expect(page.step()).toBe('m3u');
  const inputs = page.el.querySelectorAll('input');
  expect(inputs).toHaveLength(3); // name, playlist, guide
  expect(buttons()).toEqual(['Confirm', 'Back']);
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => '#EXTM3U url-tvg="http://h/epg.xml"\n#EXTINF:-1,A\nhttp://h/live/1.ts\n' }));
  inputs[0].value = 'My list';
  inputs[1].value = 'h/list.m3u';
  ctx.focus.focus('providerSetup', 3); // Confirm
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
  ctx.focus.focus('providerSetup', 5); // Back (4 fields, then Confirm, Back)
  ctx.focus.handle(Action.ENTER);
  expect(page.step()).toBe('type');
  page.destroy();
});
