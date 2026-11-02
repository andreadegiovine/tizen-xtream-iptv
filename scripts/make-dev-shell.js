/* Generates a tiny Tizen widget whose only job is to open the dev server running on your PC. */
const fs = require('fs');
const path = require('path');

const host = process.env.DEV_HOST || process.argv[2];
const port = process.env.DEV_PORT || '8080';
if (!host) {
  console.error('Usage: DEV_HOST=<pc-ip> npm run tizen:dev-shell');
  process.exit(1);
}

const out = path.resolve(__dirname, '..', 'build', 'dev-shell');
fs.mkdirSync(out, { recursive: true });

const config = `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets"
        id="http://xtream-iptv.local/XtrmIptvDv" version="0.0.1" viewmodes="maximized">
  <tizen:application id="XtrmIptvDv.XtreamIPTVDev" package="XtrmIptvDv" required_version="6.0"/>
  <content src="http://${host}:${port}/"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <icon src="icon.png"/>
  <name>Xtream IPTV (dev)</name>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:privilege name="http://tizen.org/privilege/network.get"/>
  <tizen:privilege name="http://developer.samsung.com/privilege/productinfo"/>
  <access origin="*" subdomains="true"/>
  <tizen:allow-navigation>*</tizen:allow-navigation>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable"
                 encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
fs.writeFileSync(path.join(out, 'config.xml'), config);
fs.copyFileSync(path.resolve(__dirname, '..', 'tizen', 'icon.png'), path.join(out, 'icon.png'));
console.log(`Dev shell written to ${out}\nNext: sign and install it on the TV (see README), then run "npm run dev:tv".`);
