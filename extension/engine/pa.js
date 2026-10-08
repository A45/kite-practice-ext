/* Price action: levels (zones) + trend (HH-HL) + 5-min candle patterns + order check.
   Sirf NIFTY spot ki recorded candles (KP.day) aur chain ke OI levels se. Sab sirf alert / warning, koi order nahi. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const D = () => KP.day;
const f0 = x => Math.round(x).toLocaleString('en-IN');

/* ---------- levels → zones ----------
   ctx = {S, day, nowMin, manual, em, extra:[{px, tag, w}]}  (extra = OI levels app se)
   Paas-paas ke levels (tol ke andar) ek zone me; score = weights ka jod; ⭐ = score >= 4 ya 3+ tags. */
function tolFor(S, em) { return Math.max(10, 0.15 * (em || S * 0.008)); }
function sources(ctx) {
  const { S, day, nowMin, manual = {} } = ctx, out = [], em = ctx.em || S * 0.008;
  const add = (px, tag, w, kind) => { if (px > 0 && isFinite(px)) out.push({ px: +px, tag, w, kind }); };
  if (day) {
    add(manual.pdh > 0 ? manual.pdh : day.prevHigh, 'Kal ka High', 2, 'pd');
    add(manual.pdl > 0 ? manual.pdl : day.prevLow, 'Kal ka Low', 2, 'pd');
    add(manual.prevClose > 0 ? manual.prevClose : day.prevClose, 'Kal ka Close', 1, 'pd');
    const or = D().or15(day, nowMin, manual);
    if (or && or.complete) { add(or.hi, 'OR high', 2, 'or'); add(or.lo, 'OR low', 2, 'or'); }
    if (nowMin >= D().OR_END + 15) { const hl = D().hiLo(day); if (hl) { add(hl.hi, 'Aaj ka High', 1, 'day'); add(hl.lo, 'Aaj ka Low', 1, 'day'); } }
  }
  for (let r = Math.ceil((S - 1.5 * em) / 100) * 100; r <= S + 1.5 * em; r += 100) add(r, r % 500 === 0 ? f0(r) + ' (bada round)' : f0(r) + ' round', r % 500 === 0 ? 2 : 1, 'round');
  (ctx.extra || []).forEach(x => add(x.px, x.tag, x.w || 2, x.kind || 'oi'));
  return out;
}
function levels(ctx) {
  const tol = tolFor(ctx.S, ctx.em), src = sources(ctx).sort((a, b) => a.px - b.px), zones = [];
  for (const s of src) {
    const z = zones[zones.length - 1];
    // zone ki chaudai max tol (chain bana ke door ke level na judein)
    if (z && s.px - z.lo <= tol) { z.items.push(s); z.hi = Math.max(z.hi, s.px); z.lo = Math.min(z.lo, s.px); }
    else zones.push({ lo: s.px, hi: s.px, items: [s] });
  }
  for (const z of zones) {
    const tags = [], seen = new Set(); let w = 0, sw = 0;
    for (const s of z.items) { if (!seen.has(s.tag)) { seen.add(s.tag); tags.push(s.tag); } w += s.w; sw += s.px * s.w; }
    Object.assign(z, { px: sw / w, score: w, tags, star: w >= 4 || tags.length >= 3, oi: z.items.some(s => s.kind === 'oi'),
      role: (sw / w) > ctx.S ? 'res' : 'sup', dist: sw / w - ctx.S });
    delete z.items;
  }
  return { zones, tol };
}
/* spot ke upar sabse paas resistance / neeche support */
function nearest(zones, S) {
  let res = null, sup = null;
  for (const z of zones) { if (z.lo > S) { if (!res) res = z; } else if (z.hi < S) sup = z; }
  return { res, sup, inside: zones.find(z => S >= z.lo && S <= z.hi) || null };
}

/* ---------- trend (5-min closed candles) ----------
   Swing high = high se 2-2 candle dono taraf neeche; swing low ulta. Pichhle 2 swing high + 2 swing low se HH/HL. */
