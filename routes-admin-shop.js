'use strict';
// Everything the ADMIN can do to the shop: edits, products and boxes, photos, settings, and shop orders.
// These routes are mounted behind the admin login (see server.js), so every handler here is admin-only.

module.exports = function mountAdminShop(app, d) {
  const { q, tx, httpError, clean, intId, uniqueSlug, hashPin, dateOrNull, timelineFrom, STAGES, shop } = d;
  const crypto = require('crypto');

  // ---------- small validators ----------
  const intIn = (v, min, max, what, { nullable = false } = {}) => {
    if (v === '' || v == null) {
      if (nullable) return null;
      throw httpError(400, `${what} is required.`);
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, `${what} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  const longText = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  const cleanUrl = (v, what) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    let u;
    try { u = new URL(s); } catch (e) { throw httpError(400, `${what} must be a full web address starting with https://`); }
    if (!['http:', 'https:'].includes(u.protocol) || s.length > 200) throw httpError(400, `${what} must be a full web address starting with https://`);
    return u.href;
  };
  // Photos are stored on Cloudinary (free). We only keep each photo's web address.
  const cleanImgUrl = (v) => {
    let u;
    try { u = new URL(String(v || '').trim()); } catch (e) { throw httpError(400, 'A photo link is not a valid web address.'); }
    if (u.protocol !== 'https:' || u.href.length > 500) throw httpError(400, 'Photo links must start with https://');
    return u.href;
  };
  const readImages = (v, max) => {
    if (v == null || v === '') return [];
    if (!Array.isArray(v) || v.length > max) throw httpError(400, `You can add up to ${max} photos.`);
    return v.map((x) => ({ url: cleanImgUrl(x && x.url) }));
  };
  // The browser asks for a one-time signed ticket, then uploads the photo straight to Cloudinary.
  // Our free server never carries the photo, and the secret key never leaves the server.
  app.post('/api/admin/image-sign', async (req, res) => {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET;
    if (!cloud || !key || !secret) return res.json({ configured: false });
    const params = { allowed_formats: 'jpg,jpeg,png,webp', folder: 'mylebrand', timestamp: String(Math.floor(Date.now() / 1000)) };
    const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    const signature = crypto.createHash('sha1').update(toSign + secret).digest('hex');
    res.json({ configured: true, cloudName: cloud, apiKey: key, signature, ...params });
  });

  // ---------- settings ----------
  app.get('/api/admin/settings', async (req, res) => res.json({ settings: await shop.getSettings() }));
  app.put('/api/admin/settings', async (req, res) => {
    const b = req.body || {};
    const out = {};
    const text = { announcement: 140, promise: 240, site_tagline: 140, gift_text: 80, bank_name: 60, bank_account_name: 80, payment_note: 240 };
    for (const [k, max] of Object.entries(text)) if (k in b) out[k] = clean(b[k], max);
    for (const [k, label] of [['instagram', 'Instagram link'], ['tiktok', 'TikTok link'], ['facebook', 'Facebook link'], ['community', 'Community link']]) {
      if (k in b) out[k] = cleanUrl(b[k], label);
    }
    if ('whatsapp' in b) {
      let digits = String(b.whatsapp || '').replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('0')) digits = '234' + digits.slice(1);
      if (digits.length < 10 || digits.length > 15) throw httpError(400, 'WhatsApp number must include the country code, for example 2349043045498.');
      out.whatsapp = digits;
    }
    if ('bank_account_number' in b) {
      const n = String(b.bank_account_number || '').replace(/\s/g, '');
      if (n && !/^\d{6,20}$/.test(n)) throw httpError(400, 'Account number should be digits only.');
      out.bank_account_number = n;
    }
    if ('gift_threshold' in b) out.gift_threshold = String(intIn(b.gift_threshold, 0, 10000000, 'Gift amount'));
    if ('gift_slots' in b) out.gift_slots = String(intIn(b.gift_slots, 0, 10000, 'Gift spots'));
    for (const [k, v] of Object.entries(out)) {
      await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v]);
    }
    res.json({ settings: await shop.getSettings() });
  });

  // ---------- edits (collections inside a batch) ----------
  const editOut = (e, n) => ({
    id: e.id, batchId: e.batch_id, slug: e.slug, name: e.name, tagline: e.tagline, description: e.description,
    cover: e.cover, sort: e.sort, productCount: n || 0,
  });
  app.get('/api/admin/edits', async (req, res) => {
    const batchId = req.query.batchId ? intId(req.query.batchId, 'Batch') : null;
    const r = await q(
      `SELECT e.*, (SELECT COUNT(*) FROM products p WHERE p.edit_id = e.id) AS n
         FROM edits e WHERE ($1::int IS NULL OR e.batch_id = $1) ORDER BY e.sort, e.id`, [batchId]);
    res.json({ edits: r.rows.map((e) => editOut(e, e.n)) });
  });
  async function readEdit(b) {
    const name = clean(b.name, 80);
    if (!name) throw httpError(400, 'Give the edit a name.');
    const cover = readImages(b.cover ? [b.cover] : [], 1)[0] || null;
    return {
      name, tagline: clean(b.tagline, 140), description: longText(b.description, 1000),
      sort: intIn(b.sort === '' ? 0 : b.sort, -1000, 1000, 'Order', { nullable: true }) || 0, cover,
    };
  }
  app.post('/api/admin/edits', async (req, res) => {
    const batchId = intId(req.body && req.body.batchId, 'Batch');
    if (!(await q('SELECT 1 FROM batches WHERE id = $1', [batchId])).rows.length) throw httpError(404, 'Batch not found.');
    const e = await readEdit(req.body);
    const slug = await uniqueSlug('edits', e.name);
    const r = await q(
      'INSERT INTO edits (batch_id, slug, name, tagline, description, cover, sort) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [batchId, slug, e.name, e.tagline, e.description, e.cover ? JSON.stringify(e.cover) : null, e.sort]);
    res.json({ id: r.rows[0].id });
  });
  app.patch('/api/admin/edits/:id', async (req, res) => {
    const id = intId(req.params.id, 'Edit');
    const cur = (await q('SELECT * FROM edits WHERE id = $1', [id])).rows[0];
    if (!cur) throw httpError(404, 'Edit not found.');
    const e = await readEdit({ ...cur, ...req.body });
    await q('UPDATE edits SET name=$1, tagline=$2, description=$3, cover=$4, sort=$5 WHERE id=$6',
      [e.name, e.tagline, e.description, e.cover ? JSON.stringify(e.cover) : null, e.sort, id]);
        res.json({ ok: true });
  });
  app.delete('/api/admin/edits/:id', async (req, res) => {
    const id = intId(req.params.id, 'Edit');
    const cur = (await q('SELECT * FROM edits WHERE id = $1', [id])).rows[0];
    if (!cur) throw httpError(404, 'Edit not found.');
    const n = (await q('SELECT COUNT(*) AS n FROM products WHERE edit_id = $1', [id])).rows[0].n;
    if (n > 0) throw httpError(409, 'This edit still has products. Move or delete them first.');
    await q('DELETE FROM edits WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ---------- products and boxes ----------
  const productOut = (p, boxItems) => ({
    id: p.id, editId: p.edit_id, editName: p.edit_name, batchId: p.batch_id, slug: p.slug, name: p.name, description: p.description,
    price: p.price, compareAt: p.compare_at, costPrice: p.cost_price, category: p.category, kind: p.kind, soldOut: p.sold_out,
    qtyBought: p.qty_bought, status: p.status, images: p.images, sort: p.sort, sold: p.sold || 0, boxItems: boxItems || [],
  });
  async function listProducts(where, params) {
    const r = await q(
      `SELECT p.*, e.name AS edit_name, e.batch_id, COALESCE(s.sold, 0) AS sold
         FROM products p JOIN edits e ON e.id = p.edit_id
         LEFT JOIN (SELECT oi.product_id, SUM(oi.qty)::int AS sold FROM order_items oi
                      JOIN orders o ON o.id = oi.order_id WHERE o.status <> 'cancelled' GROUP BY oi.product_id) s ON s.product_id = p.id
        ${where} ORDER BY p.sort, p.id`, params);
    const ids = r.rows.map((p) => p.id);
    const bx = ids.length ? (await q('SELECT box_id, product_id, qty FROM box_items WHERE box_id = ANY($1::int[])', [ids])).rows : [];
    return r.rows.map((p) => productOut(p, bx.filter((x) => x.box_id === p.id).map((x) => ({ productId: x.product_id, qty: x.qty }))));
  }
  app.get('/api/admin/products', async (req, res) => {
    const batchId = req.query.batchId ? intId(req.query.batchId, 'Batch') : null;
    res.json({ products: await listProducts('WHERE ($1::int IS NULL OR e.batch_id = $1)', [batchId]) });
  });

  async function readProduct(b, selfId) {
    const name = clean(b.name, 120);
    if (!name) throw httpError(400, 'Give the product a name.');
    const price = intIn(b.price, 1, 5000000, 'Price');
    const compareAt = intIn(b.compareAt, 1, 5000000, 'Old price', { nullable: true });
    if (compareAt !== null && compareAt <= price) throw httpError(400, 'The old price must be higher than the price (or leave it empty).');
    const kind = b.kind === 'box' ? 'box' : 'product';
    const status = b.status === 'hidden' ? 'hidden' : 'active';
    const editId = intId(b.editId, 'Edit');
    if (!(await q('SELECT 1 FROM edits WHERE id = $1', [editId])).rows.length) throw httpError(400, 'Choose which edit this belongs to.');
    const images = readImages(b.images, 8);
    let boxItems = [];
    if (kind === 'box') {
      const seen = new Set();
      for (const it of Array.isArray(b.boxItems) ? b.boxItems.slice(0, 30) : []) {
        const productId = intIn(it && it.productId, 1, 2147483647, 'Box item');
        const qty = intIn(it && it.qty, 1, 50, 'Box item quantity');
        if (productId === selfId || seen.has(productId)) continue;
        seen.add(productId);
        boxItems.push({ productId, qty });
      }
      if (!boxItems.length) throw httpError(400, 'Add at least one product to the box.');
      const ok = await q(`SELECT id FROM products WHERE id = ANY($1::int[]) AND kind = 'product'`, [boxItems.map((x) => x.productId)]);
      if (ok.rows.length !== boxItems.length) throw httpError(400, 'A box can only contain ordinary products.');
    }
    return {
      name, price, compareAt, kind, status, editId, images, boxItems,
      description: longText(b.description, 3000),
      costPrice: intIn(b.costPrice, 0, 5000000, 'Cost price', { nullable: true }),
      category: clean(b.category, 40),
      soldOut: b.soldOut === true || b.soldOut === 'true',
      qtyBought: intIn(b.qtyBought, 0, 100000, 'Quantity bought', { nullable: true }),
      sort: intIn(b.sort === '' || b.sort == null ? 0 : b.sort, -1000, 1000, 'Order'),
    };
  }
  async function saveBoxItems(c, boxId, items) {
    await c.query('DELETE FROM box_items WHERE box_id = $1', [boxId]);
    if (items.length) {
      await c.query('INSERT INTO box_items (box_id, product_id, qty) SELECT $1::int, t.pid, t.qty FROM unnest($2::int[], $3::int[]) AS t(pid, qty)',
        [boxId, items.map((x) => x.productId), items.map((x) => x.qty)]);
    }
  }
  app.post('/api/admin/products', async (req, res) => {
    const p = await readProduct(req.body || {}, null);
    const slug = await uniqueSlug('products', p.name);
    const id = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO products (edit_id, slug, name, description, price, compare_at, cost_price, category, kind, sold_out, qty_bought, status, images, sort, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [p.editId, slug, p.name, p.description, p.price, p.compareAt, p.costPrice, p.category, p.kind, p.soldOut, p.qtyBought, p.status,
          JSON.stringify(p.images), p.sort, Date.now()]);
      if (p.kind === 'box') await saveBoxItems(c, r.rows[0].id, p.boxItems);
      return r.rows[0].id;
    });
    res.json({ id });
  });
  app.patch('/api/admin/products/:id', async (req, res) => {
    const id = intId(req.params.id, 'Product');
    const cur = (await q('SELECT * FROM products WHERE id = $1', [id])).rows[0];
    if (!cur) throw httpError(404, 'Product not found.');
    const body = req.body || {};
    // a partial update (such as the quick sold-out button) keeps everything else as it is
    const merged = {
      name: cur.name, description: cur.description, price: cur.price, compareAt: cur.compare_at, costPrice: cur.cost_price,
      category: cur.category, kind: cur.kind, soldOut: cur.sold_out, qtyBought: cur.qty_bought, status: cur.status, editId: cur.edit_id, images: cur.images,
      sort: cur.sort, boxItems: null, ...body,
    };
    if (merged.kind === 'box' && merged.boxItems === null) {
      merged.boxItems = (await q('SELECT product_id AS "productId", qty FROM box_items WHERE box_id = $1', [id])).rows;
    }
    const p = await readProduct(merged, id);
    await tx(async (c) => {
      await c.query(
        `UPDATE products SET edit_id=$1, name=$2, description=$3, price=$4, compare_at=$5, cost_price=$6, category=$7, kind=$8,
                sold_out=$9, status=$10, images=$11, sort=$12, qty_bought=$13 WHERE id=$14`,
        [p.editId, p.name, p.description, p.price, p.compareAt, p.costPrice, p.category, p.kind, p.soldOut, p.status, JSON.stringify(p.images), p.sort, p.qtyBought, id]);
      await saveBoxItems(c, id, p.kind === 'box' ? p.boxItems : []);
    });
    res.json({ ok: true });
  });
  app.delete('/api/admin/products/:id', async (req, res) => {
    const id = intId(req.params.id, 'Product');
    const cur = (await q('SELECT 1 FROM products WHERE id = $1', [id])).rows[0];
    if (!cur) throw httpError(404, 'Product not found.');
    await q('DELETE FROM products WHERE id = $1', [id]); // past orders keep their own copy of the name and price
    res.json({ ok: true });
  });

  // ---------- shop orders ----------
  app.get('/api/admin/shop-orders', async (req, res) => {
    const status = ['pending', 'paid', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const batchId = req.query.batchId ? intId(req.query.batchId, 'Batch') : null;
    const [rows, counts] = await Promise.all([
      q(`SELECT o.id, o.public_id, o.customer_name, o.phone, o.total, o.status, o.gift, o.created_at, o.items, o.batch_id, o.customer_id, b.name AS batch_name
           FROM orders o JOIN batches b ON b.id = o.batch_id
          WHERE o.source = 'shop' AND ($1::text IS NULL OR o.status = $1) AND ($2::int IS NULL OR o.batch_id = $2)
          ORDER BY o.id DESC LIMIT 300`, [status, batchId]),
      q(`SELECT status, COUNT(*) AS n FROM orders WHERE source = 'shop' AND ($1::int IS NULL OR batch_id = $1) GROUP BY status`, [batchId]),
    ]);
    const c = { pending: 0, paid: 0, cancelled: 0 };
    counts.rows.forEach((r) => { c[r.status] = r.n; });
    res.json({
      counts: c,
      orders: rows.rows.map((o) => ({
        id: o.id, publicId: o.public_id, name: o.customer_name, phone: o.phone, total: o.total, status: o.status, gift: o.gift,
        createdAt: o.created_at, summary: o.items, batchId: o.batch_id, batchName: o.batch_name, hasAccount: o.customer_id !== null,
      })),
    });
  });
  app.get('/api/admin/shop-orders/:id', async (req, res) => {
    const id = intId(req.params.id, 'Order');
    const o = (await q(
      `SELECT o.*, b.name AS batch_name FROM orders o JOIN batches b ON b.id = o.batch_id WHERE o.id = $1 AND o.source = 'shop'`, [id])).rows[0];
    if (!o) throw httpError(404, 'Order not found.');
    const [items, log, ev] = await Promise.all([
      q('SELECT name, kind, qty, unit_price FROM order_items WHERE order_id = $1 ORDER BY id', [id]),
      q('SELECT at, what, note FROM order_log WHERE order_id = $1 ORDER BY id', [id]),
      q('SELECT stage, at, note FROM events WHERE batch_id = $1 AND (order_id IS NULL OR order_id = $2)', [o.batch_id, id]),
    ]);
    const tl = timelineFrom(ev.rows);
    res.json({
      order: {
        id: o.id, publicId: o.public_id, name: o.customer_name, phone: o.phone, address: o.address, notes: o.notes, total: o.total,
        status: o.status, gift: o.gift, createdAt: o.created_at, paidAt: o.paid_at, batchId: o.batch_id, batchName: o.batch_name,
        stage: tl.currentIndex >= 0 ? STAGES[tl.currentIndex].title : null, locked: o.locked_until > Date.now(),
      },
      items: items.rows.map((i) => ({ name: i.name, kind: i.kind, qty: i.qty, unitPrice: i.unit_price, line: i.unit_price * i.qty })),
      log: log.rows,
    });
  });
  app.post('/api/admin/shop-orders/:id/status', async (req, res) => {
    const id = intId(req.params.id, 'Order');
    const next = req.body && req.body.status;
    if (!['pending', 'paid', 'cancelled'].includes(next)) throw httpError(400, 'Status must be pending, paid or cancelled.');
    const note = clean(req.body.note, 200);
    await tx(async (c) => {
      const o = (await c.query(`SELECT * FROM orders WHERE id = $1 AND source = 'shop' FOR UPDATE`, [id])).rows[0];
      if (!o) throw httpError(404, 'Order not found.');
      if (o.status === 'cancelled') throw httpError(409, 'A cancelled order cannot be changed. Ask the customer to place a new one.');
      if (o.status === next) throw httpError(409, `This order is already ${next}.`);
      const now = new Date().toISOString();
      await c.query('UPDATE orders SET status = $1, paid_at = $2 WHERE id = $3', [next, next === 'paid' ? now : null, id]);
      await c.query('INSERT INTO order_log (order_id, at, what, note) VALUES ($1,$2,$3,$4)', [id, now, next, note]);
    });
    res.json({ ok: true });
  });

  // ---------- customers (accounts) ----------
  app.get('/api/admin/customers', async (req, res) => {
    const r = await q(
      `SELECT c.id, c.name, c.email, c.phone, c.created_at, c.must_change, c.locked_until,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled') AS orders,
              (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.status = 'paid') AS spent
         FROM customers c ORDER BY c.id DESC LIMIT 500`);
    res.json({
      customers: r.rows.map((c) => ({
        id: c.id, name: c.name, email: c.email, phone: c.phone, createdAt: c.created_at, mustChange: c.must_change,
        locked: c.locked_until > Date.now(), orders: c.orders, spent: Number(c.spent),
      })),
    });
  });
  // No email service on the free plan, so a forgotten password is fixed here: a temporary one is made,
  // shown to you once, and you send it to the customer on WhatsApp. They must change it when they log in.
  app.post('/api/admin/customers/:id/reset-password', async (req, res) => {
    const id = intId(req.params.id, 'Customer');
    const A = 'abcdefghjkmnpqrstuvwxyz', B = 'ABCDEFGHJKMNPQRSTUVWXYZ', N = '23456789';
    const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');
    const temp = `${pick(B, 1)}${pick(A, 4)}-${pick(N, 4)}-${pick(A, 3)}`;
    const r = await q(
      'UPDATE customers SET pass_hash = $1, must_change = TRUE, failed_count = 0, locked_until = 0 WHERE id = $2 RETURNING id',
      [await hashPin(temp), id]);
    if (!r.rows.length) throw httpError(404, 'Customer not found.');
    await q('DELETE FROM customer_sessions WHERE customer_id = $1', [id]);
    res.json({ temporaryPassword: temp });
  });
  app.delete('/api/admin/customers/:id', async (req, res) => {
    await q('DELETE FROM customers WHERE id = $1', [intId(req.params.id, 'Customer')]); // their past orders stay, without the account link
    res.json({ ok: true });
  });

  // ---------- carts (what people have saved but not ordered) ----------
  app.get('/api/admin/carts', async (req, res) => {
    const r = await q(
      `SELECT c.customer_id, c.items, c.updated_at, cu.name, cu.phone, cu.email
         FROM carts c JOIN customers cu ON cu.id = c.customer_id
        WHERE jsonb_array_length(c.items) > 0 ORDER BY c.updated_at DESC LIMIT 200`);
    const ids = [...new Set(r.rows.flatMap((c) => c.items.map((i) => i.id)))];
    const ps = ids.length ? (await q('SELECT id, name, price, sold_out FROM products WHERE id = ANY($1::int[])', [ids])).rows : [];
    const by = new Map(ps.map((p) => [p.id, p]));
    res.json({
      carts: r.rows.map((c) => {
        const items = c.items.map((i) => ({ ...i, name: by.get(i.id) ? by.get(i.id).name : '(removed item)', price: by.get(i.id) ? by.get(i.id).price : 0, soldOut: by.get(i.id) ? by.get(i.id).sold_out : false }));
        return { customerId: c.customer_id, name: c.name, phone: c.phone, email: c.email, updatedAt: c.updated_at, items, total: items.reduce((t, i) => t + i.price * i.qty, 0) };
      }),
    });
  });

  // ---------- expenses ----------
  app.get('/api/admin/expenses', async (req, res) => {
    const batchId = intId(req.query.batchId, 'Batch');
    const r = await q('SELECT * FROM expenses WHERE batch_id = $1 ORDER BY id DESC', [batchId]);
    res.json({ expenses: r.rows.map((e) => ({ id: e.id, label: e.label, amount: e.amount, spentOn: e.spent_on, note: e.note })) });
  });
  app.post('/api/admin/expenses', async (req, res) => {
    const b = req.body || {};
    const batchId = intId(b.batchId, 'Batch');
    if (!(await q('SELECT 1 FROM batches WHERE id = $1', [batchId])).rows.length) throw httpError(404, 'Batch not found.');
    const label = clean(b.label, 80);
    if (!label) throw httpError(400, 'What was the expense for? (for example Shipping, Packaging)');
    const r = await q('INSERT INTO expenses (batch_id, label, amount, spent_on, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [batchId, label, intIn(b.amount, 0, 100000000, 'Amount'), dateOrNull(b.spentOn), clean(b.note, 200)]);
    res.json({ id: r.rows[0].id });
  });
  app.delete('/api/admin/expenses/:id', async (req, res) => {
    await q('DELETE FROM expenses WHERE id = $1', [intId(req.params.id, 'Expense')]);
    res.json({ ok: true });
  });

  // ---------- the batch ledger ----------
  // Money in = paid orders. "Sold" counts paid orders only (pending ones are not money yet; they are shown separately).
  // A box counts toward the products inside it, so "bought vs sold vs left" works for single products.
  app.get('/api/admin/ledger', async (req, res) => {
    const batchId = intId(req.query.batchId, 'Batch');
    const batch = (await q('SELECT id, name, status FROM batches WHERE id = $1', [batchId])).rows[0];
    if (!batch) throw httpError(404, 'Batch not found.');
    const [ps, boxes, items, exp, ords] = await Promise.all([
      q(`SELECT p.id, p.name, p.kind, p.price, p.cost_price, p.qty_bought, p.sold_out, e.name AS edit_name
           FROM products p JOIN edits e ON e.id = p.edit_id WHERE e.batch_id = $1 ORDER BY e.sort, e.id, p.sort, p.id`, [batchId]),
      q(`SELECT bi.box_id, bi.product_id, bi.qty FROM box_items bi JOIN products b ON b.id = bi.box_id JOIN edits e ON e.id = b.edit_id WHERE e.batch_id = $1`, [batchId]),
      q(`SELECT oi.product_id, oi.kind, oi.qty, oi.unit_price, oi.unit_cost, o.status
           FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.batch_id = $1 AND o.status <> 'cancelled'`, [batchId]),
      q('SELECT id, label, amount, spent_on FROM expenses WHERE batch_id = $1 ORDER BY id', [batchId]),
      q(`SELECT COUNT(*) FILTER (WHERE status = 'paid') AS paid, COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS revenue,
                COALESCE(SUM(total) FILTER (WHERE status = 'pending'), 0) AS awaiting
           FROM orders WHERE batch_id = $1`, [batchId]),
    ]);
    const boxOf = new Map();
    boxes.rows.forEach((r) => { (boxOf.get(r.box_id) || boxOf.set(r.box_id, []).get(r.box_id)).push(r); });
    const sold = new Map(), pend = new Map(); // units per product (own sales + inside boxes)
    const add = (m, id, n) => m.set(id, (m.get(id) || 0) + n);
    let cogs = 0, cogsKnown = true;
    for (const it of items.rows) {
      const m = it.status === 'paid' ? sold : pend;
      if (it.product_id !== null) {
        add(m, it.product_id, it.qty);
        (boxOf.get(it.product_id) || []).forEach((b) => add(m, b.product_id, b.qty * it.qty));
      }
      if (it.status === 'paid') { if (it.unit_cost === null) cogsKnown = false; else cogs += it.unit_cost * it.qty; }
    }
    const rows = ps.rows.map((p) => {
      const s = sold.get(p.id) || 0, w = pend.get(p.id) || 0;
      const bought = p.qty_bought;
      return {
        id: p.id, name: p.name, kind: p.kind, editName: p.edit_name, price: p.price, cost: p.cost_price, bought,
        sold: s, pending: w, left: p.kind === 'box' || bought === null ? null : Math.max(0, bought - s), soldOut: p.sold_out,
        revenue: null,
      };
    });
    const spendOnStock = ps.rows.reduce((t, p) => t + (p.kind === 'product' && p.cost_price !== null && p.qty_bought !== null ? p.cost_price * p.qty_bought : 0), 0);
    const expenses = exp.rows.reduce((t, e) => t + e.amount, 0);
    const o = ords.rows[0];
    res.json({
      batch,
      products: rows,
      expenses: exp.rows.map((e) => ({ id: e.id, label: e.label, amount: e.amount, spentOn: e.spent_on })),
      totals: {
        paidOrders: o.paid, pendingOrders: o.pending, revenue: Number(o.revenue), awaiting: Number(o.awaiting),
        costOfSold: cogs, costOfSoldComplete: cogsKnown, spendOnStock, expenses,
        profit: Number(o.revenue) - cogs - expenses,
      },
    });
  });

  // ---------- wholesale landing pages ----------
  function readLineBody(b, line) {
    const def = shop.LINE_DEFAULTS[line];
    const items = [];
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 40)) {
      const name = clean(it && it.name, 80);
      if (!name) continue;
      const price = intIn(it.price, 1, 5000000, 'Wholesale price', { nullable: true });
      const resale = intIn(it.resale, 1, 5000000, 'Suggested resale price', { nullable: true });
      if (price !== null && resale !== null && resale <= price) throw httpError(400, `For "${name}", the resale price must be higher than your wholesale price.`);
      items.push({ name, price, resale, minQty: intIn(it.minQty, 1, 10000, 'Minimum quantity', { nullable: true }), note: clean(it.note, 80) });
    }
    return {
      title: clean(b.title, 80) || def.title, headline: clean(b.headline, 120) || def.headline, sub: clean(b.sub, 240),
      items, bonus: clean(b.bonus, 240), spots: intIn(b.spots, 1, 10000, 'Spots', { nullable: true }),
      deadline: dateOrNull(b.deadline) || '', groupLink: cleanUrl(b.groupLink, 'Group link'), minNote: clean(b.minNote, 160),
    };
  }
  app.get('/api/admin/wholesale/:line', async (req, res) => {
    const line = req.params.line;
    if (!shop.LINE_KEYS.includes(line)) throw httpError(404, 'Page not found.');
    res.json({ line: shop.readLine(await shop.getSettings(), line) });
  });
  app.put('/api/admin/wholesale/:line', async (req, res) => {
    const line = req.params.line;
    if (!shop.LINE_KEYS.includes(line)) throw httpError(404, 'Page not found.');
    const data = readLineBody(req.body || {}, line);
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['wholesale_' + line, JSON.stringify(data)]);
    res.json({ line: data });
  });
};
