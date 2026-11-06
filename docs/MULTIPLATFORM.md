# Multi-piattaforma: analisi, decisioni e piano

Stato: **struttura per piattaforme fatta (patch 104), solo Tizen implementato.** Le prove su TV delle altre piattaforme non sono state fatte;
i punti segnati "da verificare" sono ipotesi.

## Principi

- **Logica e core unici.** Pagine, focus, database, sync, worker, EPG, player controller sono gli stessi per tutte le piattaforme
  (`src/`). Non c'è codice touch.
- **Tutto ciò che riguarda una piattaforma sta in `platforms/<nome>/`**: adattatore JS, manifest, icone, certificati, plugin nativi,
  script di pacchetto.
- **Release GitHub → un pacchetto per piattaforma**: `.github/workflows/release.yml` ha un job `verify` (tag, lint, test) e un job per
  piattaforma che fa build, firma e allega il pacchetto alla release.
- **iOS escluso** per ora.
- **Android solo per TV**: Fire TV (prima) e Android TV, telecomando e D-pad, niente touch.

## Decisioni prese

| Tema | Decisione |
| --- | --- |
| Contenitore Android | **Capacitor** |
| Player Android | **ExoPlayer (Media3) nativo**, pilotato da JS come AVPlay: video sotto, controlli HTML sopra |
| Distribuzione Android | **solo APK** allegato alla release GitHub (niente store) |
| Ordine | **webOS prima di Android** |
| Certificati | restano versionati in `platforms/<nome>/`; senza password non sono utilizzabili e le password sono nei secret GitHub |
| Trailer | solo Tizen ha un plugin (servizio locale); le altre piattaforme aprono l'app YouTube |
| APK | per ora uno solo, per Fire TV; se servirà, due (Android TV e Fire TV) con due flavor Gradle dello stesso progetto |

## Struttura (fatta)

```
src/platform/contract.js     il contratto di un adattatore, i valori di default (browser), la verifica usata dai test
src/platform/index.js        l'adattatore della build (`import adapter from '@platform'`)
platforms/tizen/
  platform.js                adattatore Tizen
  avplayEngine.js            motore video AVPlay
  avplaySpike.js             laboratorio player della pagina Diagnostica
  youtubeEngine.js           trailer (iframe servito dal servizio locale)
  keys.js                    tasti Samsung (10009, 10252, 427/428) e registrazione dei tasti media
  systemInfo.js              tizen.systeminfo (pannello, RAM, rete)
  config.xml, icon.png       manifest e icona
  youtube/                   pagina del player YouTube e servizio sulla TV
  tizencert.p12              certificato di firma (password nel secret TIZEN_CERT_PASSWORD)
  build.js                   cosa webpack copia accanto all'app e opzioni della pagina (webapis.js)
  package.sh                 firma il .wgt (Tizen Studio CLI), usato dal job `tizen` della release
```

- La build sceglie la piattaforma con `--env platform=<nome>` (default `tizen`): `npm run build:tizen`; `npm run build` e
  `npm run dev` usano Tizen. Webpack risolve `@platform` in `platforms/<nome>/platform.js` e aggiunge i file di `build.js`.
  Nei test Jest `@platform` è l'adattatore Tizen.
- `dist/` per Tizen è identico a prima della riorganizzazione (stessi file, stesso `config.xml`, stesso servizio).
- Un test di contratto (`test/platforms/contract.test.js`) controlla che ogni `platforms/*/platform.js` rispetti il contratto.

### Contratto dell'adattatore (`src/platform/contract.js`)

Tutte le voci sono facoltative: quelle mancanti prendono il comportamento di un browser.

