# LG webOS TV

Package: `xtream-iptv-<version>_webos.ipk`, attached to every [release](../../../../releases). It is **not signed**: it installs on a TV in **Developer Mode**.
The LG Content Store has its own publishing procedure, which this project does not follow.

Requirements: an LG TV with **webOS 6.0 or newer** (2021, Chromium 79) and an Xtream Codes provider account. Older models are not supported.
This platform is new and **has not been verified on a real TV yet**.

## Install on the TV

1. Create a free account on the [LG Developer site](https://webostv.developer.lge.com) and install the **Developer Mode** app from the LG Content Store on the TV.
2. Open the Developer Mode app, sign in, switch **Dev Mode Status** and **Key Server** on, and restart the TV when asked. Note the TV's IP address and the passphrase shown by the app.
3. On a computer in the same network install the webOS CLI (needs Node.js):

   ```bash
   npm install -g @webos-tools/cli
   ares-setup-device --add tv --info "{'host': '<tv-ip>', 'port': '9922', 'username': 'prisoner'}"
   ares-novacom --device tv --getkey      # asks for the passphrase of the Developer Mode app
   ```

4. Install and start the package:

   ```bash
   ares-install --device tv xtream-iptv-<version>_webos.ipk
   ares-launch --device tv com.xtrmiptv.app
   ```

5. Open **Xtream IPTV** from the apps list and add your provider.

Developer Mode expires after a while and must be extended from the Developer Mode app (it counts down on the TV); the installed app keeps working but may stop
launching when the session ends.

## Notes

- **Player:** the page's `<video>` element. HLS works from webOS 6. The native player does not support fast forward/rewind speeds other than 1.0; seek works.
  Live channels use m3u8 when the provider allows it.
- **Remote keys:** Back is `461`; Play/Pause/Stop/Fast-forward/Rewind and CH+/CH- use the standard codes. The Magic Remote pointer is not used: the focus is key-driven.
- **Trailers:** open the TV's YouTube app (`youtube.leanback.v4`).
- **Permissions:** `requiredACG` lists `application.launcher` (to open YouTube) and `systemconfig.query` (system information); applied from webOS 26.
- **To verify on a TV:** direct calls to the provider (CORS from a `file://` origin), MPEG-TS and MKV playback, audio and subtitle tracks, performance on 2021 models.

## What is in this folder

| File | Role |
|---|---|
| `platform.js` | the adapter (see [`docs/MULTIPLATFORM.md`](../../docs/MULTIPLATFORM.md)) |
| `luna.js` | calls to system services through `PalmServiceBridge` (no webOSTV.js) |
| `appinfo.json` | the app manifest: id `com.xtrmiptv.app`, 1920x1080, `disableBackHistoryAPI` |
| `build.js`, `package.sh` | icons drawn from `logo.svg`, version stamping, and `ares-package` |

To try it in a desktop browser: `npm run dev:webos` (see [`docs/BUILD.md`](../../docs/BUILD.md#webos)).
