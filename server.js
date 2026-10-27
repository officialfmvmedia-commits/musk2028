// Musk2028 — site + petition API. Plain Node http server, SQLite storage.
// Optional integrations (enabled only when env vars are present — nothing is faked):
//   SMTP_URL + FROM_EMAIL        -> email confirmation links (else email stays unverified)
//   X_CLIENT_ID (+ X_CLIENT_SECRET) + X_REDIRECT_URI -> "Verify with X" OAuth 2.0 PKCE
//   ADMIN_TOKEN                  -> enables GET /admin/export.csv
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- tiny .env loader (no dependency) ----
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const PORT = Number(process.env.PORT || 4980);
const HOST = process.env.HOST || '0.0.0.0';
const ON_RENDER = !!process.env.RENDER;
const PUBLIC_URL = (process.env.PUBLIC_URL || (ON_RENDER ? 'https://musk2028.vote' : `http://127.0.0.1:${PORT}`)).replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'musk2028.db');
const IP_SALT = process.env.IP_SALT || 'musk2028-ip-salt';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const SMTP_ENABLED = !!(process.env.SMTP_URL && process.env.FROM_EMAIL);
const X_ENABLED = !!(process.env.X_CLIENT_ID && process.env.X_REDIRECT_URI);
const RATE_LIMIT_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 5);

let db; // set in start()
let mailer = null;
if (SMTP_ENABLED) {
  try { mailer = require('nodemailer').createTransport(process.env.SMTP_URL); }
  catch (e) { console.error('SMTP configured but nodemailer failed to load:', e.message); }
}

const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP'.split(' '));

