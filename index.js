// Blind Stage public co-op relay. Deploy this folder to any Node host (Render, Railway, a VPS...).
//   PORT             port to listen on (hosts set this for you; default 8080)
//   ALLOWED_ORIGINS  comma-separated regexes for pages allowed to connect. Default: itch.io embeds,
//                    localhost and home networks. Set to "*" to allow any page.
// Endpoints: GET /health -> {"ok":true,"rooms":n,"players":n}     WebSocket: /ws
//            POST /event (anonymous play counters from the game)  GET /stats -> totals since start
'use strict';
const http = require('http');
const { attachRelay } = require('./relay.js');
const { createStats } = require('./stats.js');

const port = +process.env.PORT || 8080;
const DEFAULT_ORIGINS = [
  '^https://([a-z0-9-]+\\.)*itch\\.(zone|io)$',             // itch.io game embeds and pages
  '^https://([a-z0-9-]+\\.)*crazygames\\.com$',             // CrazyGames (games.crazygames.com, *.game-files.crazygames.com, preview tool)
  '^capacitor://([a-z0-9-]+\\.)*crazygames\\.com$',         // CrazyGames iOS app
  '^https://([a-z0-9-]+\\.)*gamejolt\\.(com|net|io)$',      // Game Jolt
  '^https://([a-z0-9-]+\\.)*(newgrounds\\.com|ungrounded\\.net)$', // Newgrounds uploads
  '^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?$',          // local play / testing
  '^http://(192\\.168|10)\\.\\d+\\.\\d+(\\.\\d+)?(:\\d+)?$', // home network (phone navigator)
  '^file://', '^null$'                                        // game opened straight from disk
];
const env = (process.env.ALLOWED_ORIGINS || '').trim();
const allowed = env === '*' ? [] : (env ? env.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS);

const originRes = allowed.map(o => new RegExp(o));
const stats = createStats({ isAllowed: o => !originRes.length || originRes.some(re => re.test(o)), log: (...a) => console.log(new Date().toISOString(), ...a) });

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/event') return stats.handle(req, res);   // anonymous play counters (see stats.js)
  if (p === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(stats.summary(), null, 2));
  }
  if (p === '/health' || p === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, service: 'blind-stage-relay', ...relay.stats() }));
  }
  res.writeHead(404); res.end();
});
const relay = attachRelay(server, { allowedOrigins: allowed, log: (...a) => console.log(new Date().toISOString(), ...a) });
server.listen(port, '0.0.0.0', () => console.log(`Blind Stage relay on :${port}  ws path /ws  origins: ${allowed.length ? allowed.length + ' rules' : 'any'}`));
