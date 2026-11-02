const http = require('http');
const https = require('https');

/** Development-only middleware: GET /__proxy?u=<encoded upstream URL>. */
module.exports = function devProxy(req, res) {
  let target;
  try {
    target = new URL(new URL(req.url, 'http://localhost').searchParams.get('u'));
  } catch {
    res.statusCode = 400;
    res.end('Bad target');
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    res.statusCode = 400;
    res.end('Unsupported protocol');
    return;
  }
  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.request(
    target,
    {
      method: 'GET',
      timeout: 60000,
      headers: { 'user-agent': 'xtream-iptv-dev-proxy', accept: 'application/json,*/*' },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        'content-type': up.headers['content-type'] || 'application/json',
      });
      up.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', (err) => {
    if (!res.headersSent) res.statusCode = 502;
    res.end(JSON.stringify({ proxyError: err.message }));
  });
  upstream.end();
};
