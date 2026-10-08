/* "Kya karu?": adjustment options + recommendation score (artifact se port, scenario-only cases hataye). */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const { book: B, an: A, coach: C } = KP;

function simLegs(ctx, orders) {
  const { mkt, lot } = ctx, m = {}; let R = 0, cash = 0;
  Object.values(ctx.book.pos).forEach(p => { if (p.qty) m[KP.keyOf(p.type, p.K)] = { type: p.type, K: p.K, qty: p.qty, avg: p.avg }; });
  for (const o of orders) {
    const px = mkt.ltp(o.type, o.K), u = o.lots * lot * (o.side === 'BUY' ? 1 : -1), k = KP.keyOf(o.type, o.K); cash -= u * px;
    const p = m[k] || (m[k] = { type: o.type, K: o.K, qty: 0, avg: 0 }), q = p.qty;
    if (q === 0 || Math.sign(q) === Math.sign(u)) { p.avg = (Math.abs(q) * p.avg + Math.abs(u) * px) / (Math.abs(q) + Math.abs(u)); p.qty = q + u; }
    else { const c = Math.min(Math.abs(q), Math.abs(u)); R += c * (px - p.avg) * Math.sign(q); const rem = Math.abs(u) - c; p.qty = q + u; if (p.qty === 0) p.avg = 0; else if (rem > 0) p.avg = px; }
  }
  return { legs: Object.values(m).filter(p => p.qty !== 0), R, cash, charges: orders.length * KP.BROKERAGE };
}
function nearestByDelta(mkt, type, target, ok) {
  let best = null, bd = 1e9; const c = mkt.atm();
  for (let i = -60; i <= 60; i++) { const K = c + i * mkt.step; if (!ok(K)) continue; const d = Math.abs(Math.abs(mkt.price(type, K).d) - target); if (d < bd) { bd = d; best = K; } }
  return best;
}
function netOrders(list) {
  const m = new Map();
  for (const x of list) { const k = x.K + x.type, v = ((m.get(k) || {}).v || 0) + (x.side === 'BUY' ? 1 : -1) * x.lots; m.set(k, { type: x.type, K: x.K, v }); }
  return [...m.values()].filter(x => Math.abs(x.v) > 1e-9).map(x => ({ type: x.type, K: x.K, side: x.v > 0 ? 'BUY' : 'SELL', lots: Math.abs(x.v) }))
    .sort((a, b) => (a.side === 'BUY' ? 0 : 1) - (b.side === 'BUY' ? 0 : 1));   // hedge pehle
}
const closeSpread = (s, lot) => { const o = [{ type: s.type, K: s.sh.K, side: 'BUY', lots: s.lots }]; if (s.lg) o.push({ type: s.type, K: s.lg.K, side: 'SELL', lots: Math.abs(s.lg.qty) / lot }); return o; };
const openSpread = (type, K, wing, lots) => [{ type, K: type === 'CE' ? K + wing : K - wing, side: 'BUY', lots }, { type, K, side: 'SELL', lots }];

/* Buyer (debit) trade: roll/fly lagu nahi. Sirf hold / half / exit. */
function buildDebit(ctx) {
  const { mkt, lot } = ctx, legs = B.openLegs(ctx.book), mtm = A.liveMtm(mkt, legs), minLots = Math.min(...legs.map(l => Math.abs(l.qty) / lot)), opts = [];
  opts.push({ id: 'hold', title: 'Abhi kuch mat karo', when: 'SL ya target abhi door hai aur tumhara view (direction / bada move) abhi bhi sahi lagta hai.', orders: [] });
  if (minLots >= 2) { const h = Math.floor(minLots / 2);
    opts.push({ id: 'half', title: 'Aadha book karo (har leg se ' + h + ' lot)', when: 'Kuch profit aa gaya ya view kamzor hua. Aadha nikaal ke baaki ko chalne do.', orders: legs.map(l => ({ type: l.type, K: l.K, side: l.qty > 0 ? 'SELL' : 'BUY', lots: h })) }); }
  opts.push({ id: 'exit', title: mtm > 0 ? 'Poora exit (profit book)' : 'Poora exit (stop loss)', when: mtm > 0 ? 'Target ke paas ho ya move ruk gaya. Buyer ke liye time dushman hai, profit jaldi book karo.' : 'Move nahi aaya, premium ghat raha hai. Debit ka bacha hissa bachao.',
    orders: legs.map(l => ({ type: l.type, K: l.K, side: l.qty > 0 ? 'SELL' : 'BUY', lots: Math.abs(l.qty) / lot })) });
  const realNow = B.realSum(ctx.book);
  for (const o of opts) { o.orders = netOrders(o.orders); const sim = simLegs(ctx, o.orders); o.sim = sim; o.cash = sim.cash - sim.charges; o.an = A.fullAnalyse(mkt, sim.legs, realNow + sim.R - sim.charges); o.delta = A.greeks(mkt, sim.legs).d; }
  return { tested: null, un: null, debit: true, mtm, opts };
}

