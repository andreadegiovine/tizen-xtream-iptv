# Multi-piattaforma: analisi, decisioni e piano

Stato: **struttura per piattaforme fatta (patch 104); Tizen, LG webOS (patch 108), desktop (patch 110) e Android TV / Fire TV (patch 111) implementati.** Le prove delle altre piattaforme
non sono state fatte; i punti segnati "da verificare" sono ipotesi.

## Principi

- **Logica e core unici.** Pagine, focus, database, sync, worker, EPG, player controller sono gli stessi per tutte le piattaforme
  (`src/`). Non c'è codice touch.
- **Tutto ciò che riguarda una piattaforma sta in `platforms/<nome>/`**: adattatore JS, manifest, elenco delle icone (disegnate da `logo.svg`), certificati, plugin nativi,
  script di pacchetto.
- **Release GitHub → un pacchetto per piattaforma**: `.github/workflows/release.yml` ha un job `verify` (tag, lint, test) e un job per
  piattaforma che fa build, firma e allega il pacchetto alla release.
- **iOS escluso** per ora.
- **Android solo per TV**: Fire TV (prima) e Android TV, telecomando e D-pad, niente touch.
- **Desktop**: Windows, macOS e Linux (stessa interfaccia, tastiera come telecomando).

## Decisioni prese

