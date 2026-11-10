#!/usr/bin/env node
/**
 * Mock Xtream Codes panel for performance tests (development only, never shipped).
 *
 *   node scripts/mock-xtream/server.js [--port 8090] [--movies 20000] [--series 8000] [--live 3000]
 *                                      [--latency 150] [--img-latency 40] [--kbps 0] [--dist dist]
 *
 * Serves on one origin (no CORS involved): the app build (`--dist`, default ./dist), the Xtream API (/player_api.php, /xmltv.php),
 * posters and logos (/img/...svg, cacheable) and a fake TMDB (/tmdb/3/...) that tests route api.themoviedb.org and image.tmdb.org to.
 * Account: user "test", password "test". Every request is counted: GET /__stats returns the counts, POST /__stats/reset clears them.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buildCatalog, rng, title, TMDB_GENRES, DEMO_GENRE_NAMES } = require('./data');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, arg, i, all) => (arg.startsWith('--') ? out.concat([[arg.slice(2), all[i + 1]]]) : out), []));
const PORT = Number(args.port || 8090);
const LATENCY = Number(args.latency || 150);
const IMG_LATENCY = Number(args['img-latency'] || 40);
const KBPS = Number(args.kbps || 0); // 0 = no bandwidth limit
const DIST = path.resolve(args.dist || path.join(__dirname, '../../dist'));
const BASE = `http://localhost:${PORT}`;

const t0 = Date.now();
const DEMO = Boolean(args.demo); // fictional English names and drawn posters (screenshots: npm run screenshots)
const catalog = buildCatalog({ movies: Number(args.movies || 20000), series: Number(args.series || 8000), live: Number(args.live || 3000), baseUrl: BASE, demo: DEMO });
const json = (value) => Buffer.from(JSON.stringify(value));
const cache = new Map(); // big bodies built once
const stats = { requests: {}, bytes: 0 };
const count = (name, bytes = 0) => {
  stats.requests[name] = (stats.requests[name] || 0) + 1;
  stats.bytes += bytes;
};
console.log(`catalog: ${catalog.vod.length} movies, ${catalog.series.length} series, ${catalog.live.length} channels (${Date.now() - t0} ms)`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(req, res, status, body, type, { latency = LATENCY, cacheable = false } = {}) {
  if (latency) await sleep(latency);
  const headers = { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': cacheable ? 'public, max-age=86400' : 'no-store' };
  let out = body;
  if (body.length > 2048 && /gzip/.test(req.headers['accept-encoding'] || '') && !KBPS) {
    out = zlib.gzipSync(body, { level: 1 });
    headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = out.length;
  res.writeHead(status, headers);
  if (!KBPS) return res.end(out);
  const chunk = Math.max(1024, Math.round((KBPS * 1024) / 10)); // 10 chunks a second
  for (let i = 0; i < out.length; i += chunk) {
    res.write(out.subarray(i, i + chunk));
    await sleep(100);
  }
  return res.end();
}

function streams(list, categoryId) {
  return categoryId ? list.filter((s) => s.category_id === categoryId) : list;
}

function memo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

function vodInfo(id) {
  const m = catalog.vod[id - 1];
  if (!m) return {};
  return { info: { name: m.name, plot: `Trama del film ${id}.`, genre: m.genre, duration_secs: 5400 + (id % 3600), duration: '01:30:00', rating: m.rating, releasedate: `${m.year}-05-01`, cover_big: m.stream_icon, tmdb_id: m.tmdb, cast: 'Attore Uno, Attore Due', director: 'Regista' }, movie_data: { stream_id: id, name: m.name, container_extension: m.container_extension, category_id: m.category_id } };
}

function seriesInfo(id) {
  const s = catalog.series[id - 1];
  if (!s) return {};
  const r = rng(id);
  const seasons = 1 + Math.floor(r() * 6);
  const episodes = {};
  let epId = id * 1000;
  for (let season = 1; season <= seasons; season += 1) {
    const n = 6 + Math.floor(r() * 10);
    episodes[season] = Array.from({ length: n }, (_, i) => ({ id: String((epId += 1)), episode_num: i + 1, title: `Episodio ${i + 1}`, container_extension: 'mkv', season, info: { duration_secs: 2700, plot: `Episodio ${i + 1} della stagione ${season}.`, movie_image: s.cover } }));
  }
  return { seasons: Array.from({ length: seasons }, (_, i) => ({ season_number: i + 1, name: `Stagione ${i + 1}` })), info: { name: s.name, cover: s.cover, plot: s.plot, genre: s.genre, releaseDate: s.releaseDate, rating: s.rating, tmdb: s.tmdb }, episodes };
}

function shortEpg(streamId) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % 1800);
  const b64 = (text) => Buffer.from(text).toString('base64');
  return { epg_listings: Array.from({ length: 6 }, (_, i) => ({ id: `${streamId}-${i}`, title: b64(`Programma ${i + 1}`), description: b64('Descrizione del programma.'), start_timestamp: String(start + i * 1800), stop_timestamp: String(start + (i + 1) * 1800) })) };
}

const GENRES = ['Sport', 'Notizie', 'Film', 'Bambini', 'Documentari', 'Musica', 'Serie TV'];
// --demo: English genres and made-up programme titles per genre.
const DEMO_GENRES = ['Sport', 'News', 'Movies', 'Kids', 'Documentary', 'Music', 'Series'];
const DEMO_SHOWS = {
  Sport: ['Match Day Live', 'Goals of the Week', 'The Training Ground', 'Track and Field', 'Race Night'],
  News: ['Morning Briefing', 'World Today', 'Evening News', 'Business Hour', 'Weather Watch'],
  Movies: ['Silent Orbit', 'The Glass Garden', 'Neon Horizon', 'Iron Valley', 'Paper Moons'],
  Kids: ['Little Explorers', 'Cartoon Club', 'Robot Friends', 'Story Time', 'Jungle Band'],
  Documentary: ['Wild Coasts', 'Deep Oceans', 'Mountain Life', 'Ancient Cities', 'Night Sky'],
  Music: ['Top 20 Countdown', 'Live Session', 'Classic Hits', 'Jazz Corner', 'New Sounds'],
  Series: ['Harbor Lights', 'Frontier Doctors', 'The Night Shift', 'Kingdoms of Ash', 'Little Orbit'],
  '': ['Talk Tonight', 'Home Makeover', 'Quiz Hour', 'Cooking Together', 'Travel Diaries'],
};

function xmltv() {
  const ids = Array.from(new Set(catalog.live.map((c) => c.epg_channel_id).filter(Boolean)));
  const now = Math.floor(Date.now() / 1000);
  const day = now - (now % 86400) - 86400;
  const stamp = (s) => `${new Date(s * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n'];
  ids.forEach((id) => parts.push(`<channel id="${id}"><display-name>${id}</display-name></channel>\n`));
  ids.forEach((id, n) => {
    // One channel in 25 has a guide that only says it has nothing (as some providers do): the app must treat it as no guide.
    const placeholder = n % 25 === 24;
    for (let i = 0; i < 48; i += 1) {
      // Categories as many guides give them: one genre per channel (a third of the channels have none), sometimes a second one.
      const genre = n % 3 === 2 ? '' : GENRES[n % GENRES.length];
      const demoGenre = DEMO && genre ? DEMO_GENRES[GENRES.indexOf(genre)] : '';
      const title = placeholder ? 'EPG non disponibile' : DEMO ? DEMO_SHOWS[demoGenre][(i + n) % 5] : `Programma ${i}`;
      const shown = DEMO ? demoGenre : genre;
      const extra = DEMO ? 'Entertainment' : 'Intrattenimento';
      const category = shown ? `<category lang="it">${shown}</category>${i % 4 === 0 ? `<category lang="it">${extra}</category>` : ''}` : '';
      parts.push(`<programme start="${stamp(day + i * 3600)}" stop="${stamp(day + (i + 1) * 3600)}" channel="${id}"><title>${title}</title><desc>${DEMO ? 'A made-up programme of the demo guide.' : `Descrizione ${i} di ${id}.`}</desc>${category}</programme>\n`);
    }
  });
  parts.push('</tv>\n');
  return Buffer.from(parts.join(''));
}

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** --demo: a poster with a gradient, a sun, hills and the title; a channel logo with its name; a backdrop with soft shapes. */
function demoSvg(kind, id) {
  const hue = (Number(id) * 47) % 360;
  const list = kind === 'm' ? catalog.vod : kind === 's' ? catalog.series : catalog.live;
  // TMDB pictures (p, b) carry the TMDB id: the title the fake TMDB gives that id.
  const item = kind === 'p' || kind === 'b' ? { name: title(rng(Number(id)), 2) } : list[(Number(id) - 1) % list.length] || {};
  const name = String(item.name || '').replace(/ (HD|FHD|4K|SD|HEVC)$/, '');
  if (kind === 'l') {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,35%)"/></linearGradient></defs><rect width="200" height="200" rx="36" fill="url(#g)"/><text x="100" y="112" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="34" text-anchor="middle">${esc(name.split(' ')[0] || '')}</text><text x="100" y="146" fill="#fff" font-family="Arial,sans-serif" font-size="22" text-anchor="middle" opacity=".85">${esc(name.split(' ').slice(1).join(' '))}</text></svg>`);
  }
  const [w, h] = kind === 'b' ? [780, 439] : [342, 513];
  const words = name.split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words;
  const text = kind === 'b' ? '' : lines.map((line, i) => `<text x="${w / 2}" y="${h * 0.6 + i * 34}" fill="#fff" font-family="Arial,sans-serif" font-weight="700" font-size="28" text-anchor="middle">${esc(line)}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360},60%,12%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.68}" cy="${h * 0.3}" r="${w * 0.24}" fill="#fff" opacity=".18"/><path d="M0 ${h} L${w * 0.35} ${h * 0.62} L${w * 0.6} ${h * 0.82} L${w * 0.8} ${h * 0.55} L${w} ${h * 0.78} L${w} ${h} Z" fill="#000" opacity=".35"/>${text}</svg>`);
}