function build(ctx) {
  if (ctx.planKind === 'debit' && B.openLegs(ctx.book).length) return buildDebit(ctx);
  const { mkt, lot } = ctx, ce = C.sideInfo(ctx, 'CE'), pe = C.sideInfo(ctx, 'PE');
  if (!ce && !pe) return { msg: 'Koi short position nahi hai. Pehle Iron condor tab se condor lagao.' };
  const tested = ce && pe ? (ce.delta >= pe.delta ? ce : pe) : (ce || pe), un = tested === ce ? pe : ce, T = tested.type, c = mkt.atm(), R = ctx.coach.rules, opts = [], step = mkt.step;
  const dirW = T === 'CE' ? 'upar' : 'neeche';
  opts.push({ id: 'hold', title: 'Abhi kuch mat karo', when: 'Sirf Watch alert hai, expiry door hai aur short ka delta adjust level se neeche hai. Har adjustment ka kharcha aur naya risk hota hai.', orders: [] });
  if (un) {
    const wing = un.wing || 200, target = Math.min(0.30, Math.max(0.20, tested.delta * 0.8));
    const ok = un.type === 'PE' ? K => K > un.sh.K && K <= c - step : K => K < un.sh.K && K >= c + step, nk = nearestByDelta(mkt, un.type, target, ok);
    if (nk != null) opts.push({ id: 'rollUn', title: (un.type === 'PE' ? 'Put side upar' : 'Call side neeche') + ' laao (' + un.sh.K + ' se ' + nk + ')',
      when: 'Market dheere-dheere ' + dirW + ' ja raha hai. Untested side ko paas laake extra credit lo aur range recenter karo. Risk: naya short spot ke paas hoga, reversal aaya to us side dikkat.',
      orders: closeSpread(un, lot).concat(openSpread(un.type, nk, wing, un.lots)) });
    const okFly = un.type === 'PE' ? c > un.sh.K && c <= tested.sh.K : c < un.sh.K && c >= tested.sh.K;
    if (okFly && c !== nk) opts.push({ id: 'fly', title: 'Iron fly jaisa banao (' + un.type + ' short ' + c + ' ATM par)',
      when: 'Expiry paas hai aur lagta hai market isi level ke aas-paas rukega. Credit sabse zyada milta hai, lekin profit range bahut patli ho jaati hai.',
      orders: closeSpread(un, lot).concat(openSpread(un.type, c, wing, un.lots)) });
  }
  {
    const wing = tested.wing || 200, ok = T === 'CE' ? K => K > tested.sh.K : K => K < tested.sh.K, nk = nearestByDelta(mkt, T, 0.15, ok);
    if (nk != null) opts.push({ id: 'rollT', title: (T === 'CE' ? 'Call' : 'Put') + ' side door le jao (' + tested.sh.K + ' se ' + nk + ')',
      when: 'Strong trend hai aur tumhe lagta hai market aur ' + dirW + ' jayega. Isme debit lagta hai, isliye max profit kam ho jata hai.',
      orders: closeSpread(tested, lot).concat(openSpread(T, nk, wing, tested.lots)) });
  }
  if (un) opts.push({ id: 'closeT', title: 'Sirf ' + (T === 'CE' ? 'call' : 'put') + ' spread band karo',
    when: 'Tested side ka risk turant khatam karna hai, aur untested side ka bacha premium decay hone dena hai.', orders: closeSpread(tested, lot) });
  if (tested.lots >= 2) {
    const h = Math.floor(tested.lots / 2);
    opts.push({ id: 'half', title: 'Aadhe lots kam karo (har leg se ' + h + ' lot)', when: 'Direction par confusion hai. Size kam karke risk aadha karo aur dekho market kya karta hai.',
      orders: B.openLegs(ctx.book).map(l => ({ type: l.type, K: l.K, side: l.qty > 0 ? 'SELL' : 'BUY', lots: Math.min(h, Math.abs(l.qty) / lot) })) });
  }
  const inProfit = A.liveMtm(mkt, B.openLegs(ctx.book)) > 0;
  opts.push({ id: 'exit', title: inProfit ? 'Poora condor exit (profit book)' : 'Poora condor exit (stop loss)',
    when: inProfit ? 'Zyada tar premium kama liya hai. Bacha hua thoda sa profit lene ke liye poora risk uthane ka matlab nahi.' : 'Loss tumhari limit (credit ka ' + R.lossMult + '×) tak pahunch gaya ya view galat nikla. Chhota loss lo, bada hone se pehle.',
    orders: B.openLegs(ctx.book).map(l => ({ type: l.type, K: l.K, side: l.qty > 0 ? 'SELL' : 'BUY', lots: Math.abs(l.qty) / lot })) });
  const realNow = B.realSum(ctx.book);
  for (const o of opts) {
    o.orders = netOrders(o.orders); const sim = simLegs(ctx, o.orders); o.sim = sim;
    o.cash = sim.cash - sim.charges; o.an = A.fullAnalyse(mkt, sim.legs, realNow + sim.R - sim.charges); o.delta = A.greeks(mkt, sim.legs).d;
  }
  return { tested, un, opts };
}

