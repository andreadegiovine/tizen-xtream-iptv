# Multi-piattaforma: analisi e piano (LG webOS per primo)

Stato: **solo analisi, nessuna implementazione**. Le prove su TV non sono state fatte; i punti segnati "da verificare" sono ipotesi.

## Principio

Non si modificano i file esistenti e funzionanti (Tizen). Ogni piattaforma è un **plugin JavaScript** nel progetto che durante la build del relativo pacchetto, nel workflow GitHub, sostituisce o filtra solo ciò che serve.

Piattaforme previste: LG webOS (prima), Android TV, Amazon Fire TV, iOS.

## Struttura prevista

- `platforms/<webos|android|firetv|ios>/`: descrittore, template del manifest, icone, moduli sostitutivi.
- `webpack.platform.js`: richiama `webpack.config.js` senza modificarlo; filtra gli asset Tizen (`config.xml`, `service/service.js`, `$WEBAPIS`), imposta `__PLATFORM__` e il target Babel, e con `NormalModuleReplacementPlugin` sostituisce i moduli accoppiati alla piattaforma.
- Workflow nuovo `release-platforms.yml`; `release.yml` (Tizen) non si tocca.
- Test di contratto: ogni modulo sostitutivo espone la stessa API dell'originale.

## Punti di accoppiamento con Tizen

| Modulo | Cosa usa | Sostituto |
| --- | --- | --- |
| `src/services/playerEngines.js` | `webapis.avplay` (`createAvPlayEngine`) | motore HTML5 (`createHtml5Engine` esiste già) |
| `src/services/avplaySpike.js`, `diagnostics.js` | AVPlay | versioni senza AVPlay |
| `src/core/env.js` | `tizen.application` per uscire | `webOS.platformBack()` o equivalente |
| `src/core/input.js` | tasti Samsung (10009 indietro, 415 play, 19 pausa, 10252, 413 stop, 417 avanti, 412 indietro veloce, 427/428 canali) | mappa dei tasti della piattaforma |
| `src/services/deviceInfo.js` | `tizen.systeminfo` | `webOSSystem` / `navigator` |
| `src/services/youtubeEngine.js` | servizio locale `localhost:8125` per i trailer | vedi "Trailer" |
| `src/index.html` | `$WEBAPIS/webapis/webapis.js` | rimosso (`includeWebapis`) |
| `tizen/config.xml` | privilegi, CSP, servizio | `appinfo.json` della piattaforma |

## LG webOS

**Minimo consigliato: webOS 6.0 (LG 2021, Chromium 79).** Il target di build attuale (Chrome 76) funziona senza cambiare Babel, SCSS o polyfill.

Chromium per versione: webOS 4 (2018-19) 53; webOS 5 (2020) 68; webOS 6 (2021) 79; webOS 22 (2022) 87; 23 → 94; 24 → 108; 25 → 120; 26 → 132.

- webOS 5 (2020) è fattibile ma richiede un target Babel più basso e polyfill (`Object.fromEntries`, `flat`, `globalThis`, `matchAll`, `allSettled`) e una verifica del CSS: da valutare con una scansione di `dist`.
- webOS 4 e precedenti: non convengono (niente CSS grid, `async` richiede regenerator).
- HLS: versione 3 (webOS 1-3.5), 5 (4.0/4.5), 7 (6.0 e successivi). HTTP/2 da webOS 5; MSE/EME da 5.0.
- Il player nativo non supporta avanti/indietro veloce né velocità diverse da 1.0; il seek funziona.
- La live usa m3u8 (`pickLiveFormat` già lo preferisce). MPEG-TS/MKV e altri flussi dei provider: da verificare modello per modello.
- App packaged: origine `file://`, nessun cookie.
- Telecomando: Indietro = 461; Play/Pausa/Stop/Avanti/Indietro veloce seguono i codici standard LG.
- Pacchetto: `appinfo.json` + `ares-package` (`@webos-tools/cli`, gira su Linux). In modalità sviluppatore l'`.ipk` si installa senza firma; per il LG Content Store serve la procedura di LG.

## Trailer (YouTube)

Su Tizen funzionano con un servizio locale che serve `player.html` su `localhost:8125`, perché con origine `file://` l'embed YouTube risponde con l'**errore 153** (manca un Referer/origine valido). Su webOS, in ordine di preferenza:

1. iframe con `referrerpolicy="strict-origin-when-cross-origin"` e dominio `youtube-nocookie.com` (da provare su TV);
2. pagina del player ospitata su un dominio https nostro (per esempio GitHub Pages) incorporata in iframe: dà un'origine http valida senza servizio locale;
3. in ultima istanza, nascondere il pulsante trailer su webOS.

Non è stato possibile confermare come lo risolve Jellyfin. L'interfaccia `trailerEngine` per piattaforma permette di cambiare strada senza toccare le pagine.

## Rischi e verifiche sul TV

- riproduzione di MPEG-TS/MKV e dei flussi non HLS dei provider Xtream;
- errore 153 dei trailer;
- tasti del telecomando e tasto Indietro;
- prestazioni su CPU più lente (2021).

## Ordine di lavoro proposto

1. Scheletro `platforms/webos/`, `webpack.platform.js`, moduli sostitutivi e test di contratto.
2. `appinfo.json`, icone e workflow `release-platforms.yml` con `ares-package`.
3. Rinforzo del motore HTML5 e mappa dei tasti.
4. Trailer.
5. Prove su TV reale; poi Android TV, Fire TV e iOS con la stessa struttura.
