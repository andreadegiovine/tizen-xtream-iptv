# Design decisions

Decisions agreed during the design phase. Update this file when a decision changes.

## Platform and tooling
- Target: Samsung QE75Q70AATXZT (2021, Tizen 6.0, Chromium ~76), installed by sideloading.
- Vanilla ES6 (no UI library, no TypeScript), SCSS, webpack 5. Production output is a
  Tizen widget with separate JS/CSS files. Development: the TV opens the dev server on the PC.
- Unit tests (Jest) for pure logic.

## Data
- `app` IndexedDB: providers, settings, watch state, TMDB cache, TMDB title matches (real migrations).
- One `provider_<id>` database per provider: categories, items, entries, entry_cat, details, epg, meta
  (derived data, rebuilt when the schema changes).
- `entries` are what grids show: one per tmdb group (same type) or per ungrouped item.
  `entry_cat` duplicates rows per category so "category + newest first" is a single index range.
- Category exclusions are applied when entries are built (changing them triggers a rebuild).
- Search runs on an in-memory list of normalized titles, not an IndexedDB index.
- TTLs: provider lists 12 h, series details 24 h, TMDB metadata 30 days, TMDB "not found" 7 days.
- TMDB metadata language follows the UI language.

## Grouping and titles
- Trust the provider's tmdb id. Items without one are never merged, even if TMDB matching finds an id.
- Default stream = lowest stream id; the dropdown lists stream ids.
- A group's `added` is the maximum of its members.
- Card title: TMDB title when available, otherwise the normalized provider title. Card rating comes
  from the provider (TMDB only as a fallback). Series season/episode counts load lazily.
- Matching without tmdb id is conservative: prefer no metadata over wrong metadata.

## UI
- Netflix-like top bar: Home (icon), Search (icon), Movies, TV Series, Live TV, Favorites, Suggestions, then Provider
  and Settings (icons) pushed to the right edge. Search opens a full-width field in the bar (close icon on the right): from 2 characters
  the results page is shown without pressing Enter; Enter/Down moves to the results, Back closes the search.
- One spacing unit (`$gutter`, 48 px) for the screen sides, bar → content and sidebar → content. Pages are full width.
- Icons: Font Awesome Free solid, imported one by one and inlined as SVG (`src/ui/icons.js`); css-loader runs with
  `url:false`, so web-font files would not be shipped.
- Cards are the same size for every type (224 px wide, 2:3 poster): rating badge top-right, watched / partial badge
  top-left, one line of title, one smaller line `year · S7 · E87`.
- Favorites, Suggestions and search results are one carousel per type (movies / series / channels), not one grid.
  Favorites live in the app DB (`kv`, key `favorites`), per provider; the heart on the detail page toggles them.
- There is a single card component for every content type (titles, episodes, cast, channels): square corners, same size.
- Model-based focus (data indices, not geometry); `.focused` class; transform/opacity animations only.
- Category side panel with an "All" entry as default; paginated grids with a page bar and CH+/CH-.
- Posters 2:3 for every card (channel logos are contained inside the same box). Custom dropdowns (`selectField`) with label.
- Detail page: icon-only play / resume buttons, version dropdown under the subtitle, plot, category chips, genre tags, season
  dropdown (no label) + episode carousel (series), cast carousel (TMDB credits, placeholder when no photo; not clickable yet).
  Buttons: play, trailer (only when the provider sends `youtube_trailer`), resume, watched, favourite.
- Player: title at the top; one control row: back 30 s, play-pause, forward 30 s, draggable progress bar (OK then left/right to scrub, or pointer drag), time, aspect ratio, subtitles (drawn by the app from AVPlay events).
- Browse sidebar (Movies/Series): Show all, Continue watching, Favorites, Suggestions, genres (provider + TMDB merged under one normalised, untranslated key; only those with titles), Categories (expandable). Detail chips link back to the matching filter. API keys can be typed in Settings; suggestions come from TMDB or Trakt (setting). Fixed entries have an icon (genres and categories do not, and have no empty slot); every entry shows its title count on the right; categories under the toggle use a smaller font.
  Down (or OK on live) puts the D-pad on the buttons, Back leaves that mode first.
