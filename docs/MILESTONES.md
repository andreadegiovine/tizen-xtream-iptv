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
  - Avvio all'apertura dell'app (se la lista ha più di 12 h) e dopo l'aggiunta di un provider (forzato). La Home mostra per film/serie/live avanzamento e ultimo risultato, motore usato, tempi (download/elementi/titoli) e il pulsante "Aggiorna il catalogo ora".
  - Schema provider **v2**: `items` senza indici (un tipo = intervallo di chiavi primarie `movie:`…`movie:\uffff`), `entries` senza indice tmdb (chiave `type:t<tmdbId>`). Il DB provider è dato derivato: al cambio versione viene ricreato e ripopolato.
  - `XtreamClient.getCategories/getStreams` accettano `signal`; timeout cataloghi 120 s.
  - **Verifica in Chrome headless** con server Xtream finto (30.000 film, 3.000 serie, 2.000 canali): sync nel worker riuscito; con `Worker` bloccato il fallback riesce con gli stessi risultati. Tempi desktop (non rappresentano la TV): download ~0,1 s, scrittura film ~9,3 s (elementi 2,8 s + titoli 6,5 s), totale ~12 s. Il costo è dominato da IndexedDB per riga, non dal calcolo delle entries.
  - **Ottimizzazione rimandata** (decidere dopo i numeri della TV): su refresh non riscrivere le righe invariate (firma) e/o alleggerire le righe di `entries`.
  - **Esito sulla TV (utente, 2026-11-02, build di produzione, provider reale):** il sync gira con l'interfaccia fluida (dettagli dalle foto della Home); l'aggiornamento forzato funziona bene; chiudendo e riaprendo l'app il catalogo resta in memoria. Storage 28–34 MB su 263 MB. Il motore usato (worker/thread principale) e i tempi sono visibili nelle foto della Home dell'utente, non riportati in chat: chiedere se servono per decidere l'ottimizzazione delle scritture.
  - **2026-11-02 (sera): pagina Provider** (richiesta dell'utente: la sezione "Provider" mostrava solo il modulo di aggiunta). Ora `src/ui/pages/providersPage.js` mostra l'elenco dei provider (nome, host, utente; barra colorata sull'attivo) con per ciascuno i pulsanti *Usa* / *Modifica* / *Rimuovi* e in fondo *Aggiungi un provider*; navigazione a griglia 3 colonne. *Usa* imposta il provider attivo e fa partire il sync (annulla quello in corso; salta se la lista ha meno di 12 h). *Rimuovi* chiede conferma, cancella provider e relativo DB; se era l'attivo passa al primo rimasto, e se non ne restano torna al primo avvio. *Modifica* riusa `providerSetupPage` con `params.providerId` (campi precompilati; verifica le credenziali prima di salvare; se cambiano URL/utente/password del provider attivo, forza un nuovo sync). Il modulo di aggiunta dal primo avvio porta alla Home, quello da questa pagina torna all'elenco. Il dialog di conferma è in `ctx.dialogs`.
    Verificato in sandbox (125 test, lint, build) e in Chrome desktop headless con server Xtream finto: aggiunta di un secondo provider, passaggio dell'attivo, modifica con campi precompilati, rimozione con conferma. **Non ancora provato sulla TV.** Da decidere con l'utente: gestione di più provider con cataloghi diversi sulla Home (per ora la Home mostra solo l'attivo).
  - Mancano: lettura di `entries` da parte delle griglie (milestone 3), UI per le categorie escluse (milestone 7; logica `rebuildEntries` testata), cambio provider a runtime.
- Il dev server ha un proxy same-origin `/__proxy?u=<url>` per le chiamate al provider (solo sviluppo).

## 3. Navigazione
topbar, griglie, pannello categorie, paginazione, ricerca.

Stato: `[~]` parziale

### Note di avanzamento
- Fatta la topbar in stile Netflix; le altre sezioni sono segnaposto "In arrivo".
- 2026-11-02: la topbar ora distingue le sezioni e il dialog di uscita esiste (vedi note della milestone 1).
- Mancano: griglie, pannello categorie, paginazione, ricerca.

## 4. Scheda e player
dropdown stream, AVPlay con controlli, watch state, ripresa.

Stato: `[ ]` da fare (esiste solo un wrapper AVPlay minimo, `src/services/avplaySpike.js`, usato dalla pagina Diagnostica).

## 5. TMDB
matcher, metadata, titoli card, conteggi serie.

Stato: `[ ]` da fare

## 6. EPG
worker, indice, card e scheda canale.

Stato: `[ ]` da fare

## 7. Home e impostazioni complete
caroselli, continua a guardare.

Stato: `[~]` parziale (impostazioni con cambio lingua presenti; la Home mostra per ora solo lo stato del sync del catalogo, senza caroselli).

## 8. Suggerimenti
Stato: `[ ]` da fare

## 9. Trakt (fase 2)
Stato: `[ ]` da fare

## 10. Rifinitura
profiling su TV, memory leak, percorsi di errore.

Stato: `[ ]` da fare

## Questioni aperte
- Package id `XtrmIptv01` e app id `XtrmIptv01.XtreamIPTV` sono una proposta, da confermare prima di creare il profilo del certificato.
- I privilegi in `tizen/config.xml` non sono verificati sulla TV.
- Nessuna licenza scelta.
- L'asset della release non è firmato (serve il certificato Samsung locale).
- `style-loader` è ancora in `devDependencies` ma non usato.

## Test da fare sulla TV (risultati richiesti)
I punti 1–8 sono stati eseguiti dall'utente il 2026-11-02 (esito positivo, vedi note); restano aperti il 5 (sync dopo Stop durante la riproduzione) e i nuovi 9–10.
Con la **build di produzione** (.wgt), salvo dove indicato "dev". Riportare l'esito di ognuno.

1. **Diagnostica, prod e dev**: righe `worker`, `workerFile`, **`workerIdb`** (nuova), `indexeddb`, `storage`, `provider`. In dev il log si raggiunge scorrendo con Giù?
2. **Sync con il provider reale (prod)**: lasciare finire il sync; dalla Home riportare *Motore* (worker o thread principale), riga tempi (download/elementi/titoli), conteggi film/serie/live e tempo reale totale. L'interfaccia resta fluida durante il sync? Se si blocca o si chiude, a quale fase?
3. **Aggiornamento forzato** ("Aggiorna il catalogo ora") a dati presenti: tempo totale, Home usabile? Poi chiudere e riaprire: il catalogo è ancora presente?
4. **Storage** dopo il sync: riga `storage` della Diagnostica (usati/quota). Dopo un riavvio della TV i dati ci sono ancora?
5. **AVPlay**: in Diagnostica stream di un film (.mkv/.mp4) e di un canale (.m3u8) → log, video e audio ok? Con sync in corso, dopo Stop il sync riprende?
6. **Back dalla Home**: dialog con focus su "Resta"; "Resta" chiude il dialog, "Esci" chiude l'app; Back con dialog aperto lo chiude.
7. **Back da altre sezioni**: da Impostazioni torna alla Home senza chiedere; da Diagnostica a Impostazioni.
8. **Topbar**: cambiando sezione il focus resta sulla barra, una sola voce è attiva; Giù entra nella pagina, Su torna alla voce corrente.
9. **Pagina Provider (nuova)**: la sezione Provider mostra l'elenco; con 2 provider, *Usa* sul non attivo lo rende attivo (la Home cambia nome provider e avvia il sync); *Modifica* mostra i campi precompilati e salva dopo la verifica; *Rimuovi* chiede conferma; Back dal modulo torna all'elenco; le frecce si muovono bene tra i tre pulsanti e *Aggiungi*.
10. **Setup provider con IME**: "Fatto" sulla tastiera a schermo passa al campo successivo senza attivare subito anche quello.
