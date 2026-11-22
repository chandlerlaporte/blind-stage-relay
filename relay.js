// Blind Stage co-op relay: a minimal WebSocket server (RFC 6455, zero dependencies) that pairs a driver and a
// navigator in rooms keyed by a 4-letter code and forwards their messages to each other.
// Used by ../serve.js (local play) and ./index.js (public deployment).
//
// Protocol (JSON text frames):  client -> {t:'_host', room}  -> {t:'_hosted'} | {t:'_err', msg:'taken'|'bad code'}
//                               client -> {t:'_join', room}  -> {t:'_joined'} | {t:'_err', msg:'no such room'|'full'}
//   server -> {t:'_peer', on}   when the other player arrives or leaves.   {t:'_ping'} keeps idle hosts from sleeping.
//   Any other message whose t doesn't start with '_' is forwarded unchanged to the other player in the room.
'use strict';
const crypto = require('crypto');

function attachRelay(server, opts = {}) {
  const path = opts.path || '/ws';
  const maxPeers = opts.maxPeers || 2000;
  const origins = (opts.allowedOrigins || []).map(o => o instanceof RegExp ? o : new RegExp(o));
  const rooms = new Map(), peers = new Set();
  const log = opts.log || (() => { });

  class Peer {
    constructor(sock) {
      this.sock = sock; this.buf = Buffer.alloc(0); this.room = null; this.role = null;
      this.tokens = 120; this.last = Date.now(); this.seen = Date.now();
      sock.setNoDelay(true);
      sock.on('data', d => this.onData(d)); sock.on('close', () => this.onClose()); sock.on('error', () => { });
      peers.add(this);
    }
    onData(d) {
      this.seen = Date.now();
      this.buf = Buffer.concat([this.buf, d]);
      if (this.buf.length > 65536) return this.sock.destroy();
      for (; ;) {
        if (this.buf.length < 2) return;
        const b0 = this.buf[0], b1 = this.buf[1], op = b0 & 15, masked = b1 & 128;
        let len = b1 & 127, off = 2;
        if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
        if (len > 16384 || !masked) return this.sock.destroy(); // clients must mask; game messages are tiny
        if (this.buf.length < off + 4 + len) return;
        const m = this.buf.subarray(off, off + 4), payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
        this.buf = this.buf.subarray(off + 4 + len);
        if (op === 8) { this.frame(8, Buffer.alloc(0)); return this.sock.end(); }
        if (op === 9) { this.frame(10, payload); continue; }
        if (op === 1) this.onText(payload.toString('utf8'));
      }
    }
    frame(op, data) {
      const len = data.length; let h;
      if (len < 126) h = Buffer.from([128 | op, len]);
      else if (len < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
      else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
      try { this.sock.write(Buffer.concat([h, data])); } catch (e) { }
    }
    send(o) { this.frame(1, Buffer.from(JSON.stringify(o))); }
    other() { const r = this.room && rooms.get(this.room); return r ? (this.role === 'host' ? r.nav : r.host) : null; }
    onText(txt) {
      // flood guard (token bucket): 60 msgs/s sustained, bursts of 120. The game sends 20 state updates/s.
      const now = Date.now(); this.tokens = Math.min(120, this.tokens + (now - this.last) * .06); this.last = now;
      if (--this.tokens < 0) return this.sock.destroy();
      let m; try { m = JSON.parse(txt); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      const code = typeof m.room === 'string' ? m.room.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
      if (m.t === '_host') {
        if (code.length !== 4) return this.send({ t: '_err', msg: 'bad code' });
        const r = rooms.get(code); if (r && r.host && r.host !== this) return this.send({ t: '_err', msg: 'taken' });
        this.leave(); rooms.set(code, { host: this, nav: null, t: now }); this.room = code; this.role = 'host'; this.send({ t: '_hosted', room: code });
      } else if (m.t === '_join') {
        const r = rooms.get(code);
        if (!r) return this.send({ t: '_err', msg: 'no such room' });
        if (r.nav && r.nav !== this) return this.send({ t: '_err', msg: 'full' });
        this.leave(); r.nav = this; this.room = code; this.role = 'nav'; this.send({ t: '_joined', room: code }); r.host.send({ t: '_peer', on: true });
      } else if (m.t[0] !== '_') {
        const o = this.other(); if (o) o.frame(1, Buffer.from(txt));
      } // '_ping' and other underscore messages are just keep-alive
    }
    leave() {
      const r = this.room && rooms.get(this.room); if (!r) return;
      if (r.host === this) { if (r.nav) { r.nav.send({ t: '_peer', on: false }); r.nav.room = null; } rooms.delete(this.room); }
      else if (r.nav === this) { r.nav = null; r.host.send({ t: '_peer', on: false }); }
      this.room = null;
    }
    onClose() { this.leave(); peers.delete(this); }
  }

  server.on('upgrade', (req, sock, head) => {
    const key = req.headers['sec-websocket-key'], origin = req.headers.origin || '';
    if (new URL(req.url, 'http://x').pathname !== path || !key) return sock.destroy();
    if (origins.length && !origins.some(re => re.test(origin))) {
      log('rejected origin', origin || '(none)');
      sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    if (peers.size >= maxPeers) { sock.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    const peer = new Peer(sock);
    if (head && head.length) peer.onData(head); // bytes that arrived bundled with the upgrade request
  });

  // heartbeat: ping everyone every 25 s, drop connections silent for 70 s (dead phones, closed laptops)
  const hb = setInterval(() => {
    const now = Date.now();
    for (const p of peers) { if (now - p.seen > 70000) p.sock.destroy(); else p.frame(9, Buffer.alloc(0)); }
  }, 25000);
  hb.unref();

  return { stats: () => ({ rooms: rooms.size, players: peers.size }) };
}

module.exports = { attachRelay };
