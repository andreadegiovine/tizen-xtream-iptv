import { compareVersions, pickUpdate, checkForUpdate, installUpdate, forgetUpdate, BUNDLE_KEY, UPDATE_URL } from '../../src/services/updates.js';

const manifest = { version: '1.3.0', platforms: { tizen: { base: 'bundles/1.3.0/tizen/', minShell: '1.2.0' }, webos: { base: 'bundles/1.3.0/webos/' } } };

test('versions compare part by part', () => {
  expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
  expect(compareVersions('1.2', '1.2.0')).toBe(0);
  expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
});

test('a newer build for this platform, with its absolute address; one that needs a newer package; nothing newer', () => {
  expect(pickUpdate(manifest, { platform: 'tizen', running: '1.2.0', shell: '1.2.0' })).toEqual({ version: '1.3.0', base: 'https://andreadegiovine.github.io/xtream-iptv-client/bundles/1.3.0/tizen/' });
  expect(pickUpdate(manifest, { platform: 'tizen', running: '1.1.0', shell: '1.1.0' })).toEqual({ version: '1.3.0', needsPackage: true });
  expect(pickUpdate(manifest, { platform: 'tizen', running: '1.3.0', shell: '1.2.0' })).toBeNull();
  expect(pickUpdate(manifest, { platform: 'android', running: '1.0.0', shell: '1.0.0' })).toBeNull();
  expect(pickUpdate(manifest, { platform: 'webos', running: '1.0.0', shell: '0.1.0' }).base).toContain('/bundles/1.3.0/webos/');
});

test('the check reads version.json without the cache and gives up when it does not answer in time', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push([url.split('?')[0], init.cache]);
    return { ok: true, json: async () => manifest };
  };
  expect(await checkForUpdate({ platform: 'webos', running: '1.0.0', shell: '1.0.0', fetchImpl })).toMatchObject({ version: '1.3.0' });
  expect(urls).toEqual([[UPDATE_URL, 'no-store']]);
  const never = () => new Promise(() => undefined);
  expect(await checkForUpdate({ platform: 'webos', running: '1.0.0', shell: '1.0.0', fetchImpl: never, timeoutMs: 20 })).toBeNull();
});

test('installing downloads the script and the stylesheet, then tells the loader; a missing file installs nothing', async () => {
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const got = [];
  const ok = async (url) => {
    got.push(url);
    return { ok: true, text: async () => 'x' };
  };
  await installUpdate({ version: '1.3.0', base: 'https://h/b/' }, { fetchImpl: ok, storage });
  // A build without files.json (older): main.js and main.css.
  expect(got).toEqual(['https://h/b/files.json', 'https://h/b/js/main.js', 'https://h/b/css/main.css']);
  expect(JSON.parse(store.get(BUNDLE_KEY))).toEqual({ version: '1.3.0', base: 'https://h/b/' });
  forgetUpdate(storage);
  expect(store.has(BUNDLE_KEY)).toBe(false);
  await expect(installUpdate({ version: '1.3.0', base: 'https://h/b/' }, { fetchImpl: async () => ({ ok: false, status: 404 }), storage })).rejects.toThrow('404');
  expect(store.has(BUNDLE_KEY)).toBe(false);
});

test('installing a build with files.json downloads every script of it (pages and workers), nothing outside js/ and css/', async () => {
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const got = [];
  const fetchImpl = async (url) => {
    got.push(url);
    if (url.endsWith('files.json')) return { ok: true, json: async () => ({ files: ['css/main.css', 'js/main.js', 'js/page-player.js', 'fonts/a.woff2', '../x.js'] }) };
    return { ok: true, status: 200, text: async () => 'x' };
  };
  await installUpdate({ version: '1.4.0', base: 'https://h/b/' }, { fetchImpl, storage });
  expect(got).toEqual(['https://h/b/files.json', 'https://h/b/css/main.css', 'https://h/b/js/main.js', 'https://h/b/js/page-player.js']);
  expect(JSON.parse(store.get(BUNDLE_KEY)).version).toBe('1.4.0');
  // A page script missing online: nothing installed.
  store.clear();
  const missing = async (url) => (url.endsWith('files.json') ? { ok: true, json: async () => ({ files: ['js/main.js', 'js/page-player.js'] }) } : { ok: !url.endsWith('page-player.js'), status: 404, text: async () => 'x' });
  await expect(installUpdate({ version: '1.4.0', base: 'https://h/b/' }, { fetchImpl: missing, storage })).rejects.toThrow('page-player.js');
  expect(store.has(BUNDLE_KEY)).toBe(false);
});
