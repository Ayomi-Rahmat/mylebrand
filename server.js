'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool, types } = require('pg');
const crypto = require('crypto');
const path = require('path');
const { promisify } = require('util');
const { STAGES, STAGE_INDEX } = require('./stages');

const scrypt = promisify(crypto.scrypt);
types.setTypeParser(20, (v) => Number(v)); // Postgres BIGINT/COUNT come back as text by default; make them numbers

// ---------- config ----------
const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const WHATSAPP = (process.env.WHATSAPP_NUMBER || '2349043045498').replace(/\D/g, '');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Paste your Postgres (Neon) connection string into it. See README.md.');
  process.exit(1);
}
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  if (PROD) {
    console.error('ADMIN_PASSWORD must be set when NODE_ENV=production.');
    process.exit(1);
  }
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.log(`[dev] No ADMIN_PASSWORD set. Temporary admin password: ${ADMIN_PASSWORD}`);
}
if (PROD && ADMIN_PASSWORD.length < 10) {
  console.error('ADMIN_PASSWORD must be at least 10 characters in production.');
  process.exit(1);
}

// ---------- database ----------
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 20000,        // close idle connections ourselves, before the database's own sleep timer does
  connectionTimeoutMillis: 20000,  // a sleeping free database can take a moment to wake
});
// A pooled connection dropped by the database must not crash the app.
pool.on('error', (e) => console.error('[db] idle connection error:', e.message));

const CONN_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006']);
const isConnErr = (e) => CONN_CODES.has(e.code) || /Connection terminated|terminated unexpectedly/i.test(e.message || '');

