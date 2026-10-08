/* Adjustment coach: rules, 3-level alerts, original-vs-actual (shadow) P&L, report card.
   ctx = { mkt, book, coach, lot }  (artifact ke st.* ki jagah) */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const { fmt: { f2, rs, nf0 }, book: B, an: A } = KP;

const RULES = [
  ['emWatch', 'Watch: spot short se 1-din-move ke kitne guna andar', 0.1],
  ['watchDelta', 'Watch: short leg delta', 0.01],
  ['adjDelta', 'Adjust: short leg delta', 0.01],
  ['riseWatch', 'Watch: entry delta se kitna badhe', 0.01],
  ['riseAdj', 'Adjust: entry delta se kitna badhe', 0.01],
  ['premMult', 'Adjust: short premium kitne guna', 0.1],
  ['imbalance', 'Adjust: CE/PE premium imbalance (×)', 0.1],
  ['lossMult', 'Danger: MTM loss credit ka kitna guna', 0.1],
  ['expiryDist', 'Danger: expiry day par short se doori (pts)', 10]];
const LV = ['', 'Watch', 'Adjust now', 'Danger'], LVI = ['', '🟡', '🟠', '🔴'];
const REPEAT_MS = 15 * 60e3;

function defaultCoach() {
  return { rules: { emWatch: 1, watchDelta: 0.25, adjDelta: 0.30, riseWatch: 0.07, riseAdj: 0.12, premMult: 2, imbalance: 3, lossMult: 2, expiryDist: 100, sound: true, showScore: true },
    alerts: [], notified: {}, base: null, adj: [] };
}

function snapBase(ctx, legs, pnl0, charges) {
  const { mkt, coach } = ctx;
  coach.base = { pnl0, entryCharges: charges, t: mkt.now(), spot: mkt.S, iv: mkt.atmIV(), expiry: mkt.expiry,
    legs: legs.map(l => ({ type: l.type, K: l.K, qty: l.qty, avg: l.avg, d0: Math.abs(mkt.price(l.type, l.K).d) })) };
  coach.notified = {}; coach.alerts = []; coach.adj = [];
}
function shadowPnl(ctx) {
  const b = ctx.coach.base; if (!b) return 0; if (b.final) return b.final.shadow;
  let v = -b.entryCharges; for (const l of b.legs) v += l.qty * (ctx.mkt.ltp(l.type, l.K) - l.avg); return v;
}
function actualPnl(ctx) {
  const b = ctx.coach.base; if (!b) return 0; if (b.final) return b.final.actual;
  return B.total(ctx.book, ctx.mkt) - b.pnl0;
}
/* settle se PEHLE call karo: base ka final result fix karta hai */
function finalizeBase(ctx, S) {
  const b = ctx.coach.base; if (!b || b.final) return;
  let sh = -b.entryCharges; for (const l of b.legs) sh += l.qty * (KP.intrinsic(l.type, l.K, S) - l.avg);
  let act = ctx.book.booked - ctx.book.charges;
  for (const p of Object.values(ctx.book.pos)) act += p.real + p.qty * (KP.intrinsic(p.type, p.K, S) - p.avg);
  b.final = { shadow: sh, actual: act - b.pnl0 };
}

function sideInfo(ctx, type) {
  const { mkt, lot } = ctx;
  const legs = B.openLegs(ctx.book).filter(l => l.type === type), shorts = legs.filter(l => l.qty < 0);
  if (!shorts.length) return null;
  const sh = shorts.reduce((a, b) => type === 'CE' ? (a.K < b.K ? a : b) : (a.K > b.K ? a : b));
  const lg = legs.filter(l => l.qty > 0 && (type === 'CE' ? l.K > sh.K : l.K < sh.K)).sort((a, b) => Math.abs(a.K - sh.K) - Math.abs(b.K - sh.K))[0] || null;
  const px = mkt.ltp(type, sh.K);
  return { type, sh, lg, delta: Math.abs(mkt.price(type, sh.K).d), px, ratio: px / Math.max(0.05, sh.avg),
    dist: type === 'CE' ? sh.K - mkt.S : mkt.S - sh.K, lots: Math.abs(sh.qty) / lot, wing: lg ? Math.abs(lg.K - sh.K) : 0 };
}