function swings(c) {
  const H = [], L = [];
  for (let i = 2; i < c.length - 2; i++) {
    if ([-2, -1, 1, 2].every(d => c[i].h > c[i + d].h)) H.push({ i, t: c[i].t, px: c[i].h });
    if ([-2, -1, 1, 2].every(d => c[i].l < c[i + d].l)) L.push({ i, t: c[i].t, px: c[i].l });
  }
  return { H, L };
}
const TL = { up: '📈 Uptrend (HH-HL)', down: '📉 Downtrend (LH-LL)', range: '↔ Range / mixed' };
function trend(c, or) {
  const { H, L } = swings(c), last = c[c.length - 1];
  if (H.length >= 2 && L.length >= 2) {
    const [h1, h2] = H.slice(-2), [l1, l2] = L.slice(-2), hh = h2.px > h1.px, hl = l2.px > l1.px;
    const dir = hh && hl ? 'up' : !hh && !hl ? 'down' : 'range';
    const why = (hh ? 'Higher High' : 'Lower High') + ' (' + f0(h1.px) + ' → ' + f0(h2.px) + '), ' + (hl ? 'Higher Low' : 'Lower Low') + ' (' + f0(l1.px) + ' → ' + f0(l2.px) + ')';
    // aakhri close ne pichhla swing low / high tod diya = structure toota
    let broke = null;
    if (dir === 'up' && last && last.c < l2.px) broke = 'Close ' + f0(last.c) + ' ne pichhla Higher Low ' + f0(l2.px) + ' tod diya: uptrend kamzor.';
    if (dir === 'down' && last && last.c > h2.px) broke = 'Close ' + f0(last.c) + ' ne pichhla Lower High ' + f0(h2.px) + ' tod diya: downtrend kamzor.';
    return { dir, label: TL[dir], strong: !broke, why: broke ? why + '. ' + broke : why, swings: { H: H.slice(-2), L: L.slice(-2) } };
  }
  if (last && or && or.complete) {
    const dir = last.c > or.hi ? 'up' : last.c < or.lo ? 'down' : 'range';
    return { dir, label: TL[dir], strong: false, why: 'Abhi swing kam bane: ' + (dir === 'up' ? 'price OR high ' + f0(or.hi) + ' ke upar' : dir === 'down' ? 'price OR low ' + f0(or.lo) + ' ke neeche' : 'price opening range ke andar') + ' (kamzor signal)', swings: { H, L } };
  }
  return { dir: 'range', label: TL.range, strong: false, why: 'Candles kam hain (trend ke liye ~30 min chahiye).', swings: { H, L } };
}

/* ---------- 5-min candle patterns (sirf aakhri closed candle) ----------
   Pattern level (zone) par hi maayne rakhta hai; inside bar ko chhod ke. */
