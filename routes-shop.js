'use strict';
// Everything the PUBLIC can reach in the shop: the pages, the catalog, product photos and checkout.
const fs = require('fs');
const path = require('path');

module.exports = function mountShop(app, d) {
  const { rateLimit, q, tx, httpError, clean, newPublicId, hashPin, sameOrigin, WHATSAPP } = d;
  const crypto = require('crypto');
  const SHELL = fs.readFileSync(path.join(__dirname, 'views', 'shop.html'), 'utf8');

  // ---------- settings (edited in the admin) ----------
  const DEFAULTS = {
    whatsapp: WHATSAPP,
    instagram: 'https://www.instagram.com/mylebrandng',
    tiktok: 'https://www.tiktok.com/@mylebrandng',
    facebook: '',
    community: '',
    announcement: '',
    promise: '',
    site_tagline: 'Curated pieces for your style, space & everyday life.',
    gift_threshold: '50000',
    gift_slots: '5',
    gift_text: 'a valuable gift',
    bank_name: '',
    bank_account_number: '',
    bank_account_name: '',
    payment_note: 'Please use your order ID as the transfer reference.',
    wholesale_beauty: '',
    wholesale_interiors: '',
  };

  // ---------- wholesale landing pages (what the QR codes open) ----------
  // Prices are left blank on purpose: the owner fills them in from Admin > Shop > Wholesale.
  const LINE_KEYS = ['beauty', 'interiors'];
  const LINE_DEFAULTS = {
    beauty: {
      title: 'Beauty wholesale for students',
      headline: 'Buy beauty in bulk. Sell on campus. Keep the profit.',
      sub: 'Student-friendly wholesale prices on the skincare and lip essentials that sell fast.',
      items: ['Face masks', 'Hand creams', 'Eye masks', 'Lip masks', 'Lip balms', 'Natural lip balms', 'Eyeliners']
        .map((name) => ({ name, price: null, oldPrice: null, minQty: null, resale: null, note: '', desc: '', images: [] })),
      bonus: '', spots: null, deadline: '', groupLink: '', minNote: '',
    },
    interiors: {
      title: 'Room & hostel interiors',
      headline: 'Make your room feel like yours.',
      sub: 'Simple, affordable pieces for hostels and student apartments.',
      items: [], bonus: '', spots: null, deadline: '', groupLink: '', minNote: '',
    },
  };
  function readLine(settings, line) {
    let saved = {};
    try { saved = JSON.parse(settings['wholesale_' + line] || '{}') || {}; } catch (e) { saved = {}; }
    return { ...LINE_DEFAULTS[line], ...saved };
  }
  // Only these are sent to every visitor. Bank details are only shown after someone places an order.
  const PUBLIC_KEYS = ['whatsapp', 'instagram', 'tiktok', 'facebook', 'community', 'announcement', 'promise', 'site_tagline',
    'gift_threshold', 'gift_slots', 'gift_text'];

  async function getSettings() {
    const { rows } = await q('SELECT key, value FROM settings');
    const s = { ...DEFAULTS };
    rows.forEach((r) => { if (r.key in DEFAULTS) s[r.key] = r.value; });
    return s;
  }

  // ---------- the catalog (kept in memory so browsing does not wake the free database) ----------
  const TTL = 2 * 60 * 60 * 1000;
  let cache = null;
  let cacheUntil = 0;
  let version = 0;
  let building = null;
  const deadline = (closesOn) => (closesOn ? Date.parse(closesOn + 'T23:59:59+01:00') : null);
  const isOpen = (b) => b.status === 'open' && (!b.closes_on || Date.now() <= deadline(b.closes_on));
  // Photos live on an outside image host (Cloudinary). We only store their web addresses.
  const imgList = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((x) => x && typeof x.url === 'string' && /^https:\/\//.test(x.url))
    .map((x) => ({ url: x.url }));
  // Cloudinary can resize and compress on the fly; other hosts are used as they are.
  const cdn = (url, w) => (/^https:\/\/res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace('/upload/', `/upload/f_auto,q_auto,w_${w}/`) : url);

  async function buildCatalog() {
    const [settings, bs, es, ps, bx] = await Promise.all([
      getSettings(),
      q(`SELECT * FROM batches WHERE status IN ('open','closed') ORDER BY (status = 'open') DESC, id DESC`),
      q('SELECT * FROM edits ORDER BY sort, id'),
      q(`SELECT * FROM products WHERE status = 'active' ORDER BY sort, id`),
      q('SELECT box_id, product_id, qty FROM box_items'),
    ]);
    const prodById = new Map(ps.rows.map((p) => [p.id, p]));
    const boxes = new Map();
    bx.rows.forEach((r) => { (boxes.get(r.box_id) || boxes.set(r.box_id, []).get(r.box_id)).push(r); });

    const toPublic = (p) => {
      const out = {
        id: p.id, slug: p.slug, name: p.name, price: p.price, compareAt: p.compare_at, category: p.category, kind: p.kind,
        desc: p.description, images: imgList(p.images), soldOut: !!p.sold_out,
      };
      if (p.kind === 'box') {
        out.items = (boxes.get(p.id) || []).map((it) => {
          const c = prodById.get(it.product_id);
          return c ? { id: c.id, slug: c.slug, name: c.name, qty: it.qty, price: c.price, thumb: imgList(c.images)[0] ? imgList(c.images)[0].url : null, soldOut: !!c.sold_out } : null;
        }).filter(Boolean);
      }
      return out;
    };

    const batches = bs.rows.map((b) => ({
      id: b.id, slug: b.slug, name: b.name, tagline: b.tagline, open: isOpen(b), closesOn: b.closes_on,
      deliveryFrom: b.delivery_from, deliveryTo: b.delivery_to, lagosEta: b.lagos_eta,
      edits: es.rows.filter((e) => e.batch_id === b.id).map((e) => ({
        id: e.id, slug: e.slug, name: e.name, tagline: e.tagline, description: e.description,
        cover: e.cover && typeof e.cover.url === 'string' && /^https:\/\//.test(e.cover.url) ? { url: e.cover.url } : null,
        products: ps.rows.filter((p) => p.edit_id === e.id).map(toPublic),
      })),
    }));
    const pub = {};
    PUBLIC_KEYS.forEach((k) => { pub[k] = settings[k]; });
    // the cache must not outlive a closing date, so "open" never goes stale
    const soon = bs.rows.filter((b) => b.status === 'open' && b.closes_on).map((b) => deadline(b.closes_on)).filter((t) => t > Date.now());
    const lines = {};
    LINE_KEYS.forEach((k) => { lines[k] = readLine(settings, k); });
    return { catalog: { settings: pub, batches, lines }, until: Math.min(Date.now() + TTL, ...soon) };
  }
  async function getCatalog() {
    if (cache && Date.now() < cacheUntil) return cache;
    if (!building) {
      const v = version;
      building = buildCatalog()
        .then((r) => { if (v === version) { cache = r.catalog; cacheUntil = r.until; } return r.catalog; })
        .finally(() => { building = null; });
    }
    return building;
  }
  function invalidate() { version++; cache = null; }

  // ---------- pages ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  async function page(req, res, o) {
    const cat = await getCatalog();
    const origin = `${req.protocol}://${req.get('host')}`;
    const url = origin + req.path;
    const m = [
      `<title>${esc(o.title)}</title>`,
      `<meta name="description" content="${esc(o.description)}">`,
      `<link rel="canonical" href="${esc(url)}">`,
      '<meta property="og:site_name" content="MYLEBRAND">',
      `<meta property="og:type" content="${o.type || 'website'}">`,
      `<meta property="og:title" content="${esc(o.title)}">`,
      `<meta property="og:description" content="${esc(o.description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
    ];
    if (o.image) m.push(`<meta property="og:image" content="${esc(cdn(o.image, 1200))}">`);
    if (o.noindex) m.push('<meta name="robots" content="noindex, nofollow">');
    const html = SHELL
      .replace('<!--META-->', () => m.join('\n  '))
      .replace('<!--BOOT-->', () => `<script type="application/json" id="boot">${safeJson(cat)}</script>`);
    res.status(o.status || 200).set('Cache-Control', 'no-cache').type('html').send(html);
  }
  const findEdit = (cat, slug) => {
    for (const b of cat.batches) for (const e of b.edits) if (e.slug === slug) return { b, e };
    return null;
  };
  const findProduct = (cat, slug) => {
    for (const b of cat.batches) for (const e of b.edits) for (const p of e.products) if (p.slug === slug) return { b, e, p };
    return null;
  };
  const NAME = 'MYLEBRAND';

  app.get('/', async (req, res) => {
    const cat = await getCatalog();
    const b = cat.batches.find((x) => x.open) || cat.batches[0];
    const cover = b && b.edits.find((e) => e.cover);
    await page(req, res, {
      title: `${NAME} | Curated lifestyle pieces for intentional living`,
      description: short((b && b.tagline) || cat.settings.site_tagline, 160),
      image: cover ? cover.cover.url : null,
    });
  });
  app.get('/e/:slug', async (req, res) => {
    const f = findEdit(await getCatalog(), req.params.slug);
    if (!f) return page(req, res, { status: 404, title: `Not found | ${NAME}`, description: 'This page could not be found.', noindex: true });
    await page(req, res, {
      title: `${f.e.name} | ${NAME}`,
      description: short(f.e.tagline || f.e.description || f.b.tagline, 160),
      image: f.e.cover ? f.e.cover.url : (f.e.products[0] && f.e.products[0].images[0] ? f.e.products[0].images[0].url : null),
    });
  });
  app.get('/p/:slug', async (req, res) => {
    const f = findProduct(await getCatalog(), req.params.slug);
    if (!f) return page(req, res, { status: 404, title: `Not found | ${NAME}`, description: 'This page could not be found.', noindex: true });
    await page(req, res, {
      title: `${f.p.name} | ${NAME}`,
      description: short(f.p.desc || `${f.p.name} from ${f.e.name}`, 160),
      image: f.p.images[0] ? f.p.images[0].url : null,
      type: 'product',
    });
  });
  app.get(['/beauty', '/interiors'], async (req, res) => {
    const line = req.path.slice(1);
    const L = (await getCatalog()).lines[line];
    await page(req, res, { title: `${L.title} | ${NAME}`, description: short(L.sub || L.headline, 160) });
  });
  app.get(['/cart', '/checkout', '/login', '/signup', '/account', '/orders', '/order/:id'], (req, res) =>
    page(req, res, { title: `${NAME}`, description: 'Your MYLEBRAND order.', noindex: true }));

  // Unknown pages get the shop's own "not found" page; anything that looks like a file (or an API call) stays a plain 404.
  function notFound(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method) || !req.accepts('html') || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    return page(req, res, { status: 404, title: `Not found | ${NAME}`, description: 'This page could not be found.', noindex: true });
  }

  // ---------- catalog for the browser (used to refresh stock) ----------
  app.get('/api/shop', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(await getCatalog());
  });

  // ---------- checkout ----------
  const orderLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: Number(process.env.ORDER_LIMIT_PER_HOUR) || 20, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many orders from this device. Please wait a little, or order on WhatsApp.' },
  });
  app.post('/api/shop/orders', orderLimiter, sameOrigin, async (req, res) => {
    const cust = await d.customer.getCustomer(req);
    if (!cust) throw httpError(401, 'Please log in or create an account to place your order.');
    if (cust.must_change) throw httpError(403, 'Please set a new password first (Account page), then place your order.');
    const b = req.body || {};
    const name = clean(b.name, 80);
    if (name.length < 2) throw httpError(400, 'Please enter your name.');
    const phone = d.customer.normPhone(b.phone);
    if (phone.length < 10 || phone.length > 15) throw httpError(400, 'Please enter a valid phone number, for example 0803 123 4567.');
    const address = clean(b.address, 300);
    if (address.length < 8) throw httpError(400, 'Please enter your full delivery address.');
    const notes = clean(b.notes, 300);

    const want = new Map();
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 60)) {
      const id = Number(it && it.id);
      const qty = Number(it && it.qty);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !Number.isInteger(qty) || qty < 1 || qty > 50) {
        throw httpError(400, 'Your cart has an invalid item. Please refresh the page and try again.');
      }
      want.set(id, Math.min(50, (want.get(id) || 0) + qty));
    }
    if (!want.size) throw httpError(400, 'Your cart is empty.');
    if (want.size > 30) throw httpError(400, 'That is a lot of different items. Please split it into two orders.');

    const settings = await getSettings();
    // Orders have no PIN any more: customers see them inside their account. This hash can never be matched.
    const lockedPin = await hashPin(crypto.randomBytes(24).toString('hex'));

    // Prices and availability all come from the database. Nothing the browser says about money is trusted.
    const out = await tx(async (c) => {
      const ids = [...want.keys()];
      const ps = (await c.query(
        `SELECT p.id, p.name, p.price, p.cost_price, p.kind, p.sold_out, e.batch_id,
                bt.name AS batch_name, bt.status AS batch_status, bt.closes_on
           FROM products p JOIN edits e ON e.id = p.edit_id JOIN batches bt ON bt.id = e.batch_id
          WHERE p.id = ANY($1::int[]) AND p.status = 'active'`, [ids])).rows;
      if (ps.length !== ids.length) throw httpError(409, 'Some items in your cart are no longer available. Please review your cart.');
      const gone = ps.find((p) => p.sold_out);
      if (gone) throw httpError(409, `"${gone.name}" is sold out. Please remove it from your cart.`);
      const batchId = ps[0].batch_id;
      if (ps.some((p) => p.batch_id !== batchId)) throw httpError(400, 'Please order one batch at a time. Check out this cart first, then start a new one.');
      if (ps[0].batch_status !== 'open' || (ps[0].closes_on && Date.now() > Date.parse(ps[0].closes_on + 'T23:59:59+01:00'))) {
        throw httpError(409, 'Preorders for this batch are closed.');
      }
      await c.query('SELECT pg_advisory_xact_lock($1)', [batchId]); // one order at a time per batch, so gift spots cannot be double-booked

      // cost of a box = its own cost if the admin set one, otherwise the cost of what is inside it
      const boxCost = new Map();
      const boxIds = ps.filter((p) => p.kind === 'box' && p.cost_price === null).map((p) => p.id);
      if (boxIds.length) {
        const r = await c.query(
          `SELECT bi.box_id, SUM(bi.qty * pr.cost_price)::int AS cost, BOOL_AND(pr.cost_price IS NOT NULL) AS full
             FROM box_items bi JOIN products pr ON pr.id = bi.product_id WHERE bi.box_id = ANY($1::int[]) GROUP BY bi.box_id`, [boxIds]);
        r.rows.forEach((x) => boxCost.set(x.box_id, x.full ? x.cost : null));
      }

      let total = 0;
      const lines = [];
      for (const p of ps) {
        const qty = want.get(p.id);
        total += p.price * qty;
        lines.push({ ...p, qty, cost: p.cost_price !== null ? p.cost_price : (boxCost.get(p.id) ?? null) });
      }
      if (total > 100000000) throw httpError(400, 'That order is too large to place online. Please message us on WhatsApp.');

      const threshold = Number(settings.gift_threshold) || 0;
      const slots = Number(settings.gift_slots) || 0;
      let gift = false;
      if (threshold > 0 && slots > 0 && total >= threshold) {
        const n = (await c.query(`SELECT COUNT(*) AS n FROM orders WHERE batch_id = $1 AND source = 'shop' AND gift = TRUE AND status <> 'cancelled'`, [batchId])).rows[0].n;
        gift = n < slots;
      }

      const summary = lines.map((l) => `${l.qty} x ${l.name}`).join(', ').slice(0, 300);
      let order = null;
      for (let i = 0; i < 6 && !order; i++) {
        const r = await c.query(
          `INSERT INTO orders (batch_id, public_id, pin_hash, customer_name, items, phone, address, notes, total, status, source, gift, customer_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','shop',$10,$11,$12)
           ON CONFLICT (public_id) DO NOTHING RETURNING id, public_id`,
          [batchId, newPublicId(), lockedPin, name, summary, phone, address, notes, total, gift, cust.id, new Date().toISOString()]);
        order = r.rows[0] || null;
      }
      if (!order) throw httpError(500, 'Could not create your order. Please try again.');
      await c.query(
        `INSERT INTO order_items (order_id, product_id, name, kind, unit_price, unit_cost, qty)
         SELECT $1::int, t.pid, t.name, t.kind, t.price, t.cost, t.qty
           FROM unnest($2::int[], $3::text[], $4::text[], $5::int[], $6::int[], $7::int[]) AS t(pid, name, kind, price, cost, qty)`,
        [order.id, lines.map((l) => l.id), lines.map((l) => l.name), lines.map((l) => l.kind), lines.map((l) => l.price),
          lines.map((l) => l.cost), lines.map((l) => l.qty)]);
      await c.query(`INSERT INTO order_log (order_id, at, what, note) VALUES ($1,$2,'created',$3)`,
        [order.id, new Date().toISOString(), gift ? 'Placed on the website (gift spot reserved)' : 'Placed on the website']);
      // remember the details for next time, and empty the saved cart
      await c.query(`UPDATE customers SET address = CASE WHEN address = '' THEN $2 ELSE address END WHERE id = $1`, [cust.id, address]);
      await c.query('DELETE FROM carts WHERE customer_id = $1', [cust.id]);
      return { orderId: order.public_id, total, gift, batchName: ps[0].batch_name };
    });
    res.json({ ...out });
  });

  async function start() { /* nothing to warm up: photos live on the image host */ }

  return { invalidate, getCatalog, getSettings, DEFAULTS, notFound, start, cdn, readLine, LINE_KEYS, LINE_DEFAULTS };
};
