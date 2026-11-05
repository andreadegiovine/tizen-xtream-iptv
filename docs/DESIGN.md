# Design decisions

Decisions agreed during the design phase. Update this file when a decision changes.

## Platform and tooling
- Target: Samsung QE75Q70AATXZT (2021, Tizen 6.0, Chromium ~76), installed by sideloading.
- Vanilla ES6 (no UI library, no TypeScript), SCSS, webpack 5. Production output is a
  Tizen widget with separate JS/CSS files. Development: `npm run dev` in a desktop browser (keyboard as remote, dev proxy for the provider); the TV runs the signed build.
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
- Trailers: the provider's `youtube_trailer`, otherwise the TMDB trailer (`videos`). They play in the app's own player through a YouTube engine (iframe + postMessage); on the TV the player page comes from the `ytresolver` service on localhost:8125 because a `file://` page has no origin YouTube accepts.
- TMDB metadata is stored in the app DB by tmdb id + language (`meta:<type>:<id>:<lang>`, `expiresAt`, index `byExpires`), independent of the provider. A worker downloads it for the whole catalog; requests for visible cards and the open page go first and pause the worker.

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
- Player: title at the top; a full-width progress bar (no frame; Up puts the focus on the pointer, left/right move it by 30 s, OK applies, or pointer drag) and below it one row: back 30 s, play-pause (initial focus), forward 30 s and the time on the left, aspect ratio and subtitles on the right. Subtitles are drawn by the app from AVPlay events; if no event arrives, the player draws them itself.
- Browse sidebar (Movies/Series): Show all, Continue watching, Favorites, Suggestions, Genres (an open group; provider + TMDB merged under one normalised, untranslated key; only those with titles), Categories (expandable group). Counts and genres still being worked out show skeleton placeholders. Detail chips link back to the matching filter. API keys can be typed in Settings; suggestions come from TMDB or Trakt (setting). Fixed entries have an icon (genres and categories do not, and have no empty slot); every entry shows its title count on the right; categories under the toggle use a smaller font.
  Down (or OK on live) puts the D-pad on the buttons, Back leaves that mode first.
- AVPlay is the engine; all player controls are built in HTML. On-screen keyboard is the native IME.
- Settings, Providers and Categories use a centred 1400 px container (`.page-container`) whose content is full width. Settings starts with "Operations in progress" (stop button per operation); the visible-categories chooser opens from an icon on each provider.
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
- Le chiavi TMDB/Trakt non stanno nel repository né nella build: si digitano nelle Impostazioni.
- EPG: XMLTV filtrato per i canali presenti, letto a blocchi in un worker, una volta al giorno dopo il sync del catalogo.
- Suggerimenti: raccomandazioni TMDB dalla cronologia, intersecate per tmdb id con il catalogo.

## Preferiti di categorie e generi, record TMDB leggeri (2026-11-03)
I preferiti possono essere titoli o filtri (`kind` category/genre). Le card dei filtri precedono i titoli e aprono la griglia (`openFilter`). Nel database TMDB resta solo `gridMeta`; i dettagli completi si recuperano con `getFull` e vivono in memoria. I suggerimenti non propongono titoli già visti.
Il cuore dei preferiti sta nella testata sticky della griglia (titolo · pagina · cuore), zona `browseHead`. I registi arrivano dal record completo TMDB (`directors`).

## Notice, orologio, fissati e parental control (2026-11-04)
Le notice usano un solo servizio (`ctx.notices`): a destra, al centro, senza focus (si chiudono da sole, le permanenti con un clic); in riproduzione solo quelle `scope: 'playback'`. L'orologio è nella topbar (non focalizzabile), formati in `settings`. I fissati sono `pins` (kv) e compaiono nella sidebar tra Suggerimenti e Generi. Il PIN parental è salvato con hash salato; un titolo è adulto se una sua categoria ha un nome adulti, e la scheda si apre solo da `ctx.openEntry`, che chiede il PIN.

Canali Live raggruppati: `src/services/liveGrouping.js` (puro) decide i gruppi durante il sync/rebuild; i gruppi sono nello store `groups`, le righe di "Mostra tutto" (`@all`) in `entry_cat`. `getEntry` e `pageEntries` leggono da `groups` per le chiavi `live:g…`. I collegamenti manuali sono nel kv `liveLinks:<provider>`.

## Collezioni

- Una collezione (`src/services/collections.js`, `kv` `collections`) è un insieme con nome di elementi di un provider: film, serie, canali e gruppi Live (si salvano le chiavi `entryKeys`; quelle non più nel catalogo si saltano senza cancellarle).
- I generi non sono salvati: sono l'unione dei generi degli elementi (`entryGenres` legge `entry_genre` e `entry_genre_tmdb` per prefisso di chiave; i canali non ne hanno).
- Preferiti: record `favorites` con chiave `collection:<id>` e tipo `collection` (non compaiono nelle pagine per tipo). Generi fissati: `pins` con tipo `collection`.
- Pagina "Collezioni" (sidebar + griglia) e scheda `collection` (conteggio, generi, Preferiti/Modifica/Elimina, carosello). L'aggiunta parte dalla scheda di un titolo con `dialogs.search` (lo stesso box dell'unione dei canali, con `createLabel` per la riga "crea"); la modifica usa `dialogs.editCollection`.

## Download del catalogo: nuovi tentativi

