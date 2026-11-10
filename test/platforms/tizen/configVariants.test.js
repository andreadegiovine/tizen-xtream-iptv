const fs = require('fs');
const path = require('path');
const { tizenConfig } = require('../../../platforms/tizen/build.js');

const xml = fs.readFileSync(path.join(__dirname, '../../../platforms/tizen/config.xml'), 'utf8');

test('the store widget has no <tizen:service> (partners only) nor its iframe origin; the _youtube widget keeps them', () => {
  const store = tizenConfig(xml, { version: '1.4.0', youtube: false });
  expect(store).toContain('version="1.4.0"');
  expect(store).not.toMatch(/tizen:service/);
  expect(store).not.toContain('localhost:8125');
  expect(store).toContain('<tizen:content-security-policy>'); // the rest is untouched
  const youtube = tizenConfig(xml, { version: '1.4.0', youtube: true });
  expect(youtube).toMatch(/<tizen:service id="XtrmIptv01.ytresolver"/);
  expect(youtube).toContain('frame-src * http://localhost:8125');
});
