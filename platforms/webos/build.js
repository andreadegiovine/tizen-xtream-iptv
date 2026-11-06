/* How webpack builds the LG webOS app (`--env platform=webos`): appinfo.json with the version and the two icons next to the app. */
const path = require('path');

const here = (file) => path.resolve(__dirname, file);

module.exports = {
  copy: ({ version }) => [
    { from: here('appinfo.json'), to: 'appinfo.json', transform: (content) => content.toString().replace(/__VERSION__/g, version) },
    { from: here('icon.png'), to: 'icon.png' },
    { from: here('largeIcon.png'), to: 'largeIcon.png' },
  ],
};