// One query, retried once if the connection had gone stale (for example the database was asleep).
async function q(text, params) {
  try { return await pool.query(text, params); }
  catch (e) { if (isConnErr(e)) return pool.query(text, params); throw e; }
}
// Several changes as one all-or-nothing step.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS batches (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      delivery_from TEXT,
      delivery_to TEXT,
      lagos_eta TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      public_id TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '',
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until BIGINT NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_events ON events (batch_id, COALESCE(order_id, 0), stage);
    CREATE INDEX IF NOT EXISTS ix_orders_batch ON orders (batch_id);
    CREATE INDEX IF NOT EXISTS ix_events_order ON events (order_id);
  `);
}

// ---------- helpers ----------
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to avoid mix-ups
function newPublicId() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return 'MYLE-' + s;
}
function normId(x) {
  const t = String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t.length === 10 && t.startsWith('MYLE') ? 'MYLE-' + t.slice(4) : '';
}
function newPin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
// scrypt runs on a background thread, so hashing never freezes the site for other visitors.
async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pin, salt, 32);
  return salt.toString('hex') + ':' + h.toString('hex');
}
async function verifyPin(pin, stored) {
  const [s, h] = stored.split(':');
  const calc = await scrypt(pin, Buffer.from(s, 'hex'), 32);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}
let DUMMY_HASH; // used so unknown IDs cost the same time as known ones
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function parseAt(v) {
  const d = v ? new Date(v) : new Date();
  if (isNaN(d.getTime())) throw httpError(400, 'That date and time is not valid.');
  if (d.getTime() > Date.now() + 5 * 60 * 1000) throw httpError(400, 'The time cannot be in the future.');
  return d.toISOString();
}
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw httpError(400, 'One of the dates is not valid.');
  return d.toISOString().slice(0, 10);
};
// Ids from the URL must be whole numbers, otherwise Postgres would throw a confusing error.
function intId(v, what) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw httpError(404, (what || 'Item') + ' not found.');
  return n;
}

// Builds the full journey from event rows: batch-wide stages + that order's own stages.
function timelineFrom(rows) {
  const byStage = {};
  for (const r of rows) byStage[r.stage] = r;
  let currentIndex = -1;
  STAGES.forEach((s, i) => { if (byStage[s.key]) currentIndex = i; });
  const stages = STAGES.map((s, i) => {
    const ev = byStage[s.key];
    const next = STAGES[i + 1] && byStage[STAGES[i + 1].key];
    let status = 'upcoming';
    if (ev) status = next || i === STAGES.length - 1 ? 'done' : 'current';
    return {
      key: s.key, title: s.title, desc: s.desc, phase: s.phase,
      inLabel: s.inLabel, outLabel: s.outLabel,
      status, at: ev ? ev.at : null, leftAt: ev && next ? next.at : null, note: ev ? ev.note : '',
    };
  });
  const updatedAt = rows.reduce((m, r) => (r.at > m ? r.at : m), '');
  return { stages, currentIndex, updatedAt: updatedAt || null };
}

// ---------- admin sessions (kept in the database, so they survive the free server going to sleep) ----------
const SESSION_MS = 12 * 60 * 60 * 1000;
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
async function isAdmin(req) {
  const t = cookies(req).mb_admin;
  if (!t || t.length > 100) return false;
  const { rows } = await q('SELECT expires_at FROM admin_sessions WHERE token_hash = $1', [sha(t)]);
  if (!rows.length) return false;
  if (rows[0].expires_at < Date.now()) {
    await q('DELETE FROM admin_sessions WHERE token_hash = $1', [sha(t)]);
    return false;
  }
  return true;
}
async function requireAdmin(req, res, next) {
  if (!(await isAdmin(req))) return res.status(401).json({ error: 'Please log in.' });
  next();
}
// Extra guard against cross-site requests on anything that changes data.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Blocked.' });
    } catch (e) { return res.status(403).json({ error: 'Blocked.' }); }
  }
  if (req.body !== undefined && req.headers['content-length'] !== '0' && !req.is('json')) {
    return res.status(415).json({ error: 'Send JSON.' });
  }
  next();
}

// ---------- app ----------
const app = express();
if (PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');

// Used by an uptime pinger to keep the free server awake. It deliberately does NOT touch the database,
// so pings never wake the database or use up its free monthly hours.
app.get('/healthz', (req, res) => res.type('text/plain').set('Cache-Control', 'no-store').send('ok'));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Counted in memory per device. The real protection is the per-order lockout below, which lives in the database.
const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts from this device. Please wait a few minutes, or message us on WhatsApp.' },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ---------- customer: look up one order ----------
app.post('/api/track', trackLimiter, async (req, res) => {
  const GENERIC = { error: 'We could not find an order with that ID and PIN. Please check and try again.' };
  const id = normId(req.body && req.body.id);
  const pin = String((req.body && req.body.pin) || '').replace(/\s/g, '');
  if (!id || !/^\d{6}$/.test(pin)) return res.status(401).json(GENERIC);

  const { rows } = await q(
    `SELECT o.*, b.name AS batch_name, b.delivery_from, b.delivery_to, b.lagos_eta
       FROM orders o JOIN batches b ON b.id = o.batch_id WHERE o.public_id = $1`, [id]);
  const order = rows[0];
  if (!order) {
    await verifyPin(pin, DUMMY_HASH);
    return res.status(401).json(GENERIC);
  }
  const now = Date.now();
  if (order.locked_until > now) {
    return res.status(429).json({ error: 'Too many wrong attempts on this order. Please wait 15 minutes, or message us on WhatsApp.' });
  }
  if (!(await verifyPin(pin, order.pin_hash))) {
    // Counted inside the database in one step, so simultaneous guesses cannot slip past the limit.
    const upd = await q(
      `UPDATE orders SET
         failed_count = CASE WHEN failed_count + 1 >= 5 THEN 0 ELSE failed_count + 1 END,
         locked_until = CASE WHEN failed_count + 1 >= 5 THEN $2::bigint ELSE locked_until END
       WHERE id = $1 RETURNING locked_until`, [order.id, now + 15 * 60 * 1000]);
    if (upd.rows[0] && upd.rows[0].locked_until > now) {
      return res.status(429).json({ error: 'Too many wrong attempts on this order. Please wait 15 minutes, or message us on WhatsApp.' });
    }
    return res.status(401).json(GENERIC);
  }
  if (order.failed_count) await q('UPDATE orders SET failed_count = 0 WHERE id = $1', [order.id]);

  const ev = await q(
    'SELECT stage, at, note FROM events WHERE batch_id = $1 AND (order_id IS NULL OR order_id = $2)', [order.batch_id, order.id]);
  const tl = timelineFrom(ev.rows);
  res.json({
    firstName: order.customer_name.split(/\s+/)[0],
    orderId: order.public_id,
    items: order.items,
    batch: { name: order.batch_name, deliveryFrom: order.delivery_from, deliveryTo: order.delivery_to, lagosEta: order.lagos_eta },
    stages: tl.stages,
    currentIndex: tl.currentIndex,
    updatedAt: tl.updatedAt,
    whatsapp: WHATSAPP,
  });
});

// ---------- admin: auth ----------
app.post('/api/admin/login', loginLimiter, sameOrigin, async (req, res) => {
  const pw = req.body && req.body.password;
  if (typeof pw !== 'string' || !safeEqual(pw, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await q('DELETE FROM admin_sessions WHERE expires_at < $1', [Date.now()]);
  await q('INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)', [sha(token), Date.now() + SESSION_MS]);
  res.setHeader(
    'Set-Cookie',
    `mb_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${PROD ? '; Secure' : ''}`
  );
  res.json({ ok: true });
});
app.post('/api/admin/logout', sameOrigin, async (req, res) => {
  const t = cookies(req).mb_admin;
  if (t && t.length <= 100) await q('DELETE FROM admin_sessions WHERE token_hash = $1', [sha(t)]);
  res.setHeader('Set-Cookie', `mb_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PROD ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.get('/api/admin/me', async (req, res) => res.json({ loggedIn: await isAdmin(req) }));