/* kind: 'manual' | 'alert' | 'profit' | 'expiry'. Future nahi dekhta, sirf rules + abhi ke numbers. */
/* Buyer trade ka score: sirf SL/target plan follow karne par */
function scoreDebit(r, kind) {
  for (const o of r.opts) {
    let s = 50; const why = [], add = (v, t) => { s += v; why.push({ v, t }); };
    if (o.id === 'hold') { if (kind === 'sl') add(-25, 'SL hit: plan kehta hai bahar'); else if (kind === 'target') add(-10, 'Target aa gaya, ab hold = lalach'); else add(12, 'SL / target abhi door'); }
    if (o.id === 'half') { if (kind === 'target') add(12, 'Aadha book, aadha chalne do'); else if (kind === 'sl') add(-5, 'SL par aadha nahi, poora nikalo'); }
    if (o.id === 'exit') { if (kind === 'sl') add(30, 'SL hit: plan follow karo'); else if (kind === 'target') add(18, 'Target aa gaya: profit book'); else add(-8, 'Bina SL/target ke exit: plan se hat rahe ho'); }
    o.score = Math.round(Math.max(5, Math.min(95, s))); o.why = why.slice(0, 3);
  }
  r.best = r.opts.reduce((a, b) => b.score > a.score ? b : a).id; r.level = kind === 'sl' ? 3 : 0;
  return r;
}

