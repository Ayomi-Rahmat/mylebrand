'use strict';
// Customer accounts: sign up, log in, profile, password, cart, and "my orders".
// Sessions live in the database (like the admin's) so they survive the free server sleeping.
const crypto = require('crypto');

module.exports = function mountCustomer(app, d) {
  const { rateLimit, q, httpError, clean, intId, hashPin: hashSecret, verifyPin: verifySecret, sha, cookies, sameOrigin, timelineFrom, STAGES, PROD } = d;

  const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
  const COOKIE = 'mb_cust';
  const HINT = 'mb_in'; // not secret: it only tells the page "ask the server who I am", so visitors never wake the database for nothing
  const secure = PROD ? '; Secure' : '';

  const normPhone = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('0')) return '234' + digits.slice(1); // 0803... -> 234803...
    return digits;
  };
  const cleanEmail = (v) => String(v == null ? '' : v).trim().toLowerCase().slice(0, 120);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'mylebrand', 'abcd1234', '11111111', '00000000']);
  function checkPassword(pw, email) {
    if (typeof pw !== 'string') throw httpError(400, 'Please choose a password.');
    if (pw.length < 8) throw httpError(400, 'Your password needs at least 8 characters.');
    if (pw.length > 100) throw httpError(400, 'That password is too long (100 characters at most).');
    if (COMMON.has(pw.toLowerCase()) || pw.toLowerCase() === email) throw httpError(400, 'That password is too easy to guess. Please choose another.');
  }

  let DUMMY; // so "no such account" costs the same time as "wrong password"
  const dummy = () => DUMMY || (DUMMY = hashSecret('dummy-password-for-timing'));

  // ---------- who is this? ----------
  async function getCustomer(req) {
    if (req._customer !== undefined) return req._customer;
    const t = cookies(req)[COOKIE];
    let out = null;
    if (t && t.length <= 100) {
      const { rows } = await q(
        `SELECT c.id, c.name, c.email, c.phone, c.address, c.must_change
           FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
          WHERE s.token_hash = $1 AND s.expires_at > $2`, [sha(t), Date.now()]);
      out = rows[0] || null;
    }
    req._customer = out;
    return out;
  }
  async function requireCustomer(req, res, next) {
    const c = await getCustomer(req);
    if (!c) return res.status(401).json({ error: 'Please log in to continue.' });
    next();
  }
  const view = (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address, mustChange: !!c.must_change });
  async function startSession(res, customerId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await q('DELETE FROM customer_sessions WHERE customer_id = $1 AND expires_at < $2', [customerId, Date.now()]);
    await q('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES ($1,$2,$3)', [sha(token), customerId, Date.now() + SESSION_MS]);
    res.append('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
    res.append('Set-Cookie', `${HINT}=1; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  }
  function clearCookies(res) {
    res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
    res.append('Set-Cookie', `${HINT}=; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  }

  // ---------- limits ----------
  const mk = (windowMs, limit, error) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
  const signupLimiter = mk(60 * 60 * 1000, Number(process.env.SIGNUP_LIMIT_PER_HOUR) || 10, 'Too many sign-ups from this device. Please try again later, or message us on WhatsApp.');
  const loginLimiter = mk(15 * 60 * 1000, 30, 'Too many login attempts from this device. Please wait a few minutes.');
  const pwLimiter = mk(15 * 60 * 1000, 15, 'Too many attempts. Please wait a few minutes.');

  // ---------- sign up / log in / log out ----------
  app.post('/api/account/signup', signupLimiter, sameOrigin, async (req, res) => {
    const b = req.body || {};
    if (b.website) throw httpError(400, 'Something went wrong. Please try again.'); // hidden field only bots fill in
    const name = clean(b.name, 80);
    if (name.length < 2) throw httpError(400, 'Please enter your name.');
    const email = cleanEmail(b.email);
    if (!EMAIL_RE.test(email)) throw httpError(400, 'Please enter a valid email address.');
    const phone = normPhone(b.phone);
    if (phone.length < 10 || phone.length > 15) throw httpError(400, 'Please enter a valid phone number, for example 0803 123 4567.');
    checkPassword(b.password, email);
    const hash = await hashSecret(b.password);
    const r = await q(
      `INSERT INTO customers (email, name, phone, pass_hash, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO NOTHING RETURNING id`, [email, name, phone, hash, Date.now()]);
    if (!r.rows.length) throw httpError(409, 'That email already has an account. Please log in instead.');
    await startSession(res, r.rows[0].id);
    res.json({ customer: { id: r.rows[0].id, name, email, phone, address: '', mustChange: false } });
  });

  app.post('/api/account/login', loginLimiter, sameOrigin, async (req, res) => {
    const GENERIC = { error: 'Wrong email or password.' };
    const email = cleanEmail(req.body && req.body.email);
    const pw = req.body && req.body.password;
    if (!email || typeof pw !== 'string' || pw.length > 100) return res.status(401).json(GENERIC);
    const c = (await q('SELECT * FROM customers WHERE email = $1', [email])).rows[0];
    if (!c) { await verifySecret(pw, await dummy()); return res.status(401).json(GENERIC); }
    const now = Date.now();
    if (c.locked_until > now) return res.status(429).json({ error: 'Too many wrong attempts on this account. Please wait 15 minutes, or message us on WhatsApp.' });
    if (!(await verifySecret(pw, c.pass_hash))) {
      // counted inside the database in one step, so simultaneous guesses cannot slip past the limit
      const upd = await q(
        `UPDATE customers SET
           failed_count = CASE WHEN failed_count + 1 >= 5 THEN 0 ELSE failed_count + 1 END,
           locked_until = CASE WHEN failed_count + 1 >= 5 THEN $2::bigint ELSE locked_until END
         WHERE id = $1 RETURNING locked_until`, [c.id, now + 15 * 60 * 1000]);
      if (upd.rows[0] && upd.rows[0].locked_until > now) {
        return res.status(429).json({ error: 'Too many wrong attempts on this account. Please wait 15 minutes, or message us on WhatsApp.' });
      }
      return res.status(401).json(GENERIC);
    }
    if (c.failed_count) await q('UPDATE customers SET failed_count = 0 WHERE id = $1', [c.id]);
    await startSession(res, c.id);
    res.json({ customer: view(c) });
  });

  app.post('/api/account/logout', sameOrigin, async (req, res) => {
    const t = cookies(req)[COOKIE];
    if (t && t.length <= 100) await q('DELETE FROM customer_sessions WHERE token_hash = $1', [sha(t)]);
    clearCookies(res);
    res.json({ ok: true });
  });

  app.get('/api/account/me', async (req, res) => {
    const c = await getCustomer(req);
    if (!c && cookies(req)[HINT]) clearCookies(res); // stale hint
    res.json({ customer: c ? view(c) : null });
  });

  // ---------- profile and password ----------
  app.patch('/api/account/me', requireCustomer, sameOrigin, async (req, res) => {
    const c = await getCustomer(req);
    const b = req.body || {};
    const name = 'name' in b ? clean(b.name, 80) : c.name;
    if (name.length < 2) throw httpError(400, 'Please enter your name.');
    let phone = c.phone;
    if ('phone' in b) {
      phone = normPhone(b.phone);
      if (phone.length < 10 || phone.length > 15) throw httpError(400, 'Please enter a valid phone number, for example 0803 123 4567.');
    }
    const address = 'address' in b ? clean(b.address, 300) : c.address;
    await q('UPDATE customers SET name=$1, phone=$2, address=$3 WHERE id=$4', [name, phone, address, c.id]);
    res.json({ customer: view({ ...c, name, phone, address }) });
  });

  app.post('/api/account/password', pwLimiter, requireCustomer, sameOrigin, async (req, res) => {
    const c = await getCustomer(req);
    const full = (await q('SELECT * FROM customers WHERE id = $1', [c.id])).rows[0];
    const { current, next } = req.body || {};
    if (typeof current !== 'string' || !(await verifySecret(current, full.pass_hash))) throw httpError(401, 'Your current password is not right.');
    checkPassword(next, full.email);
    if (next === current) throw httpError(400, 'Please choose a different password from the old one.');
    await q('UPDATE customers SET pass_hash = $1, must_change = FALSE, failed_count = 0, locked_until = 0 WHERE id = $2', [await hashSecret(next), c.id]);
    // everyone else signed in with the old password is signed out
    const t = cookies(req)[COOKIE];
    await q('DELETE FROM customer_sessions WHERE customer_id = $1 AND token_hash <> $2', [c.id, sha(t)]);
    res.json({ ok: true });
  });

  // ---------- cart (saved for logged-in customers; the admin can see it) ----------
  const readCart = (v) => {
    const out = new Map();
    for (const it of (Array.isArray(v) ? v : []).slice(0, 60)) {
      const id = Number(it && it.id), qty = Number(it && it.qty);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !Number.isInteger(qty) || qty < 1) continue;
      out.set(id, Math.min(50, (out.get(id) || 0) + qty));
    }
    return [...out].map(([id, qty]) => ({ id, qty }));
  };
  app.get('/api/cart', requireCustomer, async (req, res) => {
    const c = await getCustomer(req);
    const r = await q('SELECT items FROM carts WHERE customer_id = $1', [c.id]);
    res.json({ items: r.rows[0] ? readCart(r.rows[0].items) : [] });
  });
  app.put('/api/cart', requireCustomer, sameOrigin, async (req, res) => {
    const c = await getCustomer(req);
    const items = readCart(req.body && req.body.items);
    await q(
      `INSERT INTO carts (customer_id, items, updated_at) VALUES ($1,$2,$3)
       ON CONFLICT (customer_id) DO UPDATE SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at`,
      [c.id, JSON.stringify(items), Date.now()]);
    res.json({ items });
  });

  // ---------- my orders ----------
  app.get('/api/account/orders', requireCustomer, async (req, res) => {
    const c = await getCustomer(req);
    const r = await q(
      `SELECT o.public_id, o.total, o.status, o.items, o.created_at, o.gift, b.name AS batch_name
         FROM orders o JOIN batches b ON b.id = o.batch_id
        WHERE o.customer_id = $1 ORDER BY o.id DESC LIMIT 100`, [c.id]);
    res.json({
      orders: r.rows.map((o) => ({
        orderId: o.public_id, total: o.total, status: o.status, summary: o.items, createdAt: o.created_at, gift: o.gift, batchName: o.batch_name,
      })),
    });
  });

  app.get('/api/account/orders/:id', requireCustomer, async (req, res) => {
    const c = await getCustomer(req);
    const o = (await q(
      `SELECT o.*, b.name AS batch_name, b.delivery_from, b.delivery_to, b.lagos_eta
         FROM orders o JOIN batches b ON b.id = o.batch_id WHERE o.public_id = $1 AND o.customer_id = $2`,
      [String(req.params.id).toUpperCase().slice(0, 20), c.id])).rows[0];
    if (!o) throw httpError(404, 'Order not found.');
    const [items, ev, settings] = await Promise.all([
      q('SELECT name, kind, qty, unit_price FROM order_items WHERE order_id = $1 ORDER BY id', [o.id]),
      q('SELECT stage, at, note FROM events WHERE batch_id = $1 AND (order_id IS NULL OR order_id = $2)', [o.batch_id, o.id]),
      d.shop.getSettings(),
    ]);
    const out = {
      order: {
        orderId: o.public_id, status: o.status, total: o.total, gift: o.gift, createdAt: o.created_at, paidAt: o.paid_at,
        name: o.customer_name, phone: o.phone, address: o.address, notes: o.notes, batchName: o.batch_name,
        deliveryFrom: o.delivery_from, deliveryTo: o.delivery_to, lagosEta: o.lagos_eta,
      },
      items: items.rows.map((i) => ({ name: i.name, kind: i.kind, qty: i.qty, unitPrice: i.unit_price })),
      whatsapp: settings.whatsapp, giftText: settings.gift_text, community: settings.community,
    };
    if (o.status === 'pending') {
      out.bank = { bankName: settings.bank_name, accountNumber: settings.bank_account_number, accountName: settings.bank_account_name, note: settings.payment_note };
    }
    if (o.status === 'paid') {
      const tl = timelineFrom(ev.rows);
      out.stages = tl.stages; out.currentIndex = tl.currentIndex; out.updatedAt = tl.updatedAt;
    }
    res.json(out);
  });

  // a customer can withdraw an order that has not been paid yet
  app.post('/api/account/orders/:id/cancel', requireCustomer, sameOrigin, async (req, res) => {
    const c = await getCustomer(req);
    const r = await q(
      `UPDATE orders SET status = 'cancelled' WHERE public_id = $1 AND customer_id = $2 AND status = 'pending' RETURNING id`,
      [String(req.params.id).toUpperCase().slice(0, 20), c.id]);
    if (!r.rows.length) throw httpError(409, 'Only an order that has not been paid yet can be cancelled here. Please message us on WhatsApp.');
    await q(`INSERT INTO order_log (order_id, at, what, note) VALUES ($1,$2,'cancelled','Cancelled by the customer')`, [r.rows[0].id, new Date().toISOString()]);
    d.shop.invalidate();
    res.json({ ok: true });
  });

  return { getCustomer, requireCustomer, normPhone };
};
