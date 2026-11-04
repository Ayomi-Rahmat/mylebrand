// The SHOP side of the admin page: batches' shop settings, edits, products and boxes, orders,
// customers, saved carts, the ledger and site settings. Loaded before admin.js, which calls ShopAdmin.mount().
(function () {
  'use strict';
  const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
  const cdn = (u, w) => (/^https:\/\/res\.cloudinary\.com\/.+\/upload\//.test(u) ? u.replace('/upload/', '/upload/f_auto,q_auto,w_' + w + ',c_fill,h_' + w + '/') : u);
  const TABS = [['products', 'Products'], ['orders', 'Orders'], ['ledger', 'Ledger'], ['customers', 'Customers'], ['carts', 'Carts'], ['wholesale', 'Wholesale'], ['settings', 'Settings']];

  const S = {
    tab: 'products', batches: [], batchId: null, edits: [], products: [], form: null, editForm: null, showBatch: false, newBatch: false, whItem: null,
    wh: null, whLine: 'beauty', orders: null, orderFilter: 'pending', openOrder: null, customers: null, carts: null, ledger: null, settings: null, tempPw: null,
  };
  let H = null; // helpers from admin.js: h, api, toast, run, copy, fmt, rerender

  // ---------- photos ----------
  async function shrink(file, max) {
    try {
      const bmp = await createImageBitmap(file);
      const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.86));
    } catch (e) { return file; }
  }
  async function uploadPhoto(file) {
    const sig = await H.api('POST', '/api/admin/image-sign', {});
    if (!sig.configured) throw new Error('Photo upload is not switched on yet. Paste a photo link below instead, or add your Cloudinary keys (see the README).');
    const blob = await shrink(file, 1600);
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    ['apiKey:api_key', 'timestamp:timestamp', 'signature:signature', 'folder:folder', 'allowed_formats:allowed_formats'].forEach((p) => {
      const [from, to] = p.split(':'); fd.append(to, sig[from]);
    });
    const r = await fetch('https://api.cloudinary.com/v1_1/' + sig.cloudName + '/image/upload', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.secure_url) throw new Error((j.error && j.error.message) || 'The photo could not be uploaded.');
    return j.secure_url;
  }
  // list is an array of {url}; onChange gets the new array
  function photoPicker(list, max, onChange) {
    const { h } = H;
    const box = h('div', { class: 'photos' });
    const draw = () => {
      box.replaceChildren();
      const grid = h('div', { class: 'thumbs' });
      list.forEach((im, i) => grid.append(h('div', { class: 'thumb' },
        h('img', { src: cdn(im.url, 160), alt: '' }),
        i === 0 ? h('span', { class: 'cover-tag', text: 'Main' }) : null,
        h('div', { class: 'tact' },
          i > 0 ? h('button', { type: 'button', title: 'Make main photo', onclick: () => { list.unshift(list.splice(i, 1)[0]); onChange(list); draw(); } }, '★') : null,
          h('button', { type: 'button', title: 'Remove', onclick: () => { list.splice(i, 1); onChange(list); draw(); } }, '✕')))));
      box.append(grid);
      if (list.length < max) {
        const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', multiple: 'multiple', style: 'display:none' });
        const status = h('span', { class: 'muted small' });
        file.addEventListener('change', async () => {
          const files = [...file.files].slice(0, max - list.length);
          for (let i = 0; i < files.length; i++) {
            status.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
            try { list.push({ url: await uploadPhoto(files[i]) }); onChange(list); draw(); }
            catch (e) { status.textContent = ''; H.toast(e.message, true); break; }
          }
          draw();
        });
        const link = h('input', { type: 'text', placeholder: 'or paste a photo link (https://…)' });
        box.append(h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => file.click() }, '+ Add photos'), file, status),
        h('div', { class: 'row' }, link, h('button', { type: 'button', class: 'btn ghost small', onclick: () => {
          const v = link.value.trim();
          if (!/^https:\/\//.test(v)) return H.toast('The link must start with https://', true);
          list.push({ url: v }); onChange(list); draw();
        } }, 'Add link')));
      }
    };
    draw();
    return box;
  }

  // ---------- loading ----------
  async function loadBatches() {
    S.batches = (await H.api('GET', '/api/admin/batches')).batches;
    if (!S.batches.find((b) => b.id === S.batchId)) S.batchId = S.batches[0] ? S.batches[0].id : null;
  }
  async function loadCatalog() {
    if (!S.batchId) { S.edits = []; S.products = []; return; }
    const [e, p] = await Promise.all([H.api('GET', '/api/admin/edits?batchId=' + S.batchId), H.api('GET', '/api/admin/products?batchId=' + S.batchId)]);
    S.edits = e.edits; S.products = p.products;
  }
  async function loadTab() {
    const t = S.tab;
    await loadBatches();
    if (t === 'products') await loadCatalog();
    if (t === 'orders') S.orders = await H.api('GET', '/api/admin/shop-orders' + (S.orderFilter !== 'all' ? '?status=' + S.orderFilter : ''));
    if (t === 'customers') S.customers = (await H.api('GET', '/api/admin/customers')).customers;
    if (t === 'carts') S.carts = (await H.api('GET', '/api/admin/carts')).carts;
    if (t === 'ledger') S.ledger = S.batchId ? await H.api('GET', '/api/admin/ledger?batchId=' + S.batchId) : null;
    if (t === 'wholesale') S.wh = (await H.api('GET', '/api/admin/wholesale/' + S.whLine)).line;
    if (t === 'settings') S.settings = (await H.api('GET', '/api/admin/settings')).settings;
  }
  const go = (fn) => H.run(async () => { if (fn) await fn(); await loadTab(); H.rerender(); });

  // ---------- small UI bits ----------
  function field(label, input, hint) {
    const { h } = H;
    return h('div', { class: 'field' }, h('label', { text: label }), input, hint ? h('div', { class: 'hint', style: 'text-align:left', text: hint }) : null);
  }
  // A pop-up window over the page. Closing it (X, Cancel or Esc) throws away anything not saved.
  function overlay(card, onClose) {
    const { h } = H;
    const box = h('div', { class: 'amdl-box', role: 'dialog', 'aria-modal': 'true' },
      h('button', { class: 'amdl-x', type: 'button', 'aria-label': 'Close', onclick: onClose }, '×'), card);
    S.closeTop = onClose;
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body) { const i = box.querySelector('input[type=text],textarea'); if (i) i.focus(); }
    }, 30);
    return h('div', { class: 'amdl' }, box);
  }
  const hasOverlay = () => !!(S.form || S.editForm || S.newBatch || S.whItem);
  const closeAll = () => { S.form = null; S.editForm = null; S.newBatch = false; S.whItem = null; };
  let escBound = false;

  function batchPicker() {
    const { h } = H;
    const sel = h('select', { onchange: () => { S.batchId = Number(sel.value); closeAll(); go(); } },
      S.batches.map((b) => h('option', { value: b.id, selected: b.id === S.batchId ? 'selected' : null }, b.name + ' (' + b.status + ')')));
    return h('div', { class: 'field' }, h('label', { text: 'BATCH' }), sel);
  }

  // ---------- products tab ----------
  function batchShopCard() {
    const { h, api, toast } = H;
    const b = S.batches.find((x) => x.id === S.batchId);
    if (!b) return h('p', { class: 'muted', text: 'Create a batch in the Tracker tab first, then come back here to fill it with products.' });
    const status = h('select', null, ['draft', 'open', 'closed'].map((s) => h('option', { value: s, selected: b.status === s ? 'selected' : null }, { draft: 'Draft (hidden from the shop)', open: 'Open (customers can order)', closed: 'Closed (visible, no orders)' }[s])));
    const tagline = h('input', { type: 'text', value: b.tagline || '', maxlength: 140, placeholder: 'One line about this batch' });
    const closes = h('input', { type: 'date', value: b.closesOn || '' });
    return h('details', { class: 'card', open: S.showBatch ? 'open' : null, ontoggle: (e) => { S.showBatch = e.target.open; } },
      h('summary', { text: 'Shop settings for this batch · ' + b.status }),
      field('STATUS', status), field('TAGLINE', tagline), field('PREORDERS CLOSE ON (optional)', closes, 'The shop closes itself at the end of this day (Lagos time).'),
      h('button', { class: 'btn small', onclick: () => go(async () => {
        await api('PATCH', '/api/admin/batches/' + b.id, { status: status.value, tagline: tagline.value, closesOn: closes.value || null }); toast('Saved');
      }) }, 'Save'));
  }

  function newBatchButton() {
    const { h } = H;
    return h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => { S.newBatch = true; H.rerender(); } }, S.batches.length ? '+ New batch' : '+ Create your first batch'));
  }
  function newBatchForm() {
    const { h, api, toast } = H;
    const name = h('input', { type: 'text', placeholder: 'Batch 03', maxlength: 80 });
    const create = () => go(async () => {
      const r = await api('POST', '/api/admin/batches', { name: name.value, status: 'open' }); S.batchId = r.id; S.newBatch = false; toast('Batch created and open');
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    return h('div', null, h('h3', { text: 'New batch' }),
      field('BATCH NAME', name),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: create }, 'Create batch'),
        h('button', { class: 'btn ghost small', onclick: () => { S.newBatch = false; H.rerender(); } }, 'Cancel')));
  }
  function batchStatusNote() {
    const { h, api, toast } = H;
    const b = S.batches.find((x) => x.id === S.batchId);
    if (!b) return h('div');
    if (b.status === 'draft') return h('div', { class: 'notice warn' },
      h('b', { text: 'This batch is hidden (Draft). ' }), 'Customers cannot see anything you add here until you publish it.',
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn small', onclick: () => go(async () => { await api('PATCH', '/api/admin/batches/' + b.id, { status: 'open' }); toast('Published. Customers can see it and order now.'); }) }, 'Publish now (open for orders)')));
    if (b.status === 'closed') return h('div', { class: 'notice', text: 'This batch is Closed: customers can look but cannot order. Change it to Open below to take orders.' });
    return h('div');
  }

  function editForm() {
    const { h, api, toast } = H;
    const f = S.editForm;
    const name = h('input', { type: 'text', value: f.name || '', maxlength: 80, placeholder: 'The Becoming Edit' });
    const tag = h('input', { type: 'text', value: f.tagline || '', maxlength: 140 });
    const desc = h('textarea', { rows: 3, maxlength: 1000 }, f.description || '');
    const sort = h('input', { type: 'text', inputmode: 'numeric', value: f.sort || 0 });
    const cover = f.cover ? [{ url: f.cover.url }] : [];
    return h('div', { class: 'card' },
      h('h3', { text: f.id ? 'Edit this collection' : 'New edit (collection)' }),
      field('NAME', name), field('ONE-LINE TAGLINE', tag), field('DESCRIPTION', desc),
      field('COVER PHOTO', photoPicker(cover, 1, (l) => { f.cover = l[0] || null; })),
      field('ORDER ON THE PAGE (smaller shows first)', sort),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => go(async () => {
          const body = { name: name.value, tagline: tag.value, description: desc.value, sort: sort.value, cover: f.cover };
          if (f.id) await api('PATCH', '/api/admin/edits/' + f.id, body); else await api('POST', '/api/admin/edits', { ...body, batchId: S.batchId });
          S.editForm = null; toast('Saved');
        }) }, 'Save edit'),
        h('button', { class: 'btn ghost small', onclick: () => { S.editForm = null; H.rerender(); } }, 'Cancel')));
  }

  function productForm() {
    const { h, api, toast } = H;
    const f = S.form;
    const isBox = f.kind === 'box';
    const el = {
      name: h('input', { type: 'text', value: f.name || '', maxlength: 120 }),
      edit: h('select', null, S.edits.map((e) => h('option', { value: e.id, selected: Number(f.editId) === e.id ? 'selected' : null }, e.name))),
      price: h('input', { type: 'text', inputmode: 'numeric', value: f.price || '', placeholder: '12000' }),
      compare: h('input', { type: 'text', inputmode: 'numeric', value: f.compareAt || '', placeholder: 'optional' }),
      cost: h('input', { type: 'text', inputmode: 'numeric', value: f.costPrice == null ? '' : f.costPrice, placeholder: isBox ? 'leave empty to add up what is inside' : 'what it costs you per piece' }),
      bought: h('input', { type: 'text', inputmode: 'numeric', value: f.qtyBought == null ? '' : f.qtyBought, placeholder: 'how many you bought' }),
      cat: h('input', { type: 'text', value: f.category || '', maxlength: 40, placeholder: 'Fashion, Home, Beauty…' }),
      desc: h('textarea', { rows: 5, maxlength: 3000 }, f.description || ''),
      sort: h('input', { type: 'text', inputmode: 'numeric', value: f.sort || 0 }),
      status: h('select', null, [['active', 'Shown in the shop'], ['hidden', 'Hidden']].map(([v, t]) => h('option', { value: v, selected: f.status === v ? 'selected' : null }, t))),
      sold: h('input', { type: 'checkbox', checked: !!f.soldOut }),
    };
    const items = f.boxItems || (f.boxItems = []);
    const boxUI = h('div');
    const drawBox = () => {
      boxUI.replaceChildren();
      const singles = S.products.filter((p) => p.kind === 'product' && p.id !== f.id);
      items.forEach((it, i) => {
        const p = S.products.find((x) => x.id === it.productId);
        const q = h('input', { type: 'text', inputmode: 'numeric', value: it.qty, style: 'width:64px', onchange: () => { it.qty = Number(q.value) || 1; } });
        boxUI.append(h('div', { class: 'row' }, h('span', { style: 'flex:1', text: p ? p.name : '(removed product)' }), 'x', q,
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => { items.splice(i, 1); drawBox(); } }, 'Remove')));
      });
      const add = h('select', null, h('option', { value: '' }, '+ Add a product to this box…'),
        singles.filter((p) => !items.some((i) => i.productId === p.id)).map((p) => h('option', { value: p.id }, p.name)));
      add.addEventListener('change', () => { if (add.value) { items.push({ productId: Number(add.value), qty: 1 }); drawBox(); } });
      boxUI.append(add);
      if (!singles.length) boxUI.append(h('p', { class: 'muted small', text: 'Add the single products first, then build the box from them.' }));
    };
    drawBox();
    return h('div', { class: 'card' },
      h('h3', { text: (f.id ? 'Edit ' : 'New ') + (isBox ? 'box' : 'product') }),
      field('NAME', el.name), field('WHICH EDIT IS IT IN?', el.edit),
      field('PRICE (₦)', el.price), field('OLD PRICE (₦, to show a discount)', el.compare),
      field('YOUR COST PER PIECE (₦, private)', el.cost), isBox ? null : field('QUANTITY YOU BOUGHT (private, for the ledger)', el.bought),
      isBox ? field('WHAT IS INSIDE THE BOX', boxUI) : null,
      field('CATEGORY', el.cat), field('DESCRIPTION', el.desc),
      field('PHOTOS (the first is the main one)', photoPicker(f.images || (f.images = []), 8, (l) => { f.images = l; })),
      field('ORDER ON THE PAGE (smaller shows first)', el.sort), field('VISIBILITY', el.status),
      h('label', { class: 'check' }, el.sold, ' Mark as SOLD OUT'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => go(async () => {
          const body = {
            kind: f.kind, editId: Number(el.edit.value), name: el.name.value, price: el.price.value, compareAt: el.compare.value,
            costPrice: el.cost.value, qtyBought: isBox ? null : el.bought.value, category: el.cat.value, description: el.desc.value,
            images: f.images, sort: el.sort.value || 0, status: el.status.value, soldOut: el.sold.checked, boxItems: isBox ? items : undefined,
          };
          if (f.id) await api('PATCH', '/api/admin/products/' + f.id, body); else await api('POST', '/api/admin/products', body);
          S.form = null; toast('Saved');
        }) }, 'Save'),
        h('button', { class: 'btn ghost small', onclick: () => { S.form = null; H.rerender(); } }, 'Cancel')));
  }

  function productsTab() {
    const { h, api, toast } = H;
    const wrap = h('div', null, batchPicker(), newBatchButton(), batchStatusNote(), batchShopCard());
    if (S.newBatch) wrap.append(overlay(newBatchForm(), () => { S.newBatch = false; H.rerender(); }));
    if (!S.batchId) return wrap;
    if (S.editForm) wrap.append(overlay(editForm(), () => { S.editForm = null; H.rerender(); }));
    if (S.form) wrap.append(overlay(productForm(), () => { S.form = null; H.rerender(); }));
    wrap.append(h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { S.editForm = {}; H.rerender(); } }, '+ New edit')));
    if (!S.edits.length) wrap.append(h('p', { class: 'muted', text: 'No edits yet. An edit is a collection, like “The Becoming Edit”. Create one, then add products to it.' }));
    S.edits.forEach((e) => {
      const ps = S.products.filter((p) => p.editId === e.id);
      wrap.append(h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('h3', { text: e.name }),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', onclick: () => { S.editForm = { ...e }; H.rerender(); } }, 'Edit'),
            h('button', { class: 'btn danger small', onclick: () => { if (confirm('Delete the edit “' + e.name + '”?')) go(() => api('DELETE', '/api/admin/edits/' + e.id)); } }, 'Delete'))),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => { S.form = { kind: 'product', editId: e.id, status: 'active', images: [] }; H.rerender(); } }, '+ Product'),
          h('button', { class: 'btn ghost small', onclick: () => { S.form = { kind: 'box', editId: e.id, status: 'active', images: [], boxItems: [] }; H.rerender(); } }, '+ Box')),
        ps.length ? null : h('p', { class: 'muted small', text: 'Nothing here yet.' }),
        ps.map((p) => h('div', { class: 'prow' + (p.status === 'hidden' ? ' dim' : '') },
          p.images && p.images[0] ? h('img', { src: cdn(p.images[0].url, 96), alt: '' }) : h('div', { class: 'noimg', text: '—' }),
          h('div', { class: 'pinfo' },
            h('div', { class: 'pname', text: p.name + (p.kind === 'box' ? '  (box)' : '') }),
            h('div', { class: 'muted small', text: naira(p.price) + ' · sold ' + p.sold + (p.status === 'hidden' ? ' · hidden' : '') })),
          h('div', { class: 'row' },
            h('button', { class: 'btn small ' + (p.soldOut ? '' : 'ghost'), onclick: () => go(async () => { await api('PATCH', '/api/admin/products/' + p.id, { soldOut: !p.soldOut }); toast(p.soldOut ? 'Back on sale' : 'Marked sold out'); }) }, p.soldOut ? 'Sold out ✓' : 'Sold out?'),
            h('button', { class: 'btn ghost small', onclick: () => { S.form = JSON.parse(JSON.stringify(p)); H.rerender(); } }, 'Edit'),
            h('button', { class: 'btn danger small', onclick: () => { if (confirm('Delete “' + p.name + '”?')) go(() => api('DELETE', '/api/admin/products/' + p.id)); } }, '✕'))))));
    });
    return wrap;
  }

  // ---------- orders tab ----------
  function ordersTab() {
    const { h, api, toast, fmt } = H;
    const wrap = h('div');
    const c = S.orders ? S.orders.counts : { pending: 0, paid: 0, cancelled: 0 };
    wrap.append(h('div', { class: 'row chips' }, [['pending', 'Waiting for payment'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, t]) =>
      h('button', { class: 'chip' + (S.orderFilter === k ? ' on' : ''), onclick: () => { S.orderFilter = k; S.openOrder = null; go(); } }, t + (k !== 'all' ? ' (' + c[k] + ')' : '')))));
    if (!S.orders) return wrap;
    if (!S.orders.orders.length) wrap.append(h('p', { class: 'muted', text: 'No orders here.' }));
    S.orders.orders.forEach((o) => {
      const open = S.openOrder && S.openOrder.order.id === o.id;
      const card = h('div', { class: 'card' },
        h('div', { class: 'row between', style: 'cursor:pointer', onclick: () => H.run(async () => {
          S.openOrder = open ? null : await api('GET', '/api/admin/shop-orders/' + o.id); H.rerender(); }) },
          h('div', null, h('b', { text: o.publicId + ' · ' + o.name }), h('div', { class: 'muted small', text: o.batchName + ' · ' + fmt(o.createdAt) + (o.gift ? ' · 🎁 gift spot' : '') })),
          h('div', { style: 'text-align:right' }, h('b', { text: naira(o.total) }), h('div', { class: 'tag ' + o.status, text: o.status }))));
      if (open) {
        const d = S.openOrder;
        const wa = 'https://wa.me/' + d.order.phone + '?text=' + encodeURIComponent('Hi ' + d.order.name.split(' ')[0] + '! This is MYLEBRAND. We have received your payment for order ' + d.order.publicId + '. Thank you! 🤍');
        card.append(
          h('p', { class: 'small', text: d.order.address + (d.order.notes ? '  ·  Note: ' + d.order.notes : '') }),
          h('p', { class: 'small' }, 'Phone: ', h('a', { href: wa, target: '_blank', rel: 'noopener' }, '+' + d.order.phone + ' (message on WhatsApp)')),
          h('ul', { class: 'small' }, d.items.map((i) => h('li', { text: i.qty + ' × ' + i.name + ' — ' + naira(i.line) }))),
          d.order.stage ? h('p', { class: 'muted small', text: 'Tracker stage: ' + d.order.stage }) : null,
          h('ul', { class: 'small muted' }, d.log.map((l) => h('li', { text: fmt(l.at) + ' — ' + l.what + (l.note ? ' (' + l.note + ')' : '') }))),
          h('div', { class: 'row' },
            d.order.status === 'pending' ? h('button', { class: 'btn small', onclick: () => go(async () => { await api('POST', '/api/admin/shop-orders/' + o.id + '/status', { status: 'paid' }); S.openOrder = null; toast('Marked as paid'); }) }, 'Mark as paid') : null,
            d.order.status === 'paid' ? h('button', { class: 'btn ghost small', onclick: () => go(async () => { await api('POST', '/api/admin/shop-orders/' + o.id + '/status', { status: 'pending' }); S.openOrder = null; }) }, 'Undo paid') : null,
            d.order.status !== 'cancelled' ? h('button', { class: 'btn danger small', onclick: () => { if (confirm('Cancel this order? This cannot be undone.')) go(async () => { await api('POST', '/api/admin/shop-orders/' + o.id + '/status', { status: 'cancelled' }); S.openOrder = null; }); } }, 'Cancel order') : null));
      }
      wrap.append(card);
    });
    return wrap;
  }

  // ---------- customers / carts ----------
  function customersTab() {
    const { h, api, copy, fmt } = H;
    const wrap = h('div');
    if (S.tempPw) {
      const t = S.tempPw;
      const msg = 'Hi ' + t.name.split(' ')[0] + '! Your temporary MYLEBRAND password is: ' + t.pw + '\nLog in at ' + location.origin + '/login and you will be asked to choose a new one. Please do not share it. 🤍';
      wrap.append(h('div', { class: 'card fresh' },
        h('b', { text: 'Temporary password for ' + t.name }), h('div', { class: 'big', text: t.pw }),
        h('p', { class: 'muted small', text: 'This is shown only once. Send it to the customer privately.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => copy(msg, 'Message copied') }, 'Copy message'),
          h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + t.phone + '?text=' + encodeURIComponent(msg) }, 'Open WhatsApp'),
          h('button', { class: 'btn ghost small', onclick: () => { S.tempPw = null; H.rerender(); } }, 'Done'))));
    }
    if (!S.customers) return wrap;
    wrap.append(h('p', { class: 'muted small', text: S.customers.length + ' account' + (S.customers.length === 1 ? '' : 's') }));
    S.customers.forEach((c) => wrap.append(h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('div', null, h('b', { text: c.name }), h('div', { class: 'muted small', text: c.email + ' · +' + c.phone })),
        h('div', { style: 'text-align:right' }, h('div', { text: c.orders + ' order' + (c.orders === 1 ? '' : 's') }), h('div', { class: 'muted small', text: naira(c.spent) + ' paid' }))),
      h('div', { class: 'muted small', text: 'Joined ' + fmt(new Date(c.createdAt).toISOString()) + (c.locked ? ' · locked after wrong passwords' : '') + (c.mustChange ? ' · must change password' : '') }),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: () => { if (confirm('Make a new temporary password for ' + c.name + '? Their old password and sessions stop working.')) H.run(async () => {
          const r = await api('POST', '/api/admin/customers/' + c.id + '/reset-password', {});
          S.tempPw = { name: c.name, phone: c.phone, pw: r.temporaryPassword }; H.rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); } }, 'Reset password'),
        h('button', { class: 'btn danger small', onclick: () => { if (confirm('Delete the account of ' + c.name + '? Their past orders stay in your records.')) go(() => api('DELETE', '/api/admin/customers/' + c.id)); } }, 'Delete')))));
    return wrap;
  }
  function cartsTab() {
    const { h, fmt } = H;
    const wrap = h('div', null, h('p', { class: 'muted small', text: 'What logged-in customers have in their cart right now (and have not ordered yet). Handy for a friendly nudge on WhatsApp.' }));
    if (!S.carts) return wrap;
    if (!S.carts.length) wrap.append(h('p', { class: 'muted', text: 'No saved carts right now.' }));
    S.carts.forEach((c) => wrap.append(h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('div', null, h('b', { text: c.name }), h('div', { class: 'muted small', text: 'Updated ' + fmt(new Date(c.updatedAt).toISOString()) })), h('b', { text: naira(c.total) })),
      h('ul', { class: 'small' }, c.items.map((i) => h('li', { text: i.qty + ' × ' + i.name + (i.soldOut ? ' (sold out)' : '') }))),
      h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + c.phone + '?text=' + encodeURIComponent('Hi ' + c.name.split(' ')[0] + '! 🤍 You left some lovely pieces in your MYLEBRAND cart. Need any help finishing your order?') }, 'Nudge on WhatsApp'))));
    return wrap;
  }

  // ---------- ledger ----------
  function ledgerTab() {
    const { h, api, toast } = H;
    const wrap = h('div', null, batchPicker());
    const L = S.ledger;
    if (!L) return wrap;
    const t = L.totals;
    const tile = (label, val, cls) => h('div', { class: 'tile ' + (cls || '') }, h('div', { class: 'tl', text: label }), h('div', { class: 'tv', text: val }));
    wrap.append(h('div', { class: 'tiles' },
      tile('Money in (paid orders)', naira(t.revenue)), tile('Cost of what sold' + (t.costOfSoldComplete ? '' : ' *'), naira(t.costOfSold)),
      tile('Other expenses', naira(t.expenses)), tile('Profit so far', naira(t.profit), t.profit < 0 ? 'neg' : 'pos'),
      tile('Waiting for payment', naira(t.awaiting) + ' (' + t.pendingOrders + ')'), tile('You spent on stock', naira(t.spendOnStock))));
    if (!t.costOfSoldComplete) wrap.append(h('p', { class: 'muted small', text: '* Some sold items have no cost price entered, so profit may look higher than it is. Add costs on the Products tab.' }));
    wrap.append(h('h3', { style: 'margin:18px 0 8px', text: 'Products: bought, sold, left' }));
    const tbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Product', 'Price', 'Cost', 'Bought', 'Sold', 'Left'].map((x) => h('th', { text: x })))),
      h('tbody', null, L.products.map((p) => h('tr', { class: p.kind === 'box' ? 'dim' : '' },
        h('td', { text: p.name + (p.kind === 'box' ? ' (box)' : '') + (p.soldOut ? ' · sold out' : '') }), h('td', { text: naira(p.price) }),
        h('td', { text: p.cost == null ? '—' : naira(p.cost) }), h('td', { text: p.bought == null ? '—' : p.bought }),
        h('td', { text: p.sold + (p.pending ? ' (+' + p.pending + ' pending)' : '') }), h('td', { text: p.left == null ? '—' : p.left })))));
    wrap.append(h('div', { class: 'scroll' }, tbl));
    wrap.append(h('p', { class: 'muted small', text: 'Boxes count toward the products inside them, so the numbers for single products stay true.' }));

    wrap.append(h('h3', { style: 'margin:18px 0 8px', text: 'Other expenses' }));
    L.expenses.forEach((e) => wrap.append(h('div', { class: 'row between card slim' }, h('span', { text: e.label + (e.spentOn ? ' · ' + e.spentOn : '') }),
      h('span', { class: 'row' }, h('b', { text: naira(e.amount) }), h('button', { class: 'btn danger small', onclick: () => go(() => api('DELETE', '/api/admin/expenses/' + e.id)) }, '✕')))));
    const label = h('input', { type: 'text', placeholder: 'Shipping, packaging, ads…', maxlength: 80 });
    const amount = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Amount ₦' });
    const date = h('input', { type: 'date' });
    wrap.append(h('div', { class: 'card' }, field('WHAT FOR', label), field('AMOUNT', amount), field('DATE (optional)', date),
      h('button', { class: 'btn small', onclick: () => go(async () => { await api('POST', '/api/admin/expenses', { batchId: S.batchId, label: label.value, amount: amount.value, spentOn: date.value || null }); toast('Added'); }) }, 'Add expense')));
    return wrap;
  }


  // ---------- wholesale pages ----------
  function wholesaleTab() {
    const { h, api, toast } = H;
    const L = S.wh;
    if (!L) return h('div');
    const url = location.origin + '/' + S.whLine;
    const wrap = h('div');
    wrap.append(h('div', { class: 'row chips' }, [['beauty', 'Beauty wholesale'], ['interiors', 'Interiors']].map(([k, t]) =>
      h('button', { class: 'chip' + (S.whLine === k ? ' on' : ''), onclick: () => { S.whLine = k; go(); } }, t))));
    wrap.append(h('div', { class: 'card' },
      h('p', { class: 'small', style: 'margin-top:0' }, 'This is the page your QR code opens: ', h('a', { href: url, target: '_blank', rel: 'noopener', text: url })),
      h('p', { class: 'small muted', style: 'margin-bottom:0', text: 'Add each product with a photo, description and price. Put the higher price in “Old price” to show a discount. Leave a price empty and the page shows “Price on request”.' })));
    // page-level fields write straight into S.wh, so nothing typed is lost when a pop-up opens or closes
    const bind = (key, el) => { el.addEventListener('input', () => { L[key] = el.value; }); return el; };
    const f = {
      title: bind('title', h('input', { type: 'text', value: L.title, maxlength: 80 })), headline: bind('headline', h('input', { type: 'text', value: L.headline, maxlength: 120 })),
      sub: bind('sub', h('textarea', { rows: 2, maxlength: 240 }, L.sub || '')), group: bind('groupLink', h('input', { type: 'text', value: L.groupLink || '', placeholder: 'https://chat.whatsapp.com/…' })),
      min: bind('minNote', h('input', { type: 'text', value: L.minNote || '', maxlength: 160, placeholder: 'e.g. Minimum order: 6 pieces in total' })),
      bonus: bind('bonus', h('input', { type: 'text', value: L.bonus || '', maxlength: 240, placeholder: 'e.g. Free lip balm for first-time buyers' })),
      spots: bind('spots', h('input', { type: 'text', inputmode: 'numeric', value: L.spots == null ? '' : L.spots, placeholder: 'optional' })), deadline: bind('deadline', h('input', { type: 'date', value: L.deadline || '' })),
    };
    wrap.append(h('div', { class: 'card' },
      field('PAGE NAME', f.title), field('HEADLINE', f.headline), field('ONE-LINE DESCRIPTION', f.sub),
      field('WHATSAPP GROUP LINK (leave empty to use your community link)', f.group), field('MINIMUM ORDER NOTE (optional)', f.min),
      field('FIRST-ORDER BONUS (optional, only offer what you will honour)', f.bonus), field('LIMITED TO FIRST HOW MANY STUDENTS? (optional)', f.spots), field('OFFER ENDS ON (optional)', f.deadline)));
    const items = L.items;
    const beauty = S.whLine === 'beauty';
    const blank = () => ({ name: '', price: '', oldPrice: '', resale: '', minQty: '', note: '', desc: '', images: [] });
    const openItem = (i) => { S.whItem = { i, draft: i >= 0 ? JSON.parse(JSON.stringify(items[i])) : blank() }; if (!Array.isArray(S.whItem.draft.images)) S.whItem.draft.images = []; H.rerender(); };
    const priceLine = (it) => {
      if (!it.price) return 'No price yet · shows “Price on request”';
      const bits = [(beauty ? 'You pay ' : '') + naira(it.price)];
      if (it.oldPrice) bits.push('was ' + naira(it.oldPrice));
      if (beauty && it.resale) bits.push('they sell at ' + naira(it.resale));
      if (it.minQty) bits.push('min ' + it.minQty);
      return bits.join(' · ');
    };
    wrap.append(h('div', { class: 'row between', style: 'margin:6px 0 10px' }, h('h3', { style: 'margin:0', text: 'Products and prices' }),
      h('button', { class: 'btn small', onclick: () => openItem(-1) }, '+ Add product')));
    wrap.append(h('div', { class: 'card slim' }, items.length ? items.map((it, i) => h('div', { class: 'prow' },
      it.images && it.images[0] ? h('img', { src: cdn(it.images[0].url, 96), alt: '' }) : h('div', { class: 'noimg', text: '—' }),
      h('div', { class: 'pinfo' }, h('div', { class: 'pname', text: it.name || 'Unnamed product' }), h('div', { class: 'muted small', text: priceLine(it) })),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: () => openItem(i) }, 'Edit'),
        h('button', { class: 'btn danger small', onclick: () => { if (confirm('Remove “' + (it.name || 'this product') + '” from the page?')) { items.splice(i, 1); H.rerender(); } } }, '✕'))))
      : h('p', { class: 'muted', style: 'margin:0', text: 'No products yet. Tap “+ Add product”.' })));
    wrap.append(h('p', { class: 'small muted', text: 'Changes to products only go live when you press “Save page”.' }));
    wrap.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => go(async () => {
      const body = { title: L.title, headline: L.headline, sub: L.sub, groupLink: L.groupLink, minNote: L.minNote,
        bonus: L.bonus, spots: L.spots, deadline: L.deadline, items };
      await api('PUT', '/api/admin/wholesale/' + S.whLine, body); toast('Saved. Your page is updated.');
    }) }, 'Save page')));
    if (S.whItem) {
      const w = S.whItem, d = w.draft;
      const inp = (key, label, ph, wide) => { const el = h('input', { type: 'text', inputmode: ['name', 'note'].includes(key) ? 'text' : 'numeric', value: d[key] == null ? '' : d[key], placeholder: ph || '' });
        el.addEventListener('input', () => { d[key] = el.value; }); return h('div', { class: 'mini', style: wide ? 'flex-basis:100%' : null }, h('span', { text: label }), el); };
      const desc = h('textarea', { rows: 3, maxlength: 600, placeholder: 'What is it? Size, benefits, what is included…' }, d.description || d.desc || '');
      desc.addEventListener('input', () => { d.desc = desc.value; });
      const err = h('p', { class: 'err', role: 'alert' });
      wrap.append(overlay(h('div', null, h('h3', { text: w.i >= 0 ? 'Edit product' : 'New product' }),
        h('div', { class: 'row' }, inp('name', 'PRODUCT NAME', 'e.g. Hydrating face mask', true)),
        h('div', { class: 'mini', style: 'flex-basis:100%' }, h('span', { text: 'DESCRIPTION' }), desc),
        h('div', { class: 'row' }, inp('price', beauty ? 'YOU PAY ₦ (EACH)' : 'PRICE ₦'), inp('oldPrice', 'OLD PRICE ₦ (for a discount)'), beauty ? inp('resale', 'THEY SELL AT ₦') : null, inp('minQty', 'MIN QUANTITY')),
        h('div', { class: 'row' }, inp('note', 'SHORT NOTE (size, shade…)', '', true)),
        h('div', { class: 'mini', style: 'flex-basis:100%' }, h('span', { text: 'PHOTOS (up to 3)' }), photoPicker(d.images, 3, (l) => { d.images = l; })),
        err,
        h('div', { class: 'row', style: 'margin-top:12px' },
          h('button', { class: 'btn small', onclick: () => {
            if (!String(d.name || '').trim()) { err.textContent = 'Give the product a name first.'; return; }
            if (w.i >= 0) items[w.i] = d; else items.push(d);
            S.whItem = null; H.rerender();
          } }, 'Done'),
          h('button', { class: 'btn ghost small', onclick: () => { S.whItem = null; H.rerender(); } }, 'Cancel'))),
        () => { S.whItem = null; H.rerender(); }));
    }
    return wrap;
  }

  // ---------- admin security: change password, recovery codes ----------
  function securityCard() {
    const { h, api, toast, copy } = H;
    const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
    const cur2 = h('input', { type: 'password', autocomplete: 'current-password' });
    const out = h('div');
    const info = h('p', { class: 'muted small', text: 'Loading…' });
    api('GET', '/api/admin/security').then((r) => { info.textContent = r.codesLeft ? r.codesLeft + ' recovery codes left.' : 'You have not saved recovery codes yet. Make them now, so you can get back in if you forget your password.'; }).catch(() => {});
    return h('div', { class: 'card' },
      h('h3', { text: 'Admin security' }),
      h('p', { class: 'small', style: 'margin-top:8px', text: 'Change your admin password' }),
      field('CURRENT PASSWORD', cur), field('NEW PASSWORD (at least 10 characters)', nw),
      h('button', { class: 'btn small', onclick: () => H.run(async () => { await api('POST', '/api/admin/password', { current: cur.value, next: nw.value }); cur.value = nw.value = ''; toast('Password changed'); }) }, 'Change password'),
      h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:18px 0' }),
      h('p', { class: 'small', style: 'margin:0', text: 'Recovery codes (for “Forgot password?”)' }), info,
      field('CURRENT PASSWORD', cur2),
      h('button', { class: 'btn ghost small', onclick: () => H.run(async () => {
        const r = await api('POST', '/api/admin/recovery-codes', { current: cur2.value }); cur2.value = '';
        out.replaceChildren(h('div', { class: 'notice warn' }, h('b', { text: 'Save these now. They are shown only once. ' }), 'Each code works one time. Put them in a safe place, such as a photo in a private album or a password manager.'),
          h('div', { class: 'codes' }, r.codes.map((c) => h('code', { text: c }))),
          h('button', { class: 'btn small', onclick: () => copy(r.codes.join('\n'), 'Codes copied') }, 'Copy all'));
        info.textContent = '8 recovery codes made. Old codes no longer work.';
      }) }, 'Make new recovery codes'), out);
  }

  // ---------- settings ----------
  function settingsTab() {
    const { h, api, toast } = H;
    const s = S.settings;
    if (!s) return h('div');
    const defs = [
      ['whatsapp', 'WHATSAPP NUMBER (with country code)', '2349043045498'], ['instagram', 'INSTAGRAM LINK'], ['tiktok', 'TIKTOK LINK'], ['facebook', 'FACEBOOK LINK'],
      ['community', 'WHATSAPP COMMUNITY / GROUP LINK'], ['site_tagline', 'SITE TAGLINE'], ['announcement', 'ANNOUNCEMENT BAR (leave empty to hide)'], ['promise', 'YOUR PROMISE (shown on the home page)'],
      ['bank_name', 'BANK NAME'], ['bank_account_number', 'ACCOUNT NUMBER'], ['bank_account_name', 'ACCOUNT NAME'], ['payment_note', 'NOTE SHOWN WITH PAYMENT DETAILS'],
      ['gift_threshold', 'GIFT: ORDER TOTAL NEEDED (₦, 0 turns it off)'], ['gift_slots', 'GIFT: HOW MANY SPOTS PER BATCH'], ['gift_text', 'GIFT: WHAT IS IT (words)'],
    ];
    const inputs = {};
    const form = h('div', { class: 'card' });
    defs.forEach(([k, label, ph]) => { inputs[k] = h('input', { type: 'text', value: s[k] || '', placeholder: ph || '' }); form.append(field(label, inputs[k])); });
    form.append(h('button', { class: 'btn', onclick: () => go(async () => {
      const body = {}; Object.keys(inputs).forEach((k) => { body[k] = inputs[k].value; });
      await api('PUT', '/api/admin/settings', body); toast('Saved');
    }) }, 'Save settings'));
    return h('div', null, h('p', { class: 'muted small', text: 'Bank details are only shown to a customer after they place an order.' }), form, securityCard());
  }

  function mount(helpers) {
    H = helpers;
    const { h } = H;
    const nav = h('div', { class: 'row chips tabs' }, TABS.map(([k, t]) => h('button', { class: 'chip' + (S.tab === k ? ' on' : ''), onclick: () => { S.tab = k; closeAll(); go(); } }, t)));
    if (!escBound) { escBound = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hasOverlay() && S.closeTop) S.closeTop(); }); }
    S.closeTop = null;
    const body = { products: productsTab, orders: ordersTab, ledger: ledgerTab, wholesale: wholesaleTab, customers: customersTab, carts: cartsTab, settings: settingsTab }[S.tab]();
    document.body.style.overflow = hasOverlay() ? 'hidden' : '';
    return h('div', { class: 'shopadmin' }, nav, body);
  }
  async function load(helpers) { H = helpers; await loadTab(); }

  window.ShopAdmin = { mount, load };
})();
