/* OI shift: Top-3 OI levels badle (Resistance / Support / short covering) to alert + seller ke liye decision.
   Resistance = #1 CE 🔴 short buildup strike, Support = #1 PE 🔴 short buildup strike (app.buildupTop se).
   Sirf salah, koi order nahi. Shor kam: naya level 2 baar lagatar + 1.2× bada ho tabhi, ek baat 30 min me ek baar. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const f0 = x => Math.round(x).toLocaleString('en-IN');
const DEDUPE_MIN = 30, SIZE_X = 1.2;

/* buildupTop() ka nichod: R, Su, sab short/cover strikes */
function snap(bt, S, step) {
  const top = bt.top || {}, sh = top.short || [], R = sh.find(x => x.T === 'CE'), Su = sh.find(x => x.T === 'PE'), short = {}, coverAll = [];
  for (const k in bt.BU || {}) { const b = bt.BU[k]; if (!b) continue; if (b.id === 'short') short[k] = Math.abs(b.dOI || 0); if (b.id === 'cover') coverAll.push(k); }
  const lv = x => x ? { K: x.K, d: Math.abs(x.b.dOI || 0) } : null;
  return { S, step, R: lv(R), Su: lv(Su), short, coverAll, top3c: (top.cover || []).map(x => x.K + x.T) };
}

/* pichhli state + naya snap → events. t = IST minute. st null ho to sirf baseline (koi alert nahi). */
function step(st, cur, t) {
  const events = [], first = !st;
  st = st || { base: { R: null, Su: null }, ref: null, pend: { R: null, Su: null }, prev: null, seen: {}, recent: {} };
  const shift = (L, T, up, dn) => {
    const b = st.base[L], c = cur[L];
    if (!c) { st.pend[L] = null; return null; }
    if (!b) { st.base[L] = c; return null; }
    if (c.K === b.K) { st.pend[L] = null; st.base[L] = c; return null; }
    if (c.d < SIZE_X * (cur.short[b.K + T] || 0)) { st.pend[L] = null; return null; }     // naya #1 purane se kaafi bada nahi = shor
    const p = st.pend[L]; st.pend[L] = p && p.K === c.K ? { K: c.K, n: p.n + 1 } : { K: c.K, n: 1 };
    if (st.pend[L].n < 2) return null;                                                     // 2 baar lagatar
    st.pend[L] = null; st.base[L] = c;
    return { id: c.K > b.K ? up : dn, T, from: b.K, to: c.K };
  };
  let ev = [shift('R', 'CE', 'res_up', 'res_dn'), shift('Su', 'PE', 'sup_up', 'sup_dn')].filter(Boolean);
  // range: dono taraf se andar (chhoti) ya dono taraf bahar (badi). Dono ek hi taraf chale = trend, ref naya.
  const B = st.base;
  if (B.R && B.Su) {
    if (!st.ref) st.ref = { R: B.R.K, Su: B.Su.K };
    const dR = B.R.K - st.ref.R, dS = B.Su.K - st.ref.Su, gap0 = st.ref.R - st.ref.Su, gap = B.R.K - B.Su.K;
    const rid = dR < 0 && dS > 0 ? 'range_narrow' : dR > 0 && dS < 0 ? 'range_wide' : null;
    if (rid) { ev = [{ id: rid, from: gap0, to: gap, R: B.R.K, Su: B.Su.K }]; st.ref = { R: B.R.K, Su: B.Su.K }; }
    else if (dR * dS > 0) st.ref = { R: B.R.K, Su: B.Su.K };
  }
  // short covering: R / Su ke paas (±1 step), ya ATM ±2 par naya 🔵 Top 3. 2 baar lagatar dikhe tabhi.
  const prev = st.prev, has = (arr, k) => arr.indexOf(k) >= 0;
  if (first) { cur.coverAll.forEach(k => { st.seen['c' + k] = t; }); cur.top3c.forEach(k => { st.seen['n' + k] = t; }); }
  else if (prev) {
    const fired = {};
    [['R', 'CE', 'res_cover'], ['Su', 'PE', 'sup_cover']].forEach(([L, T, id]) => {
      const b = B[L]; if (!b) return;
      for (const K of [b.K, b.K - cur.step, b.K + cur.step]) { const k = K + T;
        if (has(cur.coverAll, k) && has(prev.coverAll, k) && !st.seen['c' + k]) { st.seen['c' + k] = t; fired[k] = 1; ev.push({ id, T, K, lvl: b.K }); break; } }
    });
    const atm = Math.round(cur.S / cur.step) * cur.step;
    cur.top3c.forEach(k => { const K = parseFloat(k), T = k.slice(-2);
      if (fired[k] || !has(prev.top3c, k) || st.seen['n' + k] || Math.abs(K - atm) > 2 * cur.step) return;
      st.seen['n' + k] = t; ev.push({ id: 'cover_new', T, K }); });
    for (const s in st.seen) { const k = s.slice(1); if (s[0] === 'c' ? !has(cur.coverAll, k) : !has(cur.top3c, k)) delete st.seen[s]; }
  }
  st.prev = cur;
  if (first) return { st, events };
  for (const e of ev) {                                                                   // ek baat 30 min me ek baar
    const key = e.id + '|' + (e.to != null ? e.to : e.K != null ? e.K + e.T : '');
    if (st.recent[key] != null && t - st.recent[key] < DEDUPE_MIN) continue;
    st.recent[key] = t; events.push(Object.assign(e, { t }, text(e)));
  }
  return { st, events };
}

