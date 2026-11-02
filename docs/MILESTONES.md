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

## 1. Fondamenta
core, InputService, FocusManager, Router, i18n, AppError, impostazioni.

Stato: `[x]` completata secondo la sessione precedente (lint, 78 test e build passano in sandbox; non provata a fondo su TV).

### Note di avanzamento
- Input del telecomando con tastiera desktop per debug in Chrome, focus basato sui dati, router, i18n en-US/it-IT, errori unificati, log che nascondono le credenziali.
- Stack: webpack 5, Babel target Chromium 76, SCSS, ESLint che blocca API troppo nuove, Jest.

## 2. Provider e catalogo
XtreamClient, setup provider, DB, catalog worker, normalizer e grouping, sync progressivo.

Stato: `[~]` parziale

### Note di avanzamento
- Fatti (secondo la sessione precedente): database IndexedDB come da schema, `XtreamClient`, normalizzazione titoli, raggruppamento per tmdb, gestione provider e impostazioni, schermata di setup provider.
- Mancano: catalog worker e sync progressivo del catalogo in worker.
- Il dev server ha un proxy same-origin `/__proxy?u=<url>` per le chiamate al provider (solo sviluppo).

## 3. Navigazione
topbar, griglie, pannello categorie, paginazione, ricerca.

Stato: `[~]` parziale

### Note di avanzamento
- Fatta la topbar in stile Netflix; le altre sezioni sono segnaposto "In arrivo".
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

Stato: `[~]` parziale (impostazioni con cambio lingua presenti; home solo segnaposto).

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
