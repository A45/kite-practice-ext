/* Kite chain ki har strike cell me chhote FAKE B/S buttons (Shadow DOM).
   Clicks yahin rok diye jaate hain taaki Kite ka apna row click / order window kabhi na khule. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const STOP = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart', 'touchend', 'keydown'];
const CSS = `:host{all:initial;display:inline-block;vertical-align:middle;margin:0 8px}
.w{display:inline-flex;gap:6px;align-items:center;font:600 10px/1 -apple-system,Segoe UI,Roboto,sans-serif}
.g{display:inline-flex;gap:2px;align-items:center}
.g i{font-style:normal;color:#8a8f98;margin-right:1px}
button{all:unset;cursor:pointer;padding:2px 5px;border-radius:3px;color:#fff;opacity:.9}
button:hover{opacity:1}.b{background:#387ed1}.s{background:#f05c2c}
.q{padding:1px 4px;border-radius:3px;background:#fff3cd;color:#7a5b00}`;

let sheet = null;                                              // sab buttons ke liye ek hi constructable stylesheet (CSP-safe)
function style(sh) {
  try { if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); } sh.adoptedStyleSheets = [sheet]; }
  catch (e) { const st = document.createElement('style'); st.textContent = CSS; sh.prepend(st); }
}

/* ek type (CE / PE) ka host: CE Call LTP cell ke shuru me (price right-aligned, buttons uske left), PE Put LTP cell ke end me */
function ensure(cell, type, K, onClick) {
  let host = cell.querySelector(':scope > [data-kp-host="' + type + '"]');
  if (!host) {
    host = document.createElement('span'); host.setAttribute('data-kp-host', type); host.dataset.k = K;
    const sh = host.attachShadow({ mode: 'open' }), lab = type === 'CE' ? 'C' : 'P', nm = type === 'CE' ? 'call' : 'put';
    const q = '<span class="q" data-q="' + type + '" hidden></span>';
    sh.innerHTML = '<div class="w"><span class="g">' + (type === 'PE' ? q : '') + '<i>' + lab + '</i><button class="b" data-o="' + type + '|BUY" title="Fake BUY ' + nm + ' (paper)">B</button><button class="s" data-o="' + type + '|SELL" title="Fake SELL ' + nm + ' (paper)">S</button>' + (type === 'CE' ? q : '') + '</span></div>';
    style(sh);
    STOP.forEach(ev => host.addEventListener(ev, e => {
      e.stopPropagation(); e.stopImmediatePropagation();
      if (ev === 'click') { e.preventDefault(); const b = e.composedPath()[0].closest && e.composedPath()[0].closest('button'); if (b) { const [t, side] = b.dataset.o.split('|'); onClick(t, +host.dataset.k, side); } }
    }, true));
    if (type === 'CE') cell.prepend(host); else cell.appendChild(host);
  }
  host.dataset.k = K;
  return host;
}
/* rowEls: chainReader.read() se; onClick(type,K,side); qtyOf(type,K) → lots (fake position) */
function sync(rowEls, onClick, qtyOf) {
  for (const { K, callCell, putCell } of rowEls) {
    for (const [type, cell] of [['CE', callCell], ['PE', putCell]]) {
      if (!cell) continue;
      const host = ensure(cell, type, K, onClick), q = host.shadowRoot.querySelector('[data-q="' + type + '"]'), l = qtyOf(type, K);
      q.hidden = !l; q.textContent = l ? (l > 0 ? '+' : '') + l + 'L' : '';
    }
  }
}
function removeAll() { document.querySelectorAll('[data-kp-host]').forEach(h => h.remove()); }

KP.kite = Object.assign(KP.kite || {}, { syncButtons: sync, removeButtons: removeAll });
})();
