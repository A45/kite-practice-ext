/* Demo feed: Kite na ho / market band ho / coach practice. Spot random walk, prices BS + smile se.
   mode 'free' = asli ghadi, hamesha chalta. mode 'day' = nakli din 09:10 IST se shuru, ghadi speed× tez,
   regime (range / up / down / volatile / random-secret) se din ka mizaaj. Push/IV buttons se alerts trigger kar sakte ho. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const IST = 5.5 * 3600e3, REGIMES = ['range', 'up', 'down', 'volatile'];

/* aaj (ya weekend ho to pichhla Friday) 09:10 IST, UTC ms me */
function dayStart(ms) {
  let d = new Date(ms + IST); d = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  while ([0, 6].includes(new Date(d).getUTCDay())) d -= 864e5;
  return d + (9 * 60 + 10) * 60e3 - IST;
}

class DemoFeed {
  constructor(onSnap, { spot = 25000, iv = 13, speed = 60, expiry, mode = 'free', regime = 'random' } = {}) {
    Object.assign(this, { onSnap, spot, iv, speed, mode, ivShock: 0, pending: 0, timer: null });
    this.secret = regime === 'random';
    this.regime = this.secret ? REGIMES[Math.floor(Math.random() * REGIMES.length)] : regime;
    if (mode === 'day') {
      this.sim0 = dayStart(Date.now()); this.real0 = Date.now(); this.lastReal = this.real0;
      this.prevClose = spot; this.vix0 = iv; this.opened = false;
      this.expiry = KP.nextWeekday(this.sim0, 2);
    } else this.expiry = expiry;
  }
  /* sim ghadi (day mode me 15:35 IST par ruk jaati hai) */
  now() {
    if (this.mode !== 'day') return Date.now();
    return Math.min(this.sim0 + (Date.now() - this.real0) * this.speed, this.sim0 + (6 * 60 + 25) * 60e3);
  }
  setSpeed(s) { if (this.mode === 'day') { this.sim0 = this.now(); this.real0 = Date.now(); } this.speed = s; }
  start() { if (this.timer) return; this.emit(); this.timer = setInterval(() => { this.step(1); this.emit(); }, 1000); }
  stop() { clearInterval(this.timer); this.timer = null; }
  get running() { return !!this.timer; }
  em() { return this.spot * (this.iv / 100) / Math.sqrt(365); }
  step(dt) {
    const sigSec = this.spot * (this.iv / 100) / Math.sqrt(252 * 22500);         // 1 trading-sec ka 1σ
    let simSec = dt * this.speed, mv = 0;
    if (this.mode === 'day') {
      const m = KP.istMin(this.now());
      if (m < 555 || m >= 930) { this.settle(); return; }
      if (!this.opened) this.openGap();
      const r = this.regime, early = m < 570, vm = (r === 'volatile' ? (m < 615 ? 2.0 : 1.6) : r === 'range' ? 0.8 : 1.0) * (early ? 1.3 : 1);
      mv = sigSec * vm * Math.sqrt(simSec) * gauss();
      if (r === 'range') mv -= (this.spot - this.anchor) * Math.min(1, simSec / 2400);
      if ((r === 'up' || r === 'down') && m >= 570) mv += (r === 'up' ? 1 : -1) * 1.2 * this.em() / (360 * 60) * simSec;
      if (r === 'volatile' && Math.random() < 0.004 * simSec / 60) mv += gauss() * this.em() * 0.4;   // beech-beech me jhatke
      this.iv = Math.max(6, this.iv + (r === 'volatile' ? 0.25 : r === 'range' ? -0.08 : 0) * simSec / 3600);
    } else mv = sigSec * Math.sqrt(simSec) * gauss();
    if (this.pending) { const take = this.pending * 0.12; mv += take; this.pending -= take; if (Math.abs(this.pending) < 0.5) this.pending = 0; }
    this.spot = Math.max(1000, this.spot + mv);
    this.ivShock *= 0.995;
  }
  openGap() {
    const g = { range: gauss() * 0.12, up: 0.2 + Math.random() * 0.4, down: -(0.2 + Math.random() * 0.4), volatile: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6) }[this.regime];
    this.spot = this.prevClose * (1 + g / 100); this.anchor = this.spot; this.opened = true;
    if (this.regime === 'volatile') this.iv += 2;
  }
  settle() { /* market band: price ruka rehta hai */ }
  push(pts) { this.pending += pts; }
  shockIV(p) { this.ivShock += p; }
  ivFor(K) { const m = (K - this.spot) / this.spot; return Math.max(4, (this.iv + this.ivShock) * (1 - 1.2 * m + 6 * m * m)) / 100; }
  snapshot() {
    const now = this.now(), T = Math.max(1e-7, (KP.expiryCloseMs(this.expiry) - now) / KP.YEAR_MS), c = Math.round(this.spot / 50) * 50, rows = [];
    // demo OI (lakh) + din ki shuruaat se LTP / OI change %. Sirf practice ke liye, asli nahi:
    // OTM par price gire to sellers likhte hain (short buildup), price chadhe to bhaagte hain (covering);
    // ITM/ATM par price chadhe to buyers judte hain (long buildup), gire to nikalte hain (unwinding).
    const o0 = this.oiBase || (this.oiBase = c), p0 = this.p0 || (this.p0 = {});
    const tf = this.mode === 'day' ? Math.max(0, Math.min(1, (KP.istMin(now) - 555) / 375)) : 0.5;
    const baseOI = (K, ce) => { const d = (K - o0) / 50, side = ce ? Math.max(0, d) : Math.max(0, -d), r = K % 100 === 0 ? 1.6 : 1;
      return r * (8 + 60 * Math.exp(-((side - 6) ** 2) / 30) + 10 * Math.exp(-(d * d) / 8)) * (ce ? 1 : 1.1); };
    const opt = (type, K, v) => {
      const ltp = Math.max(0.05, KP.r05(KP.bs(type, this.spot, K, T, v).p)), k = K + type;
      if (!p0[k]) p0[k] = ltp;
      const pc = (ltp / p0[k] - 1) * 100, otm = type === 'CE' ? K > this.spot : K < this.spot;
      const oc = 10 * tf + Math.max(-60, Math.min(60, (otm ? -0.45 : 0.35) * pc)) + 3 * Math.sin(K / 37 + (type === 'CE' ? 1 : 2));
      return { ltp, ltpChg: +pc.toFixed(2), oi: +(baseOI(K, type === 'CE') * (1 + oc / 100)).toFixed(2), oiChg: +oc.toFixed(2) };
    };
    for (let i = -25; i <= 25; i++) {
      const K = c + i * 50, v = this.ivFor(K);
      rows.push({ K, ce: opt('CE', K, v), pe: opt('PE', K, v) });
    }
    const snap = { source: 'demo', spot: this.spot, expiry: this.expiry, rows };
    if (this.mode === 'day') {
      const vx = this.iv + this.ivShock; snap.prevClose = this.prevClose;
      if (!this.prevHL) { const a = 0.004 + Math.random() * 0.004, b = 0.004 + Math.random() * 0.004; this.prevHL = [this.prevClose * (1 + a), this.prevClose * (1 - b)].map(x => Math.round(x * 20) / 20); }
      snap.prevHigh = this.prevHL[0]; snap.prevLow = this.prevHL[1]; snap.vix = { v: vx, chg: (vx - this.vix0) / this.vix0 * 100, src: 'demo' }; }
    return snap;
  }
  emit() { this.onSnap(this.snapshot()); }
}
KP.DemoFeed = DemoFeed;
KP.DemoFeed.dayStart = dayStart;
})();
