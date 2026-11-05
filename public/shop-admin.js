// The SHOP side of the admin page: batches' shop settings, edits, products and boxes, orders,
// customers, saved carts, the ledger and site settings. Loaded before admin.js, which calls ShopAdmin.mount().
(function () {
  'use strict';
  const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
  const cdn = (u, w) => (/^https:\/\/res\.cloudinary\.com\/.+\/upload\//.test(u) ? u.replace('/upload/', '/upload/f_auto,q_auto,w_' + w + ',c_fill,h_' + w + '/') : u);
  const TABS = [['products', 'Products'], ['orders', 'Orders'], ['ledger', 'Ledger'], ['customers', 'Customers'], ['carts', 'Carts'], ['wholesale', 'Wholesale'], ['settings', 'Settings']];

  const S = {
    tab: 'products', batches: [], batchId: null, edits: [], products: [], form: null, editForm: null, showBatch: false, newBatch: false, whItem: null,
    orderType: 'batch', openId: null, openDetail: null, orderForm: null, sugg: [], entryForm: null, ledgerScope: 'batch',
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
    if (t === 'orders') {
      const st = S.orderFilter !== 'all' ? 'status=' + S.orderFilter : '';
      S.orders = S.orderType === 'batch' ? await H.api('GET', '/api/admin/shop-orders?' + st) : await H.api('GET', '/api/admin/line-orders?line=' + S.orderType + '&' + st);
    }
    if (t === 'customers') S.customers = (await H.api('GET', '/api/admin/customers')).customers;
    if (t === 'carts') S.carts = (await H.api('GET', '/api/admin/carts')).carts;
    if (t === 'ledger') {
      if (S.ledgerScope !== 'batch') S.ledger = await H.api('GET', '/api/admin/ledger?line=' + S.ledgerScope);
      else S.ledger = S.batchId ? await H.api('GET', '/api/admin/ledger?batchId=' + S.batchId) : null;
    }
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
  const hasOverlay = () => !!(S.form || S.editForm || S.newBatch || S.whItem || S.orderForm || S.entryForm);
  const closeAll = () => { S.form = null; S.editForm = null; S.newBatch = false; S.whItem = null; S.orderForm = null; S.entryForm = null; };
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
    if (!b) return h('p', { class: 'muted', text: 'Create a batch first (tap “+ Create your first batch”), then you can add products to it.' });
    const name = h('input', { type: 'text', value: b.name || '', maxlength: 80 });
    const status = h('select', null, ['draft', 'open', 'closed'].map((s) => h('option', { value: s, selected: b.status === s ? 'selected' : null }, { draft: 'Draft (hidden from the shop)', open: 'Open (customers can order)', closed: 'Closed (visible, no orders)' }[s])));
    const tagline = h('input', { type: 'text', value: b.tagline || '', maxlength: 140, placeholder: 'One line about this batch' });
    const closes = h('input', { type: 'date', value: b.closesOn || '' });
    const dFrom = h('input', { type: 'date', value: b.deliveryFrom || '' });
    const dTo = h('input', { type: 'date', value: b.deliveryTo || '' });
    const eta = h('input', { type: 'date', value: b.lagosEta || '' });
    return h('details', { class: 'card', open: S.showBatch ? 'open' : null, ontoggle: (e) => { S.showBatch = e.target.open; } },
      h('summary', { text: 'Batch details · ' + b.name + ' · ' + b.status }),
      field('BATCH NAME', name), field('STATUS', status), field('TAGLINE', tagline),
      field('PREORDERS CLOSE ON (optional)', closes, 'The shop closes itself at the end of this day (Lagos time).'),
      field('DELIVERY STARTS (optional)', dFrom), field('DELIVERY ENDS (optional)', dTo), field('EXPECTED IN LAGOS (optional)', eta),
      h('button', { class: 'btn small', onclick: () => go(async () => {
        await api('PATCH', '/api/admin/batches/' + b.id, { name: name.value, status: status.value, tagline: tagline.value, closesOn: closes.value || null,
          deliveryFrom: dFrom.value || null, deliveryTo: dTo.value || null, lagosEta: eta.value || null }); toast('Saved');
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
      edit: S.edits.length ? h('select', null, S.edits.map((e) => h('option', { value: e.id, selected: Number(f.editId) === e.id ? 'selected' : null }, e.name))) : null,
      newEdit: S.edits.length ? null : h('input', { type: 'text', value: 'Shop', maxlength: 80 }),
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
      field('NAME', el.name), el.edit ? field('WHICH EDIT (COLLECTION) IS IT IN?', el.edit) : field('COLLECTION NAME', el.newEdit, 'Products sit in collections, like “The Becoming Edit”. You have none yet, so we will make this one for you. You can rename it later.'),
      field('PRICE (₦)', el.price), field('OLD PRICE (₦, to show a discount)', el.compare),
      field('YOUR COST PER PIECE (₦, private)', el.cost), isBox ? null : field('QUANTITY YOU BOUGHT (private, for the ledger)', el.bought),
      isBox ? field('WHAT IS INSIDE THE BOX', boxUI) : null,
      field('CATEGORY', el.cat), field('DESCRIPTION', el.desc),
      field('PHOTOS (the first is the main one)', photoPicker(f.images || (f.images = []), 8, (l) => { f.images = l; })),
      field('ORDER ON THE PAGE (smaller shows first)', el.sort), field('VISIBILITY', el.status),
      h('label', { class: 'check' }, el.sold, ' Mark as SOLD OUT'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => go(async () => {
          let editId = el.edit ? Number(el.edit.value) : null;
          if (!editId) editId = (await api('POST', '/api/admin/edits', { batchId: S.batchId, name: el.newEdit.value || 'Shop' })).id;
          const body = {
            kind: f.kind, editId, name: el.name.value, price: el.price.value, compareAt: el.compare.value,
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
    const firstEdit = S.edits[0] ? S.edits[0].id : null;
    wrap.append(h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { S.form = { kind: 'product', editId: firstEdit, status: 'active', images: [] }; H.rerender(); } }, '+ Add product'),
      h('button', { class: 'btn ghost small', onclick: () => { S.form = { kind: 'box', editId: firstEdit, status: 'active', images: [], boxItems: [] }; H.rerender(); } }, '+ Add box'),
      h('button', { class: 'btn ghost small', onclick: () => { S.editForm = {}; H.rerender(); } }, '+ New collection (edit)')));
    if (!S.edits.length) wrap.append(h('p', { class: 'muted', text: 'Nothing here yet. Tap “+ Add product” to add your first one.' }));
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
  const waNum = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('0') ? '234' + d.slice(1) : d; };
  const TYPES = [['batch', 'Preorder batches'], ['beauty', 'Beauty wholesale'], ['interiors', 'Interiors']];
  const itemSum = (items) => items.reduce((t, i) => t + (Number(i.unitPrice) || 0) * (Number(i.qty) || 0), 0);

  async function openOrderForm(mode, o) {
    const type = S.orderType;
    const d = { mode, type, id: o ? o.id : null, name: o ? o.name : '', phone: o ? o.phone : '', address: o ? (o.address || '') : '', email: o ? (o.email || '') : '',
      notes: o ? (o.notes || '') : '', status: o ? o.status : 'paid', date: o ? String(o.createdAt || '').slice(0, 10) : '',
      batchId: type === 'batch' ? (o ? o.batchId : S.batchId) : null, gift: o ? !!o.gift : false, items: [], total: '', touched: false };
    d.items = (o && o.items && o.items.length ? o.items : [{}]).map((i) => ({ name: i.name || '', qty: i.qty || 1, unitPrice: i.unitPrice == null ? '' : i.unitPrice, unitCost: i.unitCost == null ? '' : i.unitCost, productId: i.productId || null }));
    d.total = o ? o.total : '';
    d.touched = !!o && o.total !== itemSum(d.items);
    S.orderForm = d; await loadSugg(); H.rerender();
  }
  async function loadSugg() {
    const d = S.orderForm; if (!d) return;
    try {
      if (d.type === 'batch') {
        S.sugg = d.batchId ? (await H.api('GET', '/api/admin/products?batchId=' + d.batchId)).products.map((p) => ({ name: p.name, price: p.price, cost: p.costPrice, productId: p.id })) : [];
      } else {
        S.sugg = (await H.api('GET', '/api/admin/wholesale/' + d.type)).line.items.filter((i) => i.price).map((i) => ({ name: i.name, price: i.price, cost: null, productId: null }));
      }
    } catch (e) { S.sugg = []; }
  }

  function orderFormUI() {
    const { h, api, toast } = H;
    const d = S.orderForm;
    const batch = d.type === 'batch';
    const bind = (key, el) => { el.addEventListener('input', () => { d[key] = el.value; }); return el; };
    const name = bind('name', h('input', { type: 'text', value: d.name, maxlength: 80, placeholder: 'Customer name' }));
    const phone = bind('phone', h('input', { type: 'tel', value: d.phone, placeholder: '0803 123 4567' }));
    const address = bind('address', h('textarea', { rows: 2, maxlength: 300 }, d.address));
    const email = bind('email', h('input', { type: 'text', value: d.email, placeholder: 'only if they have an account on the site' }));
    const notes = bind('notes', h('textarea', { rows: 2, maxlength: 300 }, d.notes));
    const date = bind('date', h('input', { type: 'date', value: d.date }));
    const status = h('select', { onchange: () => { d.status = status.value; } }, [['paid', 'Paid'], ['pending', 'Waiting for payment'], ['cancelled', 'Cancelled']].map(([v, t]) => h('option', { value: v, selected: d.status === v ? 'selected' : null }, t)));
    const batchSel = batch ? h('select', { onchange: () => { d.batchId = Number(batchSel.value); loadSugg().then(() => H.rerender()); } },
      S.batches.map((b) => h('option', { value: b.id, selected: b.id === d.batchId ? 'selected' : null }, b.name))) : null;
    const total = h('input', { type: 'text', inputmode: 'numeric', value: d.total });
    total.addEventListener('input', () => { d.total = total.value; d.touched = true; });
    const sumNote = h('div', { class: 'hint', style: 'text-align:left' });
    const refreshTotal = () => {
      const sum = itemSum(d.items);
      if (!d.touched) { d.total = sum; total.value = String(sum); }
      sumNote.textContent = 'Items add up to ' + naira(sum) + (d.touched && Number(d.total) !== sum ? '  (you changed the total)' : '');
    };
    const rows = h('div');
    const drawRows = () => {
      rows.replaceChildren(...d.items.map((it, i) => {
        const num = (key, ph, w) => { const el = h('input', { type: 'text', inputmode: 'numeric', value: it[key], placeholder: ph, style: 'width:' + w });
          el.addEventListener('input', () => { it[key] = el.value; refreshTotal(); }); return el; };
        const nm = h('input', { type: 'text', value: it.name, list: 'ordsugg', placeholder: 'Item name', maxlength: 120, style: 'flex:1;min-width:140px' });
        nm.addEventListener('input', () => { it.name = nm.value; });
        const qty = num('qty', 'Qty', '64px'), pr = num('unitPrice', 'Price ₦', '96px'), co = num('unitCost', 'Cost ₦', '96px');
        nm.addEventListener('change', () => {
          const m = S.sugg.find((x) => x.name.toLowerCase() === nm.value.trim().toLowerCase());
          if (m) { it.name = m.name; it.productId = m.productId; if (!it.unitPrice) { it.unitPrice = m.price; pr.value = String(m.price); } if (!it.unitCost && m.cost != null) { it.unitCost = m.cost; co.value = String(m.cost); } refreshTotal(); }
        });
        return h('div', { class: 'row', style: 'align-items:center;margin-bottom:8px' }, nm, qty, pr, co,
          h('button', { type: 'button', class: 'btn danger small', 'aria-label': 'Remove item', onclick: () => { d.items.splice(i, 1); if (!d.items.length) d.items.push({ name: '', qty: 1, unitPrice: '', unitCost: '', productId: null }); drawRows(); refreshTotal(); } }, '✕'));
      }));
    };
    drawRows(); refreshTotal();
    const err = h('p', { class: 'err', role: 'alert' });
    const save = () => go(async () => {
      const body = { name: d.name, phone: d.phone, notes: d.notes, status: d.status, date: d.date || null,
        total: d.touched ? d.total : '', items: d.items.filter((i) => String(i.name).trim()).map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice, unitCost: i.unitCost, productId: i.productId })) };
      if (batch) Object.assign(body, { batchId: d.batchId, address: d.address, email: d.email, gift: d.gift });
      else if (d.mode === 'new') body.line = d.type;
      const base = batch ? '/api/admin/shop-orders' : '/api/admin/line-orders';
      if (d.mode === 'edit') await api('PATCH', base + '/' + d.id, body); else await api('POST', base, body);
      S.orderForm = null; S.openId = null; S.openDetail = null; toast('Order saved');
    });
    return h('div', null, h('h3', { text: (d.mode === 'edit' ? 'Edit order' : 'New order') + ' · ' + TYPES.find((t) => t[0] === d.type)[1] }),
      batch ? field('BATCH', batchSel) : null,
      field('CUSTOMER NAME', name), field('PHONE / WHATSAPP', phone),
      batch ? field('DELIVERY ADDRESS', address) : null, batch ? field('CUSTOMER ACCOUNT EMAIL (optional, shows the order in their account)', email) : null,
      field('STATUS', status), field('DATE (optional, to record an older sale)', date),
      h('label', { text: 'ITEMS  (name · how many · price each · your cost each, optional)', style: 'display:block;margin:12px 0 6px' }),
      h('datalist', { id: 'ordsugg' }, S.sugg.map((x) => h('option', { value: x.name }))), rows,
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { d.items.push({ name: '', qty: 1, unitPrice: '', unitCost: '', productId: null }); drawRows(); } }, '+ Add item'),
      field('TOTAL (₦)', total, null), sumNote,
      field('NOTE', notes), err,
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn small', onclick: save }, 'Save order'),
        h('button', { class: 'btn ghost small', onclick: () => { S.orderForm = null; H.rerender(); } }, 'Cancel')));
  }

  function ordersTab() {
    const { h, api, toast, fmt } = H;
    const wrap = h('div');
    const c = S.orders ? S.orders.counts : { pending: 0, paid: 0, cancelled: 0 };
    const batch = S.orderType === 'batch';
    wrap.append(h('div', { class: 'row between', style: 'align-items:center' },
      h('div', { class: 'row chips' }, TYPES.map(([k, t]) => h('button', { class: 'chip' + (S.orderType === k ? ' on' : ''), onclick: () => { S.orderType = k; S.openId = null; S.openDetail = null; S.orders = null; go(); } }, t))),
      h('button', { class: 'btn small', onclick: () => { if (batch && !S.batches.length) { toast('Create a batch first (Products tab).', true); return; } openOrderForm('new'); } }, '+ New order')));
    wrap.append(h('div', { class: 'row chips' }, [['pending', 'Waiting for payment'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, t]) =>
      h('button', { class: 'chip' + (S.orderFilter === k ? ' on' : ''), onclick: () => { S.orderFilter = k; S.openId = null; S.openDetail = null; go(); } }, t + (k !== 'all' ? ' (' + c[k] + ')' : '')))));
    wrap.append(h('p', { class: 'muted small', text: batch
      ? 'Orders placed on the website appear here by themselves. You can also add an order by hand, or change anything on an existing one.'
      : 'When someone taps “Send my order on WhatsApp” on your ' + S.orderType + ' page, a copy lands here by itself (marked “Waiting for payment”). Add the name and phone if you get them, mark it Paid when they pay, and it counts in your ledger.' }));
    if (S.orders && S.orders.orders.length === 0) wrap.append(h('p', { class: 'muted', text: 'No orders here yet.' }));
    (S.orders ? S.orders.orders : []).forEach((o) => {
      const open = S.openId === o.id;
      const setStatus = (next, note) => go(async () => {
        await api(batch ? 'POST' : 'PATCH', '/api/admin/' + (batch ? 'shop-orders/' + o.id + '/status' : 'line-orders/' + o.id), { status: next, note }); S.openId = null; S.openDetail = null; toast('Updated');
      });
      const card = h('div', { class: 'card' },
        h('div', { class: 'row between', style: 'cursor:pointer', onclick: () => H.run(async () => {
          if (open) { S.openId = null; S.openDetail = null; } else { S.openId = o.id; S.openDetail = batch ? await api('GET', '/api/admin/shop-orders/' + o.id) : null; }
          H.rerender(); }) },
          h('div', null, h('b', { text: o.publicId + ' · ' + (o.name || 'No name yet') }),
            h('div', { class: 'muted small', text: (batch ? o.batchName + ' · ' : '') + fmt(o.createdAt) + (o.gift ? ' · 🎁 gift spot' : '') + (o.source === 'admin' ? ' · added by you' : (o.source === 'site' ? ' · from the site' : '')) }),
            h('div', { class: 'small', text: o.summary })),
          h('div', { style: 'text-align:right' }, h('b', { text: naira(o.total) }), h('div', { class: 'tag ' + o.status, text: o.status }))));
      if (open) {
        const d = batch ? S.openDetail : null;
        const phone = batch ? d.order.phone : o.phone;
        const who = batch ? d.order.name : o.name;
        const msg = 'Hi ' + (who ? who.split(' ')[0] : 'there') + '! This is MYLEBRAND. ' + (o.status === 'paid' ? 'We have received your payment for order ' : 'About your order ') + o.publicId + '. Thank you! 🤍';
        const items = batch ? d.items : o.items.map((i) => ({ ...i, line: i.unitPrice * i.qty }));
        card.append(
          batch ? h('p', { class: 'small', text: d.order.address + (d.order.notes ? '  ·  Note: ' + d.order.notes : '') }) : (o.notes ? h('p', { class: 'small', text: 'Note: ' + o.notes }) : null),
          phone ? h('p', { class: 'small' }, 'Phone: ', h('a', { href: 'https://wa.me/' + waNum(phone) + '?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener' }, phone + ' (message on WhatsApp)')) : h('p', { class: 'small muted', text: 'No phone number yet. Tap Edit to add one.' }),
          h('ul', { class: 'small' }, items.map((i) => h('li', { text: i.qty + ' × ' + i.name + ' — ' + naira(i.line) + (i.unitCost != null ? '  (your cost ' + naira(i.unitCost * i.qty) + ')' : '') }))),
          batch && d.order.stage ? h('p', { class: 'muted small', text: 'Tracker stage: ' + d.order.stage }) : null,
          batch ? h('ul', { class: 'small muted' }, d.log.map((l) => h('li', { text: fmt(l.at) + ' — ' + l.what + (l.note ? ' (' + l.note + ')' : '') }))) : null,
          h('div', { class: 'row' },
            h('button', { class: 'btn small', onclick: () => openOrderForm('edit', batch ? { ...d.order, items: d.items } : o) }, 'Edit order'),
            o.status !== 'paid' ? h('button', { class: 'btn ghost small', onclick: () => setStatus('paid') }, 'Mark as paid') : h('button', { class: 'btn ghost small', onclick: () => setStatus('pending') }, 'Undo paid'),
            o.status !== 'cancelled' ? h('button', { class: 'btn ghost small', onclick: () => { if (confirm('Cancel this order?')) setStatus('cancelled'); } }, 'Cancel order') : null,
            h('button', { class: 'btn danger small', onclick: () => { if (confirm('Delete this order for good? It will also leave your ledger.')) go(async () => { await api('DELETE', batch ? '/api/admin/orders/' + o.id : '/api/admin/line-orders/' + o.id); S.openId = null; S.openDetail = null; toast('Deleted'); }); } }, 'Delete')));
      }
      wrap.append(card);
    });
    if (S.orderForm) wrap.append(overlay(orderFormUI(), () => { S.orderForm = null; H.rerender(); }));
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
  const KIND_LABEL = { income: 'Money in', cost: 'Cost', expense: 'Expense' };
  function ledgerScopeStr() { return S.ledgerScope !== 'batch' ? S.ledgerScope : 'batch:' + S.batchId; }
  function ledgerPicker() {
    const { h } = H;
    const cur = S.ledgerScope !== 'batch' ? S.ledgerScope : 'batch-' + S.batchId;
    const sel = h('select', { onchange: () => {
      if (sel.value.startsWith('batch-')) { S.ledgerScope = 'batch'; S.batchId = Number(sel.value.slice(6)); } else S.ledgerScope = sel.value;
      S.ledger = null; closeAll(); go();
    } }, [...S.batches.map((b) => h('option', { value: 'batch-' + b.id, selected: cur === 'batch-' + b.id ? 'selected' : null }, 'Batch: ' + b.name)),
      h('option', { value: 'beauty', selected: cur === 'beauty' ? 'selected' : null }, 'Beauty wholesale'),
      h('option', { value: 'interiors', selected: cur === 'interiors' ? 'selected' : null }, 'Interiors')]);
    return h('div', { class: 'field' }, h('label', { text: 'WHICH LEDGER?' }), sel);
  }
  function entryFormUI() {
    const { h, api, toast } = H;
    const f = S.entryForm;
    const kind = h('select', { onchange: () => { f.kind = kind.value; } }, [['income', 'Money in (a payment you received)'], ['cost', 'Cost (what you paid for stock / cost of what sold)'], ['expense', 'Other expense (shipping, packaging, ads…)']]
      .map(([v, t]) => h('option', { value: v, selected: f.kind === v ? 'selected' : null }, t)));
    const label = h('input', { type: 'text', maxlength: 80, value: f.label || '', placeholder: 'e.g. Paid supplier, Transport, Cash sale' });
    const amount = h('input', { type: 'text', inputmode: 'numeric', value: f.amount || '', placeholder: 'Amount ₦' });
    const date = h('input', { type: 'date', value: f.date || '' });
    const note = h('input', { type: 'text', maxlength: 200, value: f.note || '', placeholder: 'optional' });
    [[label, 'label'], [amount, 'amount'], [date, 'date'], [note, 'note']].forEach(([el, k]) => el.addEventListener('input', () => { f[k] = el.value; }));
    const save = () => go(async () => {
      await api('POST', '/api/admin/ledger-entries', { scope: ledgerScopeStr(), kind: f.kind, label: f.label, amount: f.amount, date: f.date || null, note: f.note });
      S.entryForm = null; toast('Added');
    });
    return h('div', null, h('h3', { text: 'Add to the ledger' }), field('WHAT KIND?', kind), field('WHAT FOR', label), field('AMOUNT (₦)', amount), field('DATE (optional)', date), field('NOTE (optional)', note),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn small', onclick: save }, 'Save'), h('button', { class: 'btn ghost small', onclick: () => { S.entryForm = null; H.rerender(); } }, 'Cancel')));
  }
  function ledgerTab() {
    const { h, api, toast } = H;
    const wrap = h('div', null, ledgerPicker());
    const L = S.ledger;
    if (S.entryForm) wrap.append(overlay(entryFormUI(), () => { S.entryForm = null; H.rerender(); }));
    if (!L) return wrap;
    const t = L.totals;
    const line = S.ledgerScope !== 'batch';
    const tile = (label, val, cls) => h('div', { class: 'tile ' + (cls || '') }, h('div', { class: 'tl', text: label }), h('div', { class: 'tv', text: val }));
    wrap.append(h('div', { class: 'tiles' },
      tile('Money in (paid orders)', naira(t.revenue)), tile('Other money in', naira(t.otherIncome)),
      tile('Cost of what sold' + (t.costOfSoldComplete ? '' : ' *'), naira(t.costOfSold)), tile('Other costs you added', naira(t.extraCost)),
      tile('Other expenses', naira(t.expenses)), tile('Profit so far', naira(t.profit), t.profit < 0 ? 'neg' : 'pos'),
      tile('Waiting for payment', naira(t.awaiting) + ' (' + t.pendingOrders + ')'), line ? null : tile('You spent on stock', naira(t.spendOnStock))));
    if (!t.costOfSoldComplete) wrap.append(h('p', { class: 'muted small', text: line
      ? '* Some paid items have no cost entered. Open the order, tap Edit, and fill “cost each”, or add a Cost entry below.'
      : '* Some sold items have no cost price entered, so profit may look higher than it is. Add costs on the Products tab.' }));
    if (line) {
      wrap.append(h('h3', { style: 'margin:18px 0 8px', text: 'What sold' }));
      wrap.append(L.products.length ? h('div', { class: 'scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Product', 'Sold', 'Pending', 'Money in', 'Cost'].map((x) => h('th', { text: x })))),
        h('tbody', null, L.products.map((p) => h('tr', null, h('td', { text: p.name }), h('td', { text: p.sold }), h('td', { text: p.pending || '—' }), h('td', { text: naira(p.money) }), h('td', { text: p.cost ? naira(p.cost) : '—' }))))))
        : h('p', { class: 'muted', text: 'No orders yet. They appear here once you mark them Paid in the Orders tab.' }));
    } else {
      wrap.append(h('h3', { style: 'margin:18px 0 8px', text: 'Products: bought, sold, left' }));
      const tbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Product', 'Price', 'Cost', 'Bought', 'Sold', 'Left'].map((x) => h('th', { text: x })))),
        h('tbody', null, L.products.map((p) => h('tr', { class: p.kind === 'box' ? 'dim' : '' },
          h('td', { text: p.name + (p.kind === 'box' ? ' (box)' : '') + (p.soldOut ? ' · sold out' : '') }), h('td', { text: naira(p.price) }),
          h('td', { text: p.cost == null ? '—' : naira(p.cost) }), h('td', { text: p.bought == null ? '—' : p.bought }),
          h('td', { text: p.sold + (p.pending ? ' (+' + p.pending + ' pending)' : '') }), h('td', { text: p.left == null ? '—' : p.left })))));
      wrap.append(h('div', { class: 'scroll' }, tbl));
      wrap.append(h('p', { class: 'muted small', text: 'Boxes count toward the products inside them, so the numbers for single products stay true.' }));
    }
    wrap.append(h('div', { class: 'row between', style: 'margin:18px 0 8px;align-items:center' }, h('h3', { style: 'margin:0', text: 'Money you added by hand' }),
      h('button', { class: 'btn small', onclick: () => { S.entryForm = { kind: 'income' }; H.rerender(); } }, '+ Add entry')));
    if (!L.entries.length) wrap.append(h('p', { class: 'muted', text: 'Nothing yet. Add money you received, what you paid for stock, or expenses like shipping.' }));
    L.entries.forEach((e) => wrap.append(h('div', { class: 'row between card slim' },
      h('span', null, h('span', { class: 'tag ' + (e.kind === 'income' ? 'paid' : 'pending'), text: KIND_LABEL[e.kind] }), ' ' + e.label + (e.date ? ' · ' + e.date : '') + (e.note ? ' · ' + e.note : '')),
      h('span', { class: 'row' }, h('b', { text: (e.kind === 'income' ? '+' : '−') + naira(e.amount) }),
        h('button', { class: 'btn danger small', 'aria-label': 'Delete entry', onclick: () => { if (confirm('Delete “' + e.label + '”?')) go(() => api('DELETE', (e.src === 'expense' ? '/api/admin/expenses/' : '/api/admin/ledger-entries/') + e.id)); } }, '✕')))));
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