// ---- helpers ----
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
const clientIp = (req) => (process.env.TRUST_PROXY || process.env.RENDER ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SEC_HEADERS, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const json = (res, status, obj) => send(res, status, obj, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
const redirect = (res, loc) => { res.writeHead(302, { Location: loc, ...SEC_HEADERS }); res.end(); };

function readJson(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

// ---- stats / public data (never exposes emails, X ids, or full last names) ----
async function stats() {
  const r = (await db.get(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN x_verified=1 THEN 1 ELSE 0 END) AS x_verified,
      SUM(CASE WHEN email_verified=1 THEN 1 ELSE 0 END) AS email_verified,
      COUNT(DISTINCT state) AS states FROM signatures`));
  return { total: Number(r.total || 0), xVerified: Number(r.x_verified || 0), emailVerified: Number(r.email_verified || 0), states: Number(r.states || 0) };
}
async function recent(limit = 12) {
  return (await db.all(`SELECT first_name, last_initial, state, x_verified, email_verified, created_at FROM signatures ORDER BY id DESC LIMIT ?`, [limit]))
    .map((r) => ({ name: r.first_name + (r.last_initial ? ` ${r.last_initial}.` : ''), state: r.state || null, xVerified: !!r.x_verified, emailVerified: !!r.email_verified, at: r.created_at }));
}

// ---- validation ----
function clean(s, max) { return String(s ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function validate(b) {
  const errors = {};
  const full_name = clean(b.name, 80);
  if (full_name.length < 2 || !/\p{L}/u.test(full_name)) errors.name = 'Please enter your full name.';
  if (/https?:|www\.|@/i.test(full_name)) errors.name = 'Names can’t contain links or handles.';
  let zip = clean(b.zip, 10) || null;
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = 'ZIP should look like 12345.';
  let state = clean(b.state, 2).toUpperCase() || null;
  if (state && !US_STATES.has(state)) errors.state = 'Pick a state from the list.';
  let email = clean(b.email, 254).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'That email doesn’t look right.';
  if (b.consent !== true) errors.consent = 'Please confirm the statement to sign.';
  const parts = full_name.split(' ');
  const first_name = parts[0] || '';
  const last_initial = parts.length > 1 ? (parts[parts.length - 1][0] || '').toUpperCase() : '';
  return { errors, data: { full_name, first_name, last_initial, zip, state, email, opt_in: b.optIn === true && !!email ? 1 : 0 } };
}

// ---- in-memory short-window limiter (plus a DB-backed hourly cap) ----
const hits = new Map();
function burstLimited(key, max = 10, windowMs = 60_000) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr); return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k); }, 60_000).unref();

async function sendConfirmEmail(sig, token) {
  if (!mailer) return false;
  const link = `${PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const del = `${PUBLIC_URL}/remove?id=${sig.id}&token=${encodeURIComponent(sig.manage_token)}`;
  await mailer.sendMail({
    from: process.env.FROM_EMAIL, to: sig.email,
    subject: 'Confirm your Musk2028 signature',
    text: `Thanks for signing the Musk2028 petition, ${sig.first_name}.\n\nConfirm your signature: ${link}\n\nDidn't sign? Ignore this email, or remove the signature here: ${del}\n\nMusk2028 is an independent grassroots movement, not affiliated with Elon Musk or any of his companies.`,
    html: `<p>Thanks for signing the Musk2028 petition, ${esc(sig.first_name)}.</p><p><a href="${link}">Confirm your signature</a></p><p style="color:#666;font-size:13px">Didn't sign? Ignore this email, or <a href="${del}">remove the signature</a>.<br>Musk2028 is an independent grassroots movement, not affiliated with Elon Musk or any of his companies.</p>`,
  });
  return true;
}

// ---- X OAuth 2.0 (Authorization Code + PKCE) ----
const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const X_ME = 'https://api.x.com/2/users/me';

async function xStart(res, sigId, manageToken) {
  const sig = (await db.get('SELECT id, manage_token FROM signatures WHERE id=?', [sigId]));
  if (!sig || !safeEq(sig.manage_token, manageToken || '')) return redirect(res, '/?x=invalid#sign');
  const state = rand(24), verifier = rand(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  (await db.run('DELETE FROM oauth_states WHERE created_at < ?', [Date.now() - 15 * 60_000]));
  (await db.run('INSERT INTO oauth_states(state, verifier, signature_id, created_at) VALUES (?,?,?,?)', [state, verifier, sig.id, Date.now()]));
  const q = new URLSearchParams({ response_type: 'code', client_id: process.env.X_CLIENT_ID, redirect_uri: process.env.X_REDIRECT_URI,
    scope: 'users.read tweet.read', state, code_challenge: challenge, code_challenge_method: 'S256' });
  redirect(res, `${X_AUTHORIZE}?${q}`);
}

async function xCallback(res, params) {
  const state = params.get('state'), code = params.get('code');
  if (params.get('error') || !state || !code) return redirect(res, '/?x=cancelled#sign');
  const row = (await db.get('SELECT * FROM oauth_states WHERE state=?', [state]));
  (await db.run('DELETE FROM oauth_states WHERE state=?', [state]));
  if (!row || Date.now() - row.created_at > 15 * 60_000) return redirect(res, '/?x=expired#sign');
  try {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.X_REDIRECT_URI, code_verifier: row.verifier, client_id: process.env.X_CLIENT_ID });
    if (process.env.X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
    const tr = await fetch(X_TOKEN, { method: 'POST', headers, body });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) throw new Error('token ' + tr.status + ' ' + JSON.stringify(tok).slice(0, 200));
    const mr = await fetch(X_ME, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const me = await mr.json();
    if (!mr.ok || !me.data?.id) throw new Error('me ' + mr.status);
    // Best effort: revoke the token, we only needed identity.
    fetch('https://api.x.com/2/oauth2/revoke', { method: 'POST', headers, body: new URLSearchParams({ token: tok.access_token, token_type_hint: 'access_token', client_id: process.env.X_CLIENT_ID }) }).catch(() => {});
    const dupe = (await db.get('SELECT id FROM signatures WHERE x_id=? AND id<>?', [me.data.id, row.signature_id]));
    if (dupe) return redirect(res, '/?x=duplicate#sign');
    (await db.run('UPDATE signatures SET x_id=?, x_handle=?, x_verified=1 WHERE id=?', [me.data.id, me.data.username, row.signature_id]));
    redirect(res, `/?x=verified&handle=${encodeURIComponent(me.data.username)}#sign`);
  } catch (e) {
    console.error('X OAuth failed:', e.message);
    redirect(res, '/?x=error#sign');
  }
}

// ---- static files ----
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const PUB = path.join(__dirname, 'public');
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/privacy') pathname = '/privacy.html';
  if (pathname === '/manifesto') pathname = '/manifesto.html';
  const file = path.normalize(path.join(PUB, pathname));
  if (!file.startsWith(PUB)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return fs.readFile(path.join(PUB, '404.html'), (e2, b2) => send(res, 404, e2 ? 'Not found' : b2, 'text/html; charset=utf-8'));
    const ext = path.extname(file);
    send(res, 200, buf, MIME[ext] || 'application/octet-stream', { 'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600' });
  });
}

function page(title, msg, ok = true) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Musk2028</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/favicon.svg"></head><body class="simple"><main class="simple-card"><a class="brand" href="/">MUSK<span>2028</span></a><h1>${esc(title)}</h1><p>${msg}</p><a class="btn btn-red" href="/">${ok ? 'Back to the movement' : 'Go home'}</a></main></body></html>`;
}

// ---- router ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true });

    if (p === '/api/config' && req.method === 'GET')
      return json(res, 200, { xEnabled: X_ENABLED, emailVerification: SMTP_ENABLED && !!mailer, contactEmail: CONTACT_EMAIL || null });

    if (p === '/api/stats' && req.method === 'GET') return json(res, 200, { ...(await stats()), recent: await recent() });

    if (p === '/api/sign' && req.method === 'POST') {
      const ip = clientIp(req); const ipHash = sha(IP_SALT + ip);
      if (burstLimited('sign:' + ipHash, 3, 60_000)) return json(res, 429, { error: 'Too many attempts. Please wait a minute.' });
      const body = await readJson(req);
      // Honeypot: real people never fill the hidden "website" field. Pretend success, store nothing.
      if (body.website) return json(res, 200, { ok: true, id: 0, stats: await stats() });
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const n = Number((await db.get('SELECT COUNT(*) AS n FROM signatures WHERE ip_hash=? AND created_at > ?', [ipHash, hourAgo])).n);
      if (n >= RATE_LIMIT_PER_HOUR) return json(res, 429, { error: 'Too many signatures from this network in the last hour. Please try again later.' });
      const { errors, data } = validate(body);
      if (Object.keys(errors).length) return json(res, 400, { error: 'Please fix the highlighted fields.', fields: errors });
      if (data.email && (await db.get('SELECT 1 FROM signatures WHERE email=?', [data.email])))
        return json(res, 409, { error: 'That email has already signed. Thank you!', fields: { email: 'Already signed with this email.' } });
      const manage = rand(24);
      const emailToken = data.email && mailer ? rand(24) : null;
      const r = (await db.run(`INSERT INTO signatures(full_name, first_name, last_initial, zip, state, email, opt_in, consent, email_token, manage_token, ip_hash, created_at)
        VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`, [data.full_name, data.first_name, data.last_initial, data.zip, data.state, data.email, data.opt_in, emailToken, manage, ipHash, new Date().toISOString()]));
      const id = r.lastId;
      let emailSent = false;
      if (emailToken) {
        try { emailSent = await sendConfirmEmail({ id, email: data.email, first_name: data.first_name, manage_token: manage }, emailToken); }
        catch (e) { console.error('Confirmation email failed:', e.message); }
      }
      return json(res, 201, { ok: true, id, manageToken: manage, firstName: data.first_name, emailSent, emailVerification: !!mailer, xEnabled: X_ENABLED, stats: await stats() });
    }

    if (p === '/api/remove' && req.method === 'POST') {
      const b = await readJson(req);
      const sig = (await db.get('SELECT id, manage_token FROM signatures WHERE id=?', [Number(b.id) || 0]));
      if (!sig || !safeEq(sig.manage_token, b.token || '')) return json(res, 404, { error: 'Signature not found.' });
      (await db.run('DELETE FROM signatures WHERE id=?', [sig.id]));
      return json(res, 200, { ok: true, stats: await stats() });
    }

    if (p === '/api/me' && req.method === 'POST') {
      const b = await readJson(req);
      const sig = (await db.get('SELECT id, first_name, x_verified, x_handle, email_verified, email IS NOT NULL AS has_email, manage_token FROM signatures WHERE id=?', [Number(b.id) || 0]));
      if (!sig || !safeEq(sig.manage_token, b.token || '')) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { id: sig.id, firstName: sig.first_name, xVerified: !!sig.x_verified, xHandle: sig.x_handle, emailVerified: !!sig.email_verified, hasEmail: !!sig.has_email });
    }

    if (p === '/remove' && req.method === 'GET') {
      // Email link: show a confirm page; the actual delete is a POST from the page script.
      return serveStatic(req, res, '/remove.html');
    }

    if (p === '/verify-email' && req.method === 'GET') {
      const t = url.searchParams.get('token') || '';
      const sig = t && (await db.get('SELECT id FROM signatures WHERE email_token=?', [t]));
      if (!sig) return send(res, 400, page('Link expired', 'This confirmation link is invalid or was already used.', false), 'text/html; charset=utf-8');
      (await db.run('UPDATE signatures SET email_verified=1, email_token=NULL WHERE id=?', [sig.id]));
      return send(res, 200, page('Signature confirmed', 'Your email is verified and your signature now counts as confirmed. Thank you for standing up.'), 'text/html; charset=utf-8');
    }

    if (p === '/auth/x/start' && req.method === 'GET') {
      if (!X_ENABLED) return redirect(res, '/?x=unavailable#sign');
      return await xStart(res, Number(url.searchParams.get('id')) || 0, url.searchParams.get('token'));
    }
    if (p === '/auth/x/callback' && req.method === 'GET') {
      if (!X_ENABLED) return redirect(res, '/?x=unavailable#sign');
      return xCallback(res, url.searchParams);
    }

    if (p === '/admin/export.csv' && req.method === 'GET') {
      const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
      if (!ADMIN_TOKEN || !safeEq(given, ADMIN_TOKEN)) return send(res, 401, 'Unauthorized', 'text/plain', { 'WWW-Authenticate': 'Bearer' });
      const rows = (await db.all('SELECT id, full_name, zip, state, email, opt_in, email_verified, x_handle, x_verified, created_at FROM signatures ORDER BY id'));
      const cols = ['id', 'full_name', 'zip', 'state', 'email', 'opt_in', 'email_verified', 'x_handle', 'x_verified', 'created_at'];
      const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
      return send(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="musk2028-signatures.csv"', 'Cache-Control': 'no-store' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    if (e.message === 'too_large' || e.message === 'bad_json') return json(res, 400, { error: 'Bad request.' });
    console.error(e);
    return json(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

async function start() {
  db = await require('./db').open({ databaseUrl: process.env.DATABASE_URL, sqlitePath: DB_PATH });
  server.listen(PORT, HOST, () => {
  console.log(`  storage:            ${db.kind}`);
  console.log(`Musk2028 running on ${PUBLIC_URL} (listening ${HOST}:${PORT})`);
  console.log(`  email verification: ${SMTP_ENABLED ? 'ON' : 'off (set SMTP_URL + FROM_EMAIL)'}`);
  console.log(`  verify with X:      ${X_ENABLED ? 'ON' : 'off (set X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI)'}`);
  console.log(`  admin CSV export:   ${ADMIN_TOKEN ? 'ON' : 'off (set ADMIN_TOKEN)'}`);
});
}
start().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