// Everything below needs a logged-in admin.
app.use('/api/admin', requireAdmin, sameOrigin);

app.get('/api/admin/stages', (req, res) => res.json({ stages: STAGES }));

// ---------- admin: batches ----------
app.get('/api/admin/batches', async (req, res) => {
  const [bs, ev, cnt] = await Promise.all([
    q('SELECT * FROM batches ORDER BY id DESC'),
    q('SELECT batch_id, stage, at, note FROM events WHERE order_id IS NULL'),
    q('SELECT batch_id, COUNT(*) AS n FROM orders GROUP BY batch_id'),
  ]);
  const counts = Object.fromEntries(cnt.rows.map((r) => [r.batch_id, r.n]));
  const batches = bs.rows.map((b) => {
    const events = ev.rows.filter((e) => e.batch_id === b.id).map((e) => ({ stage: e.stage, at: e.at, note: e.note }));
    let currentIndex = -1;
    events.forEach((e) => { currentIndex = Math.max(currentIndex, STAGE_INDEX[e.stage]); });
    return {
      id: b.id, name: b.name, deliveryFrom: b.delivery_from, deliveryTo: b.delivery_to, lagosEta: b.lagos_eta,
      orderCount: counts[b.id] || 0, events, currentIndex,
    };
  });
  res.json({ batches });
});
app.post('/api/admin/batches', async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  if (!name) throw httpError(400, 'Give the batch a name.');
  const r = await q(
    'INSERT INTO batches (name, delivery_from, delivery_to, lagos_eta, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [name, dateOrNull(b.deliveryFrom), dateOrNull(b.deliveryTo), dateOrNull(b.lagosEta), new Date().toISOString()]);
  res.json({ id: r.rows[0].id });
});
app.patch('/api/admin/batches/:id', async (req, res) => {
  const id = intId(req.params.id, 'Batch');
  const cur = (await q('SELECT * FROM batches WHERE id = $1', [id])).rows[0];
  if (!cur) throw httpError(404, 'Batch not found.');
  const b = req.body || {};
  await q('UPDATE batches SET name = $1, delivery_from = $2, delivery_to = $3, lagos_eta = $4 WHERE id = $5', [
    clean(b.name, 80) || cur.name,
    'deliveryFrom' in b ? dateOrNull(b.deliveryFrom) : cur.delivery_from,
    'deliveryTo' in b ? dateOrNull(b.deliveryTo) : cur.delivery_to,
    'lagosEta' in b ? dateOrNull(b.lagosEta) : cur.lagos_eta,
    id,
  ]);
  res.json({ ok: true });
});
app.delete('/api/admin/batches/:id', async (req, res) => {
  await q('DELETE FROM batches WHERE id = $1', [intId(req.params.id, 'Batch')]);
  res.json({ ok: true });
});

