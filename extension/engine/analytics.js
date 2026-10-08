/* Payoff, Greeks, POP, margin, iron condor builder (artifact se port). */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const { intrinsic, npdf, RATE, bs } = KP;

function expPay(S, legs) { let v = 0; for (const l of legs) v += l.qty * (intrinsic(l.type, l.K, S) - l.avg); return v; }
function nowPay(mkt, S, legs) { const T = mkt.T(); let v = 0; for (const l of legs) v += l.qty * (mkt.price(l.type, l.K, S, T).p - l.avg); return v; }
/* Live MTM (LTP se), model nahi */
function liveMtm(mkt, legs) { let v = 0; for (const l of legs) v += l.qty * (mkt.ltp(l.type, l.K) - l.avg); return v; }

function greeks(mkt, legs) {
  const T = mkt.T(), T1 = Math.max(1e-7, T - 1 / 365), S = mkt.S; let d = 0, th = 0, vg = 0;
  for (const l of legs) {
    const a = mkt.price(l.type, l.K, S, T); d += l.qty * a.d;
    th += l.qty * (mkt.price(l.type, l.K, S, T1).p - a.p);
    vg += l.qty * (mkt.price(l.type, l.K, S, T, 0.01).p - a.p);
  }
  return { d, th, vg };
}

/* POP: lognormal, ATM IV se. off = legs ke bahar ka P&L (realised, charges). */
function pop(mkt, f) {
  const S = mkt.S, T = mkt.T(), sig = (mkt.atmIV() || 13) / 100;
  if (T < 2e-5) return f(S) > 0 ? 1 : 0;
  const sd = sig * Math.sqrt(T), mu = (RATE - sig * sig / 2) * T; let p = 0;
  for (let z = -5; z <= 5; z += 0.02) if (f(S * Math.exp(mu + sd * z)) > 0) p += npdf(z) * 0.02;
  return p;
}
function analyse(mkt, legs) {
  if (!legs.length) return null;
  const S = mkt.S, lo = S * 0.6, hi = S * 1.4, n = 1600; let mx = -Infinity, mn = Infinity; const be = []; let prev = null, prevS = null;
  for (let i = 0; i <= n; i++) {
    const x = lo + (hi - lo) * i / n, v = expPay(x, legs); mx = Math.max(mx, v); mn = Math.min(mn, v);
    if (prev !== null && Math.sign(v) !== Math.sign(prev) && v !== 0) be.push(prevS + (x - prevS) * (-prev) / (v - prev));
    prev = v; prevS = x;
  }
  const sL = expPay(lo, legs) - expPay(lo + 10, legs), sH = expPay(hi, legs) - expPay(hi - 10, legs);
  return { mx, mn, be, unlimProfit: sL > 1 || sH > 1, unlimLoss: sL < -1 || sH < -1, pop: pop(mkt, x => expPay(x, legs)) };
}
/* off ke saath (adjustment options compare karne ke liye) */
function fullAnalyse(mkt, legs, off) {
  const S = mkt.S, f = x => off + expPay(x, legs);
  if (!legs.length) return { mx: off, mn: off, be: [], pop: off > 0 ? 1 : 0 };
  const lo = S * 0.85, hi = S * 1.15, n = 900; let mx = -1e18, mn = 1e18, pv = null, px = null; const be = [];
  for (let i = 0; i <= n; i++) {
    const x = lo + (hi - lo) * i / n, v = f(x); mx = Math.max(mx, v); mn = Math.min(mn, v);
    if (pv !== null && (pv < 0) !== (v < 0)) be.push(px + (x - px) * (-pv) / (v - pv)); pv = v; px = x;
  }
  return { mx, mn, be, pop: pop(mkt, f) };
}
/* Margin ka ANDAZA, NSE SPAN jaisa (portfolio par, isliye hedge ka fayda apne aap):
   SPAN     = 16 scenario (price ±0, ±1/3, ±2/3, ±1 × PSR, har ek IV upar / neeche) + 2 extreme (±2×PSR, 35% weight) me sabse bada loss
   Exposure = short options ke notional ka 2% (index options)
   Premium  = khareede gaye options ka paisa (cash me lagta hai)
   PSR (price scan range) index ke liye ~9%, VSR (IV scan) ~25% relative. Exact number ke liye Kite basket margin (Kite Connect). */
