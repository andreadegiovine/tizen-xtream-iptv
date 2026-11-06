/* How webpack builds the desktop app (`--env platform=desktop`): the page and the app icon (512 px, drawn from logo.svg), which the
 * window and electron-builder use. The Electron shell itself (electron/main.js) is added by package.sh. */
module.exports = {
  demux: true, // hls.js and mpegts.js play HLS and MPEG-TS in the page (Chromium cannot)
  icons: [{ file: 'icon.png', size: 512 }],
};
