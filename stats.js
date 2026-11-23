// Anonymous play counters for Blind Stage. The game posts small JSON events (sendBeacon, text/plain);
// we keep only totals in memory and print one log line per event (Render keeps logs for a few days).
// Nothing personal is stored: no ids, no IPs (the rate limiter holds an IP for at most a minute).
'use strict';

const EVENTS = new Set(['load', 'quick', 'coached', 'start', 'finish', 'quit', 'restart', 'leave', 'coop']);
const PORTALS = new Set(['web', 'crazygames', 'gamejolt', 'newgrounds', 'y8', 'gamedistribution', 'kongregate']);
const VIS = new Set(['clear', 'dim', 'blind']);

function createStats(opts) {
  const isAllowed = opts.isAllowed, log = opts.log || (() => { });
  const since = new Date().toISOString();
  const t = { events: {}, portals: {}, stages: {}, sessions: 0, newPlayers: 0, playSecs: 0, quickStarts: 0, coached: 0, coop: 0 };
  const bucket = new Map(); // ip -> {n, reset}
  setInterval(() => { const now = Date.now(); for (const [k, b] of bucket) if (b.reset < now) bucket.delete(k); }, 60e3).unref();

  const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; };
  const stage = id => { const k = String(id); return t.stages[k] || (t.stages[k] = { starts: 0, finishes: 0, quits: 0, restarts: 0, quitProgSum: 0, bestTime: null, timeSum: 0, crashSecs: 0 }); };

  function record(d) {
    const e = d.e, p = PORTALS.has(d.p) ? d.p : 'other';
    t.events[e] = (t.events[e] || 0) + 1;
    t.portals[p] = (t.portals[p] || 0) + (e === 'load' ? 1 : 0);
    const s = num(d.s, 1, 999999), sk = s == null ? null : (s >= 10000 ? (s < 100000 ? 'daily' : 'code') : String(Math.round(s)));
    if (e === 'load') { t.sessions++; if (d.newp) t.newPlayers++; }
    else if (e === 'quick') t.quickStarts++;
    else if (e === 'coached') t.coached++;
    else if (e === 'coop') t.coop++;
    else if (e === 'leave') { const secs = num(d.secs, 0, 6 * 3600); if (secs != null) t.playSecs += secs; }
    if (sk && (e === 'start' || e === 'finish' || e === 'quit' || e === 'restart')) {
      const S = stage(sk);
      if (e === 'start') S.starts++;
      else if (e === 'finish') { S.finishes++; const tm = num(d.t, 0, 3600); if (tm != null) { S.timeSum += tm; S.bestTime = S.bestTime == null ? tm : Math.min(S.bestTime, tm); } S.crashSecs += num(d.pen, 0, 3600) || 0; }
      else { S[e === 'quit' ? 'quits' : 'restarts']++; if (e === 'quit') S.quitProgSum += num(d.prog, 0, 100) || 0; }
    }
    // one compact line per event, for reading in the host's log viewer
    log('EV', JSON.stringify({ e, p, s: sk, v: String(d.v || '').slice(0, 12), vis: VIS.has(d.vis) ? d.vis : undefined, t: num(d.t, 0, 3600) ?? undefined, prog: num(d.prog, -1, 100) ?? undefined, secs: num(d.secs, 0, 21600) ?? undefined, q: d.q ? 1 : undefined }));
  }

  function handle(req, res) {
    const origin = req.headers.origin || 'null';
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' }); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    if (!isAllowed(origin)) { res.writeHead(403); return res.end(); }
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now(); let b = bucket.get(ip); if (!b || b.reset < now) { b = { n: 0, reset: now + 60e3 }; bucket.set(ip, b); }
    if (++b.n > 40) { res.writeHead(429); return res.end(); }
    let body = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 2048) { req.destroy(); return; } body += c; });
    req.on('end', () => {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end();
      let d; try { d = JSON.parse(body); } catch (e) { return; }
      if (d && typeof d === 'object' && EVENTS.has(d.e)) record(d);
    });
  }

  function summary() {
    const stages = {};
    for (const [k, S] of Object.entries(t.stages)) stages[k] = {
      starts: S.starts, finishes: S.finishes, quits: S.quits, restarts: S.restarts,
      finishRate: S.starts ? Math.round(100 * S.finishes / S.starts) + '%' : null,
      avgQuitAt: S.quits ? Math.round(S.quitProgSum / S.quits) + '%' : null,
      avgTime: S.finishes ? Math.round(10 * S.timeSum / S.finishes) / 10 : null, bestTime: S.bestTime,
      avgCrashSecs: S.finishes ? Math.round(10 * S.crashSecs / S.finishes) / 10 : null
    };
    const leaves = t.events.leave || 0;
    return {
      since, note: 'Totals since the server last started (the free host sleeps after ~15 min idle, which resets them). Every event is also in the host log as an "EV" line.',
      sessions: t.sessions, newPlayers: t.newPlayers, avgSessionSecs: leaves ? Math.round(t.playSecs / leaves) : null,
      quickStarts: t.quickStarts, guideCompleted: t.coached, coopConnections: t.coop, byPortal: t.portals, events: t.events, stages
    };
  }
  return { handle, summary };
}
module.exports = { createStats };
