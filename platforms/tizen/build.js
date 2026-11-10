/* How webpack builds the Tizen package (read by webpack.config.js with `--env platform=tizen`, the default): the files next to the app
 * (config.xml with the version, icon, the YouTube service for trailers) and the page options (webapis.js only inside a packaged app). */
const fs = require('fs');
const path = require('path');

const YOUTUBE_SERVICE_PORT = 8125; // keep in sync with platforms/tizen/youtubeEngine.js
const here = (file) => path.resolve(__dirname, file);

/** config.xml of a variant: the version, and without `youtube` no trailer service (nor its iframe origin in the CSP). */
function tizenConfig(xml, { version, youtube }) {
  let out = xml.replace(/__VERSION__/g, version);
  if (!youtube) {
    out = out
      .replace(/\s*<!-- The trailer player[^>]*-->/, '')
      .replace(/\s*<tizen:service[\s\S]*?<\/tizen:service>/, '')
      .replace(' http://localhost:8125', '');
  }
  return out;
}

module.exports = {
  tizenConfig,
  // Drawn from logo.svg at build time (scripts/platform-icons.js).
  icons: [{ file: 'icon.png', size: 117 }],
  html: ({ isProd }) => ({ includeWebapis: isProd }),
  // Without `youtube` (the store package: Samsung allows a <tizen:service> to partners only) there is no trailer service: config.xml loses
  // its <tizen:service> and the iframe origin, and trailers open in the TV's YouTube app. Development builds keep the player page.
  copy: ({ version, youtube, isProd }) => [
    { from: here('config.xml'), to: 'config.xml', transform: (content) => tizenConfig(content.toString(), { version, youtube }) },
    ...(youtube || !isProd
      ? [
          // YouTube player page: served by the on-TV service (service/service.js) and, for development, by the dev server.
          { from: here('youtube/player.html'), to: 'yt-player.html' },
          {
            from: here('youtube/service.js'),
            to: 'service/service.js',
            transform: (content) =>
              content
                .toString()
                .replace(/__PORT__/g, String(YOUTUBE_SERVICE_PORT))
                .replace('__PLAYER_HTML__', () => JSON.stringify(fs.readFileSync(here('youtube/player.html'), 'utf8'))),
          },
        ]
      : []),
  ],
};
