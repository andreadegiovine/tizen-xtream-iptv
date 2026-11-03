/* Tizen web service "ytresolver": serves the YouTube player page on http://localhost:__PORT__ so the embedded
   player gets a valid http origin (a page opened from the app package has none, and YouTube refuses it with
   "error 153"). The app starts it with tizen.application.launch("<package>.ytresolver"). The page is filled in
   at build time (see webpack.config.js). It only serves two static paths. */
var http = require('http');

var PORT = __PORT__;
var PLAYER_HTML = __PLAYER_HTML__;

function handler(req, res) {
  var path = String(req.url || '').split('?')[0];
  var headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (path === '/player.html') {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    headers['Referrer-Policy'] = 'no-referrer-when-downgrade';
    res.writeHead(200, headers);
    res.end(PLAYER_HTML);
  } else if (path === '/health') {
    headers['Content-Type'] = 'text/plain';
    res.writeHead(200, headers);
    res.end('ok');
  } else {
    headers['Content-Type'] = 'text/plain';
    res.writeHead(404, headers);
    res.end('Not Found');
  }
}

http.createServer(handler).listen(PORT, '0.0.0.0');

module.exports.onStart = function () {};
module.exports.onRequest = function () {};
module.exports.onStop = function () {};