const PSR = 0.09, VSR = 0.25, EXPO = 0.02;
function marginDetail(mkt, legs) {
  if (!legs.length || !mkt.ready) return { span: 0, exposure: 0, premium: 0, total: 0, short: 0 };
  const S = mkt.S, T = mkt.T(), val = (s, bump) => legs.reduce((v, l) => { const iv = mkt.ivFor(l.K); return v + l.qty * bs(l.type, s, l.K, T, Math.max(0.01, iv * (1 + bump))).p; }, 0), base = val(S, 0);
  let worst = 0;
  for (const f of [0, 1 / 3, 2 / 3, 1]) for (const dir of f ? [1, -1] : [1]) for (const vb of [VSR, -VSR]) worst = Math.max(worst, base - val(S * (1 + dir * f * PSR), vb));
  for (const dir of [1, -1]) worst = Math.max(worst, 0.35 * (base - val(S * (1 + dir * 2 * PSR), 0)));
  let shortQty = 0, premium = 0;
  for (const l of legs) { if (l.qty < 0) shortQty += -l.qty; else premium += l.qty * l.avg; }
  const exposure = shortQty * S * EXPO, span = shortQty ? worst : 0;
  return { span, exposure, premium, total: span + exposure + premium, short: shortQty };
}
function margin(mkt, legs) { return marginDetail(mkt, legs).total; }

/* Iron condor legs. cfg = {mode:'pts'|'delta', dist, delta, wing, lots} */
function icLegs(mkt, cfg) {
  const step = mkt.step, c = mkt.atm();
  const lots = Math.max(1, parseInt(cfg.lots) || 1), wing = Math.max(step, Math.round((+cfg.wing || 200) / step) * step);
  let sc, sp;
  if (cfg.mode === 'delta') {
    const tgt = Math.min(0.45, Math.max(0.03, +cfg.delta || 0.15)); let bc = 1e9, bp = 1e9; sc = c; sp = c;
    for (let K = c; K <= c + 60 * step; K += step) { const d = Math.abs(mkt.price('CE', K).d - tgt); if (d < bc) { bc = d; sc = K; } }
    for (let K = c; K >= c - 60 * step; K -= step) { const d = Math.abs(-mkt.price('PE', K).d - tgt); if (d < bp) { bp = d; sp = K; } }
  } else {
    const dist = Math.max(step, Math.round((+cfg.dist || 300) / step) * step); sc = c + dist; sp = c - dist;
  }
  return { lots, wing, legs: [
    { lab: 'Buy PE (hedge)', type: 'PE', K: sp - wing, side: 'BUY' },
    { lab: 'Sell PE', type: 'PE', K: sp, side: 'SELL' },
    { lab: 'Sell CE', type: 'CE', K: sc, side: 'SELL' },
    { lab: 'Buy CE (hedge)', type: 'CE', K: sc + wing, side: 'BUY' }] };
}
function icStats(mkt, b, lot) {
  let credit = 0;
  const legs = b.legs.map(l => { const px = mkt.ltp(l.type, l.K); credit += (l.side === 'SELL' ? 1 : -1) * px; return Object.assign({ px, d: mkt.price(l.type, l.K).d, live: mkt.live(l.type, l.K) != null }, l); });
  const u = b.lots * lot, maxP = credit * u, maxL = (b.wing - credit) * u;
  return { legs, credit, maxP, maxL, beLo: b.legs[1].K - credit, beHi: b.legs[2].K + credit, rr: maxP > 0 ? maxL / maxP : null };
}

KP.an = { expPay, nowPay, liveMtm, greeks, analyse, fullAnalyse, margin, marginDetail, icLegs, icStats, pop };
})();
