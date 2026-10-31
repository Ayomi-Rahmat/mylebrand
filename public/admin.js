(function () {
  'use strict';
  const TZ = 'Africa/Lagos';
  const app = document.getElementById('app');
  const state = { stages: [], batches: [], selId: null, orders: [], tab: 'journey', selected: new Set(), fresh: null, showNew: false, editing: false, area: 'tracker' };

  // ---------- tiny helpers ----------
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
      else el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }
  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), bad ? 5000 : 2200);
  }
  function fmt(iso) {
    return new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function nowLocal() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  async function api(method, url, body) {
    const r = await fetch(url, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/admin/login') { showLogin(); throw new Error('Please log in again.'); }
    if (!r.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  async function run(fn) {
    try { await fn(); } catch (e) { toast(e.message, true); }
  }
  const batch = () => state.batches.find((b) => b.id === state.selId) || null;
  const iso = (localValue) => new Date(localValue).toISOString();
  function firstName(n) { return n.split(/\s+/)[0]; }
  function shareMessage(c, batchName) {
    return 'Hi ' + firstName(c.name) + '! 🤍 Your ' + batchName + ' order is now trackable.\n\n' +
      'Track it here: ' + location.origin + '\nTracking ID: ' + c.publicId + '\nPIN: ' + c.pin +
      '\n\nKeep your PIN private, it is the key to your tracker.';
  }
  async function copy(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok || 'Copied'); } catch (e) { toast('Could not copy. Select and copy it manually.', true); }
  }

  const helpers = { h, api, toast, run, copy, fmt, rerender: () => render() };

  // ---------- login ----------
  function showLogin() {
    const err = h('p', { class: 'error', role: 'alert' });
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: 'required' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Log in');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try { await api('POST', '/api/admin/login', { password: pw.value }); await boot(); }
        catch (ex) { err.textContent = ex.message; }
        btn.disabled = false;
      },
    }, h('div', { class: 'field' }, h('label', { for: 'pw', text: 'ADMIN PASSWORD' }), pw), btn, err);
    app.replaceChildren(h('main', { class: 'wrap' },
      h('div', { class: 'wordmark' }, 'MYLEBRAND', h('sup', null, '®')),
      h('p', { class: 'eyebrow', text: 'Tracker admin' }),
      h('div', { class: 'card' }, form)));
    pw.focus();
  }

  // ---------- data loading ----------
  async function loadBatches() {
    state.batches = (await api('GET', '/api/admin/batches')).batches;
    if (!state.batches.find((b) => b.id === state.selId)) state.selId = state.batches[0] ? state.batches[0].id : null;
  }
  async function loadOrders() {
    state.orders = state.selId ? (await api('GET', '/api/admin/batches/' + state.selId + '/orders')).orders : [];
    state.selected = new Set([...state.selected].filter((id) => state.orders.some((o) => o.id === id)));
  }
  async function refresh() { await loadBatches(); await loadOrders(); render(); }
  async function boot() {
    const me = await api('GET', '/api/admin/me');
    if (!me.loggedIn) return showLogin();
    state.stages = (await api('GET', '/api/admin/stages')).stages;
    await refresh();
  }

  // ---------- rendering ----------
  function render() {
    const top = h('div', { class: 'topbar' },
      h('div', null, h('div', { class: 'wordmark' }, 'MYLEBRAND', h('sup', null, '®')), h('div', { class: 'sub', text: 'Admin' })),
      h('button', { class: 'btn ghost small', onclick: () => run(async () => { await api('POST', '/api/admin/logout', {}); showLogin(); }) }, 'Log out'));
    const nav = h('div', { class: 'row chips areanav' }, [['tracker', 'Tracker'], ['shop', 'Shop']].map(([k, t]) =>
      h('button', { class: 'chip big' + (state.area === k ? ' on' : ''), onclick: () => run(async () => {
        state.area = k;
        if (k === 'shop') await window.ShopAdmin.load(helpers);
        render();
      }) }, t)));
    app.replaceChildren(h('div', { class: 'admin' }, top, nav,
      state.area === 'shop' ? window.ShopAdmin.mount(helpers) : h('div', { class: 'cols' }, sidebar(), main())));
  }

  function sidebar() {
    const wrap = h('div');
    wrap.append(h('button', { class: 'btn block', style: 'margin-bottom:12px', onclick: () => { state.showNew = !state.showNew; render(); } }, state.showNew ? 'Cancel' : '+ New batch'));
    if (state.showNew) wrap.append(batchForm(null));
    state.batches.forEach((b) => {
      const stage = b.currentIndex >= 0 ? state.stages[b.currentIndex].title : 'Not started';
      wrap.append(h('button', {
        class: 'batchcard' + (b.id === state.selId ? ' sel' : ''),
        onclick: () => run(async () => { state.selId = b.id; state.fresh = null; state.selected.clear(); state.editing = false; await loadOrders(); render(); }),
      }, h('div', { class: 'bn', text: b.name }), h('div', { class: 'bs', text: b.orderCount + ' customer' + (b.orderCount === 1 ? '' : 's') + ' · ' + stage })));
    });
    if (!state.batches.length && !state.showNew) wrap.append(h('p', { class: 'muted', text: 'No batches yet. Create your first one.' }));
    return wrap;
  }

  function batchForm(b) {
    const name = h('input', { type: 'text', value: b ? b.name : '', placeholder: 'Batch 02: The Becoming Edit', maxlength: 80 });
    const from = h('input', { type: 'date', value: b && b.deliveryFrom ? b.deliveryFrom : '' });
    const to = h('input', { type: 'date', value: b && b.deliveryTo ? b.deliveryTo : '' });
    const eta = h('input', { type: 'date', value: b && b.lagosEta ? b.lagosEta : '' });
    return h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', { text: 'BATCH NAME' }), name),
      h('div', { class: 'field' }, h('label', { text: 'DELIVERY WINDOW STARTS' }), from),
      h('div', { class: 'field' }, h('label', { text: 'DELIVERY WINDOW ENDS' }), to),
      h('div', { class: 'field' }, h('label', { text: 'EXPECTED ARRIVAL IN LAGOS (optional)' }), eta,
        h('div', { class: 'hint', style: 'text-align:left', text: 'Used to move the ship along the map and count down the days.' })),
      h('button', {
        class: 'btn block',
        onclick: () => run(async () => {
          const body = { name: name.value, deliveryFrom: from.value || null, deliveryTo: to.value || null, lagosEta: eta.value || null };
          if (b) { await api('PATCH', '/api/admin/batches/' + b.id, body); state.editing = false; toast('Saved'); }
          else { const r = await api('POST', '/api/admin/batches', body); state.selId = r.id; state.showNew = false; toast('Batch created'); }
          await refresh();
        }),
      }, b ? 'Save changes' : 'Create batch'));
  }

  function main() {
    const b = batch();
    if (!b) return h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Create a batch to get started.' }));
    const win = b.deliveryFrom || b.deliveryTo ? [b.deliveryFrom, b.deliveryTo].filter(Boolean).join(' to ') : 'not set';
    const head = h('div', { class: 'card' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', null, h('h2', { text: b.name, style: 'font-size:26px' }),
          h('div', { class: 'muted', style: 'font-size:14px;margin-top:4px', text: 'Delivery window: ' + win + (b.lagosEta ? ' · Lagos ETA: ' + b.lagosEta : '') })),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost small', onclick: () => { state.editing = !state.editing; render(); } }, state.editing ? 'Close' : 'Edit'),
          h('button', {
            class: 'btn danger small',
            onclick: () => { if (confirm('Delete "' + b.name + '" and ALL its customers? This cannot be undone.')) run(async () => { await api('DELETE', '/api/admin/batches/' + b.id); await refresh(); }); },
          }, 'Delete'))),
      state.editing ? h('div', { style: 'margin-top:14px' }, batchForm(b)) : null);
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: 'tab' + (state.tab === 'journey' ? ' on' : ''), onclick: () => { state.tab = 'journey'; render(); } }, 'Batch journey'),
      h('button', { class: 'tab' + (state.tab === 'customers' ? ' on' : ''), onclick: () => { state.tab = 'customers'; render(); } }, 'Customers (' + b.orderCount + ')'));
    return h('div', null, head, tabs, state.tab === 'journey' ? journeyTab(b) : customersTab(b));
  }

  // ----- batch-wide steps -----
  function journeyTab(b) {
    const card = h('div', { class: 'card' });
    card.append(h('p', { class: 'muted', style: 'margin:0 0 6px;font-size:14px', text: 'These steps apply to everyone in this batch. Mark each one as it happens; customers see it straight away.' }));
    const batchStages = state.stages.filter((s) => s.scope === 'batch');
    const recorded = Object.fromEntries(b.events.map((e) => [e.stage, e]));
    let nextFound = false;
    batchStages.forEach((s, i) => {
      const ev = recorded[s.key];
      const isLastRecorded = ev && !recorded[(batchStages[i + 1] || {}).key];
      const isNext = !ev && !nextFound;
      if (isNext) nextFound = true;
      const row = h('div', { class: 'stage-row' + (ev ? ' done' : isNext ? ' next' : '') },
        h('div', { class: 'n', text: ev ? '✓' : String(i + 1) }),
        h('div', null, h('div', { style: 'font-weight:600', text: s.title }),
          h('div', { class: 'meta', text: ev ? s.inLabel + ' ' + fmt(ev.at) + (ev.note ? ' · "' + ev.note + '"' : '') : s.phase })),
        isLastRecorded ? h('button', {
          class: 'btn ghost small',
          onclick: () => { if (confirm('Undo "' + s.title + '"?')) run(async () => { await api('DELETE', '/api/admin/batches/' + b.id + '/stages/' + s.key); await refresh(); }); },
        }, 'Undo') : null);
      if (isNext) {
        const at = h('input', { type: 'datetime-local', value: nowLocal() });
        const note = h('input', { type: 'text', placeholder: 'Optional note for customers', maxlength: 200 });
        row.append(h('div', { class: 'stage-form' }, at, note,
          h('button', {
            class: 'btn small',
            onclick: () => run(async () => { await api('POST', '/api/admin/batches/' + b.id + '/stages', { stage: s.key, at: iso(at.value), note: note.value }); toast('Recorded: ' + s.title); await refresh(); }),
          }, 'Mark reached')));
      }
      card.append(row);
    });
    if (b.currentIndex >= 6) card.append(h('div', { class: 'warn', text: 'Customs is done. Open the Customers tab to record the founder collecting, packing and delivering each order.' }));
    return card;
  }

  // ----- customers -----
  function customersTab(b) {
    const wrap = h('div');

    // add customers
    const ta = h('textarea', { rows: 5, placeholder: 'One customer per line:\nAmaka Obi | Grey tote bag, black cap\nTunde Adeyemi | Candle set' });
    wrap.append(h('div', { class: 'card' },
      h('h3', { text: 'Add customers', style: 'font-size:20px;margin-bottom:10px' }),
      ta,
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', {
          class: 'btn',
          onclick: () => run(async () => {
            const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
            const r = await api('POST', '/api/admin/batches/' + b.id + '/orders', { lines });
            state.fresh = r.created;
            await refresh();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }),
        }, 'Create IDs and PINs'),
        h('span', { class: 'muted', style: 'font-size:13px', text: 'The part after | is optional (what they ordered).' }))));

    // freshly created credentials (shown once)
    if (state.fresh) {
      const box = h('div', { class: 'card' },
        h('h3', { text: 'Send these to your customers', style: 'font-size:20px' }),
        h('div', { class: 'warn', text: 'PINs are shown only once and are stored scrambled. Copy them now. If one is lost, use "New PIN" on that customer.' }));
      state.fresh.forEach((c) => {
        box.append(h('div', { class: 'cred' },
          h('div', { style: 'font-weight:600', text: c.name }),
          h('div', null, h('code', { text: c.publicId }), '   PIN ', h('code', { text: c.pin })),
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'btn small', onclick: () => copy(shareMessage(c, b.name), 'Message copied for ' + firstName(c.name)) }, 'Copy WhatsApp message'))));
      });
      box.append(h('div', { class: 'row' },
        h('button', { class: 'btn gold small', onclick: () => copy(state.fresh.map((c) => shareMessage(c, b.name)).join('\n\n-----\n\n'), 'All messages copied') }, 'Copy all messages'),
        h('button', { class: 'btn ghost small', onclick: () => { state.fresh = null; render(); } }, 'I have copied them, hide this')));
      wrap.append(box);
    }

    // update selected
    const orderStages = state.stages.filter((s) => s.scope === 'order');
    const customsDone = b.currentIndex >= 6;
    const sel = h('select', { disabled: !customsDone }, orderStages.map((s) => h('option', { value: s.key, text: s.title })));
    const at = h('input', { type: 'datetime-local', value: nowLocal(), disabled: !customsDone });
    const note = h('input', { type: 'text', placeholder: 'Optional note', maxlength: 200, disabled: !customsDone });
    const goBtn = h('button', {
      class: 'btn small', disabled: !customsDone,
      onclick: () => run(async () => {
        const r = await api('POST', '/api/admin/orders/stage', { orderIds: [...state.selected], stage: sel.value, at: iso(at.value), note: note.value });
        if (r.failures.length) toast(r.failures.slice(0, 3).join(' | '), true); else toast('Updated');
        await refresh();
      }),
    }, 'Update selected (' + state.selected.size + ')');
    const upd = h('div', { class: 'card' },
      h('h3', { text: 'Update customers together', style: 'font-size:20px;margin-bottom:6px' }),
      customsDone ? h('p', { class: 'muted', style: 'margin:0 0 10px;font-size:14px', text: 'Tick customers below, pick the step and time, then update.' })
        : h('div', { class: 'warn', text: 'Unlocks once the batch has cleared customs (see Batch journey).' }),
      h('div', { class: 'stage-form', style: 'grid-column:auto;grid-template-columns:1fr 1fr' }, sel, at),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('div', { class: 'grow' }, note), goBtn));

    wrap.append(upd);

    // list
    const list = h('div', { class: 'card' });
    const all = h('input', {
      type: 'checkbox', 'aria-label': 'Select all',
      onchange: (e) => { state.orders.forEach((o) => (e.target.checked ? state.selected.add(o.id) : state.selected.delete(o.id))); render(); },
    });
    list.append(h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:600' }, all, 'Select all (' + state.orders.length + ')'));
    if (!state.orders.length) list.append(h('p', { class: 'muted', text: 'No customers in this batch yet.' }));
    state.orders.forEach((o) => {
      const stage = o.currentIndex >= 0 ? state.stages[o.currentIndex].title : 'Not started';
      const last = o.ownEvents.length ? o.ownEvents.reduce((m, e) => (state.stages.findIndex((s) => s.key === e.stage) > state.stages.findIndex((s) => s.key === m.stage) ? e : m)) : null;
      const cb = h('input', {
        type: 'checkbox', checked: state.selected.has(o.id),
        onchange: (e) => { e.target.checked ? state.selected.add(o.id) : state.selected.delete(o.id); goBtn.textContent = 'Update selected (' + state.selected.size + ')'; },
      });
      list.append(h('div', { class: 'order' }, cb,
        h('div', null,
          h('div', { style: 'font-weight:600' }, o.name, ' ', h('span', { class: 'badge', text: stage }), o.locked ? ' ' : null, o.locked ? h('span', { class: 'badge lock', text: 'locked' }) : null),
          h('div', { class: 'id', text: o.publicId }),
          o.items ? h('div', { style: 'font-size:14px', text: o.items }) : null),
        h('div', { class: 'acts' },
          last ? h('button', {
            class: 'btn ghost small',
            onclick: () => run(async () => { await api('DELETE', '/api/admin/orders/' + o.id + '/stages/' + last.stage); await refresh(); }),
          }, 'Undo last') : null,
          h('button', {
            class: 'btn ghost small',
            onclick: () => { if (confirm('Create a new PIN for ' + o.name + '? The old one stops working.')) run(async () => {
              const r = await api('POST', '/api/admin/orders/' + o.id + '/reset-pin', {});
              state.fresh = [{ name: r.name, publicId: r.publicId, pin: r.pin }];
              await refresh();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }); },
          }, 'New PIN'),
          h('button', {
            class: 'btn danger small',
            onclick: () => { if (confirm('Delete ' + o.name + '?')) run(async () => { await api('DELETE', '/api/admin/orders/' + o.id); await refresh(); }); },
          }, 'Delete'))));
    });
    wrap.append(list);
    return wrap;
  }

  boot().catch((e) => { showLogin(); });
})();
