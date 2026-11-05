const http = require('http');
const https = require('https');

const MAX_REDIRECTS = 5;

/** Playlist line → absolute URL routed through the media proxy. */
function proxied(base, ref) {
  return `/__media?u=${encodeURIComponent(new URL(ref, base).toString())}`;
}

/** HLS playlist: every URI (segments, sub-playlists, keys) goes through the proxy too. */
function rewritePlaylist(text, base) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (m, uri) => `URI="${proxied(base, uri)}"`);
      return proxied(base, line.trim());
    })
    .join('\n');
}

/** Development-only middleware: GET /__media?u=<encoded URL>. Streams video with Range support (no CORS in the browser). */
module.exports = function devMediaProxy(req, res) {
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
  const open = (url, hops) => {
    const lib = url.protocol === 'https:' ? https : http;
    const headers = { 'user-agent': 'xtream-iptv-dev-proxy', accept: '*/*' };
    if (req.headers.range) headers.range = req.headers.range;
    const upstream = lib.request(url, { method: 'GET', headers }, (up) => {
      const status = up.statusCode || 502;
      if (status >= 300 && status < 400 && up.headers.location && hops < MAX_REDIRECTS) {
        up.resume();
        open(new URL(up.headers.location, url), hops + 1);
        return;
      }
      const type = String(up.headers['content-type'] || '');
      const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(url.pathname + url.search);
      if (isPlaylist) {
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          const body = rewritePlaylist(Buffer.concat(chunks).toString('utf8'), url);
          res.writeHead(status, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
          res.end(body);
        });
        return;
      }
      const out = { 'content-type': type || 'video/mp2t', 'cache-control': 'no-store' };
      ['content-length', 'content-range', 'accept-ranges'].forEach((name) => {
        if (up.headers[name]) out[name] = up.headers[name];
      });
      res.writeHead(status, out);
      up.pipe(res);
      res.on('close', () => up.destroy());
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) res.statusCode = 502;
      res.end(err.message);
    });
    req.on('close', () => upstream.destroy());
    upstream.end();
  };
  open(target, 0);
};
module.exports.rewritePlaylist = rewritePlaylist;