- Categorie e liste (`syncType`) passano da `loadWithRetries`: se il provider dà un errore (rete, timeout, HTTP, risposta illeggibile) o una lista vuota, si riprova 2 volte con pause crescenti (`retryPolicy.delays`, 3 s e 8 s), mostrando "nuovo tentativo n/2" nella fase `retry`. Dopo l'ultimo tentativo l'errore viene lanciato, la lista vuota accettata se non c'è un catalogo salvato (se c'è, resta il rifiuto "lista vuota": non si cancella nulla). Gli errori non ripetibili (autenticazione, annullamento) non si ritentano; annullare la sync interrompe anche la pausa. Si somma al tentativo unico di `fetchJson` per timeout/5xx.

## Reti Live TV

- Una rete raccoglie i canali e i gruppi che iniziano con la stessa parola (≥ 2 elementi; `networkToken` scarta parole generiche, numeri e parole corte). È calcolata nella stessa sync/rebuild dei gruppi (`buildNetworks` dopo `groupLiveItems`) e salvata nello store `groups` con chiave `live:n<id>` (`isCompositeKey` vale per gruppi e reti); in "Mostra tutto" è elencata per prima (poi i gruppi senza rete, poi i canali senza gruppo né rete; i membri di una rete non si ripetono).
- Algoritmo (`analyzeNetworks`): i nomi si confrontano senza spazi, simboli e accenti, in minuscolo (`Rai 3 +1` → `rai31`). Ordinati, un nome entra nella rete precedente finché l'inizio comune di tutti i nomi (min 3 caratteri) resta almeno il **X%** di ogni nome (`liveNetworkSimilarity`, predefinito 50) e nessun nome supera l'inizio comune di più di **N** caratteri (`liveNetworkMaxDiff`, predefinito 13). Le parole sono lettere e cifre (ogni altro carattere è uno spazio, spazi multipli → uno) e una parola ripetuta subito dopo se stessa vale una volta (`Dazn: Dazn 1` → `Dazn 1`, anche in `channelBase`). Il nome della rete è l'inizio comune, scritto come nei canali con spazi singoli (maiuscolo → titolo, sigle ≤ 3 lettere restano) e portato a fine parola (`amazonprime1`/`…10` → `Amazon Prime`). Si scartano il nome ripetuto (`duplicates`, anche "X" e "X Channel"), quello generico (`generic`: Sport, TV…) e quello che taglia una parola a metà (`partial`: `Vene` per Veneto/Venezia). Valori predefiniti scelti su ~200 nomi dei rapporti reali (griglia soglia 20–100%, differenza 1–30): sotto 50% entrano nomi sbagliati (precisione 0,71 a 20%), sopra 50% si perdono reti (richiamo 0,47 a 60%); oltre 13 caratteri non cambia nulla. Limite noto: marchi con sottomarchi diversi (`Sky Cinema …`, `Sky Sport …`, `Rai Sport`) hanno un inizio comune troppo corto e non si uniscono.
- Il rapporto (reti con prova, nomi scartati, unità fuori) è salvato in `meta` (`networkReport`, scartati ordinati per dimensione, max 150) a ogni sync/rebuild Live e mostrato in Diagnostica.
- Aggiunte a mano: `[streamId, reteId]` in `liveNetworkLinks:<provider>` (`linkNetwork`/`unlinkNetwork`), valide solo per reti esistenti; si tolgono solo quelle. Un'unità (gruppo o canale) appartiene alla rete se uno dei suoi stream è collegato.
- I canali e i gruppi portano `networkKey`. Preferiti = record titolo con la chiave della rete; collezioni = chiave tra gli `entryKeys`. `ctx.openEntry` apre la pagina `network` per le reti.

- Le parole da rimuovere dai nomi (`liveGroupPatterns`) si sommano a quelle predefinite (`resolveTerms`: predefinite + aggiunte), mantengono il maiuscolo/minuscolo scritto e accettano `/regex/`; si applicano ai nomi dei canali singoli (`cleanChannelNames`) e dei gruppi, prima di calcolare reti e gruppi.
- Una rete si può aggiungere ai preferiti (record titolo con la chiave `live:n…`) e fissare nella sidebar Live (`pins` con `kind: 'network'`).

## Immagini delle collezioni e connessione

- La pagina di una collezione ha locandina rettangolare (come film e serie); solo l'entità Rete usa la locandina quadrata.
- `imageRotator.js`: due livelli sovrapposti con dissolvenza; ogni rotatore sceglie a caso (mai la stessa due volte di fila) tra le immagini dei titoli, con precarico. Locandina e sfondo sono rotatori indipendenti, quindi non sono accoppiati. Lo sfondo usa anche i backdrop TMDB dei titoli con `tmdbId` (primi 12) man mano che arrivano.
- Dispositivo: la riga "Connessione internet" usa `navigator.onLine`, `navigator.connection` (tipo, `effectiveType`, `downlink`, `rtt`) e `tizen.systeminfo` `NETWORK` quando presente; i campi di qualità compaiono solo se il browser li fornisce.
- Player: il cambio formato usa le notice standard (`scope: 'playback'`, `key: 'aspect'`) come audio e sottotitoli; rimosso il riquadro `player-flash`.

Vedi anche `docs/MULTIPLATFORM.md`.

## Titoli iniziati e ora di fine

- `STARTED_RATIO = 0.1`: `isStarted` è vero oltre il 10% (esclusivo); `shouldResume` = iniziato e non finito (prima: almeno 30 s). `WatchStore.recent` raggruppa i record per titolo: un film resta se iniziato e non visto; una serie resta se un suo episodio è finito o iniziato.
- "Visto" poi tolto esegue `clearEntry` (nessun record resta), quindi il titolo non è iniziato.
- Player: `endsAtText` = ora attuale + tempo restante; formato `timeFormat` delle impostazioni (come l'orologio). Non mostrato in diretta o con durata ignota.
