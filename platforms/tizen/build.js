/* How webpack builds the Tizen package (read by webpack.config.js with `--env platform=tizen`, the default): the files next to the app
 * (config.xml with the version, icon, the YouTube service for trailers) and the page options (webapis.js only inside a packaged app). */
const fs = require('fs');
const path = require('path');

const YOUTUBE_SERVICE_PORT = 8125; // keep in sync with platforms/tizen/youtubeEngine.js
const here = (file) => path.resolve(__dirname, file);

module.exports = {
  html: ({ isProd }) => ({ includeWebapis: isProd }),
  copy: ({ version }) => [
    { from: here('config.xml'), to: 'config.xml', transform: (content) => content.toString().replace(/__VERSION__/g, version) },
    { from: here('icon.png'), to: 'icon.png' },
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
  ],
};
