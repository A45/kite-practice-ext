/* Controller: state + storage, feed (Kite DOM / Demo), fake trading, morning plan, SL/target, coach loop, expiry settle, events.
   HARD RULE: koi asli order nahi, Kite ke buttons/session ko touch nahi. */
(function () {
'use strict';
const KP = globalThis.KP;
const { book: B, an: A, coach: C, opts: O, morning: M, risk: RK, day: D, fmt: { rs, rsS } } = KP;
const STORE = 'kp_state', STALE_MS = 10000, SNAP_EVERY = 60e3;

const newDayState = () => ({ day: null, pick: null, manual: {} });
function defaults() {
  return { v: 1, book: B.newBook(), coach: C.defaultCoach(),
    cfg: { feed: 'kite', lot: 65, lots: 1, expiry: '', demoSpeed: 60, demoMode: 'day', demoRegime: 'random', yahooBackup: false,
      ic: { mode: 'pts', dist: 300, delta: 0.15, wing: 200, lots: 1 }, morning: M.defaultMorning(), risk: RK.defaultRisk(), pa: { alerts: true }, oishift: { alerts: true, info: true } },
    days: { kite: newDayState(), demo: newDayState() }, trade: null, trades: [], journal: [], legSL: {}, pending: [],
    lastSpot: null, ui: { collapsed: false, tab: 'plan' } };
}

class App {
  constructor() {
    this.mkt = new KP.Market(); this.S = defaults(); this.kiteSeen = 0; this.kiteFound = false; this.vix = null; this.menu = null;
    this.lastEv = null; this.lastOpts = null; this.demo = null; this.panel = null; this.saveT = null; this.lastSnapEvt = 0; this.readT = 0;
  }
  async init() {
    try {
      const got = await chrome.storage.local.get(STORE), s = got && got[STORE];
      if (s && s.v === 1) {
        const d = defaults(), c = s.cfg || {};
        this.S = Object.assign(d, s, { cfg: Object.assign(d.cfg, c, { ic: Object.assign(d.cfg.ic, c.ic), morning: Object.assign(d.cfg.morning, c.morning), risk: Object.assign(d.cfg.risk, c.risk) }),
          days: Object.assign(d.days, s.days) });
        this.S.coach.rules = Object.assign(C.defaultCoach().rules, this.S.coach.rules);
        // purane save ke positional leg % (100/50) → intraday defaults
        if (this.S.cfg.risk.legPctV !== 2) Object.assign(this.S.cfg.risk, RK.LEG_PCT, { legPctV: 2 });
      }
    } catch (e) { /* storage na mile to defaults */ }
    // Har page load par Kite live. Demo sirf us session ke liye (purana Demo save hua ho to bhi nakli prices se shuru na ho)
    this.S.cfg.feed = 'kite';
    this.panel = new KP.Panel(this); this.panel.mount();
    // Kite Connect login complete (background ne token bana liya) → status + candles turant
    try { chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'kp-kc-done') { this.panel.showKCResult(m.r || { ok: false, error: 'jawab nahi mila' }); this.panel.loadKC(); if (m.r && m.r.ok) this.syncIntraday(true); } }); } catch (e) {}
    this.startFeed();
    new MutationObserver(() => this.kiteReadSoon()).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    setInterval(() => this.loop(), 2000);
    this.checkExpiry();
  }

  /* ---------- helpers ---------- */
  get lot() { return this.S.cfg.lot; }
  now() { return this.mkt.now(); }
  ctx() { return { mkt: this.mkt, book: this.S.book, coach: this.S.coach, lot: this.lot, planKind: this.S.trade ? this.S.trade.kind : null }; }
  legs() { return B.openLegs(this.S.book); }
  save() { clearTimeout(this.saveT); this.saveT = setTimeout(() => { try { chrome.storage.local.set({ [STORE]: this.S }); } catch (e) {} }, 600); }
  emit(kind, payload) { try { chrome.runtime.sendMessage({ type: 'kp-event', ev: { ts: new Date(this.now()).toISOString(), kind, payload } }); } catch (e) {} }
  lotsOf(type, K) { const p = this.S.book.pos[KP.keyOf(type, K)]; return p && p.qty ? +(p.qty / this.lot).toFixed(1) : 0; }
  sameSeries() { return !this.S.book.expiry || this.S.book.expiry === this.mkt.expiry; }
  expiryDefault() { return this.S.cfg.expiry || KP.nextWeekday(Date.now(), 2); }
  fresh() { return this.S.cfg.feed === 'demo' ? !!(this.demo && this.demo.running) : Date.now() - this.kiteSeen < STALE_MS; }
  /* time rules (9:30 block etc.) Kite par aur Demo din me; free demo me nahi */
  /* Buildup ke liye fallback: Kite chain me LTP / OI change % na dikhe to aaj pehli baar dekhi value se compare (9:15 ke baad, per feed + expiry) */
  recordChainBase(snap) {
    const now = this.now(); if (this.timeRules() && KP.istMin(now) < 555) return;
    const id = KP.istDay(now) + '|' + (snap.source || '') + '|' + (this.mkt.expiry || '');
    let b = this.chainBase; if (!b || b.id !== id) b = this.chainBase = { id, m: {} };
    for (const r of snap.rows || []) for (const [s, T] of [['ce', 'CE'], ['pe', 'PE']]) {
      const o = r[s], k = r.K + T; if (o && o.ltp > 0 && !b.m[k]) b.m[k] = { ltp: o.ltp, oi: o.oi ?? null, t: KP.istMin(now) };
    }
  }
  /* strike ka buildup: Kite ka change % (kal se) ho to wahi, warna aaj ki baseline se */
  buildupOf(type, K) {
    const mkt = this.mkt, o = mkt.oi(type, K), b = this.chainBase && this.chainBase.m[K + type], ltp = mkt.live(type, K);
    let pc = mkt.ltpChg(type, K), oc = o ? o.chg : null, src = 'kite';
    if (pc == null && b && ltp != null) { pc = (ltp / b.ltp - 1) * 100; src = 'aaj'; }
    if (oc == null && b && b.oi > 0 && o) { oc = (o.oi / b.oi - 1) * 100; src = 'aaj'; }
    const r = KP.buildup(pc, oc); if (!r) return null;
    // asli size: kitne lakh contracts jude / ghate (OI ÷ (1 + change%) = pehle ka OI)
    const dOI = o && o.oi > 0 && oc > -99 ? o.oi - o.oi / (1 + oc / 100) : 0;
    return Object.assign(r, { pc, oc, src, dOI });
  }
  /* strike ka LTP kitna hila: kal ke close se (Kite ka change %) aur aaj open se (9:15 ke baad pehli dekhi price) */
  ltpMove(type, K) {
    const mkt = this.mkt, ltp = mkt.live(type, K); if (ltp == null) return null;
    const pc = mkt.ltpChg(type, K), b = this.chainBase && this.chainBase.m[K + type], out = { ltp };
    if (pc != null && pc > -100) { out.prev = ltp / (1 + pc / 100); out.dPrev = ltp - out.prev; out.pPrev = pc; }
    if (b && b.ltp > 0) { out.open = b.ltp; out.openT = b.t; out.dOpen = ltp - b.ltp; out.pOpen = (ltp / b.ltp - 1) * 100; }
    return out;
  }
  /* chain ke visible strikes (ATM ± 12) par buildup + Top 3 (Long / Short buildup / Short covering, lakh contracts se). Panel aur price action dono yahi use karte hain. */
  buildupTop(ks) {
    const mkt = this.mkt; if (!mkt.ready) return { BU: {}, top: { long: [], short: [], cover: [] }, rank: {} };
    if (!ks) { const a = mkt.atm(); ks = []; for (let i = 12; i >= -12; i--) ks.push(a - i * mkt.step); }
    const BU = {}, top = { long: [], short: [], cover: [] }, rank = {};
    for (const K of ks) for (const T of ['CE', 'PE']) { const b = this.buildupOf(T, K); BU[K + T] = b; if (b && top[b.id]) top[b.id].push({ K, T, b }); }
    for (const id in top) { top[id].sort((x, y) => Math.abs(y.b.dOI) - Math.abs(x.b.dOI)); top[id] = top[id].slice(0, 3); top[id].forEach((x, i) => { rank[x.K + x.T] = i + 1; }); }
    return { BU, top, rank };
  }
  /* Price action: zones (kal ka H/L/C, OR, aaj ka H/L, round, OI levels) + trend + aakhri closed 5-min candle ke patterns */
  paState() {
    const mkt = this.mkt, st = this.D(), day = st.day, now = this.now(), nowMin = KP.istMin(now);
    if (!mkt.ready || !day || day.date !== KP.istDay(now)) return null;
    const S = mkt.S, em = S * (mkt.atmIV() || 13) / 100 / Math.sqrt(365), bt = this.buildupTop(), extra = [];
    const oiLvl = T => { const s = bt.top.short.find(x => x.T === T); if (s) return { px: s.K, tag: T + ' OI 🔴 short buildup', w: 2, kind: 'oi' };
      let best = null; for (const [K, r] of mkt.rows) { const o = r[T === 'CE' ? 'ce' : 'pe']; if (o && o.oi > 0 && (T === 'CE' ? K > S : K < S) && (!best || o.oi > best.oi)) best = { K, oi: o.oi }; }
      return best ? { px: best.K, tag: T + ' max OI', w: 2, kind: 'oi' } : null; };
    for (const T of ['CE', 'PE']) { const l = oiLvl(T); if (l) extra.push(l); }
    const { zones, tol } = KP.pa.levels({ S, day, nowMin, manual: st.manual || {}, em, extra });
    const c5 = D.candles(day, 5).filter(c => c.t + 5 <= nowMin), or = D.or15(day, nowMin, st.manual || {});
    // "Aaj ka High/Low" har candle ke saath khud khisakta hai: ladder me dikhe, patterns me nahi
    const pz = zones.filter(z => !z.tags.every(t => /^Aaj ka/.test(t)));
    const tr = KP.pa.trend(c5, or), pats = KP.pa.patterns(c5, pz, tol);
    // pattern ke zone par OI kya keh raha hai
    const buAt = z => { const out = []; for (const k in bt.BU) { const b = bt.BU[k]; if (!b) continue; const K = parseFloat(k); if (K >= z.lo - tol - mkt.step / 2 && K <= z.hi + tol + mkt.step / 2) out.push({ T: k.slice(-2), id: b.id }); } return out; };
    pats.forEach(p => { p.oi = KP.pa.confirm(p, p.zone ? buAt(p.zone) : null); });
    return { S, zones, tol, trend: tr, c5, bar: c5.length ? c5[c5.length - 1].t : null, pats, nr: KP.pa.nearest(zones, S), at: now };
  }
  /* naya 5-min candle close hua to patterns ka alert (ek pattern ek hi baar) */
  paTick() {
    const pa = this.pa = this.paState(); if (!pa || pa.bar == null) return;
    if (this.paBar === undefined) { this.paBar = pa.bar; this.paRecent = pa.pats.map(p => Object.assign({}, p)); return; }   // panel khulte hi purani candle par alert nahi
    if (pa.bar === this.paBar) return;
    this.paBar = pa.bar;
    const prev = (this.paRecent || []).filter(p => pa.bar - p.t <= 15);
    // same pattern + same level pichhle 15 min me aa chuka = dobara alert nahi
    const fresh = pa.pats.filter(p => !prev.some(r => r.id === p.id && r.dir === p.dir && (r.zone && p.zone ? Math.abs(r.zone.px - p.zone.px) < 1 : !r.zone && !p.zone)));
    this.paRecent = prev.concat(pa.pats);
    this.paLog = (this.paLog || []).concat(fresh.map(p => ({ t: p.t, title: p.title }))).slice(-8);
    if (this.S.cfg.pa && this.S.cfg.pa.alerts === false) return;
    fresh.forEach(p => {
      const lv = (p.id === 'breakout' || p.id === 'breakdown' || p.id === 'fakeout' || (p.id === 'rejection' && p.zone && p.zone.star)) ? 2 : 1;
      this.panel.showPA(p, lv);
      this.emit('alert', { side: 'PA', lv, title: p.title });
    });
  }
  /* OI shift: 5-min candle close par Top-3 Resistance / Support / short covering ka badlaav → seller ke liye decision card */
  oiTick() {
    const pa = this.pa, mkt = this.mkt; if (!pa || pa.bar == null || pa.bar === this.oiBar) return;
    this.oiBar = pa.bar;
    const nowMin = KP.istMin(this.now()); if (this.timeRules() && nowMin < 9 * 60 + 30) return;
    const OS = KP.oishift, bt = this.buildupTop(), cur = OS.snap(bt, mkt.S, mkt.step);
    const r = OS.step(this.oiSt, cur, nowMin); this.oiSt = r.st;
    if (!r.events.length) return;
    const cfg = this.S.cfg.oishift || {}, em = mkt.S * (mkt.atmIV() || 13) / 100 / Math.sqrt(365);
    const ctx = { legs: this.legs(), S: mkt.S, em, step: mkt.step, trend: pa.trend && pa.trend.dir, trendLabel: pa.trend && pa.trend.label, dte: mkt.dte(), nowMin,
      R: r.st.base.R ? r.st.base.R.K : null, Su: r.st.base.Su ? r.st.base.Su.K : null, ltp: (T, K) => mkt.ltp(T, K) };
    for (const e of r.events) {
      const a = OS.advise(e, ctx); e.adv = a;
      this.oiLog = (this.oiLog || []).concat({ t: e.t, title: e.title, mode: a.mode, decision: a.why.slice(1) }).slice(-5);
      if (cfg.alerts === false || (a.mode === 'info' && cfg.info === false)) continue;
      this.panel.showOIShift(e, a);
      this.emit('alert', { side: 'OI', lv: a.lv, title: e.title });
    }
  }
  /* leg SL/target defaults: expiry day par tight SL */
  legRisk() { return RK.effRisk(this.S.cfg.risk, this.mkt.ready && this.mkt.dte() === 0); }
  /* SELL order naked hai? (usi type ka koi BUY hedge khula nahi) */
  isNakedSell(type, side) { return side === 'SELL' && !this.legs().some(l => l.type === type && l.qty > 0); }
  timeRules() { return this.S.cfg.feed === 'kite' || this.S.cfg.demoMode === 'day'; }
  phase() { return this.timeRules() ? M.phase(this.now()) : 'free'; }
  D() { const k = this.S.cfg.feed === 'demo' ? 'demo' : 'kite'; return this.S.days[k] || (this.S.days[k] = newDayState()); }

  /* ---------- feeds ---------- */
  startFeed() {
    if (this.demo) { this.demo.stop(); this.demo = null; }
    this.mkt = new KP.Market(); this.vix = null; this.menu = null; this.pa = null; this.paBar = undefined; this.paRecent = []; this.paLog = []; this.oiSt = null; this.oiBar = undefined; this.oiLog = [];
    const cfg = this.S.cfg;
    if (cfg.feed === 'demo') {
      KP.kite.removeButtons();
      this.demo = new KP.DemoFeed(s => this.onSnap(s), { spot: this.S.lastSpot || 25000, expiry: this.S.book.expiry || this.expiryDefault(), speed: cfg.demoSpeed, mode: cfg.demoMode, regime: cfg.demoRegime });
      this.mkt.clock = () => this.demo.now();
      if (cfg.demoMode === 'day') this.S.days.demo = newDayState();          // har demo din naya
      this.demo.start();
    } else this.kiteRead();
    this.panel.render(true);
  }
  kiteReadSoon() {
    if (this.S.cfg.feed !== 'kite' || this.readT) return;
    this.readT = setTimeout(() => { this.readT = 0; this.kiteRead(); }, 150);       // Kite tick ke ~150ms me padho (pehle 500ms: panel ek tick peeche rehta tha)
  }
  kiteRead() {
    if (this.S.cfg.feed !== 'kite') return;
    let snap = null;
    try { snap = KP.kite.read(Date.now()); } catch (e) { console.warn('[KP] chain read', e); }
    this.kiteFound = !!snap;
    if (!snap) return;
    if (!snap.expiry) { snap.expiry = this.expiryDefault(); snap.expiryGuessed = true; }
    this.kiteSnap = snap; this.kiteSeen = Date.now();
    this.onSnap(snap);
    KP.kite.syncButtons(snap.rowEls, (t, K, s) => this.panel.openTicket(t, K, s), (t, K) => this.lotsOf(t, K));
  }
  onSnap(snap) {
    this.mkt.update(snap);
    this.recordChainBase(snap);
    if (this.sameSeries()) this.S.lastSpot = this.mkt.S;
    if (snap.vix) this.vix = snap.vix;
    this.recordDay(snap);
    if (this.S.ui.tab === 'chain' && !this.S.ui.collapsed) this.panel.renderChainNow(); else this.panel.renderSoon();   // chain tab: Kite ke saath turant
  }
  recordDay(snap) {
    if (this.S.cfg.feed === 'demo' && this.S.cfg.demoMode !== 'day') return;
    const st = this.D(), now = this.now(), today = KP.istDay(now), old = st.day;
    st.day = D.rollover(old, today);
    if (st.day !== old) {
      if (old && st.pick && !st.pick.review) this.doReview(old, st.pick, true);
      st.pick = null; st.manual = {};
    }
    if (snap.prevClose > 0 && snap.source === 'kite') { st.day.prevClose = snap.prevClose; st.day.prevSrc = 'kite-header'; }
    else if (snap.prevClose > 0) st.day.prevClose = snap.prevClose;
    if (snap.prevHigh > 0 && snap.prevLow > 0) { st.day.prevHigh = snap.prevHigh; st.day.prevLow = snap.prevLow; st.day.prevHLSrc = snap.source; }
    D.record(st.day, now, snap.spot > 0 ? snap.spot : this.mkt.S, this.mkt.atmIV());
  }
  /* Opening range / open / kal ka close: Kite Connect (official 1-min candles) se, ya (setting on ho to) Yahoo backup. Har ~60 sec. */
  indexInfo() {
    const ix = (this.kiteSnap && this.kiteSnap.index) || {}, name = (ix.name || (this.kiteSnap && this.kiteSnap.underlying) || 'NIFTY 50').toUpperCase();
    const T = { 'NIFTY 50': [256265, '^NSEI'], NIFTY: [256265, '^NSEI'], 'NIFTY BANK': [260105, '^NSEBANK'], BANKNIFTY: [260105, '^NSEBANK'], SENSEX: [265, '^BSESN'] }[name] || [null, null];
    return { token: ix.token || T[0], symbol: T[1], name };
  }
  async syncIntraday(force) {
    if (this.S.cfg.feed !== 'kite' || this.intraBusy) return;
    if (!force && Date.now() - (this.intraAt || 0) < 60e3) return;
    const ix = this.indexInfo(); if (!ix.token && !ix.symbol) return;
    this.intraBusy = true; this.intraAt = Date.now();
    try {
      const r = await chrome.runtime.sendMessage({ type: 'kp-intraday', token: ix.token, symbol: ix.symbol, allowYahoo: !!this.S.cfg.yahooBackup });
      if (r && r.ok) {
        const st = this.D(); st.day = D.rollover(st.day, KP.istDay(Date.now()));
        D.backfill(st.day, r.v); this.intraSrc = r.v.src; this.intraErr = null; this.save(); this.panel.renderSoon();
      } else { this.intraErr = r && r.error; this.intraSrc = null; }
    } catch (e) { this.intraErr = e.message; } finally { this.intraBusy = false; }
  }
  /* Exact margin (Kite basket margin API, sirf calculation). Legs badle ya 60 sec purana ho to dobara. */
  async refreshMargin(force) {
    const legs = this.legs(), kc = this.panel.kc;
    if (!legs.length || this.S.cfg.feed !== 'kite' || !kc || !kc.loggedIn) { if (!legs.length) this.kcMargin = null; return; }
    const expiry = this.S.book.expiry || this.mkt.expiry, ix = this.indexInfo(), name = /BANK/.test(ix.name) ? 'BANKNIFTY' : /FIN/.test(ix.name) ? 'FINNIFTY' : 'NIFTY';
    const sig = expiry + '|' + legs.map(l => l.K + l.type + l.qty).sort().join(','), m = this.kcMargin;
    if (!force && m && m.sig === sig && Date.now() - m.at < 60e3) return;
    if (this.marginBusy) return; this.marginBusy = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'kp-kc-margin', legs: legs.map(l => ({ type: l.type, K: l.K, qty: l.qty })), expiry, name });
      this.kcMargin = r && r.ok ? Object.assign({ sig, at: Date.now() }, r.v) : { sig, at: Date.now(), err: (r && r.error) || 'jawab nahi' };
    } catch (e) { this.kcMargin = { sig, at: Date.now(), err: e.message }; } finally { this.marginBusy = false; }
    this.panel.renderSoon();
  }
  feedState() {
    if (this.S.cfg.feed === 'demo') return { cls: 'demo', txt: this.S.cfg.demoMode === 'day' ? 'Demo din' : 'Demo feed' };
    if (!this.kiteSeen) return { cls: 'bad', txt: 'Option chain kholo' };
    if (Date.now() - this.kiteSeen > STALE_MS) return { cls: 'bad', txt: 'Data ruka hua' };
    if (!KP.isMarketOpen(Date.now())) return { cls: 'bad', txt: 'Market band' };
    return { cls: 'live', txt: 'Kite live' };
  }

  /* ---------- trading (FAKE) ---------- */
  /* entry = naya risk (exit hamesha allowed, 9:30 se pehle bhi) */
  canTrade(entry) {
    if (!this.mkt.ready) return { ok: false, why: 'Chain ka data nahi mila. Kite me option chain kholo, ya Settings me Demo feed chuno.' };
    if (this.S.cfg.feed === 'kite') {
      if (!this.fresh()) return { ok: false, why: 'Kite chain ka data ruka hua hai. Option chain wala page khula rakho.' };
      if (!KP.isMarketOpen(Date.now())) return { ok: false, why: 'Market band hai (09:15–15:30 IST). Abhi practice ke liye Settings me Demo feed chuno.' };
    } else if (this.timeRules() && this.phase() === 'closed') return { ok: false, why: 'Demo din khatam (15:30). Settings → "Naya demo din" dabao.' };
    if (entry && this.timeRules()) {
      const ph = this.phase();
      if (ph === 'pre' || ph === 'observe') return { ok: false, why: '9:30 se pehle naya order band hai (Observe phase). Pehli 15 min candle banne do, "Aaj ka plan" tab dekho.' };
    }
    if (!this.sameSeries() && this.legs().length) return { ok: false, why: 'Positions ' + this.S.book.expiry + ' expiry ki hain, chain me ' + this.mkt.expiry + ' khula hai. Kite me wahi expiry kholo.' };
    return { ok: true };
  }
  guard(entry) { const c = this.canTrade(entry); if (!c.ok) this.panel.toast(c.why); return c.ok; }
  /* 9:30–10:00: soft rule. Returns {ok, early} */
  earlyCheck() {
    if (this.phase() !== 'assess') return { ok: true, early: false };
    return { ok: confirm('Abhi 10 baje se pehle hai (Assess phase). Opening range ka confirmation poora nahi hua.\n\nPhir bhi fake entry lena hai? (Log me "early entry" likha jaayega.)'), early: true };
  }
  /* fillPx: limit order ka fill price (warna market = LTP) */
  doTrade(type, K, lots, side, fillPx) {
    const book = this.S.book;
    if (!this.legs().length) book.expiry = this.mkt.expiry;
    const stale = this.mkt.stale(type, K), model = fillPx == null && (this.mkt.live(type, K) == null || stale), px = fillPx != null ? fillPx : this.mkt.ltp(type, K);
    const o = B.trade(book, { type, K, lots, side, lot: this.lot, px, t: this.now() }); o.model = model;
    C.markReaction(this.S.coach, this.now());
    this.emit('order', { inst: o.inst, side, qty: o.qty, px, model });
    return o;
  }
  isExit(type, K, lots, side) { const p = this.S.book.pos[KP.keyOf(type, K)], u = lots * this.lot * (side === 'BUY' ? 1 : -1); return !!(p && p.qty && Math.sign(p.qty) !== Math.sign(u) && Math.abs(u) <= Math.abs(p.qty)); }
  /* risk = {slPct, tgtPct}: naya / badhta order bina SL% aur target% ke punch nahi hota (exit order ko zaroorat nahi).
     limit = price: Kite jaisa LIMIT order. BUY: LTP <= limit, SELL: LTP >= limit hote hi limit price par fill; tab tak "open order".
     Abhi hi mil raha ho (BUY limit >= LTP) to turant LTP par fill (exchange better price deta hai). Din khatam (15:30) = cancel. */
  placeOrder(type, K, lots, side, risk, limit) {
    const entry = !this.isExit(type, K, lots, side);
    if (entry && !(risk && risk.slPct > 0 && risk.tgtPct > 0)) { this.panel.toast('Order nahi laga: pehle Stoploss % aur Target % dono bharo.'); return false; }
    if (limit != null && !(limit > 0)) { this.panel.toast('Limit price galat hai.'); return false; }
    if (!this.guard(entry)) return false;
    let early = false; if (entry) { const e = this.earlyCheck(); if (!e.ok) return false; early = e.early; }
    if (limit != null && !this.limitHit(type, K, side, limit)) {
      const lim = Math.round(limit * 20) / 20, o = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, K, lots, side, limit: lim, risk: risk || null, at: this.now(), early };
      (this.S.pending = this.S.pending || []).push(o);
      this.emit('order', { ev: 'limit', inst: KP.instName(type, K), side, qty: lots * this.lot, limit: lim });
      this.panel.toast('Limit order open: ' + side + ' ' + lots * this.lot + ' × ' + KP.instName(type, K) + ' @ ' + KP.fmt.f2(lim) + '. LTP wahan aayega tab fill hoga (Positions → Open orders).');
      this.save(); this.panel.render(true); return true;
    }
    this.fillOrder(type, K, lots, side, risk, early, null);
    this.after();
    return true;
  }
  limitHit(type, K, side, limit) { const l = this.mkt.ltp(type, K); return l != null && (side === 'BUY' ? l <= limit : l >= limit); }
  fillOrder(type, K, lots, side, risk, early, fillPx, viaLimit) {
    const entry = !this.isExit(type, K, lots, side);
    const o = this.doTrade(type, K, lots, side, fillPx);
    if (early && entry) this.markEarly();
    const k = KP.keyOf(type, K), p = this.S.book.pos[k];
    let rk = '';
    if (entry && risk && p && p.qty) {
      const e = RK.setLeg(this.S.legSL, k, p.qty, p.avg, risk.slPct, risk.tgtPct, this.S.cfg.risk);
      rk = ' · SL ' + KP.fmt.f2(e.sl) + ' (' + e.slPct + '%), target ' + KP.fmt.f2(e.tgt) + ' (' + e.tgtPct + '%)';
      this.emit('risk', { ev: 'legset', inst: o.inst, slPct: e.slPct, tgtPct: e.tgtPct, sl: e.sl, tgt: e.tgt });
    }
    const st = fillPx == null && this.mkt.stale(type, K);
    this.panel.toast((viaLimit ? '✅ Limit order fill: ' : 'Fake ') + side + ' ' + o.qty + ' × ' + o.inst + ' @ ' + KP.fmt.f2(o.px) + (st ? ' (Kite LTP ' + KP.fmt.f2(this.mkt.live(type, K)) + ' purana tha, parity fair price liya)' : o.model ? ' (model price)' : '') + rk);
    return o;
  }
  cancelPending(id) {
    const P = this.S.pending || [], i = P.findIndex(o => o.id === id); if (i < 0) return;
    const o = P.splice(i, 1)[0];
    this.emit('order', { ev: 'cancel', inst: KP.instName(o.type, o.K), side: o.side, limit: o.limit });
    this.panel.toast('Limit order cancel: ' + o.side + ' ' + KP.instName(o.type, o.K) + ' @ ' + KP.fmt.f2(o.limit)); this.save(); this.panel.render(true);
  }
  /* har tick: open limit orders fill / din khatam par cancel */
  checkPending(now) {
    const P = this.S.pending; if (!P || !P.length || !this.mkt.ready) return;
    const day = KP.istDay(now), late = KP.istMin(now) >= 15 * 60 + 30, keep = [];
    let changed = false;
    P.forEach(o => {
      if (KP.istDay(o.at) !== day || (late && this.timeRules())) { changed = true; this.emit('order', { ev: 'expired', inst: KP.instName(o.type, o.K), side: o.side, limit: o.limit }); this.panel.toast('Limit order cancel (din khatam): ' + KP.instName(o.type, o.K) + ' @ ' + KP.fmt.f2(o.limit)); return; }
      if (!this.limitHit(o.type, o.K, o.side, o.limit)) { keep.push(o); return; }
      const entry = !this.isExit(o.type, o.K, o.lots, o.side);
      if (entry && !this.canTrade(false).ok) { keep.push(o); return; }    // 9:30 se pehle / market band: abhi fill nahi
      changed = true; this.fillOrder(o.type, o.K, o.lots, o.side, o.risk, o.early, o.limit, true);
      this.panel.showNudge('limit', '✅ Limit order fill: ' + o.side + ' ' + KP.instName(o.type, o.K) + ' @ ' + KP.fmt.f2(o.limit));
    });
    if (changed) { this.S.pending = keep; this.save(); this.panel.render(true); }
  }
  markEarly() { this.pendingEarly = true; if (this.S.trade) this.S.trade.early = true; }
  /* legs = [{type,K,side,lots}] → hedge (BUY) pehle. Returns fills */
  fillLegs(legs) {
    return legs.slice().sort((a, b) => (a.side === 'BUY' ? 0 : 1) - (b.side === 'BUY' ? 0 : 1)).map(l => {
      const o = this.doTrade(l.type, l.K, l.lots, l.side); return { type: l.type, K: l.K, qty: (l.side === 'BUY' ? 1 : -1) * l.lots * this.lot, avg: o.px };
    });
  }
  startPlan(o) {
    this.S.trade = RK.makePlan(Object.assign({ at: this.now(), early: !!this.pendingEarly }, o), this.S.cfg.risk); this.pendingEarly = false;
    const t = this.S.trade;
    this.emit('plan', { ev: 'enter', strategy: t.strategy, kind: t.kind, unit: Math.round(t.unitRs), sl: Math.round(t.slRs), tgt: Math.round(t.tgtRs), rr: +t.rr.toFixed(2), early: t.early, followed: o.followed, best: o.best });
  }
  placeIC() {
    if (!this.guard(true)) return;
    const b = A.icLegs(this.mkt, this.S.cfg.ic), st = A.icStats(this.mkt, b, this.lot);
    if (st.credit <= 0) { this.panel.toast('Credit zero ya negative hai. Strikes/wing check karo.'); return; }
    if (this.legs().length) { this.panel.toast('Pehle purani position band karo (Positions → Exit all). Ek waqt me ek trade plan.'); return; }
    const e = this.earlyCheck(); if (!e.ok) return; if (e.early) this.pendingEarly = true;
    const pnl0 = B.total(this.S.book, this.mkt), c0 = this.S.book.charges;
    const fills = this.fillLegs(b.legs.map(l => Object.assign({ lots: b.lots }, l)));
    C.snapBase(this.ctx(), fills, pnl0, this.S.book.charges - c0);
    this.startPlan({ strategy: 'ic', name: 'Iron Condor (IC tab)', kind: 'credit', unitRs: st.credit * b.lots * this.lot, pnl0 });
    this.emit('ic', { legs: fills, credit: st.credit, lots: b.lots, spot: this.mkt.S, iv: this.mkt.atmIV() });
    this.panel.toast('Fake iron condor laga: ' + b.legs[1].K + 'PE / ' + b.legs[2].K + 'CE, credit ' + KP.fmt.f2(st.credit) + '. ' + RK.desc(this.S.trade));
    this.panel.openTab('coach'); this.after();
  }
  exitLeg(k) {
    if (!this.guard(false)) return;
    const p = this.S.book.pos[k]; if (!p || !p.qty) return;
    this.doTrade(p.type, p.K, Math.abs(p.qty) / this.lot, p.qty > 0 ? 'SELL' : 'BUY'); this.after();
  }
  exitAll() {
    if (!this.guard(false) || !this.legs().length) return;
    const legs = this.legs().sort((a, b) => a.qty - b.qty);                     // shorts pehle buy-back, phir longs
    legs.forEach(p => this.doTrade(p.type, p.K, Math.abs(p.qty) / this.lot, p.qty > 0 ? 'SELL' : 'BUY'));
    this.panel.toast('Saari fake positions band.'); this.after();
  }
  after() { this.save(); this.loop(true); this.panel.render(true); }

  /* ---------- morning plan ---------- */
  buildMenu() {
    const st = this.D(), now = this.now();
    if (!st.day) st.day = D.newDay(KP.istDay(now));
    const ph = this.phase();
    const intra = this.S.cfg.feed === 'kite' ? { src: this.intraSrc, err: this.intraErr, pending: this.intraBusy || (!this.intraAt && !this.intraErr) } : {};
    this.menu = M.build({ mkt: this.mkt, day: st.day, now, manual: st.manual, vix: this.vix, phase: ph === 'free' ? 'decide' : ph, intra },
      { morning: this.S.cfg.morning, risk: this.S.cfg.risk, ic: this.S.cfg.ic, lot: this.lot });
    return this.menu;
  }
  setManual(k, v) { const st = this.D(); st.manual[k] = v; this.save(); this.panel.render(true); }
  lockPick(id, reason, note) {
    if (!M.SBY[id]) { this.panel.toast('Pehle ek strategy chuno.'); return; }
    if (!reason) { this.panel.toast('"Kyun?" me apna day type chuno. Sochna hi asli practice hai.'); return; }
    const menu = this.buildMenu(), st = this.D(), sig = menu.sig, sc = Object.fromEntries(menu.list.map(s => [s.id, s.score]));
    const old = st.pick, hist = old ? (old.history || []).concat([{ id: old.id, at: old.at, score: old.pickScore }]) : [];
    st.pick = { id, reason, note: (note || '').slice(0, 120), at: this.now(), phase: menu.ph, dt: sig.dt, best: menu.best, scores: sc, pickScore: sc[id], bestScore: sc[menu.best],
      sig: { em: sig.em, orHi: sig.or && sig.or.hi, orLo: sig.or && sig.or.lo, gap: sig.gap, orRatio: sig.orRatio, ivChg: sig.ivChg, pos: sig.pos }, history: hist, review: null };
    this.emit('plan', { ev: 'pick', id, reason, best: menu.best, score: sc[id], bestScore: sc[menu.best], dt: sig.dt, phase: menu.ph, changed: hist.length,
      gap: sig.gap == null ? null : +sig.gap.toFixed(2), orRatio: sig.orRatio == null ? null : +sig.orRatio.toFixed(2), ivChg: sig.ivChg == null ? null : +sig.ivChg.toFixed(1) });
    this.save(); this.panel.render(true);
  }
  unlockPick() { const st = this.D(); if (st.pick) { st.pick.reopen = true; this.panel.render(true); } }
  placeStrategy(id) {
    const st = this.D(), pick = st.pick;
    if (!pick) { this.panel.toast('Pehle Step 1 me apna choice lock karo.'); return; }
    if (!this.guard(true)) return;
    if (this.legs().length) { this.panel.toast('Pehle purani position band karo (Positions → Exit all). Ek waqt me ek trade plan.'); return; }
    const menu = this.buildMenu(), s = menu.list.find(x => x.id === id);
    if (!s || !s.legs || !s.legs.length || !s.st) { this.panel.toast('Is strategy ke strikes abhi nahi ban rahe.'); return; }
    const e = this.earlyCheck(); if (!e.ok) return; if (e.early) this.pendingEarly = true;
    const pnl0 = B.total(this.S.book, this.mkt), c0 = this.S.book.charges;
    const fills = this.fillLegs(s.legs);
    C.snapBase(this.ctx(), fills, pnl0, this.S.book.charges - c0);
    this.startPlan({ strategy: id, name: s.name, kind: s.st.kind, unitRs: s.st.unitRs, pnl0, followed: id === pick.id, best: menu.best });
    pick.placed = { id, at: this.now(), score: s.score };
    this.panel.toast('Fake ' + s.name + ' laga. ' + RK.desc(this.S.trade));
    this.after();
  }
  editRisk(slRs, tgtRs) {
    const t = this.S.trade; if (!t) return;
    const w = t.widened; RK.edit(t, slRs, tgtRs);
    this.emit('risk', { ev: 'edit', sl: Math.round(t.slRs), tgt: Math.round(t.tgtRs), widened: t.widened > w });
    this.panel.toast(t.widened > w ? 'SL door khiskaya. Report card me ye note hoga.' : 'SL / target update: ' + RK.desc(t)); this.save(); this.panel.render(true);
  }
  /* ek leg ka SL / target %. which 'sl' | 'tgt'; blank/0 = band */
  editLegSL(k, pct, which) {
    const e = this.S.legSL[k], p = this.S.book.pos[k]; if (!e || !p || !p.qty) return;
    const wid = RK.editLeg(e, pct, which), t = this.S.trade, n = KP.instName(p.type, p.K), tg = which === 'tgt', val = tg ? e.tgt : e.sl;
    if (wid && t) t.widened++;
    this.emit('risk', { ev: 'legedit', inst: n, slPct: e.slPct, tgtPct: e.tgtPct, sl: e.sl, tgt: e.tgt, widened: wid });
    const how = this.S.cfg.risk.legAutoExit !== false ? 'hit par leg khud exit' : 'alert only';
    this.panel.toast(val == null ? n + ': leg ' + (tg ? 'target' : 'SL') + ' band.' : wid ? 'Leg SL door khiskaya (' + e.slPct + '%). Report card me ye note hoga.' : n + (tg ? ' target ' + e.tgtPct : ' SL ' + e.slPct) + '% = ' + KP.fmt.f2(val) + ' (' + how + ').');
    this.save(); this.panel.render(true);
  }
  doReview(day, pick, partial) {
    const rv = M.review(day, pick); if (!rv) return null;
    rv.partial = !!partial; pick.review = rv;
    const j = { date: day.date, demo: this.S.cfg.feed === 'demo', pick: pick.id, best: pick.best, pickScore: pick.pickScore, bestScore: pick.bestScore, dt: pick.dt, actual: rv.actual, pickOk: rv.pickOk, coachOk: rv.coachOk, placed: pick.placed ? pick.placed.id : null };
    this.S.journal.unshift(j); if (this.S.journal.length > 60) this.S.journal.length = 60;
    this.emit('review', j);
    return rv;
  }
  coachOptions(kind) {
    if (!this.mkt.ready) return { msg: 'Chain data nahi hai.' };
    const r = O.build(this.ctx()); if (r.msg) return r;
    O.score(this.ctx(), r, kind || 'manual'); r.kind = kind || 'manual'; r.at = this.now(); this.lastOpts = r; return r;
  }
  setBaseline() {
    const legs = this.legs(); if (!legs.length) { this.panel.toast('Koi open position nahi.'); return; }
    C.snapBase(this.ctx(), legs.map(l => ({ type: l.type, K: l.K, qty: l.qty, avg: this.mkt.ltp(l.type, l.K) })), B.total(this.S.book, this.mkt), 0);
    this.panel.toast('Baseline set: ab se original vs tumhara compare hoga.'); this.save(); this.panel.render(true);
  }
  applyOption(i) {
    const r = this.lastOpts, o = r && r.opts[i]; if (!o) return;
    if (o.orders.length && !this.guard(false)) return;
    const lv = C.maxLevel(C.evaluate(this.ctx()));
    o.orders.forEach(x => this.doTrade(x.type, x.K, x.lots, x.side));
    if (o.orders.length) this.S.coach.adj.push({ at: this.now(), name: o.title, id: o.id, spot: this.mkt.S, lv, cash: o.cash });
    this.emit('adjust', { id: o.id, title: o.title, score: o.score, best: r.best === o.id, kind: r.kind, level: lv, cash: o.cash });
    this.lastOpts = null;
    this.panel.toast(o.orders.length ? 'Adjustment: ' + o.title : 'Theek hai, abhi kuch nahi kiya.');
    this.after();
  }

  /* ---------- AI coach (Claude): sirf fake trades + screen par dikhne wale numbers ---------- */
  aiContext() {
    const mkt = this.mkt, now = this.now(), st = this.D(), legs = this.legs(), ctx = this.ctx(), cfg = this.S.cfg;
    const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100, r0 = x => x == null || !isFinite(x) ? null : Math.round(x);
    const o = { time_ist: new Date(now).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }), feed: cfg.feed === 'demo' ? 'demo (' + cfg.demoMode + ')' : 'kite live',
      phase: this.phase(), lot_size: this.lot, paper_pnl_total_rs: mkt.ready ? r0(B.total(this.S.book, mkt)) : null };
    if (mkt.ready) o.market = { underlying: r2(mkt.S), atm_strike: mkt.atm(), atm_iv_pct: r2(mkt.atmIV()), expiry: mkt.expiry, trading_days_to_expiry: mkt.dte() };
    const menu = mkt.ready ? this.buildMenu() : null;
    if (menu) {
      const s = menu.sig;
      o.signals = { day_type_by_rules: s.dt, gap_pct: r2(s.gap), opening_range: s.or ? { hi: r0(s.or.hi), lo: r0(s.or.lo), source: s.or.src } : null, or_width_vs_expected_move: r2(s.orRatio),
        expected_move_1day_pts: r0(s.em), price_vs_opening_range: s.pos, atm_iv_change_since_open_pct: r2(s.ivChg), vix: s.vix, event_day: s.event, notes: s.items.map(i => i.txt) };
      o.strategy_scores_by_rules = menu.list.map(x => ({ id: x.id, name: x.name, score: x.score, why: x.why.map(w => (w.v > 0 ? '+' : '') + w.v + ' ' + w.t),
        legs: (x.legs || []).map(l => l.side + ' ' + l.lots + 'L ' + l.K + ' ' + l.type),
        numbers: x.st ? { kind: x.st.kind, premium_rs: r0(x.st.unitRs), max_profit_rs: isFinite(x.st.maxP) ? r0(x.st.maxP) : 'unlimited', max_loss_rs: isFinite(x.st.maxL) ? r0(x.st.maxL) : 'unlimited',
          pop: r2(x.st.pop), sl_rs: r0(x.st.slRs), target_rs: r0(x.st.tgtRs) } : null }));
      o.coach_best_now = menu.best;
    }
    if (st.pick) o.student_morning_pick = { strategy: st.pick.id, student_thinks_day_is: st.pick.reason, note: st.pick.note || null, locked_in_phase: st.pick.phase, score_at_lock: st.pick.pickScore,
      coach_best_at_lock: st.pick.best, rules_day_type_at_lock: st.pick.dt, times_changed: (st.pick.history || []).length,
      end_of_day_review: st.pick.review ? { actual_day: st.pick.review.label, pick_was_right: st.pick.review.pickOk, coach_was_right: st.pick.review.coachOk, day_range_x_em: r2(st.pick.review.rangeX) } : null };
    if (legs.length && mkt.ready) {
      o.open_positions = legs.map(l => { const e = this.S.legSL[KP.keyOf(l.type, l.K)];
        return { inst: 'NIFTY ' + l.K + ' ' + l.type, qty: l.qty, avg: r2(l.avg), ltp: r2(mkt.ltp(l.type, l.K)), delta: r2(mkt.price(l.type, l.K).d),
          leg_stop_loss_premium: e && e.sl != null ? e.sl : null, leg_sl_pct: e ? e.slPct : null, leg_target_premium: e && e.tgt != null ? e.tgt : null, leg_target_pct: e ? e.tgtPct : null, leg_auto_exit_on_hit: cfg.risk.legAutoExit !== false }; });
      const an = A.analyse(mkt, legs), g = A.greeks(mkt, legs);
      o.position_stats = { open_mtm_rs: r0(A.liveMtm(mkt, legs)), net_delta_units: r0(g.d), theta_per_day_rs: r0(g.th), vega_per_1pct_iv_rs: r0(g.vg), expiry_breakevens: an.be.map(r0), pop: r2(an.pop),
        max_profit_rs: an.unlimProfit ? 'unlimited' : r0(an.mx), max_loss_rs: an.unlimLoss ? 'unlimited' : r0(an.mn) };
    }
    const pa = this.pa;
    if (pa) o.price_action = { trend: pa.trend.label, trend_why: pa.trend.why, trend_strong: pa.trend.strong,
      levels_near_spot: pa.zones.slice().sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist)).slice(0, 6).map(z => ({ px: r0(z.px), role: z.role === 'res' ? 'resistance' : 'support', tags: z.tags, confluence: z.star, dist_pts: r0(z.dist) })),
      recent_patterns_5min: (this.paLog || []).map(p => p.title) };
    if ((this.oiLog || []).length) o.oi_shifts = this.oiLog.map(x => ({ title: x.title, card: x.mode === 'pos' ? 'position' : 'info', decision: x.decision }));
    const t = this.S.trade;
    if (t) o.trade_plan = { strategy: t.name, kind: t.kind, premium_rs: r0(t.unitRs), stop_loss_rs: r0(t.slRs), target_rs: r0(t.tgtRs), risk_reward: '1:' + t.rr.toFixed(2),
      pnl_since_entry_rs: mkt.ready ? r0(B.total(this.S.book, mkt) - t.pnl0) : null, early_entry: t.early, sl_widened_times: t.widened,
      hits: t.hits.map(h => ({ type: h.type, pnl_rs: r0(h.pnl), minutes_ago: r0((now - h.at) / 60e3), reacted_after_min: h.reacted == null ? null : r2(h.reacted / 60) })) };
    const ev = this.lastEv;
    if (ev) o.coach_alert_levels = { scale: '0 safe, 1 watch, 2 adjust, 3 danger', CE: ev.CE.level, PE: ev.PE.level, position: ev.POS.level, reasons: [...ev.CE.why, ...ev.PE.why, ...ev.POS.why].map(w => w.t) };
    const al = this.S.coach.alerts.slice(-5);
    if (al.length) o.recent_alerts = al.map(a => ({ title: a.title, minutes_ago: r0((now - a.at) / 60e3), spot: r0(a.spot), reacted_after_min: a.reacted == null ? null : r2(a.reacted / 60) }));
    if (this.S.coach.adj.length) o.adjustments_done = this.S.coach.adj.slice(-5).map(a => a.name);
    if (this.S.coach.base && mkt.ready) o.original_vs_actual_pnl_rs = { original_without_adjustments: r0(C.shadowPnl(ctx)), actual: r0(C.actualPnl(ctx)) };
    const lo = this.lastOpts;
    if (lo && lo.opts) { o.adjustment_options_shown = lo.opts.map(x => ({ title: x.title, score: x.score, why: x.why.map(w => w.t) })); o.adjustment_best = lo.best; }
    const done = this.S.trades.slice(0, 5);
    if (done.length) o.recent_closed_trades = done.map(p => ({ strategy: p.name, pnl_rs: r0(p.closed && p.closed.pnl), sl_hit: p.hits.some(h => h.type === 'sl'), target_hit: p.hits.some(h => h.type === 'target'), sl_widened: p.widened }));
    const J = this.S.journal.slice(0, 5);
    if (J.length) o.journal_recent_days = J.map(j => ({ date: j.date, pick: j.pick, coach: j.best, actual_day: j.actual, pick_right: j.pickOk }));
    return o;
  }
  async askAI(q) {
    q = (q || '').trim(); if (!q || this.aiBusy) return;
    const H = this.aiChat || (this.aiChat = []);
    H.push({ role: 'user', content: q, at: this.now() }); this.aiBusy = true; this.aiErr = null; this.panel.renderAI();
    let ctxJson = '{}'; try { ctxJson = JSON.stringify(this.aiContext()); } catch (e) { console.warn('[KP] ai context', e); }
    let msgs = H.slice(-10); while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
    const messages = msgs.map((m, i) => ({ role: m.role, content: i === msgs.length - 1 ? 'Context (abhi ka data, JSON):\n' + ctxJson + '\n\nSawaal: ' + m.content : m.content }));
    let r; try { r = await chrome.runtime.sendMessage({ type: 'kp-ai-ask', req: { messages } }); } catch (e) { r = { ok: false, error: e.message }; }
    this.aiBusy = false;
    if (r && r.ok) H.push({ role: 'assistant', content: (r.note ? '(ℹ ' + r.note + ')\n\n' : '') + r.text, at: this.now() });
    else { H.pop(); this.aiErr = (r && r.error) || 'Claude se jawab nahi mila.'; this.panel.restoreAIQ(q); }
    if (r && r.used != null) this.aiUsed = { used: r.used, limit: r.limit };
    this.panel.renderAI();
  }

  /* ---------- loop: coach tick, SL/target, nudges, snapshots, review, settle ---------- */
  loop(force) {
    if (this.S.cfg.feed === 'kite' && (force || Date.now() - this.kiteSeen > 3000)) this.kiteRead();
    if (this.S.cfg.feed === 'kite' && this.kiteSeen) { this.syncIntraday(); this.refreshMargin(); }
    // Demo feed par ho aur page par asli Kite chain khuli ho: user ko saaf batao (warna nakli prices Kite se match nahi karte)
    if (this.S.cfg.feed === 'demo') { let f = null; try { f = KP.kite.findChain(); } catch (e) {} this.kiteChainOnPage = !!f; } else this.kiteChainOnPage = false;
    this.checkExpiry();
    if (this.fresh()) this.checkPending(this.now());                       // open limit orders
    try { if (this.mkt.ready) this.paTick(); } catch (e) { console.warn('[KP] price action', e); }
    try { if (this.mkt.ready) this.oiTick(); } catch (e) { console.warn('[KP] oi shift', e); }
    const legs = this.legs(), ctx = this.ctx(), now = this.now(), tr = this.S.trade;
    // per-leg SL: nayi leg ko auto SL, band hui leg ka reaction time (hit ke kitni der baad kaati)
    RK.syncLegs(this.S.legSL, legs, this.legRisk()).forEach(g => {
      if (!g.hit || !tr) return;
      const h = tr.hits.filter(x => x.type === 'legsl' && x.inst === g.key && x.reacted == null).pop();
      if (h) { h.reacted = (now - h.at) / 1000; const bp = this.S.book.pos[g.key]; this.emit('risk', { ev: 'legexit', inst: bp ? KP.instName(bp.type, bp.K) : g.key, reacted: Math.round(h.reacted) }); }
    });
    // trade plan: nayi position (chain se) ko default plan, flat hone par close
    if (legs.length && !tr && this.mkt.ready) {
      let net = 0; legs.forEach(l => net -= l.qty * l.avg);
      this.startPlan({ strategy: 'manual', name: 'Manual position', kind: net > 0 ? 'credit' : 'debit', unitRs: Math.abs(net) || 1, pnl0: B.total(this.S.book, this.mkt) - A.liveMtm(this.mkt, legs) });
    } else if (legs.length && tr && tr.strategy === 'manual' && !tr.closed) {
      // chain se ek-ek leg jod rahe ho: plan ka premium / SL / target poori position ke hisaab se (pehle sirf pehle order ka reh jaata tha)
      const sig = legs.map(l => l.K + l.type + ':' + l.qty).sort().join(',');
      if (tr.legSig !== sig) {
        let net = 0; legs.forEach(l => net -= l.qty * l.avg);
        const kind = net > 0 ? 'credit' : 'debit', lv = RK.levels(kind, Math.abs(net) || 1, this.S.cfg.risk);
        Object.assign(tr, { kind, unitRs: Math.abs(net) || 1, legSig: sig }, tr.widened ? {} : lv);
        if (tr.legSig && tr.state) tr.state = null;
      }
    } else if (!legs.length && tr) {
      const pnl = B.total(this.S.book, this.mkt) - tr.pnl0; RK.close(tr, pnl, now);
      this.emit('risk', { ev: 'closed', strategy: tr.strategy, pnl: Math.round(pnl), hits: tr.hits.map(h => ({ t: h.type, r: h.reacted == null ? null : Math.round(h.reacted) })), widened: tr.widened });
      this.S.trades.unshift(tr); if (this.S.trades.length > 50) this.S.trades.length = 50;
      this.S.trade = null; this.save();
    }
    if (legs.length && this.mkt.ready && this.sameSeries() && this.fresh()) {
      const { ev, fired } = C.tick(ctx); this.lastEv = ev;
      fired.forEach(a => { this.panel.showAlert(a); this.emit('alert', { side: a.side, lv: a.lv, title: a.title, spot: a.spot }); });
      const t = this.S.trade;
      if (t) {
        const pnl = B.total(this.S.book, this.mkt) - t.pnl0, h = RK.check(t, pnl, now);
        if (h) { this.panel.showRisk(h, t); this.emit('risk', { ev: h.type, strategy: t.strategy, pnl: Math.round(pnl), sl: Math.round(t.slRs), tgt: Math.round(t.tgtRs) }); }
      }
      // har leg ka SL / target. Auto exit on: broker ke SL-M order jaisa, trigger par us waqt ke LTP par fake exit.
      const auto = this.S.cfg.risk.legAutoExit !== false, exits = [];
      legs.forEach(l => {
        const k = KP.keyOf(l.type, l.K), e = this.S.legSL[k], ltp = this.mkt.ltp(l.type, l.K), lh = RK.checkLeg(e, ltp, now);
        if (!lh) return;
        const pnl = l.qty * (ltp - l.avg), sl = lh.type === 'sl';
        if (t) t.hits.push({ type: sl ? 'legsl' : 'legtgt', inst: k, at: now, pnl, reacted: auto ? 0 : null, auto });
        if (auto) exits.push(l);
        this.panel.showLegSL(l, e, pnl, auto);
        this.emit('risk', { ev: sl ? 'legsl' : 'legtgt', inst: KP.instName(l.type, l.K), side: l.qty < 0 ? 'SELL' : 'BUY', avg: l.avg, sl: e.sl, tgt: e.tgt, ltp, pnl: Math.round(pnl), auto });
      });
      if (exits.length) {
        exits.sort((a, b) => a.qty - b.qty).forEach(l => this.doTrade(l.type, l.K, Math.abs(l.qty) / this.lot, l.qty > 0 ? 'SELL' : 'BUY'));   // short pehle buy-back
        this.panel.render(true);
      }
      const b = this.S.coach.base;
      if (b && !b.final && !b.exp && this.mkt.dte() === 0 && KP.istMin(now) >= 14 * 60) { b.exp = true; this.panel.showNudge('expiry', '⏰ Expiry day, 2 baj gaye. Position abhi bhi khuli hai. Aakhri 90 minute me gamma sabse tez hota hai. Kya karoge?'); this.emit('alert', { side: 'POS', lv: 0, title: 'Expiry 2PM' }); }
      if (Date.now() - this.lastSnapEvt > SNAP_EVERY) {
        this.lastSnapEvt = Date.now();
        this.emit('snapshot', { pnl: Math.round(B.total(this.S.book, this.mkt)), spot: Math.round(this.mkt.S), iv: +(this.mkt.atmIV() || 0).toFixed(1), level: C.maxLevel(ev),
          shadow: Math.round(C.shadowPnl(ctx)), actual: Math.round(C.actualPnl(ctx)), legs: legs.length });
      }
      this.save();
    } else this.lastEv = null;
    // din ka review (15:30 ke baad)
    const st = this.D();
    if (this.timeRules() && st.pick && !st.pick.review && st.day && KP.istDay(now) === st.day.date && KP.istMin(now) >= D.CLOSE) {
      const rv = this.doReview(st.day, st.pick, false);
      if (rv) { this.panel.toast('Aaj ka review taiyaar: ' + rv.label + '. "Aaj ka plan" tab dekho.'); this.save(); }
    }
    this.panel.renderSoon();
  }
  checkExpiry() {
    const book = this.S.book;
    if (!book.expiry || !this.legs().length || this.now() < KP.expiryCloseMs(book.expiry) + 60e3) return;
    const S = this.S.lastSpot; if (!S) return;
    C.finalizeBase(this.ctx(), S);
    B.settle(book, S, KP.expiryCloseMs(book.expiry));
    this.emit('settle', { expiry: book.expiry, spot: Math.round(S), pnl: Math.round(book.booked - book.charges),
      shadow: this.S.coach.base && Math.round(this.S.coach.base.final.shadow), actual: this.S.coach.base && Math.round(this.S.coach.base.final.actual) });
    this.panel.toast('Expiry ' + book.expiry + ' settle hua @ ' + KP.fmt.f2(S) + '. Report card Coach tab me.');
    book.expiry = null; this.save();
  }

  /* ---------- settings ---------- */
  setFeed(f) { this.S.cfg.feed = f; this.save(); this.startFeed(); }
  newDemoDay() {
    if (this.legs().length && confirm('Purani fake positions abhi khuli hain. Unhe mita ke naya demo din shuru karein?')) {
      const rules = this.S.coach.rules; this.S.book = B.newBook(); this.S.coach = C.defaultCoach(); this.S.coach.rules = rules; this.S.trade = null;
    }
    this.S.cfg.feed = 'demo'; this.save(); this.startFeed(); this.panel.openTab('plan');
  }
  setCfg(path, v) {
    const ks = path.split('.'); let o = this.S.cfg; while (ks.length > 1) o = o[ks.shift()]; o[ks[0]] = v;
    if (/^risk\.leg(Sl|Tgt)Pct/.test(path)) RK.reLegs(this.S.legSL, this.legRisk());
    this.save();
  }
  reset() {
    if (!confirm('Saari fake positions, orders, coach history aur trade plans mita dein?')) return;
    const rules = this.S.coach.rules; this.S.book = B.newBook(); this.S.coach = C.defaultCoach(); this.S.coach.rules = rules;
    this.S.trade = null; this.S.trades = []; this.S.legSL = {}; this.S.pending = [];
    this.emit('reset', {}); this.save(); this.panel.render(true); this.panel.toast('Naya paper account shuru.');
  }
}

const app = new App(); KP.app = app;
app.init();
})();
