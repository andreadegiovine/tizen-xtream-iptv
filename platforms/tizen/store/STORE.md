# Samsung TV Seller Office — submission material

Everything needed to register Xtream IPTV on the Samsung TV Seller Office (seller.samsungapps.com/tv). Values to paste are in code
blocks. Fields marked **(you)** depend on the seller account and must be filled by the account owner.

> Package to upload: **`xtream-iptv-<version>_tizen.wgt`** of the release (the store widget). It has **no `<tizen:service>`** (Samsung
> reserves it to partners: "Element of service is available only to Partner user") and **no online updates** (store apps must not download
> code). The `_tizen_youtube` and `_autoupdate` widgets are for installation outside the store only.

## 1. Application

| Field | Value |
|---|---|
| Application name (Seller Office, internal) | `Xtream IPTV` |
| Application ID / package | `XtrmIptv01.XtreamIPTV` / `XtrmIptv01` (from `config.xml`) |
| Version | the release version, e.g. `1.3.0` |
| Required platform version | Tizen 6.0 (2021 TVs and newer) |
| Category | `Video` |
| Price | Free |
| In-app purchases / ads | None / none |
| Default language | English |
| Other languages | Italian |
| Countries | All the countries where the seller wants it (the app has no regional content) |
| Seller name, support e-mail, phone **(you)** | the seller account's data |
| Homepage URL | `https://github.com/andreadegiovine/xtream-iptv-client` |
| Privacy policy URL | `https://github.com/andreadegiovine/xtream-iptv-client/blob/main/docs/PRIVACY.md` |

## 2. Title and descriptions

**Title (all languages)**

```
Xtream IPTV
```

**Short description — English**

```
A fast, TV-first player for your own Xtream Codes or M3U IPTV service: movies, series and live TV with a full programme guide.
```

**Description — English**

```
Xtream IPTV is a fast, modern player for the IPTV service you already subscribe to. Sign in with your provider's Xtream Codes details, or add an M3U playlist with its XMLTV guide, and browse movies, series and live channels with your remote, in an interface designed for the big screen.

BUILT FOR LARGE CATALOGUES
Your catalogue is synced in the background and stored on the TV, so tens of thousands of titles open instantly and scroll smoothly. Versions of the same title are grouped into one card, titles are cleaned of provider tags, and genres, categories, favourites and your own collections help you find what you want.

LIVE TV WITH A PROGRAMME GUIDE
See what's on now on every channel, browse the full grid guide, filter it by genre, search programmes, and schedule one so the app switches to the channel when it starts. Channels in several qualities are grouped together, and channels of the same broadcaster are collected into networks.

A COMPLETE PLAYER
Resume where you left off, autoplay the next episode, skip end credits once per series, switch audio tracks and subtitles, change the aspect ratio and adjust buffering.

OPTIONAL FREE SERVICES (keys entered in Settings)
- TMDB: posters, plots, cast, ratings, trailers and recommendations.
- Trakt: your watch history and progress synced across devices.
- OpenSubtitles: subtitles in your language for movies and episodes.

PRIVATE BY DESIGN
No account, no ads, no analytics. Your details and keys stay on your TV.

IMPORTANT: Xtream IPTV does not provide, host or sell any channels, films or other content. You need an active subscription with an IPTV provider that supports the Xtream Codes API or M3U playlists, and you are responsible for watching only content you have the rights to.
```

**Short description — Italiano**

```
Un player veloce, pensato per la TV, per il tuo servizio IPTV Xtream Codes o M3U: film, serie e TV in diretta con la guida completa.
```

**Description — Italiano**

