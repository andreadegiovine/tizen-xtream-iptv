# Samsung Tizen TV

Package: `xtream-iptv-<version>_tizen.wgt`, a **signed production widget** attached to every [release](../../../../releases).

Requirements: a Samsung TV with **Tizen 6.0 or newer** (developed on a 2021 QLED, Chromium ~76) and an Xtream Codes provider account.

## Install on the TV

1. Download `xtream-iptv-<version>_tizen.wgt` from the [Releases](../../../../releases) page.
2. Enable **Developer Mode** on the TV: open *Apps*, press `12345` on the remote, set Developer mode
   to **On**, enter the IP address of the computer you will install from, and reboot the TV.
3. Install the package with [**tizen-wgt-installer**](https://github.com/andreadegiovine/tizen-wgt-installer),
   a one-command tool (it needs Docker on a computer in the same network as the TV). It can re-sign
   the package with your own Samsung certificate, which recent TVs require; see its page for the exact
   commands for Linux, macOS, WSL and Windows.
4. Open **Xtream IPTV** from *Apps → Downloaded* and add your provider.

### Install with Tizen Studio instead

If you already use [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) (or its CLI) with a Samsung certificate profile:

```bash
sdb connect <tv-ip>
tizen install -n xtream-iptv-<version>_tizen.wgt -t <tv-name>
```

The released `.wgt` is signed with the project's certificate. If the TV refuses it, build the app yourself and sign it with your own profile
(see [`docs/BUILD.md`](../../docs/BUILD.md#tizen)).

## Notes

- **Player:** AVPlay, the Samsung native engine. All the controls are drawn by the app. Subtitles are drawn by the player.
- **Trailers:** played inside the app, with the same controls as a movie. A small service on the TV (`ytresolver`, port 8125) serves the
  YouTube player page, because a `file://` page has no origin YouTube accepts.
- **Remote keys:** Back is `10009`, Play/Pause `10252`, channels `427` / `428`; the media keys are registered with `tvinputdevice`.
- **Package id** `XtrmIptv01`, application id `XtrmIptv01.XtreamIPTV` (`config.xml`).
- **CSP:** `config.xml` allows `blob:` scripts and workers; the catalog workers are loaded from files.

## What is in this folder

| File | Role |
|---|---|
| `platform.js` | the adapter (see [`docs/MULTIPLATFORM.md`](../../docs/MULTIPLATFORM.md)) |
| `avplayEngine.js`, `avplaySpike.js` | the AVPlay video engine and the player lab of the Diagnostics page |
| `youtubeEngine.js`, `youtube/` | in-app trailers and the on-TV service |
| `keys.js`, `systemInfo.js` | Samsung keys, `tizen.systeminfo` |
| `config.xml` | the widget manifest (the icon is drawn at build from `logo.svg`) |
| `tizencert.p12` | signing certificate; its password is the `TIZEN_CERT_PASSWORD` secret |
| `build.js`, `package.sh` | what webpack copies, and the signing script used by the release |
