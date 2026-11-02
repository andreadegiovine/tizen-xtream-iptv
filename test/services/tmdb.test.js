import { openAppDb } from '../../src/db/appDb.js';
import { normalizeMeta, pickMatch, createQueue, createTmdbService, META_TTL_MS } from '../../src/services/tmdbService.js';

let n = 0;
const appDb = () => openAppDb(`tmdb-test-${(n += 1)}`);

describe('normalizeMeta', () => {
  test('movie and tv payloads', () => {
    expect(normalizeMeta('movie', { id: 1, title: 'Heat', release_date: '1995-12-15', runtime: 170, poster_path: '/p.jpg', vote_average: 8.2, genres: [{ name: 'Crime' }, { name: 'Drama' }] })).toMatchObject({
      title: 'Heat', year: 1995, runtime: 170, genre: 'Crime, Drama', poster: 'https://image.tmdb.org/t/p/w342/p.jpg', rating: 8.2,
    });
    expect(normalizeMeta('series', { id: 2, name: 'Dark', first_air_date: '2017-12-01', number_of_seasons: 3, number_of_episodes: 26, episode_run_time: [50] })).toMatchObject({
      title: 'Dark', year: 2017, seasons: 3, episodes: 26, runtime: 50,
    });
  });
});

describe('pickMatch (conservative)', () => {
  const results = [
    { id: 1, title: 'Heat', original_title: 'Heat', release_date: '1995-12-15' },
    { id: 2, title: 'Heat', original_title: 'Heat', release_date: '1986-01-01' },
    { id: 3, title: 'Heat Wave', release_date: '1995-01-01' },
  ];
  test('needs a unique exact title (and year when known)', () => {
    expect(pickMatch('movie', results, 'Heat', 1995)).toBe(1);
    expect(pickMatch('movie', results, 'Heat', null)).toBeNull(); // two candidates: refuse to guess
    expect(pickMatch('movie', results, 'Heat', 2001)).toBeNull();
    expect(pickMatch('movie', results, 'Hea', 1995)).toBeNull();
  });
  test('accepts the original title too, ignoring accents', () => {
    expect(pickMatch('movie', [{ id: 9, title: 'Il Gladiatore', original_title: 'Gladiator', release_date: '2000-05-01' }], 'Gladiator', 2000)).toBe(9);
  });
});

test('queue caps concurrency and can drop waiting jobs', async () => {
  const q = createQueue(2);
  let running = 0;
  let peak = 0;
  const gates = [];
  const job = () => new Promise((resolve) => {
    running += 1;
    peak = Math.max(peak, running);
    gates.push(() => { running -= 1; resolve(); });
  });
  const done = [q.add(job), q.add(job), q.add(job)];
  await Promise.resolve();
  await Promise.resolve();
  expect(peak).toBe(2);
  q.clear();
  gates.forEach((g) => g());
  await Promise.all(done.slice(0, 2));
  expect(gates).toHaveLength(2); // the third never started
});

describe('tmdb service', () => {
  const client = (extra = {}) => ({
    enabled: true,
    details: jest.fn().mockResolvedValue({ id: 5, title: 'Five', release_date: '2001-01-01' }),
    search: jest.fn().mockResolvedValue({ results: [{ id: 7, title: 'Seven', release_date: '1995-01-01' }] }),
    ...extra,
  });

  test('caches metadata per language and refreshes after the ttl', async () => {
    const db = await appDb();
    let t = 1000;
    const c = client();
    const svc = createTmdbService({ db, client: c, getLanguage: () => 'it-IT', now: () => t });
    await svc.getMeta('movie', 5);
    // a second service instance (new session) must hit the persistent cache
    const again = createTmdbService({ db, client: c, getLanguage: () => 'it-IT', now: () => t });
    expect((await again.getMeta('movie', 5)).title).toBe('Five');
    expect(c.details).toHaveBeenCalledTimes(1);
    t += META_TTL_MS + 1;
    await createTmdbService({ db, client: c, getLanguage: () => 'it-IT', now: () => t }).getMeta('movie', 5);
    expect(c.details).toHaveBeenCalledTimes(2);
    await createTmdbService({ db, client: c, getLanguage: () => 'en-US', now: () => t }).getMeta('movie', 5);
    expect(c.details).toHaveBeenCalledTimes(3); // another language is another entry
  });

  test('404 is cached as "not found"', async () => {
    const db = await appDb();
    const err = Object.assign(new Error('nf'), { details: { status: 404 } });
    const c = client({ details: jest.fn().mockRejectedValue(err) });
    const svc = createTmdbService({ db, client: c, getLanguage: () => 'en-US' });
    expect(await svc.getMeta('movie', 5)).toBeNull();
    expect(await createTmdbService({ db, client: c, getLanguage: () => 'en-US' }).getMeta('movie', 5)).toBeNull();
    expect(c.details).toHaveBeenCalledTimes(1);
  });

  test('forEntry: provider tmdb id wins; no id → conservative match; live → nothing', async () => {
    const db = await appDb();
    const c = client();
    const svc = createTmdbService({ db, client: c, getLanguage: () => 'en-US' });
    await svc.forEntry({ type: 'movie', tmdbId: 5, name: 'x' });
    expect(c.search).not.toHaveBeenCalled();
    expect(await svc.forEntry({ type: 'live', name: 'CH' })).toBeNull();
    c.details.mockResolvedValueOnce({ id: 7, title: 'Seven', release_date: '1995-01-01' });
    expect((await svc.forEntry({ type: 'movie', tmdbId: null, name: 'Seven', year: 1995 })).tmdbId).toBe(7);
  });

  test('disabled without a key', async () => {
    const db = await appDb();
    const svc = createTmdbService({ db, client: { enabled: false }, getLanguage: () => 'en-US' });
    expect(await svc.getMeta('movie', 5)).toBeNull();
    expect(await svc.forEntry({ type: 'movie', tmdbId: 5 })).toBeNull();
  });
});
