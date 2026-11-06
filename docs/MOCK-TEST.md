# Test con il mock Xtream e misure di prestazioni

Strumenti solo di sviluppo in `scripts/mock-xtream/` (non finiscono nella build): un pannello Xtream finto con un catalogo grande e uno script che usa l'app in Chromium headless, solo da tastiera come sulla TV, e misura i tempi.

## Server mock

```
npm run build
npm run mock -- [--port 8090] [--movies 20000] [--series 8000] [--live 3000] [--latency 150] [--img-latency 40] [--kbps 0] [--dist dist]
```

- Account: utente `test`, password `test`, URL `http://localhost:8090`.
- Stessa origine per app (build in `dist`), API (`/player_api.php`, `/xmltv.php`), immagini (`/img/...svg`, in cache del browser) e un TMDB finto (`/tmdb/3/...`, `/tmdbimg/...`): nessun problema di CORS.
- Catalogo deterministico (stesso seed, stesso catalogo): il 15% dei titoli senza id TMDB, il 30% senza generi, il 7% senza locandina, l'1% per adulti, canali con varianti di qualità (HD, FHD, 4K...) e paese per il raggruppamento; EPG XMLTV di 48 ore (un canale su 25 ha solo programmi "EPG non disponibile", che l'app deve trattare come guida assente).
- `--latency` è il ritardo di ogni risposta API, `--img-latency` quello delle immagini, `--kbps` limita la banda (0 = nessun limite, risposte gzip).
- `GET /__stats` dà le richieste ricevute per tipo, `POST /__stats` le azzera.
- Funziona anche con la build di sviluppo (`/__proxy` e `/__media` sono gestiti).

## Misure

Con il server avviato:

```
npm run perf -- [--url http://localhost:8090] [--tmdb] [--cpu 4] [--profile] [--out report.json] [--shots cartella]
```

Percorso: primo avvio (PIN parentale, provider), sync completa del catalogo, home, Film / Serie / Live a freddo, griglia (30 × giù), riavvio a caldo, ricerca, scheda, Impostazioni, 20 s di inattività. Per ogni passo: tempo alle card visibili e alle loro locandine, long task del thread principale (> 50 ms), heap JS, richieste al server.

- `--tmdb` imposta una chiave TMDB (risponde il TMDB finto) per misurare anche quei flussi.
- `--cpu 4` rallenta la CPU di 4 volte (vale per il thread principale, non per i worker): più vicino a una TV.
- `--profile` aggiunge a ogni passo le funzioni che hanno occupato di più il thread principale (meglio con una build di sviluppo, nomi leggibili: `npx webpack --mode development --output-path /tmp/distdev` e `--dist /tmp/distdev` al server).
- I numeri sono di un PC: sulla TV vanno moltiplicati (CPU e IndexedDB più lenti). Servono per confrontare prima/dopo una modifica.

## Confronto prima / dopo

```
npm run perf -- --out riferimento.json        # sulla versione di partenza
npm run perf -- --out nuovo.json              # dopo la modifica (stesse opzioni)
npm run perf:compare -- riferimento.json nuovo.json [--threshold 25] [--min-ms 80]
```

Per ogni passo confronta i tempi che si sentono nell'interfaccia (card, locandine, risultati della ricerca, scheda, long task) e le durate delle sync: segna `✗` ciò che è peggiorato più della soglia (25%) e di più di 80 ms, `✓` ciò che è migliorato. Esce con codice 1 se qualcosa è peggiorato: da usare prima di consegnare una modifica. Due giri della stessa versione differiscono di qualche decina di ms: per decidere servono differenze ripetute, non un singolo valore.

L'ultimo passo di `perf.js` simula l'avvio dopo 12 ore con lo stesso catalogo: la sync rilegge le liste e, con la sync differenziale, non riscrive nulla (`changes: 0`).