function patterns(c, zones, tol) {
  const n = c.length; if (n < 2) return [];
  const k = c[n - 1], p = c[n - 2], out = [], body = Math.abs(k.c - k.o), rng = Math.max(k.h - k.l, 0.05);
  const upW = k.h - Math.max(k.o, k.c), dnW = Math.min(k.o, k.c) - k.l, bull = k.c > k.o, bear = k.c < k.o;
  const best = zs => zs.sort((a, b) => b.score - a.score)[0] || null;
  const at = (z) => (z.star ? ' ⭐' : '') + ' (' + z.tags.join(' + ') + ')';
  const lvl = z => f0(z.px);
  const push = (id, dir, z, title, why) => out.push({ id, dir, zone: z, t: k.t, title, why });

  // breakout / breakdown: close zone ke paar, pichhla close andar / is paar; body >= 50% range
  const bo = best(zones.filter(z => p.c <= z.hi && k.c > z.hi + 0.1 * tol && bull && body >= 0.5 * rng));
  const bd = best(zones.filter(z => p.c >= z.lo && k.c < z.lo - 0.1 * tol && bear && body >= 0.5 * rng));
  if (bo) push('breakout', 'bull', bo, '🚀 Breakout ' + lvl(bo) + at(bo), ['5-min candle ' + f0(k.c) + ' par level ke UPAR close hui (sirf wick nahi).', 'Asli breakout ka pakka sabut: wapas aake ' + lvl(bo) + ' ko test kare aur upar hi rahe (retest).']);
  if (bd) push('breakdown', 'bear', bd, '🔻 Breakdown ' + lvl(bd) + at(bd), ['5-min candle ' + f0(k.c) + ' par level ke NEECHE close hui.', 'Pakka tab: wapas ' + lvl(bd) + ' tak aaye aur neeche hi rahe (retest).']);

  // fakeout: pichhli candle paar close hui thi, ye wapas andar
  if (n >= 3) {
    const pp = c[n - 3];
    const fu = best(zones.filter(z => pp.c <= z.hi && p.c > z.hi && k.c <= z.hi));
    const fd = best(zones.filter(z => pp.c >= z.lo && p.c < z.lo && k.c >= z.lo));
    if (fu) push('fakeout', 'bear', fu, '🪤 Fakeout ' + lvl(fu) + ' (upar)' + at(fu), ['Pichhli candle ' + lvl(fu) + ' ke upar close hui thi, ye wapas neeche aa gayi.', 'Breakout fail = buyers fanse. Aksar tez girawat aati hai.']);
    if (fd) push('fakeout', 'bull', fd, '🪤 Fakeout ' + lvl(fd) + ' (neeche)' + at(fd), ['Pichhli candle ' + lvl(fd) + ' ke neeche close hui thi, ye wapas upar aa gayi.', 'Breakdown fail = sellers fanse. Aksar tez uchhal aata hai.']);
  }

  // retest: pichhle 6 candles me breakout, ab level tak aaya aur paar hi close
  if (!bo && !bd) {
    for (const z of zones) {
      for (let j = Math.max(1, n - 7); j <= n - 2; j++) {
        const a = c[j - 1], b = c[j];
        if (a.c <= z.hi && b.c > z.hi && k.l <= z.hi + tol && k.c > z.hi && !out.some(o => o.id === 'retest')) { push('retest', 'bull', z, '✅ Breakout retest hold ' + lvl(z) + at(z), ['Breakout ke baad price wapas ' + lvl(z) + ' tak aaya aur upar hi close hua.', 'Purana resistance ab support ban gaya: breakout pakka hone ka ishara.']); break; }
        if (a.c >= z.lo && b.c < z.lo && k.h >= z.lo - tol && k.c < z.lo && !out.some(o => o.id === 'retest')) { push('retest', 'bear', z, '✅ Breakdown retest hold ' + lvl(z) + at(z), ['Breakdown ke baad price wapas ' + lvl(z) + ' tak aaya aur neeche hi close hua.', 'Purana support ab resistance ban gaya.']); break; }
      }
    }
  }

  // rejection / pin bar: lambi wick level ko chhu ke wapas
  if (!bo && !bd) {
    const rr = best(zones.filter(z => upW >= 2 * Math.max(body, 0.05) && upW >= 0.4 * rng && k.h >= z.lo - 0.5 * tol && k.c < z.lo));
    const rs = best(zones.filter(z => dnW >= 2 * Math.max(body, 0.05) && dnW >= 0.4 * rng && k.l <= z.hi + 0.5 * tol && k.c > z.hi));
    if (rr && !out.some(o => o.id === 'fakeout' && o.dir === 'bear')) push('rejection', 'bear', rr, '🕯️ Rejection @ ' + lvl(rr) + ' (resistance)' + at(rr), ['Upar lambi wick (' + f0(upW) + ' pts): price ' + lvl(rr) + ' tak gaya, sellers ne wapas dhakel diya.', 'Close ' + f0(k.c) + ' level ke neeche: yahan se girne ka chance.']);
    if (rs && !out.some(o => o.id === 'fakeout' && o.dir === 'bull')) push('rejection', 'bull', rs, '🕯️ Rejection @ ' + lvl(rs) + ' (support)' + at(rs), ['Neeche lambi wick (' + f0(dnW) + ' pts): price ' + lvl(rs) + ' tak gira, buyers ne wapas uthaya.', 'Close ' + f0(k.c) + ' level ke upar: yahan se uchhalne ka chance.']);
  }

  // engulfing: level ke paas, naya body pichhle ulte rang ke body ko poora dhak le
  const pb = Math.abs(p.c - p.o);
  if (bull && p.c < p.o && k.c >= p.o && k.o <= p.c && body > pb) { const z = best(zones.filter(x => Math.min(k.l, p.l) <= x.hi + tol && Math.min(k.l, p.l) >= x.lo - tol)); if (z) push('engulf', 'bull', z, '🟩 Bullish engulfing @ ' + lvl(z) + at(z), ['Hari candle ne pichhli laal candle ko poora dhak liya, support ke paas.', 'Buyers ne control le liya: upar jaane ka ishara.']); }
  if (bear && p.c > p.o && k.c <= p.o && k.o >= p.c && body > pb) { const z = best(zones.filter(x => Math.max(k.h, p.h) <= x.hi + tol && Math.max(k.h, p.h) >= x.lo - tol)); if (z) push('engulf', 'bear', z, '🟥 Bearish engulfing @ ' + lvl(z) + at(z), ['Laal candle ne pichhli hari candle ko poora dhak liya, resistance ke paas.', 'Sellers ne control le liya: neeche jaane ka ishara.']); }

  // inside bar (level ki zaroorat nahi)
  if (k.h <= p.h && k.l >= p.l) push('inside', 'neutral', null, '⏸️ Inside bar (' + f0(p.l) + ' – ' + f0(p.h) + ')', ['Candle pichhli candle ke andar: market saans le raha hai.', 'Is range ka high (' + f0(p.h) + ') ya low (' + f0(p.l) + ') toota to us taraf move aa sakta hai.']);
  return out;
}

/* ---------- OI se pakki / kachchi ----------
   bu = [{T:'CE'|'PE', id:'long'|'short'|'cover'|'unwind'}] us zone ke strikes par */