function svg(kind, id) {
  if (DEMO) return demoSvg(kind, id);
  const hue = (Number(id) * 47) % 360;
  const [w, h] = kind === 'l' ? [200, 200] : kind === 'b' ? [780, 439] : [342, 513];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${hue},45%,35%)"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${Math.round(w / 8)}" text-anchor="middle">${kind}${id}</text></svg>`);
}

/** Fake TMDB v3: details, search, recommendations, trending. Genres are deterministic per id. */
function tmdb(pathname, query) {
  const m = pathname.match(/^\/3\/(movie|tv)\/(\d+)(\/recommendations)?$/);
  const genresFor = (id) => {
    const r = rng(Number(id));
    const n = 1 + Math.floor(r() * 3);
    const set = new Map();
    while (set.size < n) {
      const index = Math.floor(r() * TMDB_GENRES.length);
      const [gid, italian] = TMDB_GENRES[index];
      const name = DEMO ? DEMO_GENRE_NAMES[index] : italian;
      set.set(gid, { id: gid, name });
    }
    return Array.from(set.values());
  };
  const item = (kind, id) => ({ id: Number(id), [kind === 'movie' ? 'title' : 'name']: title(rng(Number(id)), 2), overview: DEMO ? 'A fictional story made up for this demo catalog: no real title, no real content.' : `Trama TMDB ${id}.`, poster_path: `/p${id}.svg`, backdrop_path: `/b${id}.svg`, vote_average: (Number(id) % 90) / 10, [kind === 'movie' ? 'release_date' : 'first_air_date']: '2010-01-01', genres: genresFor(id), genre_ids: genresFor(id).map((g) => g.id), runtime: 100, credits: { cast: [], crew: [] }, videos: { results: [] } });
  if (m && m[3]) return { results: Array.from({ length: 12 }, (_, i) => item(m[1], Number(m[2]) + i + 1)) };
  if (m) return Number(m[2]) % 50 === 0 ? null : item(m[1], m[2]); // some ids are not found: 404
  const s = pathname.match(/^\/3\/search\/(movie|tv)$/);
  if (s) return { results: [item(s[1], 900000 + (String(query.get('query')).length % 1000))] };
  const tr = pathname.match(/^\/3\/trending\/(movie|tv)\/week$/);
  if (tr) return { results: Array.from({ length: 20 }, (_, i) => item(tr[1], 1001 + i * 7)) };
  return undefined;
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  let url = new URL(req.url, BASE);
  // A development build (npm run dev, or webpack --mode development) sends its API calls through /__proxy?u=<url>: same panel here.
  if (url.pathname === '/__proxy' || url.pathname === '/__media') {
    try {
      const target = new URL(url.searchParams.get('u'));
      url = new URL(`${target.pathname}${target.search}`, BASE);
    } catch {
      return send(req, res, 400, Buffer.from('bad target'), 'text/plain', { latency: 0 });
    }
  }
  const q = url.searchParams;
  try {
    if (url.pathname === '/__stats') {
      if (req.method === 'POST') {
        stats.requests = {};
        stats.bytes = 0;
      }
      return send(req, res, 200, json(stats), 'application/json', { latency: 0 });
    }
    if (url.pathname === '/player_api.php') {
      if (q.get('username') !== 'test' || q.get('password') !== 'test') return send(req, res, 200, json({ user_info: { auth: 0 } }), 'application/json');
      const action = q.get('action') || 'auth';
      const cat = q.get('category_id');
      let body;
      switch (action) {
        case 'auth':
          body = json({ user_info: { username: 'test', auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 365 * 86400), max_connections: '2', active_cons: '0', allowed_output_formats: ['m3u8', 'ts'] }, server_info: { url: 'localhost', port: String(PORT), server_protocol: 'http', timezone: 'Europe/Rome', time_now: new Date().toISOString() } });
          break;
        case 'get_vod_categories': body = memo(action, () => json(catalog.vodCats)); break;
        case 'get_series_categories': body = memo(action, () => json(catalog.seriesCats)); break;
        case 'get_live_categories': body = memo(action, () => json(catalog.liveCats)); break;
        case 'get_vod_streams': body = memo(`${action}:${cat}`, () => json(streams(catalog.vod, cat))); break;
        case 'get_series': body = memo(`${action}:${cat}`, () => json(streams(catalog.series, cat))); break;
        case 'get_live_streams': body = memo(`${action}:${cat}`, () => json(streams(catalog.live, cat))); break;
        case 'get_vod_info': body = json(vodInfo(Number(q.get('vod_id')))); break;
        case 'get_series_info': body = json(seriesInfo(Number(q.get('series_id')))); break;
        case 'get_short_epg': body = json(shortEpg(q.get('stream_id'))); break;
        default: body = json({});
      }
      count(action, body.length);
      return send(req, res, 200, body, 'application/json');
    }
    // M3U / XMLTV provider: the same live channels and movies as an M3U playlist (Xtream-style stream paths), and the same guide as
    // /epg.xml. `?guide=0` leaves the url-tvg header out (the guide must then be typed with the provider).
    if (url.pathname === '/playlist.m3u') {
      const host = `http://${req.headers.host}`;
      const head = q.get('guide') === '0' ? '#EXTM3U' : `#EXTM3U url-tvg="${host}/epg.xml"`;
      const group = (list, id) => (list.find((c) => c.category_id === id) || {}).category_name || '';
      const lines = [head];
      catalog.live.forEach((c) => lines.push(`#EXTINF:-1 tvg-id="${c.epg_channel_id || ''}" tvg-logo="${c.stream_icon || ''}" group-title="${group(catalog.liveCats, c.category_id)}",${c.name}`, `${host}/live/test/test/${c.stream_id}.ts`));
      catalog.vod.slice(0, 500).forEach((m) => lines.push(`#EXTINF:-1 tvg-logo="${m.stream_icon || ''}" group-title="${group(catalog.vodCats, m.category_id)}",${m.name}`, `${host}/movie/test/test/${m.stream_id}.${m.container_extension}`));
      const body = Buffer.from(`${lines.join('\n')}\n`);
      count('playlist', body.length);
      return send(req, res, 200, body, 'audio/x-mpegurl');
    }
    if (url.pathname === '/xmltv.php' || url.pathname === '/epg.xml') {
      const body = memo('xmltv', xmltv);
      count('xmltv', body.length);
      return send(req, res, 200, body, 'application/xml');
    }
    let im = url.pathname.match(/^\/img\/([msl])\/(\d+)\.svg$/) || url.pathname.match(/^\/tmdbimg\/t\/p\/\w+\/([pb])(\d+)\.svg$/);
    if (im) {
      count(`img:${im[1]}`);
      return send(req, res, 200, svg(im[1], im[2]), 'image/svg+xml', { latency: IMG_LATENCY, cacheable: true });
    }
    if (url.pathname.startsWith('/tmdb/')) {
      const value = tmdb(url.pathname.slice(5), q);
      count(`tmdb:${url.pathname.split('/')[3] || ''}`);
      if (value === undefined || value === null) return send(req, res, 404, json({ status_code: 34 }), 'application/json');
      return send(req, res, 200, json(value), 'application/json', { latency: 60 });
    }
    if (/^\/(movie|series|live)\//.test(url.pathname)) return send(req, res, 404, Buffer.from('no media in the mock'), 'text/plain', { latency: 0 });
    // the app build
    const file = path.join(DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(req, res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream', { latency: 0 });
    }
    return send(req, res, 404, Buffer.from('not found'), 'text/plain', { latency: 0 });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    return res.end();
  }
});

server.listen(PORT, () => console.log(`mock Xtream on ${BASE} (user test / test), app from ${DIST}, API latency ${LATENCY} ms, image latency ${IMG_LATENCY} ms`));