- AVPlay is the engine; all player controls are built in HTML. On-screen keyboard is the native IME.
- Settings: grid sizes are multiples of 12 (12/24/36), carousels 10/15/20/30, buffering 2/5/10/20/30 s.

## Flows
- Provider setup uses manual fields. First sync is progressive. Background work pauses during playback.
- Live format is chosen automatically (HLS preferred, TS as fallback) from the account's allowed formats.
- A title counts as watched past 90 %; position saved every 10 s. Next episode autoplays after a
  10 s countdown (can be disabled).
- Deleting a provider keeps tmdb-based watch history.
- One `AppError` type (code, severity, retryable, i18n key). Credentials are masked in all logs.
- EPG: now-playing on the card, next 24 h on the channel page; downloaded in the background at most
  once a day when the app is opened; only programs ending in the future and starting within 48 h are kept.
- Suggestions: TMDB recommendations seeded from watch history (trending as fallback), intersected with
  the provider catalog by tmdb id. Trakt follows in a second phase behind the watch-state adapter.

## Back, uscita e sezioni (2026-11-02)
- Back: dialog aperto → lo chiude; pagina con cronologia → indietro; altra sezione → Home; Home/primo avvio → conferma di uscita (default "Resta").
- La topbar evidenzia la *sezione* corrente; cambiando sezione il focus resta sulla barra.

## Sync del catalogo (2026-11-02)
- Un'unica implementazione (`catalogSync.js`) in un worker da file; fallback sul thread principale.
- Ordine film → serie → live; TTL 12 h; avvio all'apertura e dopo l'aggiunta di un provider; pausa durante la riproduzione.
- Righe nuove prima, vecchie cancellate dopo; lista vuota non sostituisce un catalogo esistente.
- Schema provider v2: `items` senza indici, `entries` senza indice tmdb (chiave `type:t<tmdbId>`).


## Provider (2026-11-02)
- Sezione Provider = elenco (`providers`) con Usa/Modifica/Rimuovi per riga e "Aggiungi"; il modulo (`providerSetup`) serve sia per aggiungere sia per modificare (`params.providerId`).
- Cambiare provider attivo = `setActiveId` + `catalog.start()` (annulla il job in corso).

## Sfoglia il catalogo (2026-11-02)
- Una pagina `browse` per film/serie/live: categorie a sinistra, griglia paginata a destra (21 titoli per pagina). Le pagine si leggono con cursori sugli indici `byTypeAdded` / `byCatAdded`; nessuna lista intera viene caricata in memoria.
- Dettagli del sync e aggiornamento manuale: in cima alle Impostazioni (tabelle Catalogo, Metadata e Dispositivo, ciascuna con il proprio pulsante; poi il titolo Preferenze). La sezione Provider ha solo l'elenco.

## Riproduzione, stato di visione e metadati (2026-11-02, notte)
- Un solo `playerController` (macchina a stati) sopra un motore intercambiabile: AVPlay sulla TV, `<video>` in un browser desktop. I controlli sono HTML.
- Stato di visione nel DB app, chiave `movie:t<tmdb>` (condivisa tra provider) o `<provider>:movie:i<id>`; serie per episodio. Trakt è un adattatore sopra lo store locale, che resta la fonte per la ripresa.
- `activeProvider` è l'unico handle condiviso su DB e client del provider attivo.
- Le chiavi TMDB/Trakt non stanno nel repository: sono compilate dalla build.
- EPG: XMLTV filtrato per i canali presenti, letto a blocchi in un worker, una volta al giorno dopo il sync del catalogo.
- Suggerimenti: raccomandazioni TMDB dalla cronologia, intersecate per tmdb id con il catalogo.