```
Xtream IPTV è un player veloce e moderno per il servizio IPTV a cui sei già abbonato. Accedi con i dati Xtream Codes del tuo provider, oppure aggiungi una playlist M3U con la sua guida XMLTV, e sfoglia film, serie e canali con il telecomando, in un'interfaccia pensata per il grande schermo.

PENSATO PER CATALOGHI GRANDI
Il catalogo si sincronizza in background e resta sulla TV: decine di migliaia di titoli si aprono subito e scorrono fluidi. Le versioni dello stesso titolo sono riunite in una sola scheda, i titoli sono ripuliti dalle sigle del provider, e generi, categorie, preferiti e collezioni ti aiutano a trovare quello che cerchi.

TV IN DIRETTA CON LA GUIDA
Il programma in onda su ogni canale, la guida a griglia completa filtrabile per genere, la ricerca dei programmi e la visione programmata, che apre il canale quando il programma inizia. I canali in più qualità sono raggruppati e quelli dello stesso editore riuniti in reti.

UN PLAYER COMPLETO
Riprendi da dove eri rimasto, episodio successivo automatico, inizio dei titoli di coda per serie, tracce audio e sottotitoli, formato dell'immagine e buffer regolabile.

SERVIZI GRATUITI FACOLTATIVI (chiavi da inserire nelle Impostazioni)
- TMDB: locandine, trame, cast, valutazioni, trailer e suggerimenti.
- Trakt: cronologia e avanzamento sincronizzati tra i tuoi dispositivi.
- OpenSubtitles: sottotitoli nella tua lingua per film ed episodi.

PRIVATO PER SCELTA
Nessun account, nessuna pubblicità, nessuna statistica. I tuoi dati e le tue chiavi restano sulla TV.

IMPORTANTE: Xtream IPTV non fornisce, ospita né vende canali, film o altri contenuti. Serve un abbonamento attivo con un provider IPTV compatibile con l'API Xtream Codes o con playlist M3U; sei responsabile di guardare solo contenuti per cui hai i diritti.
```

**Keywords**

```
IPTV, Xtream Codes, M3U, XMLTV, EPG, live TV, TV guide, player, movies, series
```

## 3. Images

| Asset | File | Spec |
|---|---|---|
| Icon 512x423 | `icon-512x423.png` | PNG |
| Icon 1920x1080 (full) | `icon-1920x1080.png` | PNG; the Seller Office can also build it from a logo and a background: |
| — logo | `icon-1920x1080-logo.png` | PNG, transparent |
| — background | `icon-1920x1080-background.png` | PNG |
| Screenshots (4) | `screenshots/1-home.jpg`, `2-movies.jpg`, `3-live-guide.jpg`, `4-detail.jpg` | 1920x1080 JPG, under 500 kB each |

Regenerate them with `npm run store-assets` (icons) and `npm run build && npm run screenshots` (screenshots, fictional demo catalog).

## 4. Age rating

The app shows whatever the user's own provider streams; it ships no content. Answer the rating questionnaire for the app itself
(no violence, sexual content, gambling or purchases in the app); adult categories of a provider are locked behind a parental PIN set at
the first start. Suggested result: the lowest rating the questionnaire allows, with "user-supplied content".

## 5. Information for the certification testers

```
Xtream IPTV is a player: it has no content of its own. To test it without an IPTV subscription, use the M3U option with a public playlist of free, legal channels:

1. At the first start, set any 4-digit parental PIN (twice).
2. Choose "M3U / XMLTV".
3. Name: Test
   M3U playlist URL: https://iptv-org.github.io/iptv/countries/it.m3u
   XMLTV guide URL: leave empty
4. Confirm: the catalog is downloaded; open Live TV and play any channel with OK.

Remote: arrows to move, OK to select, Back to go back, Play/Pause and Channel up/down in the player.
Optional services (TMDB, Trakt, OpenSubtitles) need the tester's own free keys and are not required to test the app.
```

(If the reviewers ask for an Xtream Codes account, give them a test account of a provider you trust; never a pirated one.)

## 6. Checks before submitting

- [ ] The uploaded widget is `_tizen.wgt` (no `<tizen:service>`; `config.xml` still lists `internet`, `tv.inputdevice`, `network.get`,
      `application.launch`, `productinfo`, `network.public`).
- [ ] Signed with the Samsung **distributor** certificate of the seller account (the release workflow signs with the repository's own
      certificate, which is fine for installing on a TV in developer mode; the Seller Office may require re-signing with the store one).
- [ ] Back on the first screen asks to exit; the app exits with the dialog's confirm.
- [ ] Trailers open the TV's YouTube app (no in-app trailer service in the store widget).
