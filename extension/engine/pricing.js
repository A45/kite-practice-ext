/* Pricing: Black-Scholes (artifact se port) + live Market model.
   Underlying = put-call parity se nikla forward (F = K + C − P), isliye RATE = 0 (Black-76 jaisa).
   Index spot nahi, forward use karna options ke saath consistent rehta hai. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};

const RATE = 0;
const YEAR_MS = 365 * 864e5;
const IST_MS = 5.5 * 3600e3;

function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
const npdf = x => Math.exp(-x * x / 2) / 2.5066283;
function bs(type, S, K, T, v) {
  if (T <= 1e-7 || v <= 0) return { p: Math.max(0, type === 'CE' ? S - K : K - S), d: type === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0) };
  const sq = v * Math.sqrt(T), d1 = (Math.log(S / K) + (RATE + v * v / 2) * T) / sq, d2 = d1 - sq;
  if (type === 'CE') return { p: S * ncdf(d1) - K * Math.exp(-RATE * T) * ncdf(d2), d: ncdf(d1) };
  return { p: K * Math.exp(-RATE * T) * ncdf(-d2) - S * ncdf(-d1), d: ncdf(d1) - 1 };
}
const r05 = x => Math.round(x * 20) / 20;
const intrinsic = (type, K, S) => Math.max(0, type === 'CE' ? S - K : K - S);

/* LTP se IV (bisection). Time value na ho to null. */
function impliedVol(type, price, S, K, T) {
  if (!(price > 0) || !(T > 1e-6)) return null;
  if (price <= intrinsic(type, K, S) + 0.02) return null;
  let lo = 0.005, hi = 3;
  if (bs(type, S, K, T, hi).p < price) return null;
  for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (bs(type, S, K, T, m).p > price) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/* ---------- IST clock ---------- */
const istDate = ms => new Date(ms + IST_MS);                       // UTC getters = IST fields
const istDay = ms => istDate(ms).toISOString().slice(0, 10);       // 'YYYY-MM-DD'
const istMin = ms => { const d = istDate(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const expiryCloseMs = day => Date.parse(day + 'T10:00:00Z');       // 15:30 IST
function isMarketOpen(ms) {                                        // NSE holidays ignore kiye hain
  const wd = istDate(ms).getUTCDay(), m = istMin(ms);
  return wd !== 0 && wd !== 6 && m >= 555 && m < 930;
}
/* Aaj ke baad expiry tak kitne trading din (weekday) bache. Expiry day = 0. */
function tradingDaysTo(ms, expiryDay) {
  let n = 0, d = Date.parse(istDay(ms) + 'T00:00:00Z');
  const e = Date.parse(expiryDay + 'T00:00:00Z');
  while (d < e) { d += 864e5; const wd = new Date(d).getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
  return n;
}
/* NIFTY weekly expiry = Tuesday. Agar aaj Tuesday aur 15:30 ke pehle, to aaj. */
function nextWeekday(ms, wd) {
  let d = istDate(ms);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (let i = 0; i < 8; i++) {
    const t = today + i * 864e5;
    if (new Date(t).getUTCDay() === wd && expiryCloseMs(new Date(t).toISOString().slice(0, 10)) > ms) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/* ---------- Market: ek expiry ki live chain ---------- */
class Market {
  constructor() {
    this.spot = null; this.fwd = null; this.rows = new Map(); this.expiry = null;
    this.step = 50; this.ts = 0; this.source = 'none'; this.clock = null; this._iv = null; this.lastAtmIV = 13;
  }
  now() { return this.clock ? this.clock() : Date.now(); }
  /* snap = {spot?, expiry?, source, rows:[{K, ce:{ltp, iv?}, pe:{ltp, iv?}}]} ; iv in % */
  update(snap) {
    const rows = new Map();
    for (const r of snap.rows || []) if (Number.isFinite(r.K)) rows.set(r.K, r);
    this.rows = rows;
    const ks = [...rows.keys()].sort((a, b) => a - b);
    let step = Infinity; for (let i = 1; i < ks.length; i++) step = Math.min(step, ks[i] - ks[i - 1]);
    if (Number.isFinite(step) && step > 0) this.step = step;
    if (snap.expiry) this.expiry = snap.expiry;
    if (snap.spot > 0) this.spot = snap.spot;
    // parity forward: |C−P| sabse kam wali strike par
    let best = null;
    for (const [K, r] of rows) {
      const c = r.ce && r.ce.ltp, p = r.pe && r.pe.ltp;
      if (c > 0 && p > 0 && (!best || Math.abs(c - p) < best.gap)) best = { gap: Math.abs(c - p), F: K + c - p };
    }
    this.fwd = best ? best.F : this.spot;
    if (!this.spot) this.spot = this.fwd;
    this.source = snap.source || 'kite'; this.ts = this.now(); this._iv = null;
    const a = this.atmIV(); if (a) this.lastAtmIV = a;
  }
  get ready() { return this.S > 0 && !!this.expiry && this.rows.size > 0; }
  get S() { return this.fwd || this.spot || 0; }
  T(at) { return Math.max(1e-7, (expiryCloseMs(this.expiry) - (at ?? this.now())) / YEAR_MS); }
  dte() { return this.expiry ? tradingDaysTo(this.now(), this.expiry) : 99; }
  atm() { return Math.round(this.S / this.step) * this.step; }
  /* smile: har strike ka OTM side ka IV (Kite ka diya ho to wahi, warna LTP se) */
  smile() {
    if (this._iv) return this._iv;
    const S = this.S, T = this.T(), pts = [];
    for (const [K, r] of this.rows) {
      const side = K >= S ? 'ce' : 'pe', o = r[side];
      if (!o) continue;
      let v = o.iv > 0 ? o.iv / 100 : impliedVol(side === 'ce' ? 'CE' : 'PE', o.ltp, S, K, T);
      if (v && v > 0.01 && v < 2.5) pts.push([K, v]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    return (this._iv = pts);
  }
  ivFor(K) {
    const p = this.smile();
    if (!p.length) return (this.lastAtmIV || 13) / 100;
    if (K <= p[0][0]) return p[0][1];
    if (K >= p[p.length - 1][0]) return p[p.length - 1][1];
    for (let i = 1; i < p.length; i++) if (K <= p[i][0]) { const [k0, v0] = p[i - 1], [k1, v1] = p[i]; return v0 + (v1 - v0) * (K - k0) / (k1 - k0); }
    return p[p.length - 1][1];
  }
  atmIV() { return this.S ? this.ivFor(this.S) * 100 : null; }       // %
  price(type, K, S, T, bump) { return bs(type, S ?? this.S, K, T ?? this.T(), this.ivFor(K) + (bump || 0)); }
  live(type, K) { const r = this.rows.get(K), o = r && r[type === 'CE' ? 'ce' : 'pe']; return o && o.ltp > 0 ? o.ltp : null; }
  /* ITM option ka fair price, usi strike ke (liquid) OTM option se put-call parity: C = P + (F − K), P = C + (K − F) */
  parity(type, K) {
    const F = this.S; if (!(F > 0)) return null;
    if (type === 'CE' ? K >= F : K <= F) return null;                 // sirf ITM side
    const other = this.live(type === 'CE' ? 'PE' : 'CE', K); if (other == null) return null;
    return r05(Math.max(intrinsic(type, K, F), other + (type === 'CE' ? F - K : K - F)));
  }
  /* Kite LTP purana (illiquid deep ITM, aaj trade nahi hua): parity se 3% / 2 pts se zyada alag */
  stale(type, K) { const v = this.live(type, K), p = v == null ? null : this.parity(type, K); return p != null && Math.abs(v - p) > Math.max(2, 0.03 * p); }
  ltp(type, K) {
    const v = this.live(type, K);
    if (v == null) return Math.max(0.05, r05(this.price(type, K).p));
    return this.stale(type, K) ? this.parity(type, K) : v;
  }
  strikes() { return [...this.rows.keys()].sort((a, b) => a - b); }
  /* chain UI: OI (lakh) + OI change %, us option ka IV (%: Kite ka, warna LTP se nikala), moneyness */
  oi(type, K) { const r = this.rows.get(K), o = r && r[type === 'CE' ? 'ce' : 'pe']; return o && o.oi != null ? { oi: o.oi, chg: o.oiChg ?? null } : null; }
  ivOf(type, K) {
    const r = this.rows.get(K), o = r && r[type === 'CE' ? 'ce' : 'pe'];
    if (o && o.iv > 0) return o.iv;
    const l = this.live(type, K); if (l == null || !this.S) return null;
    const v = impliedVol(type, l, this.S, K, this.T()); return v && v > 0.005 && v < 3 ? v * 100 : null;
  }
  ltpChg(type, K) { const r = this.rows.get(K), o = r && r[type === 'CE' ? 'ce' : 'pe']; return o && o.ltpChg != null ? o.ltpChg : null; }
  moneyness(type, K) { const a = this.atm(); return K === a ? 'ATM' : (type === 'CE' ? K < a : K > a) ? 'ITM' : 'OTM'; }
}

/* OI + price → kaun position bana raha hai. pc = LTP change %, oc = OI change %. Dono me se koi |x| < th (%) ho to saaf signal nahi (null). */
const BUILDUP = {
  long: { e: '🟢', name: 'Long buildup', who: 'Naye buyers', why: 'Price ⬆ + OI ⬆: naye BUYERS aa rahe hain, us option ko khareed rahe hain.' },
  short: { e: '🔴', name: 'Short buildup', who: 'Naye sellers', why: 'Price ⬇ + OI ⬆: naye SELLERS aa rahe hain, option likh (bech) rahe hain.' },
  cover: { e: '🔵', name: 'Short covering', who: 'Sellers bhaag rahe', why: 'Price ⬆ + OI ⬇: purane sellers apni position kaat rahe hain (buy-back).' },
  unwind: { e: '⚪', name: 'Long unwinding', who: 'Buyers nikal rahe', why: 'Price ⬇ + OI ⬇: purane buyers bahar nikal rahe hain.' }
};
function buildup(pc, oc, th = 1) {
  if (pc == null || oc == null || !isFinite(pc) || !isFinite(oc) || Math.abs(pc) < th || Math.abs(oc) < th) return null;
  const id = pc > 0 ? (oc > 0 ? 'long' : 'cover') : (oc > 0 ? 'short' : 'unwind');
  return Object.assign({ id }, BUILDUP[id]);
}

Object.assign(KP, { BUILDUP, buildup, RATE, YEAR_MS, ncdf, npdf, bs, r05, intrinsic, impliedVol, Market,
  istDay, istMin, expiryCloseMs, isMarketOpen, tradingDaysTo, nextWeekday });
})();
