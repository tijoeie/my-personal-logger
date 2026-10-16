// My Personal Logger server: static PWA + JSON state API + n8n bank-feed ingest.
// Zero dependencies (Node 22): http, fs, crypto.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./store');
const { applyIngest, IngestError } = require('./ingest');
const { applyBalances, BalanceError } = require('./india-ingest');

const DAY = 86400000;
const MAX_BODY = 20 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Fingerprint of every file the app serves. It changes on any deploy that changes the app,
// and clients reload when they see a new one (X-Build header / version.json).
function buildId(dir) {
  const h = crypto.createHash('sha256');
  const walk = d => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else { h.update(path.relative(dir, full)); h.update(fs.readFileSync(full)); }
    }
  };
  try { walk(dir); } catch { h.update(String(Date.now())); }
  return h.digest('hex').slice(0, 12);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createServer(opts) {
  const { passphrase, ingestSecret, dataDir, publicDir, sessionDays = 90, ingestMaxAgeDays = 14 } = opts;
  if (!passphrase || !ingestSecret) throw new Error('APP_PASSPHRASE and INGEST_SECRET are required');
  const store = createStore(dataDir);
  const sessionMs = sessionDays * DAY;
  const loginHits = new Map(); // ip -> [timestamps]
  const build = buildId(publicDir);

  const send = (res, status, body, headers = {}) => {
    const isObj = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Build': build, ...(isObj ? { 'Content-Type': MIME['.json'] } : {}), ...headers });
    res.end(isObj ? JSON.stringify(body) : body);
  };

  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });

  const authed = req => {
    const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const s = store.sessions.get(m[1]);
    if (!s || Date.now() - s.createdAt > sessionMs) return null;
    return m[1];
  };

  const clientIp = req => req.socket.remoteAddress || '?';
  const loginLimited = ip => {
    const now = Date.now();
    const hits = (loginHits.get(ip) || []).filter(t => now - t < 60000);
    hits.push(now);
    loginHits.set(ip, hits);
    return hits.length > 5;
  };

  async function api(req, res, url) {
    const p = url.pathname;

    if (p === '/api/login' && req.method === 'POST') {
      if (loginLimited(clientIp(req))) return send(res, 429, { error: 'Too many attempts, wait a minute' });
      const { passphrase: given } = await readBody(req);
      if (!safeEqual(given, passphrase)) return send(res, 401, { error: 'Wrong passphrase' });
      const token = crypto.randomBytes(32).toString('hex');
      store.sessions.prune(sessionMs);
      store.sessions.set(token, { createdAt: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 100) });
      return send(res, 200, { token });
    }

    if (p === '/api/ingest' && req.method === 'POST') {
      const body = await readBody(req);
      const secret = req.headers['x-ingest-secret'] || body.secret;
      if (!safeEqual(secret, ingestSecret)) return send(res, 401, { error: 'Invalid secret' });
      // Guard against a mailbox replay: alerts older than the limit are acknowledged but not stored
      // (e.g. a trigger picking up hundreds of old unread emails). 0 disables the check.
      const txTime = Date.parse(String(body.date || '').slice(0, 10));
      if (ingestMaxAgeDays > 0 && txTime && Date.now() - txTime > ingestMaxAgeDays * DAY) {
        return send(res, 200, { ok: true, skipped: `older than ${ingestMaxAgeDays} days` });
      }
      let id;
      try {
        await store.update(d => {
          const S = d.state ? structuredClone(d.state) : {};
          id = applyIngest(S, body);
          return S;
        });
      } catch (e) {
        if (e instanceof IngestError) return send(res, e.status, { error: e.message });
        throw e;
      }
      return send(res, 200, { ok: true, id });
    }

    if (p === '/api/ingest-balance' && req.method === 'POST') {
      const body = await readBody(req);
      const secret = req.headers['x-ingest-secret'] || body.secret;
      if (!safeEqual(secret, ingestSecret)) return send(res, 401, { error: 'Invalid secret' });
      let result;
      try {
        await store.update(d => {
          if (!d.state) throw new BalanceError(409, 'no data yet');
          const S = structuredClone(d.state);
          result = applyBalances(S, body);
          if (!result.updated.length) throw Object.assign(new Error('nothing to change'), { noop: true });
          return S;
        });
      } catch (e) {
        if (e.noop) return send(res, 200, { ok: true, ...result });          // nothing changed: not an error
        if (e instanceof BalanceError) return send(res, e.status, { error: e.message });
        throw e;
      }
      return send(res, 200, { ok: true, ...result });
    }

    const token = authed(req);
    if (!token) return send(res, 401, { error: 'Not signed in' });

    if (p === '/api/logout' && req.method === 'POST') {
      store.sessions.del(token);
      return send(res, 204, '');
    }

    if (p === '/api/state' && req.method === 'GET') {
      const d = store.get();
      if (url.searchParams.get('since') === String(d.rev)) return send(res, 304, '');
      return send(res, 200, d);
    }

    if (p === '/api/state' && req.method === 'PUT') {
      const { baseRev, state } = await readBody(req);
      if (!state || typeof state !== 'object' || !state.settings || !Array.isArray(state.expenses)) {
        return send(res, 400, { error: 'state must be a full app state object' });
      }
      const cur = store.get();
      if (baseRev !== cur.rev) return send(res, 409, cur);
      const d = await store.update(doc => {
        // re-check inside the queue: an ingest may have landed meanwhile
        if (doc.rev !== cur.rev) throw Object.assign(new Error('conflict'), { status: 409 });
        return state;
      }).catch(e => { if (e.status === 409) return null; throw e; });
      if (!d) return send(res, 409, store.get());
      return send(res, 200, { rev: d.rev, updatedAt: d.updatedAt });
    }

    return send(res, 404, { error: 'Not found' });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, 'Forbidden');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found');
      const ext = path.extname(file);
      // version.json and the service worker must never be cached; the rest revalidates
      const noStore = rel === '/version.json' || rel === '/sw.js';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': noStore ? 'no-store' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(file).pipe(res);
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // One line per API call (method, path, status, size, ms). Never bodies or headers.
    if (url.pathname.startsWith('/api/')) {
      const t0 = Date.now();
      res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} in=${req.headers['content-length'] || 0} ${Date.now() - t0}ms`));
    }
    try {
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      if (url.pathname === '/version.json') {
        let version = '';
        try { version = JSON.parse(fs.readFileSync(path.join(publicDir, 'version.json'), 'utf8')).version || ''; } catch { /* no label */ }
        return send(res, 200, { version, build });
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      if (!e.status) console.error(e);
    }
  });
}

if (require.main === module) {
  const env = process.env;
  const server = createServer({
    passphrase: env.APP_PASSPHRASE,
    ingestSecret: env.INGEST_SECRET,
    dataDir: path.resolve(env.DATA_DIR || '/data'),
    publicDir: path.resolve(env.PUBLIC_DIR || path.join(__dirname, '..', 'public')),
    sessionDays: Number(env.SESSION_DAYS) || 90,
    ingestMaxAgeDays: env.INGEST_MAX_AGE_DAYS !== undefined ? Number(env.INGEST_MAX_AGE_DAYS) : 14,
  });
  const port = Number(env.PORT) || 3000;
  server.listen(port, () => console.log(`logger listening on :${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createServer, buildId };