| Voce | Cosa fa | Tizen |
| --- | --- | --- |
| `keyCodes` | tasti del telecomando aggiunti a quelli comuni (frecce, OK, 415/19/413/417/412, Esc/Backspace, PagSu/PagGiù) | 10009 Indietro, 10252 Play/Pausa, 427/428 canali |
| `registerKeys()` | chiede alla piattaforma i tasti media | `tvinputdevice.registerKey` |
| `exit()` | chiude l'app | `tizen.application…exit()` |
| `createEngine()` | motore video (stesso contratto di `createHtml5Engine`) | AVPlay, `<video>` nel browser |
| `createTrailerEngine()` | motore che riproduce `youtube:<id>` nell'app, o null (si apre YouTube) | iframe + servizio `localhost:8125` |
| `createDiagnosticPlayer()` | laboratorio player della Diagnostica | `avplaySpike` |
| `runtimeChecks()` | righe in più dei controlli della Diagnostica | tizen, webapis, AVPlay |
| `display / memory / networkType` | dati di sistema per la tabella Dispositivo | `tizen.systeminfo` |

## Release (fatta, solo Tizen)

- `verify`: valida il tag (`v1.2.3`), `npm ci`, lint, test.
- `tizen`: versione nel `package.json`, `npm run build:tizen`, `platforms/tizen/package.sh <versione> release` (installa Tizen Studio
  CLI, registra il profilo con il certificato copiato in una cartella temporanea, firma), carica `xtream-iptv-<versione>_tizen.wgt` e `.sha256`.
- Nome dei pacchetti: `xtream-iptv-<versione>_<piattaforma>.<estensione>` (es. `xtream-iptv-1.0.1_tizen.wgt`).
- Le prossime piattaforme aggiungono un job con la stessa forma (`webos`, `android`): ognuno dipende solo da `verify`, quindi una
  piattaforma che fallisce non blocca le altre.
- Versioni: Tizen vuole x.y.z; Android vorrà anche un `versionCode` intero, ricavabile dal tag (1.2.3 → 10203).

## LG webOS (prossima)

**Minimo consigliato: webOS 6.0 (LG 2021, Chromium 79).** Il target di build attuale (Chrome 76) funziona senza cambiare Babel, SCSS o polyfill.

Chromium per versione: webOS 4 (2018-19) 53; webOS 5 (2020) 68; webOS 6 (2021) 79; webOS 22 (2022) 87; 23 → 94; 24 → 108; 25 → 120; 26 → 132.