function evaluate(ctx) {
  const { mkt, coach } = ctx, R = coach.rules, out = { CE: { level: 0, why: [] }, PE: { level: 0, why: [] }, POS: { level: 0, why: [] } };
  const legs = B.openLegs(ctx.book); if (!legs.some(l => l.qty < 0) || !mkt.ready) return out;
  if (ctx.planKind === 'debit') return out;          // buyer trade: short-leg/breakeven rules lagu nahi, sirf SL/target (KP.risk)
  const S = mkt.S, em = S * (mkt.atmIV() || 13) / 100 / Math.sqrt(252), base = coach.base, expDay = mkt.dte() === 0;
  const up = (o, l, t) => { o.level = Math.max(o.level, l); o.why.push({ l, t }); };
  const sides = { CE: sideInfo(ctx, 'CE'), PE: sideInfo(ctx, 'PE') };
  for (const T of ['CE', 'PE']) {
    const s = sides[T]; if (!s) continue; const o = out[T], nm = s.sh.K + ' ' + T;
    const b0 = base && base.legs.find(l => l.type === T && l.K === s.sh.K), d0 = b0 ? ' (entry par ' + b0.d0.toFixed(2) + ')' : '';
    if (s.dist < 0) up(o, 3, 'Spot ' + nm + ' ke paar chala gaya. Short strike ab ITM hai.');
    else if (s.dist < em * R.emWatch) up(o, 1, 'Spot ' + nm + ' se sirf ' + Math.round(s.dist) + ' pts door hai, jabki ek din ka expected move ~' + Math.round(em) + ' pts hai.');
    const wd = Math.max(R.watchDelta, b0 ? b0.d0 + R.riseWatch : 0), ad = Math.max(R.adjDelta, b0 ? b0.d0 + R.riseAdj : 0);
    if (s.delta >= ad) up(o, 2, nm + ' ka delta ' + s.delta.toFixed(2) + d0 + ', adjust level ' + ad.toFixed(2) + ' cross ho gaya. Ye leg ab tez loss deta hai.');
    else if (s.delta >= wd) up(o, 1, nm + ' ka delta ' + s.delta.toFixed(2) + d0 + '. Pressure badh raha hai (watch level ' + wd.toFixed(2) + ').');
    if (s.ratio >= R.premMult) up(o, 2, nm + ' ka premium ' + f2(s.sh.avg) + ' se ' + f2(s.px) + ' ho gaya (' + s.ratio.toFixed(1) + '×). Loss isi side par ban raha hai.');
    if (expDay && s.dist >= 0 && s.dist < R.expiryDist) up(o, 3, 'Expiry day hai aur spot ' + nm + ' ke ' + Math.round(s.dist) + ' pts andar hai. Gamma risk: ek jhatke me bada loss.');
  }
  if (sides.CE && sides.PE) {
    const hi = sides.CE.px >= sides.PE.px ? 'CE' : 'PE', lo = hi === 'CE' ? 'PE' : 'CE', r = sides[hi].px / Math.max(0.05, sides[lo].px);
    if (r >= R.imbalance && sides[hi].ratio >= 1) up(out[hi], 2, hi + ' premium ' + f2(sides[hi].px) + ' vs ' + lo + ' ' + f2(sides[lo].px) + ' (' + r.toFixed(1) + '× imbalance). ' + lo + ' side ab kuch kama nahi rahi.');
  }
  let credit = 0; legs.forEach(l => credit -= l.qty * l.avg);
  const mtm = A.liveMtm(mkt, legs) + B.realSum(ctx.book);
  if (credit > 0 && -mtm >= R.lossMult * credit) up(out.POS, 3, 'MTM loss ' + rs(mtm) + ', jo credit (' + rs(credit) + ') ka ' + (-mtm / credit).toFixed(1) + '× hai. Ye stop-loss zone hai.');
  const an = A.analyse(mkt, legs);
  if (an && an.be.length >= 2) {
    const lo = an.be[0], hi = an.be[an.be.length - 1];
    if (S < lo) up(out.POS, 3, 'Spot lower breakeven ' + nf0.format(lo) + ' ke neeche hai. Expiry tak yahi raha to loss.');
    if (S > hi) up(out.POS, 3, 'Spot upper breakeven ' + nf0.format(hi) + ' ke upar hai. Expiry tak yahi raha to loss.');
  }
  return out;
}
const maxLevel = ev => Math.max(ev.CE.level, ev.PE.level, ev.POS.level);