/* title + matlab */
function text(e) {
  const up = e.to > e.from;
  switch (e.id) {
    case 'res_up': case 'res_dn': return { bias: up ? 'bull' : 'bear', title: 'Resistance ' + f0(e.from) + ' → ' + f0(e.to) + ' (CE writers ' + (up ? 'upar' : 'neeche') + ' shift)',
      meaning: up ? 'Upar ki deewar ' + f0(e.to - e.from) + ' pts upar khisak gayi. CE writers peeche hat rahe, market ko upar jagah mil rahi (bullish).'
        : 'CE writers neeche aa kar bech rahe. Upar ki deewar ' + f0(e.from - e.to) + ' pts neeche aa gayi (bearish).' };
    case 'sup_up': case 'sup_dn': return { bias: up ? 'bull' : 'bear', title: 'Support ' + f0(e.from) + ' → ' + f0(e.to) + ' (PE writers ' + (up ? 'upar' : 'neeche') + ' shift)',
      meaning: up ? 'PE writers upar aa kar bech rahe. Neeche ka floor ' + f0(e.to - e.from) + ' pts upar uth gaya (bullish).'
        : 'PE writers peeche hat rahe. Neeche ka floor ' + f0(e.from - e.to) + ' pts neeche khisak gaya (bearish).' };
    case 'res_cover': return { bias: 'bull', title: '🔵 Resistance ' + f0(e.lvl) + ' par CE short covering',
      meaning: f0(e.K) + ' CE ke sellers position kaat rahe (🔵 short covering). Upar ki deewar kamzor, breakout ka khatra.' };
    case 'sup_cover': return { bias: 'bear', title: '🔵 Support ' + f0(e.lvl) + ' par PE short covering',
      meaning: f0(e.K) + ' PE ke sellers position kaat rahe (🔵 short covering). Neeche ka floor kamzor, breakdown ka khatra.' };
    case 'cover_new': return { bias: e.T === 'CE' ? 'bull' : 'bear', title: '🔵 ' + f0(e.K) + ' ' + e.T + ' short covering (ATM ke paas, Top 3)',
      meaning: f0(e.K) + ' ' + e.T + ' par sellers bhaag rahe. ' + (e.T === 'CE' ? 'Upar ki rally' : 'Neeche ki girawat') + ' ka fuel.' };
    case 'range_narrow': return { bias: null, title: 'Range chhoti: Support ' + f0(e.Su) + ' – Resistance ' + f0(e.R),
      meaning: 'Dono taraf ke writers paas aa gaye (gap ' + f0(e.from) + ' → ' + f0(e.to) + ' pts). Range tight ho rahi.' };
    case 'range_wide': return { bias: null, title: 'Range badi: Support ' + f0(e.Su) + ' – Resistance ' + f0(e.R),
      meaning: 'Dono taraf ke writers door chale gaye (gap ' + f0(e.from) + ' → ' + f0(e.to) + ' pts). Volatility badh rahi.' };
  }
  return { bias: null, title: e.id, meaning: '' };
}