- webOS 5 (2020) è fattibile ma richiede un target Babel più basso e polyfill (`Object.fromEntries`, `flat`, `globalThis`, `matchAll`, `allSettled`) e una verifica del CSS.
- webOS 4 e precedenti: non convengono (niente CSS grid, `async` richiede regenerator).
- HLS: versione 3 (webOS 1-3.5), 5 (4.0/4.5), 7 (6.0 e successivi). HTTP/2 da webOS 5; MSE/EME da 5.0.
- Il player nativo non supporta avanti/indietro veloce né velocità diverse da 1.0; il seek funziona.
- Live: m3u8 (`pickLiveFormat` già lo preferisce). MPEG-TS/MKV e altri flussi dei provider: da verificare modello per modello.
- App packaged: origine `file://`, nessun cookie. Chiamate dirette al provider (CORS): da verificare sulla TV.
- Telecomando: Indietro = 461 (`keyCodes` dell'adattatore); Play/Pausa/Stop/Avanti/Indietro veloce seguono i codici standard già comuni.
- Trailer: apertura dell'app YouTube (nessun plugin).
- Pacchetto: `platforms/webos/` con `appinfo.json`, icone, `platform.js`, `build.js`, `package.sh` (`ares-package` di
  `@webos-tools/cli`, gira su Linux). In modalità sviluppatore l'`.ipk` si installa senza firma.

## Android TV / Fire TV (dopo webOS)

Fire OS 7 e 8 sono basati su Android 9 e 11: un solo progetto Capacitor in `platforms/android/` (manifest per il launcher TV con
banner, touch non richiesto). Per ora un APK per Fire TV.

### Criticità tecniche e soluzioni

1. **Video (la più pesante).** Le linee Xtream sono quasi sempre MPEG-TS, a volte MKV/AC3: il `<video>` della WebView non li gestisce
   e MSE (hls.js / mpegts.js) pesa troppo sugli stick. → Plugin Capacitor con **ExoPlayer** su una superficie sotto la WebView
   trasparente, esposto come motore con lo stesso contratto di AVPlay (start/play/pause/seek/stop, tempo e durata, tracce audio e
   sottotitoli, formato, buffering ed errori). È il lavoro più corposo.
2. **Rete (CORS e http).** I server Xtream non mandano header CORS e sono spesso in http. La soluzione "facile" usata dai client web
   è non passare dal browser: con Capacitor si attiva **CapacitorHttp** (fetch e XHR eseguiti in modo nativo, niente CORS), si serve
   l'app con `server.androidScheme: 'http'` e si permette il traffico in chiaro (`usesCleartextTraffic`), così immagini e flussi http
   non sono contenuto misto. Da verificare con il nostro client HTTP (timeout, AbortController, risposte grandi come `get_live_streams`
   e l'XMLTV: CapacitorHttp legge la risposta intera in memoria).
3. **Scala dello schermo.** Su un TV 1080p la WebView presenta 960 px CSS invece di 1920: va forzata la viewport a 1920 nella
   configurazione della WebView, altrimenti l'interfaccia (disegnata in px a 1920) è raddoppiata.
4. **Tasti.** Indietro va intercettato dall'Activity e passato alla pagina; tasti media e canali hanno codici diversi da Samsung e
   tra telecomandi Fire e Android TV (`keyCodes` dell'adattatore). OK tenuto premuto da verificare.
5. **Ciclo di vita.** Home / standby: pausa e rilascio del player, ripresa al ritorno.
6. **Trailer.** Apertura dell'app YouTube (intent), presente su Fire TV e Android TV.
7. **Prestazioni.** Gli stick Fire più vecchi sono lenti: prove con il mock e il profilo CPU sul dispositivo.

### Criticità di distribuzione

- **I nuovi Fire TV Stick (4K Select, nuovo 4K, nuovo HD) usano Vega OS**, non Android: niente APK, niente sideload. Amazon ha
  confermato che i futuri stick saranno tutti Vega. "Firestick" vuol dire quindi i modelli Fire OS (4K Max, 4K Plus, Cube, TV con
  Fire TV). Un porting Vega sarebbe un progetto a parte (React Native): fuori perimetro.
- **Fire OS blocca le app che Amazon giudica d'accesso a contenuti non licenziati** (all'apertura dal 2025, all'installazione dal
  2026). I criteri non sono pubblici: non si sa se un client Xtream generico possa finirci. Rischio non controllabile.
- **Google: verifica dello sviluppatore anche per le app fuori dal Play Store** (dal 2026 in alcuni paesi, globale dal 2027); c'è un
  livello ridotto per hobbisti che limita la distribuzione a pochi dispositivi. Da seguire per l'APK Android TV.

## Ordine di lavoro

1. ~~Interfaccia di piattaforma nel core, Tizen in `platforms/tizen/`~~ (patch 104; da verificare sulla TV Samsung che nulla sia cambiato).
2. ~~Release multi-pacchetto con il solo Tizen~~ (patch 104).
3. webOS: `platforms/webos/` (adattatore, `appinfo.json`, icone, `package.sh`), job `webos` nella release, prove su TV.
4. Android / Fire TV: progetto Capacitor in `platforms/android/` (WebView, viewport, tasti, uscita, CapacitorHttp), all'inizio con il
   motore `<video>` per vedere l'interfaccia; job `android` con keystore nei secret.
5. Plugin ExoPlayer con le stesse funzioni di AVPlay.
6. Prove sui dispositivi e misure con il mock; poi l'APK nella release.