| Tema | Decisione |
| --- | --- |
| Contenitore Android | **Capacitor** |
| Player Android | **ExoPlayer (Media3) nativo**, pilotato da JS come AVPlay: video sotto, controlli HTML sopra |
| Distribuzione Android | **solo APK** allegato alla release GitHub (niente store) |
| Ordine | **webOS, desktop (Windows, macOS, Linux, a costo basso), poi Android (Fire TV)** |
| Desktop | **Electron**; pacchetti non firmati per ora (anche macOS) |
| Certificati | restano versionati in `platforms/<nome>/`; senza password non sono utilizzabili e le password sono nei secret GitHub |
| Trailer | solo Tizen ha un plugin (servizio locale); le altre piattaforme aprono l'app YouTube |
| APK | due, dallo stesso progetto con due flavor Gradle: `_androidtv.apk` e `_firetv.apk` |

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
  config.xml                 manifest (l'icona, 117 px, è disegnata in build da logo.svg)
  youtube/                   pagina del player YouTube e servizio sulla TV
  tizencert.p12              certificato di firma (password nel secret TIZEN_CERT_PASSWORD)
  build.js                   cosa webpack copia accanto all'app e opzioni della pagina (webapis.js)
  package.sh                 firma il .wgt (Tizen Studio CLI), usato dal job `tizen` della release
```

- La build sceglie la piattaforma con `--env platform=<nome>` (default `tizen`): `npm run build:tizen`; `npm run build` e
  `npm run dev` usano Tizen. Webpack risolve `@platform` in `platforms/<nome>/platform.js` e aggiunge i file di `build.js`.
  Nei test Jest `@platform` è l'adattatore Tizen.
- `dist/` per Tizen è identico a prima della riorganizzazione (stessi file, stesso `config.xml`, stesso servizio).
- **Icone:** nessuna immagine nelle cartelle delle piattaforme. Il logo è `logo.svg` nella radice del repository (lo usano anche la barra
  in alto, lo screensaver e la schermata di avvio); `build.js` di ogni piattaforma elenca le icone (`icons: [{ file, size }]`) e la build
  le disegna in PNG (`scripts/platform-icons.js`, `@resvg/resvg-js`), anche nei job della release.
- Un test di contratto (`test/platforms/contract.test.js`) controlla che ogni `platforms/*/platform.js` rispetti il contratto.

### Contratto dell'adattatore (`src/platform/contract.js`)

Tutte le voci sono facoltative: quelle mancanti prendono il comportamento di un browser.

| Voce | Cosa fa | Tizen |
| --- | --- | --- |
| `keyCodes` | tasti del telecomando aggiunti a quelli comuni (frecce, OK, 415/19/413/417/412, Esc/Backspace, PagSu/PagGiù) | 10009 Indietro, 10252 Play/Pausa, 427/428 canali |
| `registerKeys()` | chiede alla piattaforma i tasti media | `tvinputdevice.registerKey` |
| `exit()` | chiude l'app | `tizen.application…exit()` |
| `createEngine()` | motore video (stesso contratto di `createHtml5Engine`) | AVPlay, `<video>` nel browser |
| `createTrailerEngine()` | motore che riproduce `youtube:<id>` nell'app, o null | iframe + servizio `localhost:8125` |
| `openTrailer(id)` | apre il trailer fuori dall'app (webOS: app YouTube); senza nessuno dei due, niente bottone trailer | — |
| `createDiagnosticPlayer()` | laboratorio player della Diagnostica | `avplaySpike` |
| `runtimeChecks()` | righe in più dei controlli della Diagnostica | tizen, webapis, AVPlay |
| `display / memory / networkType` | dati di sistema per la tabella Dispositivo | `tizen.systeminfo` |

## Release (fatta: Tizen, webOS, desktop, Android)

- `verify`: valida il tag (`v1.2.3`), `npm ci`, lint, test.
- `tizen`: versione nel `package.json`, `npm run build:tizen`, `platforms/tizen/package.sh <versione> release` (installa Tizen Studio
  CLI, registra il profilo con il certificato copiato in una cartella temporanea, firma), carica `xtream-iptv-<versione>_tizen.wgt` e `.sha256`.
- Nome dei pacchetti: `xtream-iptv-<versione>_<piattaforma>.<estensione>` (es. `xtream-iptv-1.0.1_tizen.wgt`).
- `webos`: versione, `npm run build:webos`, `platforms/webos/package.sh <versione> release`, carica `xtream-iptv-<versione>_webos.ipk` e `.sha256`.
- Le prossime piattaforme aggiungono un job con la stessa forma (`android`, desktop): ognuno dipende solo da `verify`, quindi una
  piattaforma che fallisce non blocca le altre.
- Versioni: Tizen vuole x.y.z; Android vorrà anche un `versionCode` intero, ricavabile dal tag (1.2.3 → 10203).

## LG webOS (fatta, patch 108; da provare sulla TV)

**Minimo consigliato: webOS 6.0 (LG 2021, Chromium 79).** Il target di build attuale (Chrome 76) funziona senza cambiare Babel, SCSS o polyfill.

Chromium per versione: webOS 4 (2018-19) 53; webOS 5 (2020) 68; webOS 6 (2021) 79; webOS 22 (2022) 87; 23 → 94; 24 → 108; 25 → 120; 26 → 132.

```
platforms/webos/
  platform.js       adattatore: tasto Indietro 461, uscita (window.close), motore <video>, trailer nell'app YouTube, pannello UHD
  luna.js           chiamate ai servizi di sistema (PalmServiceBridge, senza webOSTV.js): avvio di YouTube, informazioni di sistema
  appinfo.json      id com.xtrmiptv.app, 1920x1080, disableBackHistoryAPI (Indietro arriva alla pagina), requiredACG
  build.js          icone (icon.png 80 px, largeIcon.png 130 px, disegnate da logo.svg) e appinfo.json con la versione
  package.sh        ares-package (@webos-tools/cli via npx, --no-minify) → xtream-iptv-<versione>_webos.ipk
```

- Build: `npm run build:webos`; `npm run dev:webos` per provarla nel browser. Job `webos` nella release.
- Installazione: l'`.ipk` non è firmato e si installa su una TV in **modalità sviluppatore** (app "Developer Mode" di LG,
  poi `ares-setup-device` e `ares-install`). Il LG Content Store ha una sua procedura di pubblicazione.
- `requiredACG`: `application.launcher` (avvio di YouTube) e `systemconfig.query` (informazioni di sistema). Ignorato fino a webOS 25,
  applicato da webOS 26, obbligatorio da webOS 27.
- Telecomando: Indietro = 461; Play/Pausa/Stop/Avanti/Indietro veloce e CH+/CH- usano i codici standard già comuni.
- Trailer: app YouTube della TV (`youtube.leanback.v4`, `contentTarget` con l'URL del video: da verificare sulla TV).
- Video: elemento `<video>` della pagina. HLS: versione 7 da webOS 6. Il player nativo non supporta avanti/indietro veloce né
  velocità diverse da 1.0; il seek funziona. Live: m3u8 (`pickLiveFormat` già lo preferisce).

**Da verificare sulla TV:**
- chiamate dirette al provider (origine `file://`, CORS) e immagini / flussi http;
- riproduzione di MPEG-TS, MKV e degli altri flussi dei provider, formato (object-fit), tracce audio e sottotitoli del `<video>`;
- tasti del Magic Remote e il puntatore (il focus resta a tasti);
- prestazioni sui modelli 2021.
- webOS 5 (2020) richiederebbe un target Babel più basso e polyfill; webOS 4 e precedenti non convengono.

## Desktop: Windows, macOS, Linux (fatta, patch 110; da provare sui sistemi)

```
platforms/desktop/
  platform.js            adattatore: <video> con hls.js / mpegts.js (HLS e MPEG-TS), Spazio e tasti multimediali, uscita
                         (window.close), trailer nel browser di sistema, versione di Electron nei controlli della Diagnostica
  build.js               demux: true (hls.js / mpegts.js nella build), icona 512 px da logo.svg
  electron/main.js       processo principale di Electron: una finestra a schermo intero, l'app servita come app://xtream/
                         (origine normale per worker e IndexedDB), interfaccia 1920x1080 scalata alla finestra (zoom),
                         F11 schermo intero, F12 strumenti di sviluppo, un'istanza sola
  electron-builder.json  pacchetti: Windows NSIS x64, macOS dmg x64 e arm64, Linux AppImage e deb x64; Electron 44.9.3
  package.sh             cartella di staging (build + main.js + package.json) ed electron-builder 26.18.0 via npx
```

- Build: `npm run build:desktop`; `npm run desktop` la apre in Electron dal repository. Job `desktop` della release, uno per sistema
  (Linux su ubuntu, Windows su windows, macOS su macos): `xtream-iptv-<versione>_linux-x64.AppImage` / `.deb`,
  `_windows-x64.exe`, `_macos-x64.dmg`, `_macos-arm64.dmg`, ognuno con il suo `.sha256`.
- **Rete:** la pagina gira con `webSecurity` disattivato (niente CORS, niente blocco dei contenuti http), come un'app TV. La pagina
  viene solo dai file dell'app: la navigazione verso altri indirizzi è bloccata e `window.open` va al browser di sistema.
- **Video:** `<video>` di Chromium con hls.js (HLS) e mpegts.js (MPEG-TS). Le build TV non contengono questi due moduli
  (`__JS_DEMUX__`). Limiti: MKV e audio AC3/E-AC3 non sono supportati da Chromium (film MKV che non partono, canali senza audio);
  la soluzione completa è un player nativo (mpv / libVLC) come plugin.
- **Firma:** nessuna. Windows mostra l'avviso di SmartScreen; su macOS l'app si apre con tasto destro → Apri (Gatekeeper). Per firmare
  servono un certificato Windows e l'account Apple Developer (notarizzazione).
- **Comandi:** tastiera (frecce, Invio, Esc / Backspace, PagSu / PagGiù, Spazio, tasti multimediali). Il mouse funziona solo dove
  l'interfaccia lo prevede già (barra del player).
- Verificato in Electron 44.9.3 (Linux, con il mock senza header CORS): avvio, configurazione del provider, sync nei worker, home;
  pacchetti AppImage e deb creati in locale. Windows e macOS: solo nei job della release.

## Android TV / Fire TV (fatta, patch 111; non compilata in locale, da provare sui dispositivi)

Fire OS 7 e 8 sono basati su Android 9 e 11: un solo progetto Capacitor 8.5.3 in `platforms/android/` con due flavor, **androidtv**
(Leanback richiesto) e **firetv** (Leanback non richiesto); il codice è lo stesso.

```
platforms/android/
  platform.js            adattatore: ExoPlayer (exoEngine.js), tasti dal'activity, uscita, trailer nell'app YouTube, schermo
  exoEngine.js           motore video con lo stesso contratto di AVPlay, sopra il plugin ExoPlayer (comandi e eventi)
  build.js               icone di avvio (mipmap) e banner TV 320x180 disegnati da logo.svg in dist/android-res/
  package.json           Capacitor (@capacitor/android, cli, core 8.5.3): progetto npm a sé, non tocca l'app web
  capacitor.config.json  webDir ../../dist, androidScheme http, contenuti misti consentiti
  package.sh             icone nel progetto, npm ci + cap sync, gradlew assemble<Flavor>Release → xtream-iptv-<v>_androidtv.apk / _firetv.apk
  android/               progetto Gradle (generato da `cap add android`, poi adattato)
    app/src/main/java/com/xtrmiptv/tv/
      MainActivity.java          viewport a 1920 (useWideViewPort + overview), WebView trasparente, tasti, client di rete
      ProviderWebViewClient.java ogni GET verso un altro host fatto in modo nativo e restituito con Access-Control-Allow-Origin: *
      RemoteKeys.java            Indietro, tasti media e canali → keydown 10000 + codice Android
      ExoPlayerPlugin.java       ExoPlayer (Media3 1.6.1) in un PlayerView sotto la WebView: TS, HLS, MKV, MP4, AC3 del dispositivo,
                                 tracce audio, sottotitoli disegnati da ExoPlayer, formato (fit / fill / zoom), pausa in background
      TvHostPlugin.java          uscita, apertura di link (YouTube), informazioni sul dispositivo
    app/src/androidtv, app/src/firetv   manifest dei due flavor
```

- **Rete:** non serve CapacitorHttp. `ProviderWebViewClient` intercetta le richieste GET verso host diversi da `localhost` (API del
  provider, immagini, TMDB) anche dai worker, le fa con `HttpURLConnection` (redirect seguiti, anche da http a https) e le
  restituisce alla pagina con `Access-Control-Allow-Origin: *`. Le altre richieste (POST di Trakt, che ha CORS) vanno normalmente.
  Traffico in chiaro consentito (`usesCleartextTraffic`), pagina servita in http (`androidScheme`).
- **Tasti:** D-pad e OK arrivano come frecce e Invio; Indietro, Play/Pausa, Play, Pausa, Stop, avanti/indietro veloce, traccia
  successiva/precedente e CH+/CH- li intercetta l'activity e li passa alla pagina (`window.__xtreamKey`).
- **Video:** `kind: 'exoplayer'`; tempo, durata, buffer e tracce arrivano come eventi ogni 500 ms e sono tenuti in JS per i getter
  sincroni del contratto. Con l'app in background il video va in pausa.
- **Firma:** `platforms/android/release.keystore` (da creare con `keytool` e versionare, come il certificato Tizen) e i secret
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (default `xtream`), `ANDROID_KEY_PASSWORD`. Senza, gli APK sono firmati con la
  chiave di debug della macchina: si installano, ma la versione successiva non li aggiorna (va disinstallata prima).
- **Versioni:** versionName = tag, versionCode = x*10000 + y*100 + z.
- **Release:** job `android` (ubuntu, Java 21, Android SDK del runner): `xtream-iptv-<v>_androidtv.apk` e `_firetv.apk` con `.sha256`.
- **Non verificato:** l'APK non è stato compilato qui (Android SDK e repository Google non raggiungibili da questo ambiente): la prima
  compilazione sarà quella del job della release. Da provare sui dispositivi: rete dai worker, tasti dei telecomandi Fire e Android TV,
  ExoPlayer (formati, tracce, sottotitoli), scala dell'interfaccia, prestazioni degli stick.

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
3. ~~webOS: `platforms/webos/` (adattatore, `appinfo.json`, icone, `package.sh`), job `webos` nella release~~ (patch 108); prove su TV.
4. ~~Android / Fire TV: progetto Capacitor in `platforms/android/`, rete nativa, tasti, viewport~~ (patch 111).
5. ~~Plugin ExoPlayer con le stesse funzioni di AVPlay~~ (patch 111).
6. Prima compilazione nel job della release, prove sui dispositivi e misure con il mock.
7. ~~Desktop (Windows, macOS, Linux) con Electron~~ (patch 110); prove sui sistemi, poi eventuale player nativo (mpv / libVLC) per MKV e AC3.
