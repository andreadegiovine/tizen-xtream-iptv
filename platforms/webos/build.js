/* How webpack builds the LG webOS app (`--env platform=webos`): appinfo.json with the version next to the app, and the two icons. */
const path = require('path');

const here = (file) => path.resolve(__dirname, file);

module.exports = {
  // Drawn from logo.svg at build time (scripts/platform-icons.js): 80 px on the launcher, 130 px large.
  icons: [
    { file: 'icon.png', size: 80 },
    { file: 'largeIcon.png', size: 130 },
  ],
  copy: ({ version }) => [
    { from: here('appinfo.json'), to: 'appinfo.json', transform: (content) => content.toString().replace(/__VERSION__/g, version) },
  ],
};