// Record a batch-wide stage (e.g. "On the ship").
app.post('/api/admin/batches/:id/stages', async (req, res) => {
  const batchId = intId(req.params.id, 'Batch');
  const batch = (await q('SELECT id FROM batches WHERE id = $1', [batchId])).rows[0];
  if (!batch) throw httpError(404, 'Batch not found.');
  const stage = STAGES[STAGE_INDEX[req.body && req.body.stage]];
  if (!stage || stage.scope !== 'batch') throw httpError(400, 'That step is not a batch-wide step.');
  const idx = STAGE_INDEX[stage.key];
  const at = parseAt(req.body.at);
  const note = clean(req.body.note, 200);
  const have = await q('SELECT stage, at FROM events WHERE batch_id = $1 AND order_id IS NULL', [batchId]);
  const byStage = Object.fromEntries(have.rows.map((r) => [r.stage, r]));
  if (byStage[stage.key]) throw httpError(409, 'That step is already recorded.');
  if (idx > 0) {
    const prev = byStage[STAGES[idx - 1].key];
    if (!prev) throw httpError(400, `Record "${STAGES[idx - 1].title}" first.`);
    if (at < prev.at) throw httpError(400, 'That time is earlier than the previous step.');
  }
  try {
    await q('INSERT INTO events (batch_id, order_id, stage, at, note) VALUES ($1, NULL, $2, $3, $4)', [batchId, stage.key, at, note]);
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'That step is already recorded.');
    throw e;
  }
  res.json({ ok: true });
});
// Undo the latest batch-wide stage.
app.delete('/api/admin/batches/:id/stages/:stage', async (req, res) => {
  const batchId = intId(req.params.id, 'Batch');
  const idx = STAGE_INDEX[req.params.stage];
  if (idx === undefined || STAGES[idx].scope !== 'batch') throw httpError(400, 'Unknown step.');
  const nextKey = STAGES[idx + 1] && STAGES[idx + 1].key;
  if (nextKey) {
    const later = await q('SELECT 1 FROM events WHERE batch_id = $1 AND order_id IS NULL AND stage = $2', [batchId, nextKey]);
    if (later.rows.length) throw httpError(400, 'Undo the latest step first.');
  }
  if (STAGES[idx].key === 'customs') {
    const used = await q('SELECT 1 FROM events WHERE batch_id = $1 AND order_id IS NOT NULL LIMIT 1', [batchId]);
    if (used.rows.length) throw httpError(400, 'Some customers already have delivery steps recorded. Undo those first.');
  }
  await q('DELETE FROM events WHERE batch_id = $1 AND order_id IS NULL AND stage = $2', [batchId, req.params.stage]);
  res.json({ ok: true });
});

