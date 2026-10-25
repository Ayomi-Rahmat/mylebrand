(function () {
  'use strict';
  const TZ = 'Africa/Lagos';
  const $ = (id) => document.getElementById(id);
  const form = $('form'), lookup = $('lookup'), result = $('result'), err = $('err'), go = $('go');
  let creds = null;
  let timer = null;

  // Small helper to build elements safely (no innerHTML, so nothing from the server is ever run as code).
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  function fmt(iso, withYear) {
    const d = new Date(iso);
    const nowYear = new Date().toLocaleString('en-GB', { timeZone: TZ, year: 'numeric' });
    const yr = d.toLocaleString('en-GB', { timeZone: TZ, year: 'numeric' });
    const o = { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true };
    if (withYear || yr !== nowYear) o.year = 'numeric';
    return d.toLocaleString('en-GB', o).replace(/\bam\b/, 'am').replace(/\bpm\b/, 'pm');
  }
  function fmtDay(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function windowText(b) {
    if (b.deliveryFrom && b.deliveryTo) return fmtDay(b.deliveryFrom) + ' to ' + fmtDay(b.deliveryTo);
    if (b.deliveryFrom || b.deliveryTo) return fmtDay(b.deliveryFrom || b.deliveryTo);
    return '';
  }
  const DAY = 86400000;

  // 0..1 progress of the ship between "set sail" and the expected Lagos arrival.
  function seaFraction(d) {
    const sea = d.stages[4];
    if (sea.status === 'done') return 1;
    if (sea.status === 'upcoming') return 0;
    if (!d.batch.lagosEta) return 0.45;
    const start = new Date(sea.at).getTime();
    const end = new Date(d.batch.lagosEta + 'T12:00:00Z').getTime();
    if (!(end > start)) return 0.45;
    return Math.max(0.03, Math.min(0.96, (Date.now() - start) / (end - start)));
  }
  // Where the gold marker sits along the dotted route (0 = China, 1 = your door).
  function routePosition(d) {
    const i = d.currentIndex;
    if (i < 0) return 0;
    if (i <= 3) return 0.025 * i;
    if (i === 4) return 0.12 + 0.55 * seaFraction(d);
    if (i === 5) return 0.7;
    if (i === 6) return 0.73;
    if (i === 11) return 1;
    return 0.78 + (i - 7) * 0.055;
  }

  function buildMap(d) {
    const svg = s('svg', { viewBox: '0 0 360 190', role: 'img', 'aria-label': 'Route map from China to your door' });
    const D = 'M 30 150 C 70 30, 150 20, 210 78 S 300 150, 332 52';
    const base = s('path', { d: D, class: 'base' });
    const done = s('path', { d: D, class: 'done' });
    const mask = s('mask', { id: 'progmask', maskUnits: 'userSpaceOnUse', x: 0, y: -20, width: 360, height: 230 });
    const maskPath = s('path', { d: D, fill: 'none', stroke: '#fff', 'stroke-width': 14 });
    mask.append(maskPath);
    done.setAttribute('mask', 'url(#progmask)');
    svg.append(mask, base, done);
    document.body.append(svg); // temporary, so we can measure the path
    const len = base.getTotalLength();
    document.body.removeChild(svg);

    const pos = routePosition(d);
    maskPath.setAttribute('stroke-dasharray', pos * len + ' ' + (len + 50));

    const at = (t) => base.getPointAtLength(t * len);
    const nodes = [
      { t: 0, label: 'CHINA', reached: d.currentIndex >= 0 },
      { t: 0.7, label: 'LAGOS', reached: d.currentIndex >= 5 },
      { t: 1, label: 'YOU', reached: d.currentIndex >= 11 },
    ];
    nodes.forEach((n) => {
      const p = at(n.t);
      svg.append(s('circle', { cx: p.x, cy: p.y, r: 8, class: 'node' + (n.reached ? ' reached' : '') }));
      const lab = s('text', { x: p.x, y: p.y + 26, class: 'nodelabel' });
      lab.textContent = n.label;
      svg.append(lab);
    });
    if (d.currentIndex !== 4) { // while the ship is at sea, the caption below says it already
      const sea = at(0.36);
      const seaLab = s('text', { x: sea.x, y: sea.y - 16, class: 'nodelabel' });
      seaLab.textContent = 'AT SEA';
      svg.append(seaLab);
    }

    const m = at(pos);
    if (d.currentIndex < 11) svg.append(s('circle', { cx: m.x, cy: m.y, r: 11, class: 'pulse' }));
    svg.append(s('circle', { cx: m.x, cy: m.y, r: 9, class: 'marker' }));
    return svg;
  }

  function render(d) {
    const cur = d.currentIndex >= 0 ? d.stages[d.currentIndex] : null;
    const total = d.stages.length;
    const status = h('div', { class: 'status' });
    status.append(h('div', { class: 'label' }, 'RIGHT NOW', h('span', { class: 'step-count' }, cur ? 'Step ' + (d.currentIndex + 1) + ' of ' + total : '')));
    if (cur) {
      status.append(h('h2', { text: cur.title }), h('p', { text: cur.desc }));
      if (cur.note) status.append(h('div', { class: 'note', text: cur.note }));
      status.append(h('div', { class: 'since', text: cur.inLabel + ' ' + fmt(cur.at) }));
    } else {
      status.append(h('h2', { text: 'Getting started' }), h('p', { text: 'We have your order. The first update will appear here soon.' }));
    }
    const w = windowText(d.batch);
    if (w) status.append(h('span', { class: 'pill', text: 'Expected delivery: ' + w }));

    // map + sea counter
    const mapCard = h('div', { class: 'card map' }, buildMap(d));
    const sea = d.stages[4];
    let mt = null;
    if (sea.status === 'current') {
      const day = Math.floor((Date.now() - new Date(sea.at).getTime()) / DAY) + 1;
      let extra = '';
      if (d.batch.lagosEta) {
        const left = Math.ceil((new Date(d.batch.lagosEta + 'T12:00:00Z').getTime() - Date.now()) / DAY);
        extra = left > 0 ? ' · about ' + left + ' day' + (left === 1 ? '' : 's') + ' to Lagos' : ' · arriving in Lagos any day now';
      }
      mt = h('p', { class: 'maptext' }, h('strong', { text: 'Day ' + day + ' at sea' }), extra);
    } else if (cur && d.currentIndex < 4) {
      mt = h('p', { class: 'maptext' }, h('strong', { text: 'Getting ready in China' }), ' · the ship is next');
    } else if (cur && d.currentIndex >= 5 && d.currentIndex < 11) {
      mt = h('p', { class: 'maptext' }, h('strong', { text: 'Landed in Nigeria' }), ' · the final stretch');
    } else if (d.currentIndex === 11) {
      mt = h('p', { class: 'maptext' }, h('strong', { text: 'Delivered' }), ' · enjoy');
    }
    if (mt) mapCard.append(mt);

    // timeline
    const tl = h('div', { class: 'card' }, h('h3', { text: 'Your journey', style: 'font-size:22px;margin-bottom:16px' }));
    let list = null, lastPhase = null;
    d.stages.forEach((st, i) => {
      if (st.phase !== lastPhase) {
        if (list && list.lastChild) list.lastChild.classList.add('endphase');
        tl.append(h('div', { class: 'phase', text: st.phase }));
        list = h('ul', { class: 'tl' });
        tl.append(list);
        lastPhase = st.phase;
      }
      const li = h('li', { class: st.status },
        h('span', { class: 'dot' }, st.status === 'done' ? '✓' : ''),
        h('div', { class: 't', text: st.title })
      );
      if (st.at) {
        let when = st.inLabel + ' ' + fmt(st.at);
        if (st.leftAt && st.outLabel) when += '  ·  ' + st.outLabel + ' ' + fmt(st.leftAt);
        li.append(h('div', { class: 'when', text: when }));
      }
      if (st.status === 'current') li.append(h('div', { class: 'desc', text: st.desc }));
      if (st.note && st.status !== 'current') li.append(h('div', { class: 'note', text: st.note }));
      list.append(li);
    });

    const parts = [
      h('p', { class: 'batchline', text: d.batch.name }),
      status, mapCard, tl,
    ];
    if (d.items) parts.push(h('div', { class: 'card items' }, h('h3', { text: 'In your order', style: 'font-size:20px;margin-bottom:8px' }), h('div', { text: d.items })));
    const wa = 'https://wa.me/' + d.whatsapp + '?text=' + encodeURIComponent('Hi, I have a question about my order ' + d.orderId);
    parts.push(h('div', { class: 'foot' },
      d.updatedAt ? h('div', { text: 'Last update: ' + fmt(d.updatedAt) }) : null,
      h('div', { text: 'Questions? We are one message away.' }),
      h('a', { class: 'btn gold', href: wa, target: '_blank', rel: 'noopener' }, 'Chat with us on WhatsApp'),
      h('div', null, h('button', { class: 'btn ghost small', type: 'button', id: 'again', style: 'margin-top:12px' }, 'Track another order'))
    ));
    result.replaceChildren(h('h1', { class: 'greet', text: 'Hi ' + d.firstName + ',' }), ...parts);
    $('again').addEventListener('click', reset);
  }

  async function fetchOrder(id, pin) {
    const r = await fetch('/api/track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pin }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }
  function reset() {
    creds = null;
    clearInterval(timer);
    result.classList.add('hidden');
    result.replaceChildren();
    lookup.classList.remove('hidden');
    form.reset();
    err.textContent = '';
    window.scrollTo(0, 0);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    err.style.color = '';
    go.disabled = true;
    go.textContent = 'Checking…';
    // On a free host the system can be asleep. Say so, instead of looking frozen.
    const slow = setTimeout(() => {
      err.style.color = 'var(--muted)';
      err.textContent = 'Still checking. The tracker may have been asleep, thanks for waiting…';
    }, 4000);
    try {
      const id = $('id').value, pin = $('pin').value;
      const d = await fetchOrder(id, pin);
      creds = { id, pin }; // kept only in memory, never saved in the browser
      clearTimeout(slow);
      err.textContent = '';
      lookup.classList.add('hidden');
      result.classList.remove('hidden');
      render(d);
      window.scrollTo(0, 0);
      clearInterval(timer);
      timer = setInterval(async () => {
        try { render(await fetchOrder(creds.id, creds.pin)); } catch (e2) { /* keep showing what we have */ }
      }, 5 * 60 * 1000);
    } catch (ex) {
      clearTimeout(slow);
      err.style.color = '';
      err.textContent = ex.message;
    } finally {
      clearTimeout(slow);
      go.disabled = false;
      go.textContent = 'Track my order →';
      $('pin').value = '';
    }
  });
})();