/* Decision: position ho to "meri leg ka kya karu", na ho to "naya trade lena ho to".
   ctx = {legs:[{type,K,qty,avg}], S, em, step, trend:'up'|'down'|'range'|null, trendLabel, dte, nowMin, R, Su, ltp(type,K)} */
function advise(e, ctx) {
  const { S, em, step, R, Su } = ctx, legs = (ctx.legs || []).filter(l => l.qty < 0), rs = x => '₹' + (+x).toFixed(1);
  const bull = e.bias === 'bull', bear = e.bias === 'bear', tr = ctx.trend;
  const strength = !e.bias ? null : (bull && tr === 'up') || (bear && tr === 'down') ? 'Strong' : (bull && tr === 'down') || (bear && tr === 'up') ? 'Mixed, ek candle ruko' : 'Medium';
  const late = ctx.dte === 0 && ctx.nowMin >= 14 * 60;
  const threatT = e.id === 'range_wide' ? 'both' : bull ? 'CE' : bear ? 'PE' : null;
  const near = l => Math.abs(l.K - S) < em, n = l => f0(l.K) + ' ' + l.type, far = l => f0(Math.abs(l.K - S)) + ' pts door';
  const pos = []; let hot = false;
  const strangle = legs.some(l => l.type === 'CE') && legs.some(l => l.type === 'PE');
  for (const l of legs) {
    const threat = threatT === 'both' || l.type === threatT, ltp = ctx.ltp ? ctx.ltp(l.type, l.K) : null;
    if (e.id === 'range_narrow') { pos.push(n(l) + ' SELL: hold, range tight hai to theta tumhare saath.'); continue; }
    if (e.id === 'range_wide') { hot = true; pos.push(n(l) + ' SELL: SL check karo (avg ' + rs(l.avg) + '), size mat badhao' + (strangle ? ', strangle ke dono legs par nazar.' : '.')); continue; }
    if (!threat) {
      pos.push(n(l) + ' SELL: is shift se koi khatra nahi, hold.' + (ltp != null && ltp <= l.avg * 0.5 ? ' Premium aadha ho gaya (' + rs(ltp) + ') → aadha book kar sakte ho.' : ''));
      continue;
    }
    hot = true;
    const out = l.type === 'CE' ? 'upar' : 'neeche', rollK = l.type === 'CE' ? (e.to || e.lvl || e.K) + step : (e.to || e.lvl || e.K) - step;
    const hedgeK = l.type === 'CE' ? l.K + 2 * step : l.K - 2 * step;
    if (e.id === 'res_cover' || e.id === 'sup_cover' || e.id === 'cover_new') {
      if (near(l)) pos.push(n(l) + ' SELL (' + far(l) + '): abhi exit karo ya hedge lo (' + f0(hedgeK) + ' ' + l.type + ' BUY). Covering me premium tez bhaagta hai, SL ka intezaar mat karo.');
      else pos.push(n(l) + ' SELL (' + far(l) + '): SL cost par lao (avg ' + rs(l.avg) + ').');
      continue;
    }
    // shift: res_up / sup_dn = seedha khatra, sup_up / res_dn = doosri taraf ka ishara
    const direct = e.id === 'res_up' || e.id === 'sup_dn';
    const beyond = l.type === 'CE' ? l.K <= e.to : l.K >= e.to;                            // leg nayi deewar ke andar aa gayi
    if (direct && (near(l) || beyond)) {
      if (strength === 'Strong') pos.push(n(l) + ' SELL: exit karo ya roll ' + out + ' karo (' + n(l) + ' → ' + f0(rollK) + ' ' + l.type + ').');
      else pos.push(n(l) + ' SELL: hold kar sakte ho par trend saath nahi de raha, agli candle dekho.');
      pos.push('Ruk rahe ho to SL cost par lao (avg ' + rs(l.avg) + ').');
    } else if (direct) pos.push(n(l) + ' SELL (' + far(l) + '): hold, SL wahi rakho, agli candle dekho.');
    else pos.push(n(l) + ' SELL: is taraf naya ' + l.type + ' mat jodo.' + (near(l) ? ' Spot paas hai (' + far(l) + ') → SL cost par lao (avg ' + rs(l.avg) + ').' : ''));
  }
  if (late && legs.length) pos.push('⏰ Expiry din, 2 baj gaye: gamma tez hai, exit ko prefer karo.');

  // naya trade lena ho to
  const ok = [], no = []; let wait = null;
  const ce = K => f0(K) + ' CE', pe = K => f0(K) + ' PE';
  switch (e.id) {
    case 'res_up':
      if (Su) ok.push('PE sell Support ' + f0(Su) + ' ke neeche (' + pe(Su - step) + ' / ' + pe(Su - 2 * step) + ').');
      ok.push('CE sell sirf ' + f0(e.to) + ' ke upar (' + ce(e.to + step) + '+).');
      no.push(ce(e.from) + ' sell: wo ab deewar nahi.'); no.push('ATM CE abhi mat becho.'); break;
    case 'res_dn':
      ok.push('CE sell ' + f0(e.to) + ' par / upar (' + ce(e.to) + ' / ' + ce(e.to + step) + ')' + (tr === 'up' ? ', par trend up hai: ek candle ruko.' : '.'));
      no.push('PE sell jodna (bearish jhukaav).'); break;
    case 'sup_up':
      ok.push('PE sell ' + f0(e.to) + ' ke neeche (' + pe(e.to - step) + ').'); no.push('ATM ke paas CE sell.'); break;
    case 'sup_dn':
      if (R) ok.push('CE sell Resistance ' + f0(R) + ' ke upar (' + ce(R + step) + ').');
      no.push(pe(e.from) + ' sell: wo ab floor nahi.'); break;
    case 'res_cover': wait = 'Nayi resistance banne do (CE 🔴 kahan jamta hai, dekho).'; no.push('Koi bhi CE sell abhi.'); break;
    case 'sup_cover': wait = 'Naya support banne do (PE 🔴 kahan jamta hai, dekho).'; no.push('Koi bhi PE sell abhi.'); break;
    case 'cover_new':
      no.push(e.T + ' sell (is taraf sellers bhaag rahe).');
      if (e.T === 'CE' && Su) ok.push('Doosri side dekh sakte ho: PE sell Support ' + f0(Su) + ' ke neeche.');
      if (e.T === 'PE' && R) ok.push('Doosri side dekh sakte ho: CE sell Resistance ' + f0(R) + ' ke upar.'); break;
    case 'range_narrow':
      ok.push('Strangle: ' + ce(e.R) + ' + ' + pe(e.Su) + ' SELL' + (ctx.nowMin < 9 * 60 + 45 ? ' (9:45 ke baad)' : '') + '.');
      no.push('Range toote (5-min close bahar) to turant entry.'); break;
    case 'range_wide': wait = 'Ruko, ya sirf hedge wala trade (spread / condor).'; no.push('Naked strangle.'); break;
  }
  const mode = legs.length ? 'pos' : 'info';
  const lv = mode === 'pos' ? (hot ? 2 : 1) : (e.id === 'res_cover' || e.id === 'sup_cover' ? 2 : 1);
  const dont = mode === 'pos' ? ['✗ SL door mat karo, average mat karo.'] : [];
  // card ki lines
  const why = ['Matlab: ' + e.meaning];
  pos.forEach(x => why.push('Tumhari position: ' + x));
  if (strength) why.push('Trend: ' + (ctx.trendLabel || tr || '?') + ' → ' + strength);
  if (late && !legs.length) why.push('⏰ Expiry din, 2 baj gaye: naya sell mat lo.');
  why.push('👉 Naya trade lena ho to:');
  ok.forEach(x => why.push('✓ ' + x)); if (wait) why.push('⏳ ' + wait); no.forEach(x => why.push('✗ ' + x)); dont.forEach(x => why.push(x));
  return { mode, lv, strength, pos, fresh: { ok, no, wait }, dont, why };
}

KP.oishift = { snap, step, advise, text, DEDUPE_MIN, SIZE_X };
})();