/* Har tick: naye (badhe hue) level par alert banao. Returns {ev, fired:[alert]} */
function tick(ctx) {
  const { coach, mkt } = ctx, ev = evaluate(ctx), N = coach.notified, now = mkt.now(), fired = [];
  for (const k of ['CE', 'PE', 'POS']) {
    const lv = ev[k].level, prev = N[k] || 0;
    if (lv > prev && !(N[k + 'L'] === lv && now - (N[k + 'T'] || -1e15) < REPEAT_MS)) {
      const a = { at: now, side: k, lv, title: LV[lv] + ': ' + (k === 'POS' ? 'poori position' : k + ' side'),
        why: ev[k].why.filter(w => w.l === lv).map(w => w.t), spot: mkt.S, reacted: null };
      coach.alerts.push(a); if (coach.alerts.length > 200) coach.alerts.shift();
      fired.push(a); N[k + 'L'] = lv; N[k + 'T'] = now;
    }
    N[k] = lv;
  }
  return { ev, fired };
}
/* Har fake order par: pending alerts ka reaction time (sec) record */
function markReaction(coach, now) { coach.alerts.forEach(a => { if (a.reacted == null) a.reacted = (now - a.at) / 1000; }); }

function report(ctx) {
  const { coach } = ctx, Al = coach.alerts, adj = coach.adj, b = coach.base, cnt = [0, 0, 0, 0];
  Al.forEach(a => cnt[a.lv]++);
  const big = Al.filter(a => a.lv >= 2), ign = big.filter(a => a.reacted == null || a.reacted > 1800), reac = big.filter(a => a.reacted != null);
  const avgMin = reac.length ? reac.reduce((s, a) => s + a.reacted, 0) / reac.length / 60 : null, early = adj.filter(a => a.lv <= 1).length, tips = [];
  if (!b) tips.push('Iron condor tab se condor lagao taaki original vs adjusted ka comparison ban sake.');
  if (ign.length) tips.push(ign.length + ' baar Adjust/Danger alert ke 30 min baad tak kuch nahi kiya. Plan pehle se likho, jaise "delta 0.30 par main ye karunga".');
  if (adj.length > 3) tips.push(adj.length + ' adjustments ho gaye. Over-adjust ho raha hai: har adjustment brokerage, slippage aur naya risk laata hai.');
  if (early) tips.push(early + ' adjustment sirf Watch level par (ya bina alert) kiye. Watch ka matlab dhyaan do, turant action nahi.');
  let delta = null;
  if (b) { delta = actualPnl(ctx) - shadowPnl(ctx); tips.push(delta >= 0 ? 'Adjustments ne original condor se ' + rs(delta) + ' behtar result diya.' : 'Adjustments ki wajah se ' + rs(-delta) + ' zyada nuksaan hua. Review karo: adjustment jaldi kiya, ya galat side roll ki?'); }
  if (!Al.length) tips.push('Abhi tak koi alert nahi aaya. Market ko kaam karne do, ya Demo feed me push karke practice karo.');
  return { cnt, avgMin, ignored: ign.length, adj, tips, delta };
}

KP.coach = { RULES, LV, LVI, defaultCoach, snapBase, shadowPnl, actualPnl, finalizeBase, sideInfo, evaluate, maxLevel, tick, markReaction, report };
})();
