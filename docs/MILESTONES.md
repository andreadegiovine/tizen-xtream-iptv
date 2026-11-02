# Milestones

Piano di sviluppo e stato di avanzamento. Le scelte di design stanno in [DESIGN.md](DESIGN.md).

**Convenzione (per ogni sessione di Claude):** ogni volta che una milestone viene elaborata, aggiungere sotto di essa
una sezione *Note di avanzamento* con data, cosa è stato fatto, cosa resta, decisioni prese e tutto ciò che serve a
un'altra sessione per proseguire. Non riportare come verificato ciò che non lo è stato (indicare dove è stato
verificato: sandbox, browser desktop, TV).

Legenda: `[x]` fatto · `[~]` parziale · `[ ]` da fare

## 0. Spike su TV
CORS in dev e build, webapis nel guscio remoto, worker nel widget, AVPlay su uno stream, quota IndexedDB.

Stato: `[~]` parziale

### Note di avanzamento
- **2026-11-02: risultati diagnostica (build di produzione installata come .wgt sulla TV, da foto dell'utente)**
  - Chromium `76.0.3809.146`, Tizen 6.0 (user agent `SMART-TV; LINUX; Tizen 6.0`).
  - `tizen` e `webapis` presenti; AVPlay disponibile; schermo 1920x1080 @1x.
  - Worker da blob: funziona. IndexedDB lettura/scrittura: funziona.
  - Storage: usati 0 MB su 263 MB, `persistent: true`.
  - Provider: autenticazione riuscita, stato `Active`.
  - Non risulta dalla foto (log recente tagliato): esito della riproduzione di uno stream di prova con AVPlay.
- **2026-11-02: bug build dev sulla TV**: con il widget dev-shell gli stili non venivano applicati, rendendo impossibile la navigazione.
  - Osservato: in Chromium desktop (headless) il dev server applicava gli stili correttamente; il problema non era riproducibile fuori dalla TV.
  - Differenza tra dev e prod: in dev il CSS veniva iniettato via JS con `style-loader` (tag `<style>` inline), in prod è un file `css/main.css` collegato con `<link>` (funziona sulla TV).
  - Modifica: `webpack.config.js` usa `MiniCssExtractPlugin` anche in dev, quindi dev e prod servono CSS allo stesso modo. Verificato in sandbox: `<link href="css/main.css">` presente, file servito con 200, stili applicati, nessun tag `<style>`; lint, 78 test e build di produzione passano.
  - **Non verificato sulla TV**: la causa esatta non è confermata, la correzione è basata sull'unica differenza osservata tra dev e prod. Se gli stili mancano ancora, controllare nel guscio remoto la richiesta a `css/main.css` (risposta del dev server, eventuali restrizioni della TV sul contenuto remoto).
  - Nota: `style-loader` è rimasto in `devDependencies` ma non è più usato; si può rimuovere aggiornando `package-lock.json`.
  - Nota: nel dev server l'HTML include `<script src="$WEBAPIS/webapis/webapis.js">` con `--env webapis`; su una pagina remota il percorso `$WEBAPIS/...` viene richiesto al dev server e risponde 404 (visto in Chromium desktop). Se `webapis` risulta assente nel guscio remoto sulla TV, partire da qui.
- **2026-11-02: correzione build dev confermata sulla TV (dall'utente)**: con il CSS come file `<link>` anche in dev, gli stili si applicano e l'app è navigabile nel guscio remoto.
- **2026-11-02: risultati diagnostica build dev (guscio remoto, pagina servita da `http://<ip-pc>:8080`, da foto dell'utente)**
  - `tizen`: assente (`not running inside Tizen`). `webapis`: risulta definito, ma `webapis.avplay` non è disponibile (AVPlay not available). Causa non nota: in sandbox `$WEBAPIS/webapis/webapis.js` risponde 404 dal dev server, quindi non è chiaro da dove arrivi l'oggetto `webapis`.
  - Worker da blob: **fallisce** con `Access to the script at 'blob:http://...' is denied by the document's Content Security Policy`. Nella build di produzione (widget impacchettato) lo stesso test passa.
  - IndexedDB lettura/scrittura: funziona. Provider: autenticato (il proxy di sviluppo funziona), stato `Active`. Schermo 1920x1080 @1x.
  - Storage: `StorageManager not available`. Ipotesi non verificata: `navigator.storage` richiede un contesto sicuro e la pagina è su `http://`. Nella build di produzione funziona.
  - Conseguenza: nel guscio remoto non si possono provare AVPlay né la quota di storage; per quelli serve la build di produzione installata come .wgt.
- **2026-11-02: aggiunto controllo `workerFile` alla Diagnostica** (`src/services/diagnostics.js`, `src/workers/ping.worker.js`): crea un worker da file dello stesso origin con `new Worker(new URL('../workers/ping.worker.js', import.meta.url))`, emesso da webpack come chunk separato. Verificato in sandbox solo che build e dev server emettono il chunk e che lint e test passano; **non provato su TV né eseguito nel browser**.
  - Da fare dall'utente: reinstallare nulla (basta ricaricare il guscio dev), aprire Diagnostica ed eseguire i controlli in dev e in produzione; riportare l'esito di `worker` e `workerFile`.
  - Decisione rimandata alla milestone 2: se in dev `workerFile` funziona, il catalog worker va creato da file (non da blob), perché funziona in entrambi gli ambienti; se fallisce anche quello, la CSP del guscio remoto va aggirata o il worker testato solo in produzione.
  - Ancora aperto: esito dello stream di prova con AVPlay (solo in produzione) e quota IndexedDB con dati reali.
- **2026-11-02 (sessione 3): nuovo controllo `workerIdb`** (`src/workers/ping.worker.js`, `src/services/diagnostics.js`): verifica che IndexedDB sia utilizzabile *dentro* un worker da file, requisito del catalog worker. Verificato solo in Chrome desktop headless (passa); **non provato su TV**.
  - La Diagnostica ora scorre: il log è l'ultimo elemento focalizzabile (Giù porta in fondo) e mostra le ultime 40 righe. Verificato in Chrome headless (la pagina scorre, il log diventa visibile); non sulla TV.
  - Durante la prova AVPlay il sync del catalogo viene messo in pausa e ripreso dopo.

- **2026-11-02 (sera): risultati sulla TV (build di produzione, foto dell'utente)**
  - Diagnostica: tizen/webapis/AVPlay presenti, schermo 1920x1080 @1x, `worker` (blob) ok, **`workerFile` ok**, **`workerIdb` ok** (IndexedDB dentro un worker da file funziona), `indexeddb` ok, provider autenticato (`Active`).
  - **Storage dopo il sync completo: 28 MB usati su 263 MB** (34 MB riportati a voce dall'utente in un secondo momento), `persistent: true`. La quota non è un problema per questo catalogo.
  - Il log della Diagnostica ora è raggiungibile; **AVPlay: lo stream parte** (log di buffering fino a "buffering complete", film riprodotto). Non ancora provato il sync durante la riproduzione (l'utente lo farà in seguito).
  - Chiuso: `workerFile` in dev non era stato riportato; resta da confermare solo in dev se serve.

## 1. Fondamenta
core, InputService, FocusManager, Router, i18n, AppError, impostazioni.

Stato: `[x]` completata secondo la sessione precedente (lint, 78 test e build passano in sandbox; non provata a fondo su TV).

### Note di avanzamento
- Input del telecomando con tastiera desktop per debug in Chrome, focus basato sui dati, router, i18n en-US/it-IT, errori unificati, log che nascondono le credenziali.
- Stack: webpack 5, Babel target Chromium 76, SCSS, ESLint che blocca API troppo nuove, Jest.
- **2026-11-02 (sessione 3): correzioni segnalate dall'utente dopo la prova sulla TV** (verificate in sandbox: lint, 120 test, build; e in Chrome desktop headless da tastiera; **non riprovate sulla TV**):
  - *Back dalla Home*: ora chiede conferma (dialog "Uscire?", focus di default su "Resta"). Regola (`src/ui/backHandler.js`): dialog aperto → lo chiude; pagina con cronologia → indietro; altra sezione → Home senza chiedere; Home o primo avvio → conferma e poi `exitApp()` (su desktop `window.close()`, può essere ignorato).
  - *Pagine non scrollabili*: `.page` scorre (`overflow-y:auto`) e le zone di focus chiamano `ensureVisible()` (`src/ui/scroll.js`, logica pura testata). Applicato a Impostazioni, setup provider, Diagnostica.
  - *Topbar*: la voce "attiva" era derivata dalla rotta, quindi tutte le sezioni segnaposto risultavano attive insieme. Ora ogni voce è una *sezione* (`params.section`, `sectionForEntry()`); il cursore della barra si posiziona sulla sezione corrente e cambiando sezione il focus **resta sulla barra** (Giù entra nella pagina, Su torna alla barra).
  - `FocusManager.unregister()` elimina anche i collegamenti in ingresso alla zona rimossa. Nuovo `src/ui/components/dialog.js` (riusabile).
  - Bug trovato col test in browser: Invio in un campo di testo (setup provider, URL Diagnostica) arrivava anche all'`InputService` e attivava subito il campo successivo; ora i campi fermano la propagazione. Sulla TV il tasto "Fatto" dell'IME non era noto come affetto; **non verificato su TV**.
  - **Esito sulla TV (utente, 2026-11-02): Back dalla Home, Back dalle altre sezioni e topbar funzionano.** Nota dell'utente: premendo Giù dalla topbar si entra nella pagina *attiva* e non in quella selezionata col cursore; è il comportamento voluto.
  - `ProviderStore`: `createdAt` strettamente crescente (test instabile per timestamp uguali).

## 2. Provider e catalogo
XtreamClient, setup provider, DB, catalog worker, normalizer e grouping, sync progressivo.

Stato: `[~]` catalog worker e sync progressivo fatti e testati in sandbox/Chrome desktop; **nessuna verifica su TV**.

### Note di avanzamento
- Fatti (secondo la sessione precedente): database IndexedDB come da schema, `XtreamClient`, normalizzazione titoli, raggruppamento per tmdb, gestione provider e impostazioni, schermata di setup provider.
- **2026-11-02 (sessione 3): sync del catalogo**
  - `src/services/catalogSync.js` (senza DOM): `syncType` (categorie → download → proiezione → scrittura `items` a lotti da 2000 → `entries`/`entry_cat` → pulizia righe sparite → `meta` con conteggi e tempi), `runSync` (ordine film → serie → live; un tipo che fallisce non ferma gli altri; TTL 12 h, `force`), `runSyncForProvider` (emette sempre `done`), `rebuildEntries` (ricostruisce dalle `items` salvate quando cambiano le categorie escluse, senza scaricare).
  - Scrive prima le righe nuove e poi cancella le vecchie; una lista vuota non sostituisce un catalogo esistente.
  - Worker `src/workers/catalog.worker.js` (involucro con annulla/pausa/riprendi), creato da file (`createCatalogWorker.js`, separato per Jest). `CatalogSyncService`: preferisce il worker; se non parte o non segnala `ready` entro 4 s esegue **lo stesso codice sul thread principale** (può bloccare la UI). `pause()/resume()` per la riproduzione, `cancel()`, `readStatus()`.
  - Avvio all'apertura dell'app (se la lista ha più di 12 h) e dopo l'aggiunta di un provider (forzato). Lo stato per film/serie/live (avanzamento e ultimo risultato), il motore usato, i tempi (download/elementi/titoli) e il pulsante "Aggiorna il catalogo ora" stanno nella pagina **Provider** (vedi sotto).
  - Schema provider **v2**: `items` senza indici (un tipo = intervallo di chiavi primarie `movie:`…`movie:\uffff`), `entries` senza indice tmdb (chiave `type:t<tmdbId>`). Il DB provider è dato derivato: al cambio versione viene ricreato e ripopolato.
  - `XtreamClient.getCategories/getStreams` accettano `signal`; timeout cataloghi 120 s.
  - **Verifica in Chrome headless** con server Xtream finto (30.000 film, 3.000 serie, 2.000 canali): sync nel worker riuscito; con `Worker` bloccato il fallback riesce con gli stessi risultati. Tempi desktop (non rappresentano la TV): download ~0,1 s, scrittura film ~9,3 s (elementi 2,8 s + titoli 6,5 s), totale ~12 s. Il costo è dominato da IndexedDB per riga, non dal calcolo delle entries.
  - **Ottimizzazione rimandata** (decidere dopo i numeri della TV): su refresh non riscrivere le righe invariate (firma) e/o alleggerire le righe di `entries`.
  - **Esito sulla TV (utente, 2026-11-02, build di produzione, provider reale):** il sync gira con l'interfaccia fluida (dettagli dalle foto della Home); l'aggiornamento forzato funziona bene; chiudendo e riaprendo l'app il catalogo resta in memoria. Storage 28–34 MB su 263 MB. Il motore usato (worker/thread principale) e i tempi sono visibili nelle foto della Home dell'utente, non riportati in chat: chiedere se servono per decidere l'ottimizzazione delle scritture.
  - **2026-11-02 (sera): pagina Provider** (richiesta dell'utente: la sezione "Provider" mostrava solo il modulo di aggiunta). Ora `src/ui/pages/providersPage.js` mostra l'elenco dei provider (nome, host, utente; barra colorata sull'attivo) con per ciascuno i pulsanti *Usa* / *Modifica* / *Rimuovi* e in fondo *Aggiungi un provider*; navigazione a griglia 3 colonne. *Usa* imposta il provider attivo e fa partire il sync (annulla quello in corso; salta se la lista ha meno di 12 h). *Rimuovi* chiede conferma, cancella provider e relativo DB; se era l'attivo passa al primo rimasto, e se non ne restano torna al primo avvio. *Modifica* riusa `providerSetupPage` con `params.providerId` (campi precompilati; verifica le credenziali prima di salvare; se cambiano URL/utente/password del provider attivo, forza un nuovo sync). Il modulo di aggiunta dal primo avvio porta alla Home, quello da questa pagina torna all'elenco. Il dialog di conferma è in `ctx.dialogs`.
    Verificato in sandbox (125 test, lint, build) e in Chrome desktop headless con server Xtream finto: aggiunta di un secondo provider, passaggio dell'attivo, modifica con campi precompilati, rimozione con conferma. **Non ancora provato sulla TV.** Da decidere con l'utente: gestione di più provider con cataloghi diversi sulla Home (per ora la Home mostra solo l'attivo).
  - **2026-11-02 (sera, patch 2): dettagli di sync e aggiornamento manuale spostati nella pagina Provider** (scelta dell'utente). Il componente `src/ui/components/syncPanel.js` (testo per tipo, motore, tempi, pulsante; `describeType` ora è qui) è mostrato in cima alla pagina Provider per il provider attivo e si aggiorna quando cambia l'attivo. Focus: topbar → pulsante di aggiornamento → elenco provider (la pagina si apre comunque sull'elenco). La **Home** ora mostra solo il provider attivo e "N titoli" per tipo (o "Non ancora sincronizzato") con un rimando alla sezione Provider; non ha più zone di focus (il focus resta sulla topbar).
  - Mancano: lettura di `entries` da parte delle griglie (milestone 3), UI per le categorie escluse (milestone 7; logica `rebuildEntries` testata), cambio provider a runtime.
- Il dev server ha un proxy same-origin `/__proxy?u=<url>` per le chiamate al provider (solo sviluppo).

## 3. Navigazione
topbar, griglie, pannello categorie, paginazione, ricerca.

Stato: `[x]` fatta in sandbox e Chrome desktop (topbar, griglie, categorie, paginazione, ricerca); **non provata su TV**.

### Note di avanzamento
- Fatta la topbar in stile Netflix; le altre sezioni sono segnaposto "In arrivo".
- 2026-11-02: la topbar ora distingue le sezioni e il dialog di uscita esiste (vedi note della milestone 1).
- **2026-11-02 (sera, patch 2): griglie, pannello categorie e paginazione fatti** (Film, Serie, Live usano la stessa pagina `browsePage.js` con `params.type`).
  - `src/services/catalogQuery.js`: `listCategories(db, type)` (ordine alfabetico) e `pageEntries(db, {type, categoryId, offset, limit})`: cursore all'indietro sugli indici `byTypeAdded` (tutti) o `byCatAdded` (una categoria, con join su `entries`); legge `limit + 1` righe per sapere se esiste un'altra pagina senza contare nulla. Più recenti per primi.
  - UI: a sinistra "Tutti" + categorie (Invio seleziona, la voce corrente ha la barra colorata); a destra una griglia **paginata** (poi resa configurabile: 6 colonne per locandine, 4 per i canali, 12/24/36 titoli per pagina dalle impostazioni; DOM sempre limitato anche con 30.000 titoli). Giù dall'ultima riga → pagina successiva, Su dalla prima riga → precedente (stessa colonna), altrimenti si esce verso la topbar; Sinistra dalla prima colonna → categorie. Card: locandina dall'icona del provider (se manca o non carica resta il riquadro), titolo normalizzato e anno. Invio su una card mostra per ora "In arrivo" (scheda dettaglio = milestone 4).
  - Verificato in sandbox (135 test, lint, build) e in Chrome desktop headless con il server finto (30.000 film): cambio pagina avanti/indietro, selezione categoria, pannello Provider, aggiornamento forzato. **Non provato sulla TV** (vedi milestone 11).
  - **2026-11-02 (notte, patch 3): ricerca fatta.** `searchIndex.js` tiene in memoria una riga leggera per titolo (nome + chiavi normalizzate di tutti i membri del gruppo, quindi si trova anche con titoli alternativi) e non tocca IndexedDB durante la digitazione; si ricostruisce dopo ogni sync. Tutte le parole devono comparire; ordine: titolo identico, inizia con, inizio parola, contiene; a parità i più recenti. `searchPage.js`: campo con tastiera a schermo (Fatto avvia subito la ricerca, in ogni caso parte dopo 300 ms dall'ultimo tasto), griglia di risultati misti film/serie/canali con etichetta del tipo; Invio apre la scheda.
  - Mancano: conteggi per categoria, ricordare categoria/pagina al ritorno dalla scheda, ricarica della griglia quando il sync finisce mentre è aperta.

## 4. Scheda e player
dropdown stream, AVPlay con controlli, watch state, ripresa.

Stato: `[x]` fatta in sandbox e Chrome desktop con un <video> al posto di AVPlay; **su TV è provato solo l'avvio di uno stream dalla Diagnostica (vecchio wrapper), non il nuovo player**.

### Note di avanzamento
- **2026-11-02 (notte, patch 3)**
  - `detailPage.js` (film, serie, canale): locandina, titolo, anno, voto, genere, trama (dal provider con `get_vod_info`/`get_series_info`, in cache 24 h nel DB provider, e sopra dai dati TMDB), pulsanti *Riproduci* / *Riprendi · mm:ss* / *Ricomincia*, **menu a tendina degli stream** (`dialogs.choose`, elenco degli stream id del gruppo; di default il più basso) per i film con più versioni; per le serie selettore stagione ed elenco episodi con ✓ per i visti e tempo di ripresa; per i canali il palinsesto delle prossime 24 h.
  - Player (`playerPage.js` + `playerController.js` + `playerEngines.js`): motore AVPlay sulla TV e `<video>` nei browser desktop, stessa interfaccia; tutti i controlli sono HTML sopra il video (titolo, barra, tempo, stato Pausa/Buffering/Errore) e spariscono dopo 4 s. Tasti: OK/Play/Pausa, ←/→ ±10 s, ◀◀/▶▶ ±30 s, CH+/CH− = canale successivo/precedente (live, anche Su/Giù) o episodio successivo/precedente (serie), Stop/Indietro = esci. Il player riceve i tasti prima del gestore del focus (`page.onAction` in `main.js`); Back resta al gestore globale.
  - Formato dei canali: HLS se consentito (altrimenti TS) dalla risposta di autenticazione, che il player ottiene solo per i canali.
  - Stato di visione (`watchStore.js`, DB app, store `watch`): posizione salvata ogni 10 s e all'uscita; visto oltre il 90 %; ripresa solo se oltre 30 s e non finito. La chiave è `movie:t<tmdb>` (condivisa tra provider, sopravvive all'eliminazione del provider) oppure `<provider>:movie:i<id>`; per le serie un record per episodio (`…|s1e2`). Le letture aspettano i salvataggi ancora in corso (bug trovato in test: tornando dal player la scheda non mostrava "Riprendi").
  - Episodio successivo: a fine episodio conto alla rovescia di 10 s (OK = subito, Indietro = esci), disattivabile in Impostazioni.
  - Durante la riproduzione il sync del catalogo è in pausa e riprende all'uscita.
  - `activeProvider.js`: handle condiviso sul DB e sul client del provider attivo (autenticazione pigra); `release()` prima di eliminare un provider.
  - Verificato in Chrome (mp4 di prova, server finto): ricerca → scheda → player → seek → pausa → uscita → "Riprendi · 0:43"; serie → episodio → fine → conto alla rovescia → episodio 2 → l'elenco mostra la progressione; canale: CH± funziona.
  - **Non verificato su TV**: AVPlay nel nuovo player (seek, `getCurrentTime`/`getDuration`, buffering, comportamento dei tasti media del telecomando, formati mkv/ts reali), trasparenza della pagina sopra il video.

## 5. TMDB
matcher, metadata, titoli card, conteggi serie.

Stato: `[x]` fatta e testata con risposte finte; **la chiave TMDB non c'era, quindi mai provata contro TMDB reale**.

### Note di avanzamento
- **2026-11-02 (notte, patch 3)**
  - `tmdbClient.js`: chiave **inserita in fase di build** (`TMDB_API_KEY`, vedi README); senza chiave tutto resta spento senza errori. `tmdbService.js`: cache persistente nel DB app (store `tmdb`) per lingua dell'interfaccia (30 giorni; "non trovato" 7 giorni; in caso di errore di rete vale la cache scaduta), coda con 3 richieste in parallelo che si svuota a ogni cambio pagina.
  - Titoli delle card: titolo TMDB e locandina quando disponibili (solo per i titoli con tmdb id del provider; carica a mano a mano), per le serie anche "N stagioni · M ep." (dai dati TMDB, nessuna chiamata al provider). Il voto resta quello del provider.
  - Abbinamento senza tmdb id (solo nella scheda, mai nelle griglie): ricerca per titolo, accettata solo se **un solo** risultato ha titolo identico (o titolo originale) e, se noto, lo stesso anno; altrimenti nessun metadato. Il risultato non unisce mai i gruppi (decisione di design).
  - Scheda: i dati TMDB sovrascrivono quelli del provider ma non li svuotano mai.
worker, indice, card e scheda canale.

Stato: `[x]` fatta e provata in Chrome con un XMLTV finto; **non provata su TV né con una guida reale** (dimensioni, codifica, fusi orari dei vari provider).

### Note di avanzamento
- **2026-11-02 (notte, patch 3)**
  - `xmltv.js`: lettore incrementale (a blocchi di testo, memoria costante), orari con fuso (`+0100`), entità XML; tiene solo i programmi che finiscono dopo adesso e iniziano entro 48 h, e solo dei canali presenti nell'elenco live (`epgChannelId`).
  - `epgSync.js` + `epg.worker.js` (+ `epgService.js` con fallback sul thread principale come per il catalogo): scarica `xmltv.php`, scrive nello store `epg` del DB provider, poi cancella i programmi finiti; una guida vuota o non valida **non** cancella quella esistente. Al massimo una volta al giorno: parte dopo la fine di ogni sync del catalogo se l'ultima guida ha più di 24 h.
  - UI: sulle card dei canali la riga "adesso in onda"; nel player il titolo in onda; nella scheda del canale le prossime 24 h.
  - In Chrome con il server finto: 2.940 programmi per i canali presenti, scheda canale e player mostrano il palinsesto.
  - Da decidere dopo la prova reale: guide molto grandi (decine di MB) sulla TV, canali con fusi sbagliati, guida per-canale (`get_short_epg`) come ripiego (il client ha già `getShortEpg`).

## 7. Home e impostazioni complete
caroselli, continua a guardare.

Stato: `[x]` fatta in sandbox e Chrome; non su TV.

### Note di avanzamento
- **2026-11-02 (notte, patch 3)**
  - Home: caroselli *Continua a guardare* (con barra di avanzamento ed etichetta S1E2), *Ultimi film*, *Ultime serie*; ogni riga ha la sua zona di focus e scorre in orizzontale; si ricostruiscono a fine sync. Sotto, il riepilogo del catalogo.
  - Impostazioni: lingua, titoli per pagina (12/24/36), titoli per carosello (10/15/20/30), buffering (2/5/10/20/30 s), episodio successivo automatico, categorie visibili, stato TMDB, Trakt, Diagnostica. Le scelte da elenco usano il dialog `choose`.
  - Categorie visibili (`categoriesPage.js`): per tipo si nascondono/mostrano le categorie; *Applica* salva e ricostruisce `entries` dagli `items` già scaricati (senza nuovo download; rifiutato mentre il catalogo si sta aggiornando).

## 8. Suggerimenti
Stato: `[x]` fatta e testata con risposte finte; senza chiave TMDB mostra un messaggio.

### Note di avanzamento
- **2026-11-02 (notte, patch 3)** `suggestions.js`: raccomandazioni TMDB per gli ultimi 6 titoli guardati (con tmdb id), unite e ordinate per numero di titoli di partenza che le raccomandano e per popolarità, tenute solo se il catalogo del provider ha lo stesso tmdb id (`entries.get('movie:t<id>')`) e non già guardate; se meno di 12, completate con i titoli di tendenza. Cache 24 h. Pagina `suggestionsPage.js` (griglia, Invio apre la scheda).

## 9. Trakt (fase 2)
Stato: `[x]` codice e test con risposte finte; **mai provato contro Trakt reale** (servono `TRAKT_CLIENT_ID` e `TRAKT_CLIENT_SECRET` in fase di build).

### Note di avanzamento
- **2026-11-02 (notte, patch 3)** Dietro l'adattatore dello stato di visione (`createWatchState` in `traktService.js`: stessa interfaccia di `WatchStore`, le pagine non sanno se Trakt è collegato). Accesso con codice dispositivo (Impostazioni → Trakt: la TV mostra indirizzo e codice, il sondaggio rispetta intervallo e "rallenta"); token nel DB app con rinnovo. Al passaggio a "visto" di un titolo con tmdb id viene inviata la cronologia (film, o episodio per le serie); se fallisce con errore del server resta in coda e riparte all'avvio. Dopo il collegamento importa gli ultimi film visti su Trakt come cronologia locale (aiuta i suggerimenti), senza sovrascrivere i progressi locali. Non importa le serie e non sincronizza le posizioni di riproduzione.

## 10. Rifinitura
profiling su TV, memory leak, percorsi di errore.

Stato: `[~]` solo la parte fattibile senza TV.

### Note di avanzamento
- **2026-11-02 (notte, patch 3)** Gestione globale di `unhandledrejection`/`error` nel log (credenziali mascherate); ogni pagina libera le sue zone di focus e i timer in `destroy()`; le liste lunghe sono paginate o limitate (griglie 12–36 card, carosello ≤ 30, ricerca ≤ 36 risultati). Restano da fare con la TV: profiling reale (memoria con più pagine, scorrimento), prove di errore (rete assente durante il sync, provider scaduto durante la riproduzione, stream non riproducibile).

## 11. Fase finale di test su TV
Decisione dell'utente (2026-11-02): le prove sulla TV rimandate si fanno tutte alla fine, con la build di produzione (.wgt). Riportare l'esito di ognuna.

Stato: `[ ]` da fare

### Test in sospeso
Eseguiti con esito positivo dall'utente il 2026-11-02 (non ripeterli): diagnostica completa (`workerFile`, `workerIdb`, storage, provider), sync del catalogo con provider reale e UI fluida, aggiornamento forzato, catalogo persistente dopo la chiusura, avvio di uno stream con AVPlay, Back dalla Home e dalle altre sezioni, topbar.

Da fare:
1. **Player (priorità)**: da Film, Serie e Canale avviare un titolo reale: parte video e audio? OK = pausa/riprendi, ←/→ salto di 10 s, ◀◀/▶▶ 30 s, i tasti media del telecomando funzionano? la barra e il tempo sono corretti? Quanto impiega a partire? Con file `.mkv` e stream `.m3u8`/`.ts`: dire quali non partono e il messaggio di errore.
2. **Ripresa e visti**: uscire a metà di un film, rientrare dalla scheda: "Riprendi · mm:ss" riparte dal punto giusto? Compare in *Continua a guardare*? Dopo il 90 % non più. Serie: ✓ sugli episodi visti.
3. **Serie**: stagioni, episodio successivo automatico dopo 10 s (OK = subito, Indietro = ferma), CH+/CH− cambiano episodio.
4. **Canali**: CH+/CH− e Su/Giù cambiano canale; formato scelto (HLS/TS); palinsesto (richiede un provider con `xmltv.php`): "adesso in onda" sulle card, prossime 24 h nella scheda, e se il download della guida è lento o blocca l'interfaccia (motore usato).
5. **Sync e riproduzione**: durante un sync avviare un titolo e uscire: il sync riprende?
6. **Ricerca**: scrivere con la tastiera a schermo ("Fatto" avvia la ricerca), risultati, apertura della scheda.
7. **Pagina Provider**: con due provider, *Usa*, *Modifica* (campi precompilati), *Rimuovi* con conferma, Back; frecce tra pulsanti, "Aggiorna il catalogo ora" e "Aggiungi".
8. **Tastiera a schermo nei moduli**: "Fatto" passa al campo successivo senza attivarlo subito.
9. **Griglie, Home, Impostazioni**: pannello categorie, cambio pagina, scorrimento fluido; caroselli della Home; cambiare *Titoli per pagina* e *per carosello*; nascondere una categoria in *Categorie visibili* e applicare (tempo di ricostruzione).
10. **TMDB** (solo se la build ha la chiave): titoli e locandine che si aggiornano, trama in lingua, conteggi stagioni; pagina *Suggerimenti*.
11. **Trakt** (solo se la build ha le chiavi): collegamento con il codice, un titolo visto a fine riproduzione compare su Trakt, scollegamento.
12. **Tempi con il provider reale**: motore e tempi di sync (download/elementi/titoli) mostrati nella pagina Provider, per decidere se ottimizzare le scritture.

## Questioni aperte
- Package id `XtrmIptv01` e app id `XtrmIptv01.XtreamIPTV` sono una proposta, da confermare prima di creare il profilo del certificato.
- I privilegi in `tizen/config.xml` non sono verificati sulla TV.
- Nessuna licenza scelta.
- L'asset della release non è firmato (serve il certificato Samsung locale).
- `style-loader` è ancora in `devDependencies` ma non usato.
- La chiave TMDB e le credenziali Trakt non sono nel repository: vanno aggiunte come secret `TMDB_API_KEY`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` della repo (la release le compila nell'app) e, per lo sviluppo, come variabili d'ambiente prima di `npm start`.
- Una chiave compilata nell'app è estraibile da chi ha il .wgt: usare chiavi dedicate, revocabili.
- I formati (mkv/ts) dipendono dal decoder della TV: fa fede la prova sul campo.
