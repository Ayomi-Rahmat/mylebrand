(function () {
  'use strict';
  const app = document.getElementById('app');
  const TZ = 'Africa/Lagos';

  // ---------- state ----------
  let cat = JSON.parse(document.getElementById('boot').textContent);
  let catAt = Date.now();
  let me = null;            // logged-in customer or null
  let meLoaded = false;
  let cart = [];            // [{id, qty}]
  try { cart = JSON.parse(localStorage.getItem('mb_cart') || '[]'); } catch (e) { cart = []; }
  if (!Array.isArray(cart)) cart = [];

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }
  const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
  const img = (url, w) => (/^https:\/\/res\.cloudinary\.com\/.+\/upload\//.test(url) ? url.replace('/upload/', '/upload/f_auto,q_auto,w_' + w + '/') : url);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status', text: msg });
    document.body.append(t); setTimeout(() => t.remove(), bad ? 5000 : 2200);
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
    return data;
  }
  const hasHint = () => /(?:^|; )mb_in=1/.test(document.cookie);

  const products = () => { const m = new Map(); cat.batches.forEach((b) => b.edits.forEach((e) => e.products.forEach((p) => m.set(p.id, { p, e, b })))); return m; };
  const findEdit = (slug) => { for (const b of cat.batches) for (const e of b.edits) if (e.slug === slug) return { b, e }; return null; };
  const findProd = (slug) => { for (const b of cat.batches) for (const e of b.edits) for (const p of e.products) if (p.slug === slug) return { b, e, p }; return null; };
  const openBatch = () => cat.batches.find((b) => b.open) || null;
  const heroBatch = () => openBatch() || cat.batches[0] || null;
  const S = cat.settings;
  const wa = (text) => 'https://wa.me/' + S.whatsapp + (text ? '?text=' + encodeURIComponent(text) : '');

  // ---------- cart ----------
  let syncTimer = null;
  function saveCart() {
    try { localStorage.setItem('mb_cart', JSON.stringify(cart)); } catch (e) { /* private mode */ }
    if (me) { clearTimeout(syncTimer); syncTimer = setTimeout(() => api('PUT', '/api/cart', { items: cart }).catch(() => {}), 700); }
    paintCartCount();
  }
  const cartCount = () => cart.reduce((n, i) => n + i.qty, 0);
  function paintCartCount() {
    const b = document.querySelector('.cartbtn b');
    const n = cartCount();
    if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
  }
  function addToCart(id, qty) {
    const map = products();
    const info = map.get(id);
    if (!info) return;
    // one batch at a time: ordering from a second batch starts a fresh cart
    const other = cart.find((i) => map.get(i.id) && map.get(i.id).b.id !== info.b.id);
    if (other && !confirm('Your cart has items from another batch. Start a new cart with this item instead?')) return;
    if (other) cart = [];
    const line = cart.find((i) => i.id === id);
    if (line) line.qty = Math.min(50, line.qty + qty); else cart.push({ id, qty });
    saveCart();
    toast('Added to cart 🤍');
  }
  function setQty(id, qty) {
    if (qty < 1) cart = cart.filter((i) => i.id !== id);
    else { const l = cart.find((i) => i.id === id); if (l) l.qty = Math.min(50, qty); }
    saveCart(); route();
  }
  async function mergeServerCart() {
    try {
      const r = await api('GET', '/api/cart');
      const m = new Map();
      [...r.items, ...cart].forEach((i) => m.set(i.id, Math.max(m.get(i.id) || 0, i.qty)));
      cart = [...m].map(([id, qty]) => ({ id, qty }));
      saveCart();
    } catch (e) { /* ignore */ }
  }

  // ---------- account ----------
  async function loadMe() {
    if (meLoaded) return me;
    meLoaded = true;
    if (!hasHint()) return null;
    try { me = (await api('GET', '/api/account/me')).customer; } catch (e) { me = null; }
    if (me) mergeServerCart();
    return me;
  }
  function afterAuth(c, next) {
    me = c; meLoaded = true;
    mergeServerCart().then(() => { paintHeader(); });
    go(c.mustChange ? '/account' : (next || '/'));
  }
  async function refreshCatalog() {
    if (Date.now() - catAt < 45000) return;
    try { cat = await api('GET', '/api/shop'); catAt = Date.now(); } catch (e) { /* keep the old one */ }
  }

  // ---------- chrome ----------
  function header() {
    const p = location.pathname;
    const tab = (href, text, on) => h('a', { href, 'data-link': '', class: 'tab' + (on ? ' on' : '') }, text);
    const curated = p === '/' || p.startsWith('/e/') || p.startsWith('/p/');
    return h('header', { class: 'hdr' },
      h('div', { class: 'wrap hdrrow' },
        h('a', { href: '/', class: 'logo', 'data-link': '' }, 'MYLEBRAND'),
        h('nav', { class: 'nav' },
          me ? h('a', { href: '/account', 'data-link': '' }, me.name.split(' ')[0]) : h('a', { href: '/login', 'data-link': '' }, 'Log in'),
          h('a', { href: '/cart', class: 'cartbtn', 'data-link': '' }, 'Cart', h('b', { text: String(cartCount()), style: cartCount() ? '' : 'display:none' })))),
      h('div', { class: 'tabs' }, h('div', { class: 'wrap tabsrow' },
        tab('/', 'Curated batch', curated), tab('/beauty', 'Beauty wholesale', p === '/beauty'), tab('/interiors', 'Interiors', p === '/interiors'),
        me ? tab('/orders', 'My orders', p === '/orders' || p.startsWith('/order/')) : null)));
  }
    function paintHeader() { const old = document.querySelector('.hdr'); if (old) old.replaceWith(header()); }
  function footer() {
    const soc = [['Instagram', S.instagram], ['TikTok', S.tiktok], ['Facebook', S.facebook], ['WhatsApp', wa('Hi MYLEBRAND! 🤍')], ['Community', S.community]].filter((x) => x[1]);
    return h('footer', { class: 'ftr' }, h('div', { class: 'wrap' },
      h('div', { class: 'ftrtop' },
        h('div', { class: 'ftrleft' }, h('div', { class: 'logo' }, 'MYLEBRAND'), h('p', { text: S.site_tagline })),
        h('div', { class: 'soc' }, soc.map(([n, u]) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, n)))),
      h('div', { class: 'ftrbot' },
        h('a', { href: '/track', class: 'small' }, 'Track an older order with ID + PIN'),
        h('div', { class: 'copy-line' }, '© ' + new Date().getFullYear() + ' MYLEBRAND', h('span', { class: 'seal-sm', 'aria-hidden': 'true', text: '意' })))));
  }
    function shell(...content) {
    const a = S.announcement ? h('div', { class: 'announce', text: S.announcement }) : null;
    app.replaceChildren(...[a, header(), h('main', { id: 'main' }, content), footer()].filter(Boolean));
  }

  // ---------- pieces ----------
  function productCard(p, b) {
    const closed = b && !b.open;
    return h('a', { class: 'pcard' + (p.soldOut ? ' soldout' : ''), href: '/p/' + p.slug, 'data-link': '' },
      h('div', { class: 'ph' },
        p.images[0] ? h('img', { src: img(p.images[0].url, 500), alt: p.name, loading: 'lazy', width: 500, height: 625 }) : h('div', { class: 'noimg', text: '✦' }),
        p.soldOut ? h('span', { class: 'badge sold', text: 'Sold out' }) : (closed ? null : null),
        p.kind === 'box' ? h('span', { class: 'badge box', text: 'Box' }) : null),
      h('div', { class: 'nm', text: p.name }),
      h('div', { class: 'pr' }, naira(p.price), p.compareAt ? h('s', { text: naira(p.compareAt) }) : null));
  }
  function stepper(val, on) {
    return h('div', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'Less', onclick: () => on(val - 1) }, '−'), h('span', { text: String(val) }),
      h('button', { type: 'button', 'aria-label': 'More', onclick: () => on(val + 1) }, '+'));
  }
  function giftNote() {
    const t = Number(S.gift_threshold), n = Number(S.gift_slots);
    if (!t || !n) return null;
    return h('div', { class: 'giftbar' }, h('span', { style: 'font-size:1.6rem', text: '🎁' }),
      h('div', null, h('b', { text: 'Order ' + naira(t) + ' or more' }), h('div', { class: 'small', text: 'and the first ' + n + ' customers in each batch get ' + (S.gift_text || 'a gift') + '.' })));
  }
  function daysLeft(b) {
    if (!b.closesOn) return null;
    const d = Math.ceil((Date.parse(b.closesOn + 'T23:59:59+01:00') - Date.now()) / 86400000);
    return d;
  }

  // ---------- pages ----------
  function pageHome() {
    const b = heroBatch();
    document.title = 'MYLEBRAND | Curated lifestyle pieces for intentional living';
    const open = !!(b && b.open);
    const left = open ? daysLeft(b) : null;
    const lines = cat.lines || {};
    const go2 = (id) => (e) => { e.preventDefault(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
    const hero = h('section', { class: 'hero', style: 'padding:0' }, h('div', { class: 'wrap' },
      h('div', { class: 'eyebrow', text: 'MYLEBRAND' }),
      h('h1', { text: 'Pieces chosen with intention.' }),
      h('p', { class: 'lead', text: S.site_tagline }),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        b ? h('a', { class: 'btn light', href: '#preorder', onclick: go2('preorder') }, open ? 'See the preorder' : 'See the last batch') : null,
        h('a', { class: 'btn ghost light', href: '/beauty', 'data-link': '' }, 'Beauty wholesale'))));
    const parts = [hero];
    const all = b ? b.edits.flatMap((e) => e.products.map((p) => ({ p, e }))) : [];
    if (b) {
      const facts = [];
      if (open && b.closesOn) facts.push(['Preorders close', fmtDay(b.closesOn) + (left !== null ? (left <= 0 ? ' (last day!)' : ' · ' + left + ' day' + (left === 1 ? '' : 's') + ' left') : '')]);
      if (b.deliveryFrom) facts.push(['Delivery', fmtDay(b.deliveryFrom) + (b.deliveryTo ? ' – ' + fmtDay(b.deliveryTo) : '')]);
      facts.push(['Pieces', String(all.length)]);
      parts.push(h('section', { id: 'preorder', style: 'padding-bottom:10px' }, h('div', { class: 'wrap' },
        h('div', { class: 'prebox' },
          h('div', null,
            h('span', { class: 'pill' + (open ? ' dot' : ''), style: 'border-color:var(--line);color:var(--ink)', text: open ? 'Preorders open' : 'Preorders closed' }),
            h('h2', { text: b.name }), b.tagline ? h('p', { class: 'muted', style: 'margin:8px 0 0', text: b.tagline }) : null,
            h('div', { class: 'wfacts', style: 'margin-top:12px' }, facts.map(([k, v]) => h('span', null, h('i', { text: k }), ' ', v)))),
          h('div', { class: 'preact' },
            open ? giftNote() : null,
            h('a', { class: 'btn', href: '#available', onclick: go2('available') }, open ? 'Shop the batch' : 'Browse the batch'))))));
      if (all.length) {
        const shown = [...all.filter((x) => !x.p.soldOut), ...all.filter((x) => x.p.soldOut)].slice(0, 8);
        parts.push(h('section', { id: 'available' }, h('div', { class: 'wrap' },
          h('div', { class: 'sechead' }, h('div', { class: 'eyebrow', text: b.name }), h('h2', { text: open ? 'Available to preorder' : 'From this batch' })),
          h('div', { class: 'grid four' }, shown.map((x) => productCard(x.p, b))),
          b.edits.length ? h('div', { class: 'chips', style: 'margin:22px 0 0' }, h('span', { class: 'small muted', style: 'align-self:center', text: 'Browse by edit:' }),
            b.edits.map((e) => h('a', { class: 'chip', href: '/e/' + e.slug, 'data-link': '', style: 'text-decoration:none', text: e.name }))) : null)));
      }
    } else {
      parts.push(h('section', null, h('div', { class: 'wrap center' }, h('h2', { text: 'The next batch is being prepared.' }),
        h('p', { class: 'muted', text: 'Join the list and you will be the first to know when preorders open.' }),
        h('a', { class: 'btn', href: S.community || wa('Hi MYLEBRAND! Please add me to the list 🤍'), target: '_blank', rel: 'noopener' }, 'Join on WhatsApp'))));
    }
    const card = (href, title, d) => h('a', { class: 'linecard', href, 'data-link': '' }, h('div', { class: 'eyebrow', text: 'MYLEBRAND' }), h('h3', { text: title }), h('p', { class: 'muted', text: d }), h('span', { class: 'btn small', text: 'Open' }));
    parts.push(h('section', { style: 'padding-top:10px' }, h('div', { class: 'wrap' },
      h('div', { class: 'sechead' }, h('div', { class: 'eyebrow', text: 'More from us' }), h('h2', { text: 'Shop by collection' })),
      h('div', { class: 'editgrid' },
        card('/beauty', (lines.beauty && lines.beauty.title) || 'Beauty wholesale', (lines.beauty && lines.beauty.sub) || 'Buy in bulk at student prices.'),
        card('/interiors', (lines.interiors && lines.interiors.title) || 'Interiors', (lines.interiors && lines.interiors.sub) || 'Simple pieces for your space.')))));
    parts.push(h('section', { style: 'padding-top:0' }, h('div', { class: 'wrap' },
      h('div', { class: 'sechead' }, h('div', { class: 'eyebrow', text: 'How preorders work' }), h('h2', { text: 'Preorder, then relax.' })),
      h('div', { class: 'steps' },
        [['Choose', 'Pick your pieces from the open batch and add them to your cart.'],
          ['Pay by transfer', 'Place your order and pay to our account. We confirm it by hand.'],
          ['Message us', 'Tap the WhatsApp button so we can match your payment to your order.'],
          ['Track it', 'Follow your order from China to your door, right in your account.']]
          .map(([t, d]) => h('div', { class: 'step' }, h('b', { text: t }), h('span', { class: 'muted', text: d })))))));
    if (S.promise) parts.push(h('section', { class: 'band' }, h('div', { class: 'wrap center' }, h('div', { class: 'eyebrow', text: 'Our promise' }), h('h2', { style: 'margin-top:10px', text: S.promise }))));
    shell(parts);
  }

    function pageEdit(slug) {
    const f = findEdit(slug);
    if (!f) return pageNotFound();
    const { b, e } = f;
    document.title = e.name + ' | MYLEBRAND';
    const cats = [...new Set(e.products.map((p) => p.category).filter(Boolean))];
    let active = '';
    const grid = h('div', { class: 'grid' });
    const chips = h('div', { class: 'chips' });
    const draw = () => {
      grid.replaceChildren(...e.products.filter((p) => !active || p.category === active).map((p) => productCard(p, b)));
      chips.replaceChildren(...(cats.length > 1 ? [h('button', { class: 'chip' + (active ? '' : ' on'), onclick: () => { active = ''; draw(); } }, 'All'),
        ...cats.map((c) => h('button', { class: 'chip' + (active === c ? ' on' : ''), onclick: () => { active = c; draw(); } }, c))] : []));
    };
    draw();
    shell(h('div', { class: 'wrap page' },
      h('div', { class: 'crumbs' }, h('a', { href: '/', 'data-link': '' }, 'Shop'), ' / ', e.name),
      h('div', { class: 'sechead', style: 'margin-top:14px' }, h('div', { class: 'eyebrow', text: b.name + (b.open ? '' : ' · closed') }), h('h1', { text: e.name }),
        e.tagline ? h('p', { class: 'script', style: 'font-size:1.7rem;color:var(--terracotta);margin:6px 0 0', text: e.tagline }) : null,
        e.description ? h('p', { class: 'muted', style: 'white-space:pre-line', text: e.description }) : null),
      chips, e.products.length ? grid : h('p', { class: 'muted', text: 'Pieces are being added. Check back soon.' })));
  }

  function pageProduct(slug) {
    const f = findProd(slug);
    if (!f) return pageNotFound();
    const { b, e, p } = f;
    document.title = p.name + ' | MYLEBRAND';
    let qty = 1, cur = 0;
    const main = h('div', { class: 'main' });
    const ths = h('div', { class: 'ths' });
    const drawG = () => {
      main.replaceChildren(p.images[cur] ? h('img', { src: img(p.images[cur].url, 900), alt: p.name, width: 900, height: 1125 }) : h('div', { class: 'noimg', text: '✦' }));
      ths.replaceChildren(...(p.images.length > 1 ? p.images.map((im, i) => h('button', { class: i === cur ? 'on' : '', 'aria-label': 'Photo ' + (i + 1), onclick: () => { cur = i; drawG(); } }, h('img', { src: img(im.url, 128), alt: '' }))) : []));
    };
    drawG();
    const buy = h('div');
    const drawBuy = () => {
      buy.replaceChildren();
      if (p.soldOut) buy.append(h('div', { class: 'notice' }, 'This one is sold out. ', h('a', { href: wa('Hi MYLEBRAND! Please let me know if "' + p.name + '" comes back 🤍'), target: '_blank', rel: 'noopener' }, 'Ask us on WhatsApp'), ' if it returns.'));
      else if (!b.open) buy.append(h('div', { class: 'notice' }, 'Preorders for ' + b.name + ' are closed. ', h('a', { href: S.community || wa('Hi MYLEBRAND! 🤍'), target: '_blank', rel: 'noopener' }, 'Join the list'), ' for the next batch.'));
      else buy.append(h('div', { class: 'row', style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap' },
        stepper(qty, (n) => { qty = Math.max(1, Math.min(50, n)); drawBuy(); }),
        h('button', { class: 'btn', style: 'flex:1;min-width:180px', onclick: () => addToCart(p.id, qty) }, 'Add to cart · ' + naira(p.price * qty))));
    };
    drawBuy();
    const others = e.products.filter((x) => x.id !== p.id).slice(0, 4);
    shell(h('div', { class: 'wrap' },
      h('div', { class: 'crumbs' }, h('a', { href: '/', 'data-link': '' }, 'Shop'), ' / ', h('a', { href: '/e/' + e.slug, 'data-link': '' }, e.name), ' / ', p.name),
      h('div', { class: 'pdp' }, h('div', { class: 'gal' }, main, ths),
        h('div', null, h('div', { class: 'eyebrow', text: p.kind === 'box' ? 'A MYLEBRAND box' : (p.category || e.name) }), h('h1', { style: 'font-size:clamp(2rem,5vw,2.8rem);margin:8px 0', text: p.name }),
          h('div', { class: 'price' }, naira(p.price), p.compareAt ? h('s', { text: naira(p.compareAt) }) : null),
          p.desc ? h('div', { class: 'desc', text: p.desc }) : null,
          p.kind === 'box' && p.items ? h('div', { class: 'boxlist' }, h('b', { text: 'Inside the box' }),
            p.items.map((it) => h('a', { class: 'it', href: '/p/' + it.slug, 'data-link': '', style: 'text-decoration:none' },
              it.thumb ? h('img', { src: img(it.thumb, 96), alt: '' }) : null, h('span', { style: 'flex:1', text: it.name }), h('span', { class: 'muted', text: '× ' + it.qty })))) : null,
          buy, h('p', { class: 'small muted', style: 'margin-top:18px', text: 'Preorder item. Delivery ' + (b.deliveryFrom ? 'from ' + fmtDay(b.deliveryFrom) + (b.deliveryTo ? ' to ' + fmtDay(b.deliveryTo) : '') : 'dates are shared once the batch ships') + '.' }))),
      others.length ? h('section', null, h('h2', { style: 'margin-bottom:18px', text: 'More from ' + e.name }), h('div', { class: 'grid four' }, others.map((x) => productCard(x, b)))) : null));
  }

  function cartLines() {
    const map = products();
    return cart.map((i) => ({ ...i, info: map.get(i.id) }));
  }
  function pageCart() {
    document.title = 'Your cart | MYLEBRAND';
    const lines = cartLines();
    const live = lines.filter((l) => l.info && !l.info.p.soldOut);
    const bad = lines.filter((l) => !l.info || l.info.p.soldOut);
    if (!lines.length) return shell(h('div', { class: 'narrow page empty' }, h('div', { class: 'big', text: '🛍' }), h('h1', { text: 'Your cart is empty' }), h('p', { class: 'muted', text: 'Find something you love.' }), h('a', { class: 'btn', href: '/', 'data-link': '' }, 'Browse the shop')));
    const total = live.reduce((t, l) => t + l.info.p.price * l.qty, 0);
    const b = live[0] && live[0].info.b;
    const thr = Number(S.gift_threshold), slots = Number(S.gift_slots);
    shell(h('div', { class: 'narrow page' }, h('h1', { text: 'Your cart' }),
      bad.length ? h('div', { class: 'notice bad' }, 'Some items are sold out or no longer available. Remove them to continue.') : null,
      b && !b.open ? h('div', { class: 'notice bad' }, 'Preorders for ' + b.name + ' are closed.') : null,
      h('div', { class: 'card' }, lines.map((l) => {
        const p = l.info && l.info.p;
        return h('div', { class: 'line' },
          p && p.images[0] ? h('img', { src: img(p.images[0].url, 160), alt: '' }) : h('div', { class: 'noimg', style: 'width:64px;height:80px;flex:none;background:#dcd3c0;border-radius:10px', text: '✦' }),
          h('div', { class: 'grow' }, h('div', { class: 'nm', text: p ? p.name : 'Item no longer available' }),
            p ? h('div', { class: 'muted small', text: p.soldOut ? 'Sold out' : naira(p.price) + ' each' }) : null,
            h('button', { class: 'linkbtn', onclick: () => setQty(l.id, 0) }, 'Remove')),
          p && !p.soldOut ? h('div', null, stepper(l.qty, (n) => setQty(l.id, n)), h('div', { style: 'text-align:right;margin-top:6px;font-weight:600', text: naira(p.price * l.qty) })) : null);
      }), h('div', { class: 'totalrow' }, h('span', { text: 'Total' }), h('span', { text: naira(total) }))),
      thr && slots && b && b.open ? h('div', { class: 'notice ok' }, total >= thr ? '🎁 Your order qualifies for the gift (limited spots, first come first served).' : 'Add ' + naira(thr - total) + ' more to qualify for ' + (S.gift_text || 'a gift') + '.') : null,
      h('button', { class: 'btn block', disabled: !live.length || bad.length > 0 || (b && !b.open), onclick: () => go(me ? '/checkout' : '/login?next=/checkout') }, me ? 'Checkout' : 'Log in to checkout'),
      !me ? h('p', { class: 'small muted center', style: 'margin-top:12px' }, 'New here? ', h('a', { href: '/signup?next=/checkout', 'data-link': '' }, 'Create an account'), ' in a minute. Your cart is saved.') : null));
  }

  function authPage(mode) {
    const signup = mode === 'signup';
    document.title = (signup ? 'Create account' : 'Log in') + ' | MYLEBRAND';
    const next = new URLSearchParams(location.search).get('next');
    const safeNext = next && /^\/[a-z]/i.test(next) && !next.startsWith('//') ? next : '/';
    const f = {};
    const inp = (id, type, label, extra) => { f[id] = h('input', { id, type, required: '', ...extra }); return h('div', { class: 'field' }, h('label', { for: id, text: label }), f[id]); };
    const err = h('p', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, signup ? 'Create my account' : 'Log in');
    const trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'sr', 'aria-hidden': 'true' });
    const form = h('form', { novalidate: '', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try {
        const body = signup
          ? { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value, website: trap.value }
          : { email: f.email.value, password: f.password.value };
        const r = await api('POST', '/api/account/' + (signup ? 'signup' : 'login'), body);
        afterAuth(r.customer, safeNext);
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
    signup ? inp('name', 'text', 'Your name', { autocomplete: 'name' }) : null,
    inp('email', 'email', 'Email', { autocomplete: signup ? 'email' : 'username' }),
    signup ? inp('phone', 'tel', 'Phone / WhatsApp number', { autocomplete: 'tel', placeholder: '0803 123 4567' }) : null,
    inp('password', 'password', signup ? 'Choose a password (8+ characters)' : 'Password', { autocomplete: signup ? 'new-password' : 'current-password' }),
    trap, btn, err);
    shell(h('div', { class: 'narrow page' }, h('h1', { text: signup ? 'Create your account' : 'Welcome back' }),
      h('p', { class: 'muted', text: signup ? 'One account to place orders and follow them from China to your door.' : 'Log in to place orders and track them.' }),
      h('div', { class: 'card' }, form),
      h('p', { class: 'center small' }, signup ? ['Already have an account? ', h('a', { href: '/login' + (next ? '?next=' + encodeURIComponent(safeNext) : ''), 'data-link': '' }, 'Log in')]
        : ['New to MYLEBRAND? ', h('a', { href: '/signup' + (next ? '?next=' + encodeURIComponent(safeNext) : ''), 'data-link': '' }, 'Create an account')]),
      signup ? null : h('p', { class: 'center small muted' }, 'Forgot your password? ', h('a', { href: wa('Hi MYLEBRAND! I forgot my password. Please reset it for me 🤍'), target: '_blank', rel: 'noopener' }, 'Message us on WhatsApp'), ' and we will send you a temporary one.')));
    if (f.name) f.name.focus(); else f.email.focus();
  }

  function pageCheckout() {
    document.title = 'Checkout | MYLEBRAND';
    if (!me) return go('/login?next=/checkout');
    if (me.mustChange) return go('/account');
    const lines = cartLines().filter((l) => l.info && !l.info.p.soldOut);
    if (!lines.length) return go('/cart');
    const total = lines.reduce((t, l) => t + l.info.p.price * l.qty, 0);
    const f = {
      name: h('input', { type: 'text', id: 'n', value: me.name, autocomplete: 'name' }),
      phone: h('input', { type: 'tel', id: 'ph', value: me.phone, autocomplete: 'tel' }),
      address: h('textarea', { id: 'ad', rows: 3, autocomplete: 'street-address', placeholder: 'House number, street, area, city, state' }, me.address || ''),
      notes: h('textarea', { id: 'nt', rows: 2, placeholder: 'Anything we should know? (optional)' }),
    };
    const err = h('p', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Place order · ' + naira(total));
    const field = (id, label, el) => h('div', { class: 'field' }, h('label', { for: id, text: label }), el);
    shell(h('div', { class: 'narrow page' }, h('h1', { text: 'Checkout' }),
      h('div', { class: 'card' }, lines.map((l) => h('div', { class: 'line' }, h('div', { class: 'grow' }, h('div', { class: 'nm', text: l.qty + ' × ' + l.info.p.name })), h('div', { text: naira(l.info.p.price * l.qty) }))),
        h('div', { class: 'totalrow' }, h('span', { text: 'Total' }), h('span', { text: naira(total) }))),
      h('form', { novalidate: '', onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try {
          const r = await api('POST', '/api/shop/orders', { name: f.name.value, phone: f.phone.value, address: f.address.value, notes: f.notes.value, items: lines.map((l) => ({ id: l.id, qty: l.qty })) });
          cart = []; saveCart(); catAt = 0;
          go('/order/' + r.orderId + '?new=1');
        } catch (ex) {
          if (ex.status === 401) { me = null; paintHeader(); return go('/login?next=/checkout'); }
          err.textContent = ex.message; btn.disabled = false;
        }
      } },
      h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:14px', text: 'Delivery details' }), field('n', 'Full name', f.name), field('ph', 'Phone / WhatsApp number', f.phone), field('ad', 'Delivery address', f.address), field('nt', 'Note', f.notes)),
      h('p', { class: 'small muted', text: 'Next you will see our bank details. Your order is confirmed once we see your transfer.' }), btn, err)));
  }

  const copyBtn = (text) => h('button', { class: 'copy', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast('Copy it manually', true); } } }, 'Copy');
  async function pageOrder(id) {
    document.title = 'Your order | MYLEBRAND';
    if (!me) return go('/login?next=' + encodeURIComponent('/order/' + id));
    shell(h('div', { class: 'narrow page' }, h('div', { class: 'skeleton', style: 'height:300px' })));
    let d;
    try { d = await api('GET', '/api/account/orders/' + encodeURIComponent(id)); }
    catch (e) { return shell(h('div', { class: 'narrow page empty' }, h('h1', { text: 'Order not found' }), h('p', { class: 'muted', text: 'It may belong to a different account.' }), h('a', { class: 'btn', href: '/orders', 'data-link': '' }, 'My orders'))); }
    const o = d.order;
    const isNew = new URLSearchParams(location.search).get('new');
    const msg = 'Hi MYLEBRAND! 🤍 I just placed order ' + o.orderId + ' (' + naira(o.total) + ') on the website. I am sending my transfer receipt now.';
    const parts = [h('h1', { text: o.status === 'pending' ? (isNew ? 'Order placed! 🤍' : 'Your order') : 'Your order' }),
      h('p', { class: 'muted' }, 'Order ', h('b', { text: o.orderId }), ' · ', h('span', { class: 'tag ' + o.status, text: { pending: 'Waiting for payment', paid: 'Paid', cancelled: 'Cancelled' }[o.status] }))];
    if (o.status === 'pending') {
      parts.push(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:6px', text: '1. Pay by bank transfer' }),
        h('p', { class: 'muted small', style: 'margin-top:0', text: d.bank.note || 'Please use your order ID as the transfer reference.' }),
        d.bank.accountNumber ? h('div', { class: 'bank' },
          h('div', { class: 'r' }, h('div', null, h('div', { class: 'l', text: 'Amount to pay' }), h('div', { class: 'v', text: naira(o.total) })), copyBtn(String(o.total))),
          h('div', { class: 'r' }, h('div', null, h('div', { class: 'l', text: 'Bank' }), h('div', { class: 'v', text: d.bank.bankName })), null),
          h('div', { class: 'r' }, h('div', null, h('div', { class: 'l', text: 'Account number' }), h('div', { class: 'v', text: d.bank.accountNumber })), copyBtn(d.bank.accountNumber)),
          h('div', { class: 'r' }, h('div', null, h('div', { class: 'l', text: 'Account name' }), h('div', { class: 'v', text: d.bank.accountName })), null),
          h('div', { class: 'r' }, h('div', null, h('div', { class: 'l', text: 'Reference' }), h('div', { class: 'v', text: o.orderId })), copyBtn(o.orderId)))
          : h('div', { class: 'notice' }, 'Our bank details are not on the site yet. Please message us on WhatsApp and we will send them right away.')));
      parts.push(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:6px', text: '2. Tell us you have paid' }),
        h('p', { class: 'muted small', style: 'margin-top:0', text: 'Tap the button, send the pre-written message, and attach your transfer receipt. We will confirm your payment and your order moves to “Paid”.' }),
        h('a', { class: 'btn wa block', href: wa(msg), target: '_blank', rel: 'noopener' }, 'Message us on WhatsApp'),
        d.community ? h('p', { class: 'small center', style: 'margin-bottom:0' }, h('a', { href: d.community, target: '_blank', rel: 'noopener' }, 'Join the MYLEBRAND community'), ' for batch updates.') : null));
      parts.push(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:8px', text: 'What happens next' }),
        h('ol', { class: 'small', style: 'padding-left:18px;margin:0;line-height:1.8' },
          ['We confirm your payment (usually within a few hours).', 'Your order turns to “Paid” and your tracker starts right here on this page.', 'We update each stage as your batch moves from China to Lagos and then to you.', 'You will get a WhatsApp message when it is ready for delivery.'].map((t) => h('li', { text: t })))));
    }
    if (o.status === 'paid') {
      parts.push(h('div', { class: 'notice ok', text: '✓ Payment confirmed' + (o.paidAt ? ' on ' + fmtDate(o.paidAt) : '') + '. Thank you! Your order is part of ' + o.batchName + '.' }));
      if (o.gift) parts.push(h('div', { class: 'notice', text: '🎁 You got a gift spot: ' + (d.giftText || 'a valuable gift') + ' will come with your order.' }));
      if (d.stages) {
        parts.push(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:6px', text: 'Where your order is' }),
          o.lagosEta ? h('p', { class: 'muted small', style: 'margin-top:0', text: 'Expected in Lagos around ' + fmtDay(o.lagosEta) + (o.deliveryFrom ? ' · delivery window ' + fmtDay(o.deliveryFrom) + (o.deliveryTo ? ' – ' + fmtDay(o.deliveryTo) : '') : '') }) : null,
          h('ol', { class: 'tl' }, d.stages.map((s) => h('li', { class: s.status },
            h('span', { class: 'dot' }), h('div', { class: 't', text: s.title }),
            s.status !== 'upcoming' && s.at ? h('div', { class: 'small muted', text: fmtDate(s.at) }) : null,
            s.status === 'current' ? h('div', { class: 'small', text: s.desc }) : null,
            s.note && s.status !== 'upcoming' ? h('div', { class: 'small', style: 'font-style:italic', text: s.note }) : null)))));
      }
    }
    if (o.status === 'cancelled') parts.push(h('div', { class: 'notice bad', text: 'This order was cancelled.' }));
    parts.push(h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:8px', text: 'Order summary' }),
      d.items.map((i) => h('div', { class: 'line', style: 'padding:8px 0' }, h('div', { class: 'grow', text: i.qty + ' × ' + i.name }), h('div', { text: naira(i.unitPrice * i.qty) }))),
      h('div', { class: 'totalrow' }, h('span', { text: 'Total' }), h('span', { text: naira(o.total) })),
      h('p', { class: 'small muted', style: 'margin-bottom:0', text: 'Delivering to: ' + o.address + ' · ' + o.phone })));
    if (o.status === 'pending') parts.push(h('p', { class: 'center' }, h('button', { class: 'linkbtn', onclick: async () => {
      if (!confirm('Cancel this order?')) return;
      try { await api('POST', '/api/account/orders/' + encodeURIComponent(o.orderId) + '/cancel'); toast('Order cancelled'); route(); } catch (e) { toast(e.message, true); } } }, 'Cancel this order')));
    parts.push(h('p', { class: 'center' }, h('a', { href: '/orders', 'data-link': '' }, 'All my orders')));
    shell(h('div', { class: 'narrow page' }, parts));
  }

  async function pageOrders() {
    document.title = 'My orders | MYLEBRAND';
    if (!me) return go('/login?next=/orders');
    shell(h('div', { class: 'narrow page' }, h('div', { class: 'skeleton', style: 'height:200px' })));
    const r = await api('GET', '/api/account/orders').catch(() => ({ orders: [] }));
    shell(h('div', { class: 'narrow page' }, h('h1', { text: 'My orders' }),
      r.orders.length ? r.orders.map((o) => h('a', { class: 'card', href: '/order/' + o.orderId, 'data-link': '', style: 'display:block;text-decoration:none' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:10px' }, h('b', { text: o.orderId }), h('b', { text: naira(o.total) })),
        h('div', { class: 'small muted', style: 'margin:4px 0', text: o.batchName + ' · ' + fmtDate(o.createdAt) }),
        h('div', { class: 'small', text: o.summary }),
        h('span', { class: 'tag ' + o.status, text: { pending: 'Waiting for payment', paid: 'Paid', cancelled: 'Cancelled' }[o.status] })))
        : h('div', { class: 'empty' }, h('p', { class: 'muted', text: 'No orders yet.' }), h('a', { class: 'btn', href: '/', 'data-link': '' }, 'Start shopping'))));
  }

  function pageAccount() {
    document.title = 'My account | MYLEBRAND';
    if (!me) return go('/login?next=/account');
    const nm = h('input', { type: 'text', id: 'an', value: me.name }), ph = h('input', { type: 'tel', id: 'ap', value: me.phone });
    const ad = h('textarea', { id: 'aa', rows: 3 }, me.address || '');
    const e1 = h('p', { class: 'err', role: 'alert' });
    const cur = h('input', { type: 'password', id: 'cp', autocomplete: 'current-password' }), nw = h('input', { type: 'password', id: 'np', autocomplete: 'new-password' });
    const e2 = h('p', { class: 'err', role: 'alert' });
    const fld = (id, l, el) => h('div', { class: 'field' }, h('label', { for: id, text: l }), el);
    shell(h('div', { class: 'narrow page' }, h('h1', { text: 'My account' }),
      me.mustChange ? h('div', { class: 'notice bad', text: 'Please choose a new password before you continue. You are using a temporary one.' }) : null,
      h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:12px', text: 'Your details' }), fld('an', 'Name', nm), fld('ap', 'Phone / WhatsApp', ph), fld('aa', 'Delivery address', ad),
        h('p', { class: 'small muted', text: 'Email: ' + me.email }),
        h('button', { class: 'btn small', onclick: async () => { e1.textContent = ''; try { me = (await api('PATCH', '/api/account/me', { name: nm.value, phone: ph.value, address: ad.value })).customer; paintHeader(); toast('Saved'); } catch (x) { e1.textContent = x.message; } } }, 'Save'), e1),
      h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:12px', text: 'Change password' }), fld('cp', me.mustChange ? 'Temporary password' : 'Current password', cur), fld('np', 'New password (8+ characters)', nw),
        h('button', { class: 'btn small', onclick: async () => { e2.textContent = ''; try { await api('POST', '/api/account/password', { current: cur.value, next: nw.value }); me.mustChange = false; cur.value = nw.value = ''; toast('Password changed'); route(); } catch (x) { e2.textContent = x.message; } } }, 'Change password'), e2),
      h('p', null, h('a', { class: 'btn ghost', href: '/orders', 'data-link': '' }, 'My orders'), ' ',
        h('button', { class: 'btn ghost', onclick: async () => { try { await api('POST', '/api/account/logout', {}); } catch (e) { /* ignore */ } me = null; cart = cart; paintHeader(); go('/'); } }, 'Log out'))));
  }


  // ---------- wholesale landing pages (QR codes open these) ----------
  function pageLine(line) {
    const L = (cat.lines || {})[line];
    if (!L) return pageNotFound();
    document.title = L.title + ' | MYLEBRAND';
    const beauty = line === 'beauty';
    const tag = beauty ? 'BW' : 'IN';
    const group = L.groupLink || S.community;
    const hello = 'Hi MYLEBRAND! 🤍 I am interested in ' + L.title.toLowerCase() + '. Please send me the ' + (beauty ? 'price list' : 'details') + '. [' + tag + ']';
    const live = L.deadline && Date.parse(L.deadline + 'T23:59:59+01:00') > Date.now();
    const qty = L.items.map(() => 0);
    const hasPrices = L.items.some((i) => i.price);
    const box = h('div');
    const draw = () => {
      let cost = 0, sell = 0, allResale = true, picked = [];
      L.items.forEach((it, i) => {
        if (!qty[i] || !it.price) return;
        cost += it.price * qty[i]; picked.push(qty[i] + ' x ' + it.name);
        if (it.resale) sell += it.resale * qty[i]; else allResale = false;
      });
      const short = L.items.map((it, i) => (qty[i] && it.minQty && qty[i] < it.minQty ? it.name + ' (minimum ' + it.minQty + ')' : null)).filter(Boolean);
      const order = 'Hi MYLEBRAND! 🤍 I would like to order:\n' + picked.join('\n') + '\nTotal: ' + naira(cost) + '\n[' + tag + ']';
      const rows = L.items.map((it, i) => {
        const facts = [];
        if (it.price) {
          const pct = it.oldPrice && it.oldPrice > it.price ? Math.round((1 - it.price / it.oldPrice) * 100) : 0;
          facts.push(h('span', null, h('i', { text: beauty ? 'You pay' : 'Price' }), ' ', h('b', { text: naira(it.price) }), pct ? [' ', h('s', { class: 'muted', text: naira(it.oldPrice) }), ' ', h('em', { class: 'off', text: '-' + pct + '%' })] : null));
        }
        if (it.resale) facts.push(h('span', null, h('i', { text: 'You sell at' }), ' ', naira(it.resale)));
        if (it.price && it.resale) facts.push(h('span', { class: 'gain' }, h('i', { text: 'Profit each' }), ' +' + naira(it.resale - it.price)));
        if (it.minQty) facts.push(h('span', null, h('i', { text: 'Minimum' }), ' ' + it.minQty + ' pcs'));
        const im = (it.images || [])[0];
        return h('div', { class: 'wrow' },
          im ? h('img', { class: 'wimg', src: img(im.url, 200), alt: it.name, loading: 'lazy' }) : null,
          h('div', { class: 'wmain' }, h('b', { text: it.name }), it.note ? h('span', { class: 'small muted', text: ' · ' + it.note }) : null,
            it.desc ? h('div', { class: 'small muted wdesc', text: it.desc }) : null,
            facts.length ? h('div', { class: 'wfacts' }, facts) : h('div', { class: 'small muted', text: 'Price on request. Ask us on WhatsApp.' })),
          it.price ? stepper(qty[i], (n) => { qty[i] = Math.max(0, Math.min(999, n)); draw(); }) : null);
      });
      box.replaceChildren(...[
        h('div', { class: 'wlist' }, rows),
        L.minNote ? h('p', { class: 'small muted', text: L.minNote }) : null,
        hasPrices ? h('div', { class: 'card calc' },
          h('h3', { text: 'Your order' }),
          picked.length ? [
            h('div', { class: 'totalrow', style: 'border-top:0' }, h('span', { text: beauty ? 'You pay' : 'Total' }), h('span', { text: naira(cost) })),
            beauty && allResale ? h('div', { class: 'totalrow gain', style: 'font-size:1.1rem;border-top:0' }, h('span', { text: 'If you sell everything' }), h('span', { text: '+' + naira(sell - cost) + ' profit' })) : null,
            short.length ? h('div', { class: 'notice', text: 'Minimum not reached: ' + short.join(', ') }) : null,
            h('a', { class: 'btn wa block', href: wa(order), target: '_blank', rel: 'noopener' }, 'Send my order on WhatsApp'),
          ] : h('p', { class: 'muted', style: 'margin:0', text: beauty ? 'Tap + next to a product to see what you would pay and how much you could earn.' : 'Tap + next to a product to build your order.' })) : null,
      ].filter(Boolean));
    };
    draw();
    shell(
      h('section', { class: 'hero', style: 'padding:0' }, h('div', { class: 'wrap' },
        h('div', { class: 'eyebrow', text: beauty ? 'MYLEBRAND · Student wholesale' : 'MYLEBRAND · Interiors' }),
        h('h1', { text: L.headline }),
        h('p', { class: 'lead', text: L.sub }),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
          h('a', { class: 'btn light', href: wa(hello), target: '_blank', rel: 'noopener' }, beauty ? 'Get the price list on WhatsApp' : 'Chat with us on WhatsApp'),
          group ? h('a', { class: 'btn ghost light', href: group, target: '_blank', rel: 'noopener' }, 'Join the group') : null))),
      h('div', { class: 'wrap' },
        L.bonus ? h('div', { class: 'giftbar', style: 'margin-top:26px' }, h('span', { style: 'font-size:1.6rem', text: '🎁' }),
          h('div', null, h('b', { text: L.bonus }), live || L.spots ? h('div', { class: 'small', text: [L.spots ? 'Limited to the first ' + L.spots + ' students.' : '', live ? 'Ends ' + fmtDay(L.deadline) + '.' : ''].filter(Boolean).join(' ') }) : null)) : null,
        h('section', { style: 'padding-bottom:20px' },
          h('div', { class: 'sechead' }, h('div', { class: 'eyebrow', text: beauty ? 'Price list' : 'Available now' }), h('h2', { text: beauty ? 'What you pay, what you earn' : 'Pick what you like' })),
          box),
        h('section', { style: 'padding-top:10px' },
          h('div', { class: 'steps three' }, [['Choose', beauty ? 'Pick what you want to sell and see your profit.' : 'Pick the pieces you want.'], ['Order on WhatsApp', 'Tap the button. Your order is written for you.'], ['We confirm', 'We confirm your order and tell you how you will get it.']]
            .map(([t, d]) => h('div', { class: 'step' }, h('b', { text: t }), h('span', { class: 'muted', text: d }))))),
        h('div', { class: 'card center', style: 'margin-top:26px' }, h('h3', { text: 'Not sure yet?' }), h('p', { class: 'muted', text: 'Join the group to see new stock and prices first.' }),
          h('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
            group ? h('a', { class: 'btn', href: group, target: '_blank', rel: 'noopener' }, 'Join the group') : null,
            h('a', { class: 'btn wa', href: wa(hello), target: '_blank', rel: 'noopener' }, 'Chat with us')))));
  }

    function pageNotFound() {
    document.title = 'Not found | MYLEBRAND';
    shell(h('div', { class: 'narrow page empty' }, h('div', { class: 'big', text: '✦' }), h('h1', { text: 'We could not find that page' }), h('p', { class: 'muted', text: 'It may have moved, or it is not part of an open batch.' }), h('a', { class: 'btn', href: '/', 'data-link': '' }, 'Back to the shop')));
  }

  // ---------- router ----------
  const ROUTES = [/^\/$/, /^\/(beauty|interiors)$/, /^\/e\//, /^\/p\//, /^\/cart$/, /^\/checkout$/, /^\/login$/, /^\/signup$/, /^\/account$/, /^\/orders$/, /^\/order\//];
  function go(url) { history.pushState({}, '', url); route(); window.scrollTo(0, 0); }
  async function route() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    await loadMe();
    const authed = ['/checkout', '/orders', '/account'].includes(path) || path.startsWith('/order/');
    if (!authed || path === '/checkout') await refreshCatalog();
    let m;
    if (path === '/') pageHome();
    else if ((m = path.match(/^\/e\/([a-z0-9-]+)$/))) pageEdit(m[1]);
    else if ((m = path.match(/^\/p\/([a-z0-9-]+)$/))) pageProduct(m[1]);
    else if (path === '/beauty' || path === '/interiors') pageLine(path.slice(1));
    else if (path === '/cart') pageCart();
    else if (path === '/checkout') pageCheckout();
    else if (path === '/login') (me ? go('/account') : authPage('login'));
    else if (path === '/signup') (me ? go('/account') : authPage('signup'));
    else if (path === '/account') pageAccount();
    else if (path === '/orders') pageOrders();
    else if ((m = path.match(/^\/order\/([A-Za-z0-9-]+)$/))) pageOrder(m[1]);
    else pageNotFound();
    paintCartCount();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-link]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.target) return;
    const u = new URL(a.href, location.origin);
    if (u.origin !== location.origin || !ROUTES.some((r) => r.test(u.pathname))) return;
    e.preventDefault(); go(u.pathname + u.search);
  });
  window.addEventListener('popstate', route);
  window.addEventListener('pageshow', (e) => { if (e.persisted) route(); });
  route();
})();