function confirm(p, bu) {
  if (!p || !p.zone || !bu || !bu.length) return null;
  const has = (T, id) => bu.some(b => b.T === T && b.id === id);
  if ((p.id === 'rejection' || p.id === 'fakeout' || p.id === 'engulf') && p.dir === 'bear' && has('CE', 'short')) return { ok: true, txt: 'OI bhi saath: CE sellers (🔴 Short buildup) isi level par baithe hain. Strong resistance.' };
  if ((p.id === 'rejection' || p.id === 'fakeout' || p.id === 'engulf') && p.dir === 'bull' && has('PE', 'short')) return { ok: true, txt: 'OI bhi saath: PE sellers (🔴 Short buildup) isi level par baithe hain. Strong support.' };
  if ((p.id === 'breakout' || p.id === 'retest') && p.dir === 'bull') {
    if (has('CE', 'cover')) return { ok: true, txt: 'Asli breakout: CE sellers bhaag rahe hain (🔵 Short covering).' };
    if (has('CE', 'short')) return { ok: false, txt: 'Savdhaan: CE sellers abhi bhi yahan likh rahe hain (🔴). Fakeout ho sakta hai.' };
  }
  if ((p.id === 'breakdown' || p.id === 'retest') && p.dir === 'bear') {
    if (has('PE', 'cover')) return { ok: true, txt: 'Asli breakdown: PE sellers bhaag rahe hain (🔵 Short covering).' };
    if (has('PE', 'short')) return { ok: false, txt: 'Savdhaan: PE sellers abhi bhi yahan likh rahe hain (🔴). Fakeout ho sakta hai.' };
  }
  return null;
}

/* ---------- order popup check (warning, order kabhi block nahi) ----------
   o = {type:'CE'|'PE', side:'BUY'|'SELL'}, st = {trend, zones, S, tol, recent:[patterns pichhle ~15 min]} */
function orderCheck(o, st) {
  const warn = [], ok = []; if (!st || !st.trend) return { warn, ok };
  const { trend: tr, zones, S, tol } = st, nr = nearest(zones || [], S), rec = st.recent || [];
  const bullBO = rec.some(p => p.dir === 'bull' && (p.id === 'breakout' || p.id === 'retest' || p.id === 'fakeout'));
  const bearBO = rec.some(p => p.dir === 'bear' && (p.id === 'breakdown' || p.id === 'retest' || p.id === 'fakeout'));
  const up = tr.dir === 'up', down = tr.dir === 'down', near = (z) => z && Math.abs(z.px - S) <= 2 * tol;
  const zl = z => f0(z.px) + (z.star ? ' ⭐' : '');
  if (o.type === 'CE' && o.side === 'SELL') {
    if (up) warn.push('Price action: ' + tr.label + ' chal raha hai, tum CE bech rahe ho (trend ke khilaaf).');
    if (bullBO) warn.push('Abhi upar breakout / bullish signal aaya hai. CE sell risky.');
    if (!up && nr.res && near(nr.res)) ok.push('✓ Resistance ' + zl(nr.res) + ' ke neeche CE sell' + (down ? ' + downtrend' : '') + ': price action ke saath.');
  }
  if (o.type === 'PE' && o.side === 'SELL') {
    if (down) warn.push('Price action: ' + tr.label + ' chal raha hai, tum PE bech rahe ho (trend ke khilaaf).');
    if (bearBO) warn.push('Abhi neeche breakdown / bearish signal aaya hai. PE sell risky.');
    if (!down && nr.sup && near(nr.sup)) ok.push('✓ Support ' + zl(nr.sup) + ' ke upar PE sell' + (up ? ' + uptrend' : '') + ': price action ke saath.');
  }
  if (o.type === 'CE' && o.side === 'BUY') {
    if (down) warn.push('Price action: ' + tr.label + ', tum CE kharid rahe ho (trend ke khilaaf).');
    if (nr.res && near(nr.res) && !bullBO) warn.push('Resistance ' + zl(nr.res) + ' sirf ' + f0(nr.res.px - S) + ' pts upar hai, wahan se palat sakta hai. 5-min close upar (breakout) ka intezaar karo.');
    if (up && !(nr.res && near(nr.res) && !bullBO)) ok.push('✓ Uptrend ke saath CE buy.');
  }
  if (o.type === 'PE' && o.side === 'BUY') {
    if (up) warn.push('Price action: ' + tr.label + ', tum PE kharid rahe ho (trend ke khilaaf).');
    if (nr.sup && near(nr.sup) && !bearBO) warn.push('Support ' + zl(nr.sup) + ' sirf ' + f0(S - nr.sup.px) + ' pts neeche hai, wahan se uchhal sakta hai. 5-min close neeche (breakdown) ka intezaar karo.');
    if (down && !(nr.sup && near(nr.sup) && !bearBO)) ok.push('✓ Downtrend ke saath PE buy.');
  }
  if (warn.length) ok.length = 0;                                          // warning ho to "✓ saath" nahi (ulta signal)
  return { warn, ok };
}

KP.pa = { tolFor, sources, levels, nearest, swings, trend, patterns, confirm, orderCheck, TL };
})();
