import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';
import { createParentalService, hashPin, isAdultCategoryName } from '../../src/services/parental.js';
import { createPinsService } from '../../src/services/pins.js';
import { subscriptionStatus } from '../../src/services/subscription.js';

let n = 0;
const newDb = () => openAppDb(`parental-test-${(n += 1)}`);

test('adult category names', () => {
  ['XXX', 'Adult Movies', 'Film per adulti', 'Porn HD', '18+', 'Erotic', 'Sexy Italia'].forEach((name) => expect(isAdultCategoryName(name)).toBe(true));
  ['Action', 'Sussex Cricket', 'Documentari', 'Kids 18 months'].forEach((name) => expect(isAdultCategoryName(name)).toBe(false));
});

test('the PIN is stored hashed and verified', async () => {
  const db = await newDb();
  const svc = createParentalService({ db, random: () => 0.5 });
  expect(await svc.hasPin()).toBe(false);
  await svc.setPin('1234');
  expect(await svc.hasPin()).toBe(true);
  expect(await svc.verify('1234')).toBe(true);
  expect(await svc.verify('4321')).toBe(false);
  const stored = await db.transaction('kv').objectStore('kv').get('parental');
  const raw = await new Promise((resolve) => { stored.onsuccess = () => resolve(JSON.stringify(stored.result)); });
  expect(raw).not.toContain('1234');
  expect(hashPin('1234', 's')).toBe(hashPin('1234', 's'));
  expect(hashPin('1234', 's')).not.toBe(hashPin('1235', 's'));
  // another service on the same database sees the PIN
  expect(await createParentalService({ db }).verify('1234')).toBe(true);
});

test('adult entries come from the category names', async () => {
  const db = await newDb();
  const providerDb = await openProviderDb(`parental-provider-${n}`);
  await dbPutMany(providerDb, 'categories', [
    { key: 'movie:1', type: 'movie', id: '1', name: 'Azione' },
    { key: 'movie:2', type: 'movie', id: '2', name: 'Adult XXX' },
    { key: 'live:5', type: 'live', id: '5', name: 'Sky 18+' },
  ]);
  const svc = createParentalService({ db });
  await svc.loadCategories(providerDb);
  expect(svc.isAdult({ type: 'movie', categoryIds: ['1'] })).toBe(false);
  expect(svc.isAdult({ type: 'movie', categoryIds: ['1', 2] })).toBe(true);
  expect(svc.isAdult({ type: 'series', categoryIds: ['2'] })).toBe(false);
  expect(svc.isAdult({ type: 'live', categoryIds: ['5'] })).toBe(true);
  expect(svc.isAdult({ type: 'movie' })).toBe(false);
});

test('pins: per provider and type, toggle, order of addition', async () => {
  const db = await newDb();
  let clock = 0;
  const pins = createPinsService({ db, now: () => (clock += 1) });
  expect(await pins.toggle('p', { kind: 'genre', type: 'movie', id: 'drama', name: 'Drama' })).toBe(true);
  await pins.toggle('p', { kind: 'category', type: 'movie', id: 7, name: 'Premiere' });
  await pins.toggle('p', { kind: 'genre', type: 'series', id: 'drama', name: 'Drama' });
  expect((await pins.list('p', 'movie')).map((x) => x.name)).toEqual(['Drama', 'Premiere']);
  expect(await pins.has('p', 'category', 'movie', '7')).toBe(true);
  expect(await pins.toggle('p', { kind: 'genre', type: 'movie', id: 'drama' })).toBe(false);
  expect((await pins.list('p', 'movie')).map((x) => x.name)).toEqual(['Premiere']);
  await pins.removeProvider('p');
  expect(await pins.list('p', 'series')).toEqual([]);
});

test('subscription notice: only under 10 days, error once ended', () => {
  const day = 24 * 3600 * 1000;
  const now = 1_000_000_000_000;
  expect(subscriptionStatus({ expiresAt: null }, now)).toBeNull();
  expect(subscriptionStatus({ expiresAt: now + 10 * day }, now)).toBeNull();
  expect(subscriptionStatus({ expiresAt: now + 9.5 * day }, now)).toMatchObject({ type: 'warning', days: 9 });
  expect(subscriptionStatus({ expiresAt: now + 0.5 * day }, now)).toMatchObject({ type: 'warning', days: 0 });
  expect(subscriptionStatus({ expiresAt: now - 1 }, now)).toMatchObject({ type: 'error', expired: true });
});
