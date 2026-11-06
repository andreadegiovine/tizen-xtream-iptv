/*
 * How webpack builds the page of the Android TV / Fire TV app (`--env platform=android`). The launcher icons and the TV banner are drawn
 * from logo.svg into dist/android-res/ (Android resource folders); package.sh moves them into the Android project before Capacitor
 * copies dist/ into the app. The video is ExoPlayer's (native): no hls.js / mpegts.js in the build.
 */
const MIPMAPS = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

module.exports = {
  icons: [
    ...Object.entries(MIPMAPS).flatMap(([density, size]) => [
      { file: `android-res/mipmap-${density}/ic_launcher.png`, size },
      { file: `android-res/mipmap-${density}/ic_launcher_round.png`, size },
    ]),
    // Android TV home row banner (320x180 at xhdpi): the logo in the middle of its background colour.
    { file: 'android-res/drawable-xhdpi/banner.png', width: 320, height: 180 },
  ],
};
