/* Paper book: fake orders aur positions. Asli Kite order kabhi nahi lagta. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};

const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const f2 = n => nf2.format(n);
const rs = n => (n < 0 ? '−₹' : '₹') + nf0.format(Math.abs(Math.round(n)));
const rsS = n => (n > 0 ? '+' : '') + rs(n);
const cls = n => n > 0.5 ? 'pos' : (n < -0.5 ? 'neg' : '');
KP.fmt = { nf0, nf2, f2, rs, rsS, cls };

const BROKERAGE = 20;
const keyOf = (type, K) => K + type;
const instName = (type, K) => 'NIFTY ' + K + ' ' + type;

function newBook() { return { pos: {}, orders: [], charges: 0, booked: 0, expiry: null }; }

/* side: 'BUY' | 'SELL'; px = fill price (live LTP). Returns px. */
function trade(book, { type, K, lots, side, lot, px, t }) {
  const units = lots * lot * (side === 'BUY' ? 1 : -1), k = keyOf(type, K);
  const p = book.pos[k] || (book.pos[k] = { type, K, qty: 0, avg: 0, real: 0 });
  const q = p.qty;
  if (q === 0 || Math.sign(q) === Math.sign(units)) {
    p.avg = (Math.abs(q) * p.avg + Math.abs(units) * px) / (Math.abs(q) + Math.abs(units)); p.qty = q + units;
  } else {
    const close = Math.min(Math.abs(q), Math.abs(units)); p.real += close * (px - p.avg) * Math.sign(q);
    const rem = Math.abs(units) - close; p.qty = q + units;
    if (p.qty === 0) p.avg = 0; else if (rem > 0) p.avg = px;
  }
  book.charges += BROKERAGE;
  const o = { t: t || Date.now(), inst: instName(type, K), type, K, side, qty: Math.abs(units), px };
  book.orders.unshift(o);
  if (book.orders.length > 500) book.orders.length = 500;
  return o;
}
const openLegs = book => Object.values(book.pos).filter(p => p.qty !== 0);
const realSum = book => Object.values(book.pos).reduce((s, p) => s + p.real, 0);
/* poori series ka P&L: booked + realised + open MTM − charges */
function total(book, mkt) {
  let t = book.booked - book.charges;
  for (const p of Object.values(book.pos)) t += p.real + (p.qty ? p.qty * (mkt.ltp(p.type, p.K) - p.avg) : 0);
  return t;
}
/* expiry par intrinsic se settle. Returns settled legs. */
function settle(book, S, t) {
  const out = [];
  for (const p of Object.values(book.pos)) {
    if (p.qty !== 0) {
      const px = KP.intrinsic(p.type, p.K, S); p.real += p.qty * (px - p.avg);
      book.orders.unshift({ t: t || Date.now(), inst: instName(p.type, p.K), type: p.type, K: p.K, side: 'EXP', qty: Math.abs(p.qty), px });
      out.push({ type: p.type, K: p.K, qty: p.qty, px }); p.qty = 0;
    }
    book.booked += p.real;
  }
  book.pos = {};
  return out;
}

Object.assign(KP, { BROKERAGE, keyOf, instName, book: { newBook, trade, openLegs, realSum, total, settle } });
})();
