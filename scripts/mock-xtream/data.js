/**
 * Deterministic fake catalog for the mock Xtream server: same seed, same catalog. Sizes are configurable (defaults: 20 000 movies,
 * 8 000 series, 3 000 live channels). Shapes follow what real panels send, including their quirks (string numbers, empty tmdb, mixed
 * genre separators, channel names with quality / country markers so live grouping has work to do).
 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('ombra notte città fuoco ultimo grande viaggio ritorno segreto cuore guerra amore mare cielo strada sangue tempo ' +
  'silenzio destino vento lupo stella fiume isola pioggia regno caccia confine memoria ponte specchio luce giardino porto treno ' +
  'deserto tempesta nebbia leggenda codice missione fuga verità promessa sogno sole luna ferro oro vetro').split(' ');
const PROVIDER_GENRES = ['Azione', 'Avventura', 'Animazione', 'Commedia', 'Crimine', 'Documentario', 'Dramma', 'Famiglia', 'Fantasy', 'Storia', 'Horror', 'Musica', 'Mistero', 'Romance', 'Fantascienza', 'Thriller', 'Guerra', 'Western'];
const TMDB_GENRES = [[28, 'Azione'], [12, 'Avventura'], [16, 'Animazione'], [35, 'Commedia'], [80, 'Crime'], [99, 'Documentario'], [18, 'Dramma'], [10751, 'Famiglia'], [14, 'Fantasy'], [36, 'Storia'], [27, 'Horror'], [10402, 'Musica'], [9648, 'Mistero'], [10749, 'Romance'], [878, 'Fantascienza'], [53, 'Thriller'], [10752, 'Guerra'], [37, 'Western']];
const CHANNEL_BRANDS = ['RAI', 'MEDIASET', 'SKY', 'DAZN', 'DISCOVERY', 'NOVE', 'LA7', 'TV8', 'CIELO', 'FOX', 'NATGEO', 'HISTORY', 'CARTOON', 'NICK', 'MTV', 'EUROSPORT', 'BBC', 'CNN', 'TF1', 'ZDF', 'RTL', 'ARTE', 'TVE', 'ANTENA'];
const COUNTRIES = ['IT', 'IT', 'IT', 'UK', 'FR', 'DE', 'ES', 'US'];
const QUALITIES = ['', ' HD', ' FHD', ' 4K', ' SD', ' HEVC'];

// --demo (screenshots for the documentation and the stores): fictional English titles and channel brands, no real names.
const DEMO_ADJ = 'Midnight Silent Last Iron Glass Paper Neon Hidden Golden Broken Distant Northern Silver Wild Crimson Quiet Lost Endless Frozen Burning Little Second Velvet Hollow'.split(' ');
const DEMO_NOUN = 'Harbor Lighthouse Horizon Moons Orbit Garden Valley Kingdom River Signal Empire Shadows Island Frontier Station Letters Summer Tide Compass Echoes Doctors Kitchen Detective Lights'.split(' ');
const DEMO_BRANDS = ['NOVA', 'POLAR', 'VISTA', 'LUMEN', 'AURORA', 'ZENITH', 'ATLAS', 'PULSE', 'METRO', 'CORAL', 'SUMMIT', 'ORBIT'];
const DEMO_CATS = ['Action', 'Adventure', 'Comedy', 'Drama', 'Family', 'Documentary', 'Sci-Fi', 'Thriller', 'Romance', 'Animation'];
const DEMO_LIVE_CATS = ['News', 'Sport', 'Movies', 'Kids', 'Documentary', 'Music', 'Entertainment', 'Lifestyle'];
let demo = false;

function title(r, words = 1 + Math.floor(r() * 3)) {
  if (demo) return `${DEMO_ADJ[Math.floor(r() * DEMO_ADJ.length)]} ${DEMO_NOUN[Math.floor(r() * DEMO_NOUN.length)]}`;
  const out = [];
  for (let i = 0; i < words; i += 1) out.push(WORDS[Math.floor(r() * WORDS.length)]);
  const s = out.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DEMO_GENRE_NAMES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];

function pickGenres(r) {
  const n = 1 + Math.floor(r() * 3);
  const set = new Set();
  const names = demo ? DEMO_GENRE_NAMES : PROVIDER_GENRES;
  while (set.size < n) set.add(names[Math.floor(r() * names.length)]);
  const list = Array.from(set);
  return r() < 0.5 ? list.join(', ') : list.join(' / ');
}

function buildCatalog({ movies = 20000, series = 8000, live = 3000, seed = 42, baseUrl = '', demo: demoMode = false } = {}) {
  demo = demoMode;
  const r = rng(seed);
  const now = Math.floor(Date.now() / 1000);
  const brands = demo ? DEMO_BRANDS : CHANNEL_BRANDS;
  const vodCats = demo
    ? DEMO_CATS.map((name, i) => ({ category_id: String(100 + i), category_name: name, parent_id: 0 }))
    : Array.from({ length: 60 }, (_, i) => ({ category_id: String(100 + i), category_name: `${COUNTRIES[i % COUNTRIES.length]} | ${title(r, 2)}`, parent_id: 0 }));
  const seriesCats = demo
    ? DEMO_CATS.map((name, i) => ({ category_id: String(300 + i), category_name: `${name} series`, parent_id: 0 }))
    : Array.from({ length: 40 }, (_, i) => ({ category_id: String(300 + i), category_name: `${COUNTRIES[i % COUNTRIES.length]} | Serie ${title(r, 1)}`, parent_id: 0 }));
  const liveCats = demo
    ? DEMO_LIVE_CATS.map((name, i) => ({ category_id: String(500 + i), category_name: name, parent_id: 0 }))
    : Array.from({ length: 50 }, (_, i) => ({ category_id: String(500 + i), category_name: `${COUNTRIES[i % COUNTRIES.length]} | ${CHANNEL_BRANDS[i % CHANNEL_BRANDS.length]}`, parent_id: 0 }));
  const img = (kind, id) => `${baseUrl}/img/${kind}/${id}.svg`;

  const vod = [];
  for (let i = 1; i <= movies; i += 1) {
    const year = 1960 + Math.floor(r() * 66);
    const hasTmdb = r() < 0.85;
    const name = demo ? title(r) : `${title(r)}${r() < 0.6 ? ` (${year})` : ''}${r() < 0.1 ? ' [SUB ITA]' : ''}`;
    vod.push({
      num: i, name, stream_type: 'movie', stream_id: i, stream_icon: r() < 0.93 ? img('m', i) : '',
      rating: r() < 0.8 ? (r() * 9 + 1).toFixed(1) : '', rating_5based: 0, added: String(now - Math.floor(r() * 3 * 365 * 86400)),
      is_adult: r() < 0.01 ? '1' : '0', category_id: vodCats[Math.floor(r() * vodCats.length)].category_id, container_extension: r() < 0.7 ? 'mkv' : 'mp4',
      custom_sid: '', direct_source: '', tmdb: hasTmdb || demo ? String(1000 + i) : '', genre: r() < 0.7 || demo ? pickGenres(r) : '', year: String(year), // demo: every title complete
    });
  }
  const ser = [];
  for (let i = 1; i <= series; i += 1) {
    const year = 1990 + Math.floor(r() * 36);
    ser.push({
      num: i, name: demo ? title(r) : `${title(r)}${r() < 0.4 ? ` (${year})` : ''}`, series_id: i, cover: r() < 0.95 ? img('s', i) : '', plot: `Trama della serie ${i}.`,
      cast: '', director: '', genre: r() < 0.75 || demo ? pickGenres(r) : '', releaseDate: `${year}-01-01`, last_modified: String(now - Math.floor(r() * 2 * 365 * 86400)),
      rating: r() < 0.8 ? (r() * 9 + 1).toFixed(1) : '', rating_5based: 0, backdrop_path: [], youtube_trailer: '', episode_run_time: '45',
      category_id: seriesCats[Math.floor(r() * seriesCats.length)].category_id, tmdb: r() < 0.85 || demo ? String(500000 + i) : '',
    });
  }
  const liveList = [];
  let id = 1;
  while (liveList.length < live) {
    const brand = brands[Math.floor(r() * brands.length)];
    const country = demo ? 'UK' : COUNTRIES[Math.floor(r() * COUNTRIES.length)];
    const base = `${brand} ${1 + Math.floor(r() * 12)}`;
    const variants = 1 + Math.floor(r() * 3); // the same channel in several qualities: grouped by the app
    const cat = liveCats[Math.floor(r() * liveCats.length)].category_id;
    for (let v = 0; v < variants && liveList.length < live; v += 1) {
      liveList.push({
        num: id, name: `${demo ? '' : `${country}: `}${base}${QUALITIES[(v + Math.floor(r() * QUALITIES.length)) % QUALITIES.length]}`, stream_type: 'live', stream_id: id,
        stream_icon: r() < 0.9 ? img('l', id) : '', epg_channel_id: r() < 0.8 ? `${base.toLowerCase().replace(/\s+/g, '')}.${country.toLowerCase()}` : '',
        added: String(now - Math.floor(r() * 365 * 86400)), is_adult: '0', category_id: cat, custom_sid: '', tv_archive: 0, direct_source: '', tv_archive_duration: 0,
      });
      id += 1;
    }
  }
  return { vodCats, seriesCats, liveCats, vod, series: ser, live: liveList, TMDB_GENRES };
}

module.exports = { buildCatalog, rng, title, TMDB_GENRES, DEMO_GENRE_NAMES, isDemo: () => demo };