// ---------- admin: orders ----------
app.get('/api/admin/batches/:id/orders', async (req, res) => {
  const batchId = intId(req.params.id, 'Batch');
  const [os, ev] = await Promise.all([
    q('SELECT * FROM orders WHERE batch_id = $1 ORDER BY id DESC', [batchId]),
    q('SELECT order_id, stage, at, note FROM events WHERE batch_id = $1', [batchId]),
  ]);
  const shared = ev.rows.filter((e) => e.order_id === null);
  const own = {};
  ev.rows.forEach((e) => { if (e.order_id !== null) (own[e.order_id] = own[e.order_id] || []).push(e); });
  const orders = os.rows.map((o) => {
    const mine = own[o.id] || [];
    const tl = timelineFrom(shared.concat(mine));
    return {
      id: o.id, publicId: o.public_id, name: o.customer_name, items: o.items,
      locked: o.locked_until > Date.now(), createdAt: o.created_at,
      currentIndex: tl.currentIndex, updatedAt: tl.updatedAt,
      ownEvents: mine.map((e) => ({ stage: e.stage, at: e.at, note: e.note })),
    };
  });
  res.json({ orders });
});
// Create many customers at once: one line each, "Name | items".
app.post('/api/admin/batches/:id/orders', async (req, res) => {
  const batchId = intId(req.params.id, 'Batch');
  const batch = (await q('SELECT id FROM batches WHERE id = $1', [batchId])).rows[0];
  if (!batch) throw httpError(404, 'Batch not found.');
  const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines.slice(0, 200) : [];
  const people = [];
  for (const line of lines) {
    const [n, ...rest] = String(line).split('|');
    const name = clean(n, 80);
    if (!name) continue;
    people.push({ name, items: clean(rest.join('|'), 300), pin: newPin() });
  }
  if (!people.length) throw httpError(400, 'Add at least one customer name.');
  await Promise.all(people.map(async (p) => { p.hash = await hashPin(p.pin); }));

  const created = [];
  const stamp = new Date().toISOString();
  let pending = people;
  for (let attempt = 0; attempt < 5 && pending.length; attempt++) {
    pending.forEach((p) => { p.publicId = newPublicId(); });
    const r = await q(
      `INSERT INTO orders (batch_id, public_id, pin_hash, customer_name, items, created_at)
       SELECT $1::int, t.public_id, t.pin_hash, t.customer_name, t.items, $2::text
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS t(public_id, pin_hash, customer_name, items)
       ON CONFLICT (public_id) DO NOTHING RETURNING public_id`,
      [batchId, stamp, pending.map((p) => p.publicId), pending.map((p) => p.hash), pending.map((p) => p.name), pending.map((p) => p.items)]);
    const ok = new Set(r.rows.map((x) => x.public_id));
    pending.filter((p) => ok.has(p.publicId)).forEach((p) => created.push({ name: p.name, publicId: p.publicId, pin: p.pin }));
    pending = pending.filter((p) => !ok.has(p.publicId));
  }
  if (pending.length) throw httpError(500, 'Could not create some customers. Please try again.');
  // keep the same order the admin typed them in
  const order = new Map(people.map((p, i) => [p.name + '\u0000' + p.pin, i]));
  created.sort((a, b) => order.get(a.name + '\u0000' + a.pin) - order.get(b.name + '\u0000' + b.pin));
  res.json({ created });
});
app.post('/api/admin/orders/:id/reset-pin', async (req, res) => {
  const id = intId(req.params.id, 'Order');
  const o = (await q('SELECT id, customer_name, public_id FROM orders WHERE id = $1', [id])).rows[0];
  if (!o) throw httpError(404, 'Order not found.');
  const pin = newPin();
  await q('UPDATE orders SET pin_hash = $1, failed_count = 0, locked_until = 0 WHERE id = $2', [await hashPin(pin), o.id]);
  res.json({ name: o.customer_name, publicId: o.public_id, pin });
});
app.delete('/api/admin/orders/:id', async (req, res) => {
  await q('DELETE FROM orders WHERE id = $1', [intId(req.params.id, 'Order')]);
  res.json({ ok: true });
});
// Record a delivery-phase step for several customers at once.
app.post('/api/admin/orders/stage', async (req, res) => {
  const stage = STAGES[STAGE_INDEX[req.body && req.body.stage]];
  if (!stage || stage.scope !== 'order') throw httpError(400, 'That step is not a per-customer step.');
  const idx = STAGE_INDEX[stage.key];
  const ids = [...new Set((Array.isArray(req.body.orderIds) ? req.body.orderIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 2147483647))].slice(0, 500);
  if (!ids.length) throw httpError(400, 'Select at least one customer.');
  const at = parseAt(req.body.at);
  const note = clean(req.body.note, 200);
  const failures = [];

  await tx(async (c) => {
    const os = (await c.query('SELECT id, batch_id, customer_name FROM orders WHERE id = ANY($1::int[])', [ids])).rows;
    if (!os.length) return;
    const batchIds = [...new Set(os.map((o) => o.batch_id))];
    const ev = (await c.query(
      'SELECT batch_id, order_id, stage, at FROM events WHERE order_id = ANY($1::int[]) OR (order_id IS NULL AND batch_id = ANY($2::int[]))',
      [os.map((o) => o.id), batchIds])).rows;
    const find = (batchId, orderId, key) => ev.find((e) => e.batch_id === batchId && e.order_id === orderId && e.stage === key);

    const ins = { batch: [], order: [] };
    for (const o of os) {
      const label = o.customer_name;
      const customs = find(o.batch_id, null, 'customs');
      if (!customs) { failures.push(`${label}: the batch has not cleared customs yet`); continue; }
      if (find(o.batch_id, o.id, stage.key)) { failures.push(`${label}: already recorded`); continue; }
      let prevAt = customs.at;
      if (idx > STAGE_INDEX.founder_collected) {
        const prev = find(o.batch_id, o.id, STAGES[idx - 1].key);
        if (!prev) { failures.push(`${label}: needs "${STAGES[idx - 1].title}" first`); continue; }
        prevAt = prev.at;
      }
      if (at < prevAt) { failures.push(`${label}: time is earlier than the previous step`); continue; }
      ins.batch.push(o.batch_id); ins.order.push(o.id);
    }
    if (ins.order.length) {
      await c.query(
        `INSERT INTO events (batch_id, order_id, stage, at, note)
         SELECT t.batch_id, t.order_id, $3::text, $4::text, $5::text FROM unnest($1::int[], $2::int[]) AS t(batch_id, order_id)
         ON CONFLICT DO NOTHING`,
        [ins.batch, ins.order, stage.key, at, note]);
    }
  });
  res.json({ ok: true, failures });
});
// Undo the latest per-customer step.
app.delete('/api/admin/orders/:id/stages/:stage', async (req, res) => {
  const orderId = intId(req.params.id, 'Order');
  const idx = STAGE_INDEX[req.params.stage];
  if (idx === undefined || STAGES[idx].scope !== 'order') throw httpError(400, 'Unknown step.');
  const nextKey = STAGES[idx + 1] && STAGES[idx + 1].key;
  if (nextKey) {
    const later = await q('SELECT 1 FROM events WHERE order_id = $1 AND stage = $2', [orderId, nextKey]);
    if (later.rows.length) throw httpError(400, 'Undo the latest step first.');
  }
  await q('DELETE FROM events WHERE order_id = $1 AND stage = $2', [orderId, req.params.stage]);
  res.json({ ok: true });
});

// ---------- fallbacks ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
});

// ---------- start ----------
(async () => {
  DUMMY_HASH = await hashPin('000000');
  await initDb();
  const server = app.listen(PORT, () => console.log(`MYLEBRAND tracker running on port ${PORT}  (admin at /admin)`));
  const stop = () => { server.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch((e) => {
  console.error('Could not start. Is DATABASE_URL correct and reachable?\n', e.message);
  process.exit(1);
});
