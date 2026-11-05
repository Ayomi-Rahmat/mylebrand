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
  function toast(msg, bad, act) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, h('span', { text: msg }),
      act ? h('button', { class: 'toast-act', type: 'button', onclick: () => { t.remove(); act.fn(); } }, act.label) : null);
    document.body.append(t); setTimeout(() => t.remove(), bad ? 5000 : (act ? 4200 : 2200));
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

  // ---------- modals ----------
  const modals = [];
  function openModal(content, opts) {
    opts = opts || {};
    const box = h('div', { class: 'mdl-box' + (opts.drawer ? ' drawer' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || 'Details', tabindex: '-1' },
      h('button', { class: 'mdl-x', type: 'button', 'aria-label': 'Close', onclick: () => closeModal(m) }, '×'), content);
    const bg = h('div', { class: 'mdl', onclick: (e) => { if (e.target === bg) closeModal(m); } }, box);
    const m = { bg, prev: document.activeElement };
    modals.push(m); document.body.append(bg); document.body.classList.add('noscroll');
    const f = opts.focus && box.querySelector(opts.focus);
    (f || box).focus();
    return m;
  }
  function closeModal(m) {
    const i = modals.indexOf(m); if (i < 0) return;
    modals.splice(i, 1); m.bg.remove();
    if (!modals.length) document.body.classList.remove('noscroll');
    try { if (m.prev && m.prev.focus && document.body.contains(m.prev)) m.prev.focus(); } catch (e) { /* ignore */ }
  }
  function closeAllModals() { while (modals.length) closeModal(modals[modals.length - 1]); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modals.length) closeModal(modals[modals.length - 1]); });

  // typed quantity box: - [ 3 ] +
  function numInput(value, o) {
    let v = value;
    const inp = h('input', { class: 'qin', type: 'text', inputmode: 'numeric', 'aria-label': 'Quantity', autocomplete: 'off', value: String(v) });
    const clamp = (n) => Math.max(o.min, Math.min(o.max, n));
    const commit = (n, redraw) => { v = clamp(n); if (redraw) inp.value = String(v); if (o.onChange) o.onChange(v); };
    inp.addEventListener('input', () => {
      const d = inp.value.replace(/\D/g, '').slice(0, 4);
      if (d !== inp.value) inp.value = d;
      if (d !== '') commit(Number(d), false);
    });
    inp.addEventListener('blur', () => { const n = clamp(inp.value === '' ? o.min : Number(inp.value)); inp.value = String(n); if (n !== v) commit(n, true); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(inp.value === '' ? o.min : Number(inp.value), true); inp.blur(); if (o.onEnter) o.onEnter(); } });
    inp.addEventListener('focus', () => inp.select());
    const el = h('div', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'Less', onclick: () => commit(v - 1, true) }, '−'), inp,
      h('button', { type: 'button', 'aria-label': 'More', onclick: () => commit(v + 1, true) }, '+'));
    return { el, get: () => v, set: (n) => { v = clamp(n); inp.value = String(v); } };
  }

  // ---------- cart ----------
  let syncTimer = null;
  let wListeners = [];      // pages that react to wholesale cart changes
  let wcart = [];           // wholesale: [{k, line, name, qty}]
  try { wcart = JSON.parse(localStorage.getItem('mb_wcart') || '[]'); } catch (e) { wcart = []; }
  if (!Array.isArray(wcart)) wcart = [];
  // a cart that belongs to a logged-in customer must not stay on the device after they log out or their login expires
  function clearCarts() {
    cart = []; wcart = []; wContact = { name: '', phone: '' };
    try { ['mb_cart', 'mb_wcart', 'mb_wc', 'mb_cart_user'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    paintCartCount();
  }
  function saveCart() {
    try { localStorage.setItem('mb_cart', JSON.stringify(cart)); if (me) localStorage.setItem('mb_cart_user', '1'); } catch (e) { /* private mode */ }
    if (me) { clearTimeout(syncTimer); syncTimer = setTimeout(() => api('PUT', '/api/cart', { items: cart }).catch(() => {}), 700); }
    paintCartCount();
  }
  function saveW() { try { localStorage.setItem('mb_wcart', JSON.stringify(wcart)); } catch (e) { /* ignore */ } paintCartCount(); wListeners.forEach((f) => f()); }
  const cartCount = () => cart.reduce((n, i) => n + i.qty, 0) + wcart.length;
  function paintCartCount() {
    const b = document.querySelector('.cartbtn b');
    const n = cartCount();
    if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
  }
  function wItems() {
    const out = [];
    wcart.forEach((w) => {
      const L = (cat.lines || {})[w.line]; const it = L && L.items.find((x) => x.name === w.name);
      if (it && it.price) out.push({ w, L, it });
    });
    return out;
  }
  function addW(line, it, qty) {
    const k = line + ':' + it.name;
    const w = wcart.find((x) => x.k === k);
    if (w) w.qty = Math.min(999, w.qty + qty); else wcart.push({ k, line, name: it.name, qty: Math.min(999, qty) });
    saveW();
    toast('Added to cart 🤍', false, { label: 'View cart', fn: openCart });
  }
  function addToCart(id, qty) {
    const map = products();
    const info = map.get(id);
    if (!info) return false;
    const other = cart.find((i) => map.get(i.id) && map.get(i.id).b.id !== info.b.id);
    if (other && !confirm('Your cart has items from another batch. Start a new cart with this item instead?')) return false;
    if (other) cart = [];
    const line = cart.find((i) => i.id === id);
    if (line) line.qty = Math.min(50, line.qty + qty); else cart.push({ id, qty });
    saveCart();
    toast('Added to cart 🤍', false, { label: 'View cart', fn: openCart });
    return true;
  }
  function setQty(id, qty) {
    if (qty < 1) cart = cart.filter((i) => i.id !== id);
    else { const l = cart.find((i) => i.id === id); if (l) l.qty = Math.min(50, qty); }
    saveCart();
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
    if (hasHint()) { try { me = (await api('GET', '/api/account/me')).customer; } catch (e) { me = null; } }
    if (me) mergeServerCart();
    else { let owned = false; try { owned = !!localStorage.getItem('mb_cart_user'); } catch (e) { /* ignore */ } if (owned) clearCarts(); } // login expired
    return me;
  }
  function afterAuth(c, next) {
    me = c; meLoaded = true;
    closeAllModals();
    mergeServerCart().then(() => { paintHeader(); });
    const dest = c.mustChange ? '/account' : (next || '/');
    if (dest === location.pathname + location.search || dest === location.pathname) route(); else go(dest);
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
          me ? h('a', { href: '/account', 'data-link': '' }, me.name.split(' ')[0]) : h('a', { href: '/login', onclick: (e) => { e.preventDefault(); openAuth('login', location.pathname + location.search); } }, 'Log in'),
          h('a', { href: '/cart', class: 'cartbtn', onclick: (e) => { e.preventDefault(); openCart(); } }, 'Cart', h('b', { text: String(cartCount()), style: cartCount() ? '' : 'display:none' })))),
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
    return h('a', { class: 'pcard' + (p.soldOut ? ' soldout' : ''), href: '/p/' + p.slug,
      onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); openProduct(p); } },
      h('div', { class: 'ph' },
        p.images[0] ? h('img', { src: img(p.images[0].url, 500), alt: p.name, loading: 'lazy', width: 500, height: 625 }) : h('div', { class: 'noimg', text: '✦' }),
        p.soldOut ? h('span', { class: 'badge sold', text: 'Sold out' }) : null,
        p.kind === 'box' ? h('span', { class: 'badge box', text: 'Box' }) : null),
      h('div', { class: 'nm', text: p.name }),
      h('div', { class: 'pr' }, naira(p.price), p.compareAt ? h('s', { text: naira(p.compareAt) }) : null));
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

  function gallery(images, name) {
    let cur = 0;
    const main = h('div', { class: 'main' });
    const ths = h('div', { class: 'ths' });
    const draw = () => {
      main.replaceChildren(images[cur] ? h('img', { src: img(images[cur].url, 900), alt: name, width: 900, height: 1125 }) : h('div', { class: 'noimg', text: '✦' }));
      ths.replaceChildren(...(images.length > 1 ? images.map((im, i) => h('button', { type: 'button', class: i === cur ? 'on' : '', 'aria-label': 'Photo ' + (i + 1), onclick: () => { cur = i; draw(); } }, h('img', { src: img(im.url, 128), alt: '' }))) : []));
    };
    draw();
    return h('div', { class: 'gal' }, main, ths);
  }
  function boxList(p) {
    return p.kind === 'box' && p.items ? h('div', { class: 'boxlist' }, h('b', { text: 'Inside the box' }),
      p.items.map((it) => h('div', { class: 'it' }, it.thumb ? h('img', { src: img(it.thumb, 96), alt: '' }) : null, h('span', { style: 'flex:1', text: it.name }), h('span', { class: 'muted', text: '× ' + it.qty })))) : null;
  }
  // quantity box + add button (used in the popup and on the product page)
  function buyPanel(p, b) {
    if (p.soldOut) return h('div', { class: 'notice' }, 'This one is sold out. ', h('a', { href: wa('Hi MYLEBRAND! Please let me know if "' + p.name + '" comes back 🤍'), target: '_blank', rel: 'noopener' }, 'Ask us on WhatsApp'), ' if it returns.');
    if (!b.open) return h('div', { class: 'notice' }, 'Preorders for ' + b.name + ' are closed. ', h('a', { href: S.community || wa('Hi MYLEBRAND! 🤍'), target: '_blank', rel: 'noopener' }, 'Join the list'), ' for the next batch.');
    const btn = h('button', { class: 'btn grow', type: 'button' }, 'Add to cart · ' + naira(p.price));
    const q = numInput(1, { min: 1, max: 50, onChange: (n) => { btn.textContent = 'Add to cart · ' + naira(p.price * n); }, onEnter: () => btn.click() });
    btn.addEventListener('click', () => { if (addToCart(p.id, q.get())) { q.set(1); btn.textContent = 'Add to cart · ' + naira(p.price); } });
    return h('div', { class: 'buyrow' }, q.el, btn);
  }
  function deliveryNote(b) {
    return h('p', { class: 'small muted', style: 'margin-top:14px', text: 'Preorder item. Delivery ' + (b.deliveryFrom ? 'from ' + fmtDay(b.deliveryFrom) + (b.deliveryTo ? ' to ' + fmtDay(b.deliveryTo) : '') : 'dates are shared once the batch ships') + '.' });
  }
  function openProduct(p) {
    const info = products().get(p.id);
    if (!info) return go('/p/' + p.slug);
    const { b, e } = info;
    const m = openModal(h('div', { class: 'pmodal' },
      gallery(p.images, p.name),
      h('div', { class: 'pinfo' },
        h('div', { class: 'eyebrow', text: p.kind === 'box' ? 'A MYLEBRAND box' : (p.category || e.name) }),
        h('h2', { text: p.name }),
        h('div', { class: 'price' }, naira(p.price), p.compareAt ? [h('s', { text: naira(p.compareAt) }), ' ', h('em', { class: 'off', text: '-' + Math.round((1 - p.price / p.compareAt) * 100) + '%' })] : null),
        p.desc ? h('div', { class: 'desc', text: p.desc }) : h('p', { class: 'muted', text: 'Chosen with intention for this batch.' }),
        boxList(p), buyPanel(p, b), deliveryNote(b),
        h('a', { class: 'small', href: '/p/' + p.slug, 'data-link': '' }, 'See the full page'))), { label: p.name, focus: '.qin' });
    return m;
  }

  function pageProduct(slug) {
    const f = findProd(slug);
    if (!f) return pageNotFound();
    const { b, e, p } = f;
    document.title = p.name + ' | MYLEBRAND';
    const others = e.products.filter((x) => x.id !== p.id).slice(0, 4);
    shell(h('div', { class: 'wrap' },
      h('div', { class: 'crumbs' }, h('a', { href: '/', 'data-link': '' }, 'Shop'), ' / ', h('a', { href: '/e/' + e.slug, 'data-link': '' }, e.name), ' / ', p.name),
      h('div', { class: 'pdp' }, gallery(p.images, p.name),
        h('div', null, h('div', { class: 'eyebrow', text: p.kind === 'box' ? 'A MYLEBRAND box' : (p.category || e.name) }), h('h1', { style: 'font-size:clamp(2rem,5vw,2.8rem);margin:8px 0', text: p.name }),
          h('div', { class: 'price' }, naira(p.price), p.compareAt ? h('s', { text: naira(p.compareAt) }) : null),
          p.desc ? h('div', { class: 'desc', text: p.desc }) : null,
          boxList(p), buyPanel(p, b), deliveryNote(b))),
      others.length ? h('section', null, h('h2', { style: 'margin-bottom:18px', text: 'More from ' + e.name }), h('div', { class: 'grid four' }, others.map((x) => productCard(x, b)))) : null));
  }

  // ---------- cart (drawer + /cart page) ----------
  function cartLines() {
    const map = products();
    return cart.map((i) => ({ ...i, info: map.get(i.id) }));
  }
  function wMessage(items, contact) {
    const groups = {};
    items.forEach((x) => { (groups[x.w.line] = groups[x.w.line] || []).push(x); });
    const keys = Object.keys(groups);
    const lines = ['Hi MYLEBRAND! 🤍 I would like to order:'];
    if (contact && contact.name) lines.push('Name: ' + contact.name);
    if (contact && contact.phone) lines.push('Phone: ' + contact.phone);
    let total = 0;
    keys.forEach((k) => {
      const g = groups[k]; const sub = g.reduce((t, x) => t + x.it.price * x.w.qty, 0); total += sub;
      lines.push('', g[0].L.title + ':');
      g.forEach((x) => lines.push(x.w.qty + ' x ' + x.it.name + ' (' + naira(x.it.price) + ' each)'));
      if (keys.length > 1) lines.push('Subtotal: ' + naira(sub));
    });
    lines.push('', 'Total: ' + naira(total), keys.map((k) => (k === 'beauty' ? '[BW]' : '[IN]')).join(' '));
    return lines.join('\n');
  }
  function thumb(url, w) { return url ? h('img', { class: 'cthumb', src: img(url, w || 160), alt: '' }) : h('div', { class: 'cthumb noimg', text: '✦' }); }

  let wContact = { name: '', phone: '' };
  try { wContact = { name: '', phone: '', ...JSON.parse(localStorage.getItem('mb_wc') || '{}') }; } catch (e) { /* ignore */ }
  // keeps a copy of the order for the admin (the WhatsApp message itself is what the customer sends)
  function recordW(cur) {
    const lines = [...new Set(cur.map((x) => x.w.line))];
    lines.forEach((line) => {
      const its = cur.filter((x) => x.w.line === line).map((x) => ({ name: x.it.name, qty: x.w.qty }));
      api('POST', '/api/wholesale/orders', { line, items: its, name: wContact.name, phone: wContact.phone }).catch(() => {});
    });
  }
  function wSection(repaint) {
    const items = wItems();
    const sec = h('div', { class: 'csec' });
    const foot = h('div', { class: 'cfoot' });
    const drawFoot = () => {
      const cur = wItems();
      const total = cur.reduce((t, x) => t + x.it.price * x.w.qty, 0);
      const bw = cur.filter((x) => x.w.line === 'beauty');
      const profit = bw.length && bw.every((x) => x.it.resale) ? bw.reduce((t, x) => t + (x.it.resale - x.it.price) * x.w.qty, 0) : null;
      const short = cur.filter((x) => x.it.minQty && x.w.qty < x.it.minQty).map((x) => x.it.name + ' (minimum ' + x.it.minQty + ')');
      foot.replaceChildren(...[
        h('div', { class: 'totalrow', style: 'border-top:0' }, h('span', { text: 'Wholesale total' }), h('span', { text: naira(total) })),
        profit !== null ? h('div', { class: 'totalrow gain', style: 'border-top:0;font-size:1.05rem' }, h('span', { text: 'If you sell all your beauty items' }), h('span', { text: '+' + naira(profit) + ' profit' })) : null,
        short.length ? h('div', { class: 'notice', text: 'Minimum not reached: ' + short.join(', ') }) : null,
        h('a', { class: 'btn wa block' + (short.length ? ' disabled' : ''), 'aria-disabled': short.length ? 'true' : null, href: short.length ? null : wa(wMessage(cur, wContact)), target: short.length ? null : '_blank', rel: 'noopener', onclick: () => { if (!short.length) recordW(cur); } }, 'Send my order on WhatsApp'),
        h('p', { class: 'center', style: 'margin:8px 0 0' }, h('button', { class: 'linkbtn', type: 'button', onclick: () => { if (confirm('Remove all wholesale items from your cart?')) { wcart = []; saveW(); repaint(); } } }, 'Clear wholesale items'))].filter(Boolean));
    };
    const keep = () => { try { localStorage.setItem('mb_wc', JSON.stringify(wContact)); } catch (e) { /* ignore */ } drawFoot(); };
    const nameIn = h('input', { type: 'text', class: 'cin', placeholder: 'Your name (optional)', maxlength: 80, autocomplete: 'name', value: wContact.name, oninput: () => { wContact.name = nameIn.value; keep(); } });
    const phoneIn = h('input', { type: 'tel', class: 'cin', placeholder: 'WhatsApp number (optional)', maxlength: 20, autocomplete: 'tel', value: wContact.phone, oninput: () => { wContact.phone = phoneIn.value; keep(); } });
    sec.append(h('h3', { text: 'Wholesale order' }), h('p', { class: 'small muted', style: 'margin:0 0 6px', text: 'No account needed. Your order is written for you on WhatsApp.' }),
      h('div', { class: 'cinrow' }, nameIn, phoneIn));
    items.forEach(({ w, L, it }) => {
      const lt = h('div', { class: 'cright-t', text: naira(it.price * w.qty) });
      const q = numInput(w.qty, { min: 1, max: 999, onChange: (n) => { w.qty = n; saveW(); lt.textContent = naira(it.price * n); drawFoot(); } });
      sec.append(h('div', { class: 'cline' }, thumb((it.images || [])[0] && it.images[0].url),
        h('div', { class: 'grow' }, h('div', { class: 'nm', text: it.name }), h('div', { class: 'muted small', text: L.title + ' · ' + naira(it.price) + ' each' + (it.minQty ? ' · min ' + it.minQty : '') }),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => { wcart = wcart.filter((x) => x !== w); saveW(); repaint(); } }, 'Remove')),
        h('div', { class: 'cright' }, q.el, lt)));
    });
    sec.append(foot); drawFoot();
    return sec;
  }

  function cSection(repaint) {
    const lines = cartLines();
    const live = lines.filter((l) => l.info && !l.info.p.soldOut);
    const bad = lines.filter((l) => !l.info || l.info.p.soldOut);
    const b = live[0] && live[0].info.b;
    const thr = Number(S.gift_threshold), slots = Number(S.gift_slots);
    const sec = h('div', { class: 'csec' });
    const foot = h('div', { class: 'cfoot' });
    const drawFoot = () => {
      const total = live.reduce((t, l) => t + l.info.p.price * l.qty, 0);
      const blocked = !live.length || bad.length > 0 || (b && !b.open);
      foot.replaceChildren(...[
        bad.length ? h('div', { class: 'notice bad' }, 'Some items are sold out or no longer available. Remove them to continue.') : null,
        b && !b.open ? h('div', { class: 'notice bad' }, 'Preorders for ' + b.name + ' are closed.') : null,
        h('div', { class: 'totalrow', style: 'border-top:0' }, h('span', { text: 'Total' }), h('span', { text: naira(total) })),
        thr && slots && b && b.open ? h('div', { class: 'notice ok' }, total >= thr ? '🎁 Your order qualifies for the gift (limited spots, first come first served).' : 'Add ' + naira(thr - total) + ' more to qualify for ' + (S.gift_text || 'a gift') + '.') : null,
        h('button', { class: 'btn block', type: 'button', disabled: blocked, onclick: () => { if (me) go('/checkout'); else openAuth('signup', '/checkout'); } }, me ? 'Checkout' : 'Log in to checkout'),
        !me ? h('p', { class: 'small muted center', style: 'margin:10px 0 0', text: 'Your cart is saved. It takes a minute to make an account.' }) : null].filter(Boolean));
    };
    sec.append(h('h3', { text: 'Preorder items' }));
    lines.forEach((l) => {
      const p = l.info && l.info.p;
      const lt = h('div', { class: 'cright-t', text: p ? naira(p.price * l.qty) : '' });
      const q = p && !p.soldOut ? numInput(l.qty, { min: 1, max: 50, onChange: (n) => { setQty(l.id, n); l.qty = n; lt.textContent = naira(p.price * n); drawFoot(); } }) : null;
      sec.append(h('div', { class: 'cline' }, thumb(p && p.images[0] && p.images[0].url),
        h('div', { class: 'grow' }, h('div', { class: 'nm', text: p ? p.name : 'Item no longer available' }),
          p ? h('div', { class: 'muted small', text: p.soldOut ? 'Sold out' : naira(p.price) + ' each' }) : null,
          h('button', { class: 'linkbtn', type: 'button', onclick: () => { setQty(l.id, 0); repaint(); } }, 'Remove')),
        q ? h('div', { class: 'cright' }, q.el, lt) : null));
    });
    sec.append(foot); drawFoot();
    return sec;
  }

  function cartView(onClose, asPage) {
    const root = h('div', { class: 'cartview' });
    const paint = () => {
      const wi = wItems();
      wcart = wcart.filter((w) => wi.some((x) => x.w === w)); // drop wholesale items that no longer exist
      const empty = !cart.length && !wcart.length;
      root.replaceChildren(...[
        h(asPage ? 'h1' : 'h2', { text: 'Your cart' }),
        empty ? h('div', { class: 'empty' }, h('div', { class: 'big', text: '🛍' }), h('p', { class: 'muted', text: 'Your cart is empty. Find something you love.' }),
          h('a', { class: 'btn', href: '/', 'data-link': '' }, 'Browse the shop')) : null,
        wcart.length ? wSection(paint) : null,
        cart.length ? cSection(paint) : null,
      ].filter(Boolean));
      paintCartCount();
    };
    paint();
    return root;
  }
  let cartModal = null;
  function openCart() {
    if (location.pathname === '/cart') return;
    if (cartModal && modals.includes(cartModal)) return;
    closeAllModals();
    cartModal = openModal(cartView(), { drawer: true, label: 'Your cart' });
  }
  function pageCart() {
    document.title = 'Your cart | MYLEBRAND';
    shell(h('div', { class: 'narrow page' }, cartView(null, true)));
  }

  // ---------- login / sign up (page and popup share this form) ----------
  function authForm(signup, safeNext) {
    const f = {};
    const inp = (id, type, label, extra) => { f[id] = h('input', { id: 'au_' + id, type, required: '', ...extra }); return h('div', { class: 'field' }, h('label', { for: 'au_' + id, text: label }), f[id]); };
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
    return { form, first: f.name || f.email };
  }
  const forgotNote = () => h('p', { class: 'center small muted' }, 'Forgot your password? ', h('a', { href: wa('Hi MYLEBRAND! I forgot my password. Please reset it for me 🤍'), target: '_blank', rel: 'noopener' }, 'Message us on WhatsApp'), ' and we will send you a temporary one.');
  function openAuth(mode, next) {
    const safeNext = next && /^\/[a-z]/i.test(next) && !next.startsWith('//') ? next : '/';
    const box = h('div', { class: 'authbox' });
    const draw = (m) => {
      const signup = m === 'signup';
      const { form, first } = authForm(signup, safeNext);
      box.replaceChildren(h('h2', { text: signup ? 'Create your account' : 'Welcome back' }),
        h('p', { class: 'muted', style: 'margin-top:0', text: signup ? 'One account to place orders and follow them from China to your door.' : 'Log in to place orders and track them.' }),
        form,
        h('p', { class: 'center small' }, signup ? 'Already have an account? ' : 'New to MYLEBRAND? ', h('button', { class: 'linkbtn', type: 'button', onclick: () => { draw(signup ? 'login' : 'signup'); } }, signup ? 'Log in' : 'Create an account')),
        signup ? null : forgotNote());
      first.focus();
    };
    closeAllModals();
    openModal(box, { label: 'Account' });
    draw(mode);
  }
  function authPage(mode) {
    const signup = mode === 'signup';
    document.title = (signup ? 'Create account' : 'Log in') + ' | MYLEBRAND';
    const next = new URLSearchParams(location.search).get('next');
    const safeNext = next && /^\/[a-z]/i.test(next) && !next.startsWith('//') ? next : '/';
    const { form, first } = authForm(signup, safeNext);
    shell(h('div', { class: 'narrow page' }, h('h1', { text: signup ? 'Create your account' : 'Welcome back' }),
      h('p', { class: 'muted', text: signup ? 'One account to place orders and follow them from China to your door.' : 'Log in to place orders and track them.' }),
      h('div', { class: 'card' }, form),
      h('p', { class: 'center small' }, signup ? ['Already have an account? ', h('a', { href: '/login' + (next ? '?next=' + encodeURIComponent(safeNext) : ''), 'data-link': '' }, 'Log in')]
        : ['New to MYLEBRAND? ', h('a', { href: '/signup' + (next ? '?next=' + encodeURIComponent(safeNext) : ''), 'data-link': '' }, 'Create an account')]),
      signup ? null : forgotNote()));
    first.focus();
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
    if (d.stages) {
      const dv = d.stages.find((x) => x.key === 'delivered'), rc = d.stages.find((x) => x.key === 'received');
      if (dv && dv.at && rc && !rc.at) {
        parts.push(h('div', { class: 'card center' }, h('h3', { style: 'margin-bottom:6px', text: 'Has your order arrived?' }),
          h('p', { class: 'muted small', style: 'margin-top:0', text: 'Tap the button once you have it in your hands. It completes your tracker.' }),
          h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await api('POST', '/api/account/orders/' + encodeURIComponent(o.orderId) + '/received', {}); toast('Thank you! 🤍'); route(); } catch (x) { toast(x.message, true); e.target.disabled = false; } } }, 'I have received my order')));
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
        h('button', { class: 'btn ghost', onclick: async () => { try { await api('POST', '/api/account/logout', {}); } catch (e) { /* ignore */ } me = null; clearCarts(); closeAllModals(); paintHeader(); go('/'); } }, 'Log out'))));
  }


  // ---------- wholesale landing pages (QR codes open these) ----------
  function wFacts(it, beauty) {
    const facts = [];
    if (it.price) {
      const pct = it.oldPrice && it.oldPrice > it.price ? Math.round((1 - it.price / it.oldPrice) * 100) : 0;
      facts.push(h('span', null, h('i', { text: beauty ? 'You pay' : 'Price' }), ' ', h('b', { text: naira(it.price) }), pct ? [' ', h('s', { class: 'muted', text: naira(it.oldPrice) }), ' ', h('em', { class: 'off', text: '-' + pct + '%' })] : null));
    }
    if (it.resale) facts.push(h('span', null, h('i', { text: 'You sell at' }), ' ', naira(it.resale)));
    if (it.price && it.resale) facts.push(h('span', { class: 'gain' }, h('i', { text: 'Profit each' }), ' +' + naira(it.resale - it.price)));
    if (it.minQty) facts.push(h('span', null, h('i', { text: 'Minimum' }), ' ' + it.minQty + ' pcs'));
    return facts;
  }
  // typed quantity + Add to cart for one wholesale item
  function wBuy(line, it) {
    if (!it.price) return h('div', { class: 'notice' }, 'Price on request. ', h('a', { href: wa('Hi MYLEBRAND! 🤍 What is the price of ' + it.name + '? [' + (line === 'beauty' ? 'BW' : 'IN') + ']'), target: '_blank', rel: 'noopener' }, 'Ask us on WhatsApp'));
    const start = it.minQty || 1;
    const btn = h('button', { class: 'btn grow', type: 'button' }, 'Add to cart · ' + naira(it.price * start));
    const q = numInput(start, { min: 1, max: 999, onChange: (n) => { btn.textContent = 'Add to cart · ' + naira(it.price * n); }, onEnter: () => btn.click() });
    btn.addEventListener('click', () => { addW(line, it, q.get()); });
    return h('div', { class: 'buyrow' }, q.el, btn);
  }
  function openWItem(line, it) {
    const L = cat.lines[line]; const beauty = line === 'beauty';
    openModal(h('div', { class: 'pmodal' },
      gallery(it.images || [], it.name),
      h('div', { class: 'pinfo' },
        h('div', { class: 'eyebrow', text: L.title }),
        h('h2', { text: it.name }),
        it.note ? h('p', { class: 'muted', style: 'margin:0 0 8px', text: it.note }) : null,
        it.desc ? h('div', { class: 'desc', text: it.desc }) : null,
        h('div', { class: 'wfacts', style: 'margin:10px 0 14px' }, wFacts(it, beauty)),
        wBuy(line, it))), { label: it.name, focus: '.qin' });
  }
  function pageLine(line) {
    const L = (cat.lines || {})[line];
    if (!L) return pageNotFound();
    document.title = L.title + ' | MYLEBRAND';
    const beauty = line === 'beauty';
    const tag = beauty ? 'BW' : 'IN';
    const group = L.groupLink || S.community;
    const hello = 'Hi MYLEBRAND! 🤍 I am interested in ' + L.title.toLowerCase() + '. Please send me the ' + (beauty ? 'price list' : 'details') + '. [' + tag + ']';
    const live = L.deadline && Date.parse(L.deadline + 'T23:59:59+01:00') > Date.now();
    const sum = h('div');
    const paintSum = () => {
      const mine = wItems().filter((x) => x.w.line === line);
      const total = mine.reduce((t, x) => t + x.it.price * x.w.qty, 0);
      sum.replaceChildren(h('div', { class: 'card calc' }, h('h3', { text: 'Your order' }),
        mine.length ? [h('div', { class: 'totalrow', style: 'border-top:0' }, h('span', { text: mine.length + ' item' + (mine.length === 1 ? '' : 's') + ' in your cart' }), h('span', { text: naira(total) })),
          h('button', { class: 'btn block', type: 'button', onclick: openCart }, 'Open cart and send order')]
          : h('p', { class: 'muted', style: 'margin:0', text: 'Set a quantity, tap Add to cart, then send your whole order on WhatsApp in one go.' })));
    };
    wListeners = [paintSum];
    paintSum();
    const rows = L.items.map((it) => {
      const facts = wFacts(it, beauty);
      const im = (it.images || [])[0];
      const open = () => openWItem(line, it);
      return h('div', { class: 'wrow' },
        h('button', { class: 'wimgbtn', type: 'button', 'aria-label': 'View ' + it.name, onclick: open }, im ? h('img', { class: 'wimg', src: img(im.url, 200), alt: it.name, loading: 'lazy' }) : h('div', { class: 'wimg noimg', text: '✦' })),
        h('div', { class: 'wmain' }, h('button', { class: 'wname', type: 'button', onclick: open, text: it.name }), it.note ? h('span', { class: 'small muted', text: ' · ' + it.note }) : null,
          it.desc ? h('div', { class: 'small muted wdesc', text: it.desc }) : null,
          facts.length ? h('div', { class: 'wfacts' }, facts) : h('div', { class: 'small muted', text: 'Price on request. Ask us on WhatsApp.' })),
        h('div', { class: 'wact' }, wBuy(line, it)));
    });
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
          rows.length ? h('div', { class: 'wlist' }, rows) : h('p', { class: 'muted', text: 'New stock is being added. Join the group to see it first.' }),
          L.minNote ? h('p', { class: 'small muted', text: L.minNote }) : null,
          sum),
        h('section', { style: 'padding-top:10px' },
          h('div', { class: 'steps three' }, [['Choose', beauty ? 'Tap a product for details. Set how many you want.' : 'Tap a piece for details. Set how many you want.'], ['Order on WhatsApp', 'Open your cart. Your order is written for you.'], ['We confirm', 'We confirm your order and tell you how you will get it.']]
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
    closeAllModals(); wListeners = [];
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