/* kind: 'manual' | 'alert' | 'profit' | 'expiry' | 'sl' | 'target' */
function score(ctx, r, kind) {
  if (r.debit) return scoreDebit(r, kind);
  const slHit = kind === 'sl'; if (kind === 'target') kind = 'profit'; if (slHit) kind = 'alert';
  const ev = C.evaluate(ctx), lv = C.maxLevel(ev), posDanger = ev.POS.level >= 3 || slHit;
  const h = r.opts[0], late = ctx.mkt.dte() <= 1, adjN = ctx.coach.adj.length, perLot = ctx.lot * Math.max(1, r.tested.lots);
  const special = kind === 'profit' || kind === 'expiry' || slHit, be = h.an.be, S = ctx.mkt.S, inside = be.length >= 2 && S > be[0] && S < be[be.length - 1];
  for (const o of r.opts) {
    let s = 50; const why = []; const add = (v, t) => { s += v; why.push({ v, t }); };
    if (o.id !== 'hold' && o.id !== 'exit') {
      const dLoss = (o.an.mn - h.an.mn) / Math.max(1, Math.abs(h.an.mn)), dPop = o.an.pop - h.an.pop, neut = (Math.abs(h.delta) - Math.abs(o.delta)) / perLot;
      const a = Math.max(-15, Math.min(15, dLoss * 30)), p = Math.max(-12, Math.min(12, dPop * 60)), n = Math.max(-6, Math.min(6, neut * 20));
      if (Math.abs(a) >= 3) add(a, a > 0 ? 'Max loss kam hota hai' : 'Max loss badh jaata hai');
      if (Math.abs(p) >= 3) add(p, p > 0 ? 'Profit ka chance (POP) badhta hai' : 'POP ghat jaata hai');
      if (Math.abs(n) >= 2) add(n, n > 0 ? 'Position zyada neutral hoti hai' : 'Delta aur ek taraf jhukta hai');
    }
    switch (o.id) {
      case 'hold':
        if (slHit) add(-30, 'SL hit ke baad hold = apna plan todna');
        else if (lv <= 1 && !special) add(20, 'Sirf watch level, abhi wait karna theek');
        if (lv === 2) add(-5, 'Adjust level aa chuka hai');
        if (lv >= 3) add(-25, 'Danger level par kuch na karna risky');
        if (kind === 'profit') add(-8, 'Profit haath me hai, baaki ke liye poora risk');
        if (late && lv >= 2) add(-15, 'Expiry paas, gamma tez');
        if (kind === 'expiry') add(inside && lv === 0 ? 8 : -15, inside && lv === 0 ? 'Strikes abhi door hain' : 'Last 90 min me strike ke paas rehna risky');
        break;
      case 'rollUn':
        if (lv === 2 && !late) add(18, 'Pehla adjustment: untested side paas laao');
        if (lv >= 3) add(-12, 'Strike toot rahi hai, untested roll kaafi nahi');
        if (late) add(-10, 'Expiry paas, roll ka fayda kam');
        if (adjN >= 2) add(-12, 'Pehle hi kai adjustments, over-adjust ka khatra');
        if (o.cash > 0) add(4, 'Extra credit milta hai');
        if (special) add(-10, 'Is situation me naya risk lena theek nahi'); break;
      case 'fly':
        if (late && lv >= 2) add(6, 'Expiry paas, ATM ke aas-paas rukne ka fayda');
        if (!late) add(-8, 'Range bahut patli, expiry door ho to risky');
        if (adjN >= 2) add(-8, 'Pehle hi kai adjustments');
        if (special) add(-10, 'Is situation me naya risk lena theek nahi'); break;
      case 'rollT':
        if (lv >= 3 && !late) add(10, 'Strong move, tested side ko bachao');
        else if (lv === 2) add(3, 'Tested side ko saans milti hai');
        if (late) add(-12, 'Expiry paas, roll ka debit vasool nahi hoga');
        if (o.cash < 0) add(-4, 'Debit lagta hai');
        if (special) add(-8, 'Is waqt naya risk kyun'); break;
      case 'closeT':
        if (lv >= 3) add(12, 'Tested side ka risk turant khatam');
        if (late && lv >= 2) add(10, 'Expiry paas, tooti side band karna safe');
        if (lv <= 1 && !special) add(-10, 'Abhi itni jaldi nahi'); break;
      case 'half':
        if (lv >= 2 && adjN >= 2) add(6, 'Confusion me size kam karo'); else if (lv === 2) add(3, 'Risk aadha hota hai'); break;
      case 'exit':
        if (kind === 'profit') add(22, '~50% profit par book karna common rule hai');
        if (kind === 'expiry') add(16, 'Expiry ke last ghante se pehle bahar');
        if (slHit) add(22, 'Tumhara SL hit hua: plan follow karo');
        else if (posDanger) add(18, 'Stop-loss limit ya breakeven toot gaya');
        else if (lv >= 3 && !special) add(8, 'Strike toot gayi, nikalna ek safe raasta');
        if (lv === 2 && !late && !special) add(-8, 'Pehle adjustment try karo, seedha exit jaldi hai');
        if (lv <= 1 && !special) add(-20, 'Bina wajah exit, premium chhod rahe ho'); break;
    }
    o.score = Math.round(Math.max(5, Math.min(95, s)));
    o.why = why.filter(w => w.t && Math.abs(w.v) >= 2).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
  }
  r.best = r.opts.reduce((a, b) => b.score > a.score ? b : a).id;
  r.level = lv;
  return r;
}

KP.opts = { simLegs, nearestByDelta, netOrders, build, score };
})();
