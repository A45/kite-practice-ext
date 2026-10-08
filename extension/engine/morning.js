/* Subah ka plan: phase (kab), signals (gap, opening range, IV, VIX, DTE, event), day type,
   strategy menu + recommendation score, aur din ke end me review. Future nahi jaanta, sirf rules + abhi ke numbers. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const { an: A, day: D, risk: RK, fmt: { f2, nf0 } } = KP;

function defaultMorning() {
  return { gapS: 0.3, gapB: 0.8, orQ: 0.5, orW: 1.0, ivRise: 5, ivLow: 11, ivHigh: 16, icDelta: 0.17, spreadDelta: 0.28 };
}

/* ---------- phase ---------- */
const PHASES = {
  pre: ['Pre-open', 'Market 9:15 par khulega. Gap, VIX aur aaj ke events dekho.'],
  observe: ['Observe', 'Pehli 15 min candle ban rahi hai. 9:30 tak koi order nahi.'],
  assess: ['Market chalu', 'Opening range ban gayi. Coach ab tak ke data (gap, OR, breakout, IV, din ka move) se suggest karta hai.'],
  decide: ['Market chalu', 'Coach ab tak ke data (gap, OR, breakout, IV, din ka move) se suggest karta hai.'],
  late: ['Market chalu', 'Coach ab tak ke data (gap, OR, breakout, IV, din ka move) se suggest karta hai.'],
  closed: ['Market band', 'Market band hai.'] };
const PHASE_END = { pre: 555, observe: 570, assess: 600, decide: 690, late: 930 };
function phase(t) {
  const wd = new Date(t + 5.5 * 3600e3).getUTCDay(); if (wd === 0 || wd === 6) return 'closed';
  const m = KP.istMin(t);
  return m < 555 ? 'pre' : m < 570 ? 'observe' : m < 600 ? 'assess' : m < 690 ? 'decide' : m < 930 ? 'late' : 'closed';
}
/* agle phase tak kitne minute */
function phaseLeft(t) { const p = phase(t), e = PHASE_END[p]; return e == null ? null : e - KP.istMin(t); }

/* ---------- signals ---------- */
const DT = { range: 'Range day (sideways)', mildBull: 'Upar ka trend', mildBear: 'Neeche ka trend', wild: 'Volatile / wild', event: 'Event day', unclear: 'Abhi saaf nahi' };
/* inp = {mkt, day, now, manual:{prevClose, orHi, orLo, vix, vixChg, event}, vix:{v,chg}|null, cfg(morning)} */
function signals(inp) {
  const { mkt, day, now, cfg } = inp, man = inp.manual || {}, m = KP.istMin(now), S = mkt.S, iv = mkt.ready ? mkt.atmIV() : null;
  const em = S && iv ? S * iv / 100 / Math.sqrt(365) : null;              // 1 din ka expected move (pts)
  const or = D.or15(day, m, man), op = D.open(day);
  const prev = man.prevClose > 0 ? +man.prevClose : day.prevClose, openPx = op ? op.px : null;
  const gap = prev && openPx ? (openPx - prev) / prev * 100 : null;
  const orW = or ? or.hi - or.lo : null, orRatio = orW != null && em ? orW / em : null;
  let pos = null;
  if (or && or.complete) {
    const c5 = D.candles(day, 5).filter(c => c.t >= D.OR_END && c.t + 5 <= m), last2 = c5.slice(-2), hl = D.hiLo(day, D.OR_END), tol = 0.1 * (orW || 0);
    const px = D.lastPx(day) ?? S;
    if (hl && hl.hi > or.hi + tol && hl.lo < or.lo - tol) pos = 'both';
    else if (last2.length === 2 && last2.every(c => c.c > or.hi)) pos = 'above';
    else if (last2.length === 2 && last2.every(c => c.c < or.lo)) pos = 'below';
    else pos = px > or.hi ? 'abovePending' : px < or.lo ? 'belowPending' : 'inside';
  }
  const iv0 = day.iv0, ivChg = iv0 && iv ? (iv - iv0) / iv0 * 100 : null;
  const vix = man.vix > 0 ? { v: +man.vix, chg: man.vixChg === '' || man.vixChg == null ? null : +man.vixChg, src: 'manual' } : inp.vix || null;
  const dte = mkt.ready ? mkt.dte() : null, event = !!man.event;
  const ivRef = vix ? vix.v : iv, ivLevel = ivRef == null ? null : ivRef < cfg.ivLow ? 'low' : ivRef > cfg.ivHigh ? 'high' : 'mid';

  const items = [], it = (k, lv, txt) => items.push({ k, lv, txt });
  const SRC = { 'kite-header': 'Kite page', kite: 'Kite Connect', yahoo: 'Yahoo backup' }, intra = inp.intra || {};
  // candles kyun nahi aayi, wo saaf likho (background ka asli error)
  const why = intra.err ? 'Wajah: ' + intra.err + '. ' : intra.pending ? 'Kite Connect se laa raha hai… ' : '';
  const fix = why + (/permission|plan|historical/i.test(intra.err || '') ? 'developer.kite.trade par app ka plan check karo.' : 'Settings → "Kite Connect API" se login karo (ya neeche khud bharo).');
  const prevLab = man.prevClose > 0 ? 'manual' : SRC[day.prevSrc] || 'record';
  if (gap == null) it('gap', null, prev ? (m < D.OPEN ? 'Kal ka close ' + nf0.format(prev) + ' (' + prevLab + '). Gap 9:15 par banega.' : 'Kal ka close ' + nf0.format(prev) + ', lekin aaj ka open nahi mila (panel 9:15 ke baad khula). ' + fix)
    : 'Kal ka close nahi mila. ' + fix);
  else { const g = Math.abs(gap); it('gap', g < cfg.gapS ? 0 : g < cfg.gapB ? 1 : 2, 'Gap ' + (gap > 0 ? 'up ' : 'down ') + gap.toFixed(2) + '% (' + (g < cfg.gapS ? 'chhota' : g < cfg.gapB ? 'medium' : 'bada') + '): kal ' + nf0.format(prev) + ' → aaj open ' + nf0.format(openPx) + ' · ' + prevLab + (op && !op.exact ? ', open approx' : '')); }
  if (!or) it('or', null, m < D.OPEN ? 'Opening range 9:15–9:30 me banegi.' : m < D.OR_END ? 'Opening range ban rahi hai (9:15–9:30).' : 'Opening range nahi mili (panel 9:15 ke baad khula). ' + fix);
  else {
    const lv = orRatio == null ? null : orRatio < cfg.orQ ? 0 : orRatio <= cfg.orW ? 1 : 2;
    it('or', lv, 'Opening range ' + nf0.format(or.lo) + '–' + nf0.format(or.hi) + ' (' + Math.round(orW) + ' pts' + (orRatio != null ? ' = expected move ' + Math.round(em) + ' ka ' + orRatio.toFixed(2) + '×' : '') + ')' +
      (or.src === 'partial' ? '. Adhoori: 9:15 ke baad khola' : or.src === 'manual' ? '. Manual' : day.backfill ? ' · ' + SRC[day.backfill] + ' candles' : ' · Kite live ticks') + (or.complete ? '' : '. Abhi ban rahi hai') +
      (day.backfill !== 'kite' && intra.err ? ' (Kite Connect se candles nahi aayi: ' + intra.err + ')' : ''));
  }
  if (pos) it('pos', { inside: 0, above: 1, below: 1, abovePending: 1, belowPending: 1, both: 2 }[pos],
    { inside: 'Price OR ke andar: range jaisa din', above: 'OR high ke upar 2 candle close: upar ka trend', below: 'OR low ke neeche 2 candle close: neeche ka trend',
      abovePending: 'OR high ke upar gaya, 2 candle close ka confirmation baaki', belowPending: 'OR low ke neeche gaya, 2 candle close ka confirmation baaki', both: 'OR dono taraf toot chuka: choppy / volatile' }[pos]);
  if (ivChg != null) it('ivChg', ivChg >= cfg.ivRise ? 2 : ivChg <= -3 ? 0 : ivChg > 2 ? 1 : 0, 'ATM IV ' + f2(iv) + '%, open se ' + (ivChg >= 0 ? '+' : '') + ivChg.toFixed(1) + '%' + (ivChg >= cfg.ivRise ? ' (darr badh raha, seller ke khilaaf)' : ivChg <= -3 ? ' (IV gir raha, seller ko fayda)' : ''));
  if (vix) it('vix', vix.chg == null ? 0 : vix.chg >= cfg.ivRise ? 2 : vix.chg > 2 ? 1 : 0, 'India VIX ' + f2(vix.v) + (vix.chg != null ? ' (' + (vix.chg >= 0 ? '+' : '') + vix.chg.toFixed(1) + '%)' : ''));
  if (ivLevel) it('ivLvl', ivLevel === 'mid' ? 0 : 1, ivLevel === 'low' ? 'Volatility kam: premium sasta (seller ko kam credit, buyer ke liye sasta)' : ivLevel === 'high' ? 'Volatility zyada: premium mehenga (seller ko zyada credit, risk bhi zyada)' : 'Volatility normal');
  if (dte != null) it('dte', dte === 0 ? 2 : dte === 1 ? 1 : 0, dte === 0 ? 'Aaj expiry: gamma bahut tez, ek jhatke me bada loss' : 'Expiry me ' + dte + ' trading din');
  if (event) it('event', 2, 'Aaj event day (RBI / Fed / budget / result)');
  const core = items.filter(i => ['gap', 'or', 'pos'].includes(i.k));
  const allGreen = core.length === 3 && items.every(i => i.lv === 0);

  // din ab tak: open se kitna chala, aur din ki range (dono EM ke multiple me) — kisi bhi waqt login karo, pura din dikhe
  const dHL = D.hiLo(day), nowPx = D.lastPx(day) ?? S, moveX = openPx && em ? (nowPx - openPx) / em : null, rangeX = dHL && em ? (dHL.hi - dHL.lo) / em : null;
  if (moveX != null && D.minutes(day).length > 15) it('day', Math.abs(moveX) < 0.4 && rangeX < 1.2 ? 0 : Math.abs(moveX) < 0.8 && rangeX < 1.6 ? 1 : 2,
    'Din ab tak: open se ' + (moveX >= 0 ? '+' : '') + Math.round(nowPx - openPx) + ' pts (' + (moveX >= 0 ? '+' : '') + moveX.toFixed(2) + '× EM), range ' + nf0.format(dHL.lo) + '–' + nf0.format(dHL.hi) + ' (' + rangeX.toFixed(2) + '× EM)');
  const sig = { S, iv, em, or, orW, orRatio, open: openPx, prev, gap, pos, ivChg, vix, ivLevel, dte, event, items, allGreen, min: m, moveX, rangeX };
  sig.dt = dayType(sig, cfg);
  return sig;
}
function dayType(sig, cfg) {
  if (sig.event) return 'event';
  if (!sig.or || !sig.or.complete || sig.orRatio == null) return 'unclear';
  if (sig.pos === 'both' || sig.orRatio > cfg.orW || Math.abs(sig.gap || 0) >= cfg.gapB || (sig.ivChg || 0) >= 2 * cfg.ivRise || (sig.rangeX || 0) >= 1.6) return 'wild';
  if (sig.pos === 'above') return 'mildBull';
  if (sig.pos === 'below') return 'mildBear';
  if (sig.pos === 'inside') return (sig.moveX != null && Math.abs(sig.moveX) >= 0.6) ? (sig.moveX > 0 ? 'mildBull' : 'mildBear') : 'range';
  // breakout pending: din ka move saaf ho to wahi trend, warna unclear
  if (sig.moveX != null && Math.abs(sig.moveX) >= 0.5) return sig.moveX > 0 ? 'mildBull' : 'mildBear';
  return 'unclear';
}

/* ---------- strategy menu ---------- */
const STRATS = [
  { id: 'ic', name: 'Iron Condor', kind: 'credit', view: 'Range', when: 'Market ek range me rahega. Dono taraf OTM sell, hedge ke saath. Time (theta) tumhare saath.' },
  { id: 'bullPut', name: 'Bull Put Spread', kind: 'credit', view: 'Upar / neeche nahi girega', when: 'Halki teji ya support ke upar. Neeche ka OTM put sell, aur neeche hedge.' },
  { id: 'bearCall', name: 'Bear Call Spread', kind: 'credit', view: 'Neeche / upar nahi jayega', when: 'Halki mandi ya resistance ke neeche. Upar ka OTM call sell, aur upar hedge.' },
  { id: 'bullCall', name: 'Bull Call Spread', kind: 'debit', view: 'Upar ka move', when: 'Saaf upar ka trend aur premium sasta. ATM call buy, OTM call sell. Max loss = debit.' },
  { id: 'bearPut', name: 'Bear Put Spread', kind: 'debit', view: 'Neeche ka move', when: 'Saaf neeche ka trend aur premium sasta. ATM put buy, OTM put sell. Max loss = debit.' },
  { id: 'straddle', name: 'Long Straddle', kind: 'debit', view: 'Bada move (kisi bhi taraf)', when: 'Bada breakout expected aur IV abhi sasta. ATM call + put buy. Range day me theta khata hai.' },
  { id: 'wait', name: 'Wait (abhi nahi)', kind: 'none', view: 'Confirmation chahiye', when: 'Signals saaf nahi. Agle 1–2 candle close (breakout ya range) ka confirmation lo, phir dobara decide karo.' },
  { id: 'noTrade', name: 'Aaj No trade', kind: 'none', view: 'Aaj risk layak nahi', when: 'Event day, ya bahut volatile din jahan IV bhi badh raha ho. Trade na karna bhi ek decision hai.' }];
const SBY = Object.fromEntries(STRATS.map(s => [s.id, s]));

/* cfg = {ic:{wing,lots}, morning} */
function legsFor(mkt, id, sig, cfg) {
  const step = mkt.step, c = mkt.atm(), M = cfg.morning, nb = KP.opts.nearestByDelta;
  const wing = Math.max(step, Math.round((+cfg.ic.wing || 200) / step) * step), lots = Math.max(1, parseInt(cfg.ic.lots) || 1);
  const orHi = sig.or ? sig.or.hi : c, orLo = sig.or ? sig.or.lo : c, L = (type, K, side) => ({ type, K, side, lots });
  switch (id) {
    case 'ic': {
      const sc = nb(mkt, 'CE', M.icDelta, K => K > Math.max(c, orHi)), sp = nb(mkt, 'PE', M.icDelta, K => K < Math.min(c, orLo));
      return sc == null || sp == null ? null : [L('PE', sp - wing, 'BUY'), L('CE', sc + wing, 'BUY'), L('PE', sp, 'SELL'), L('CE', sc, 'SELL')];
    }
    case 'bullPut': { const sp = nb(mkt, 'PE', M.spreadDelta, K => K < Math.min(c, orLo)); return sp == null ? null : [L('PE', sp - wing, 'BUY'), L('PE', sp, 'SELL')]; }
    case 'bearCall': { const sc = nb(mkt, 'CE', M.spreadDelta, K => K > Math.max(c, orHi)); return sc == null ? null : [L('CE', sc + wing, 'BUY'), L('CE', sc, 'SELL')]; }
    case 'bullCall': return [L('CE', c, 'BUY'), L('CE', c + wing, 'SELL')];
    case 'bearPut': return [L('PE', c, 'BUY'), L('PE', c - wing, 'SELL')];
    case 'straddle': return [L('CE', c, 'BUY'), L('PE', c, 'BUY')];
    default: return [];
  }
}
function stats(mkt, legs, lot, R) {
  if (!legs || !legs.length) return null;
  let net = 0;
  const q = legs.map(l => { const px = mkt.ltp(l.type, l.K), u = l.lots * lot * (l.side === 'BUY' ? 1 : -1); net -= u * px; return { type: l.type, K: l.K, qty: u, avg: px, live: mkt.live(l.type, l.K) != null }; });
  const an = A.analyse(mkt, q), kind = net > 0 ? 'credit' : 'debit', unitRs = Math.abs(net);
  const wingPts = legs.length >= 2 ? Math.max(...legs.filter(l => l.side === 'SELL').map(s => Math.min(...legs.filter(b => b.side === 'BUY' && b.type === s.type).map(b => Math.abs(b.K - s.K)))), 0) : 0;
  return Object.assign({ legs: q, net, kind, unitRs, maxP: an.unlimProfit ? Infinity : an.mx, maxL: an.unlimLoss ? -Infinity : an.mn, be: an.be, pop: an.pop,
    rrStruct: an.unlimProfit || an.mx <= 0 ? null : Math.abs(an.mn) / an.mx, creditPct: kind === 'credit' && wingPts > 0 && isFinite(wingPts) ? net / (wingPts * Math.abs(q[0].qty)) : null }, RK.levels(kind, unitRs, R));
}

/* score 5..95 + top-3 why (opts.score jaisa shape) */
function score(id, sig, ph, st, cfg) {
  const M = cfg.morning, dt = sig.dt, s0 = SBY[id], trade = s0.kind !== 'none', credit = s0.kind === 'credit', why = []; let s = 50;
  const add = (v, t) => { s += v; why.push({ v, t }); };
  if (trade && !st) add(-40, 'Strikes nahi bane (chain data kam hai)');
  // Sirf DATA par score (ghadi / time window ka koi rule nahi): student kisi bhi waqt aaye, us waqt tak ke data se suggestion
  if (sig.event) { if (trade) add(id === 'straddle' ? -5 : -25, 'Event day: bada jhatka kisi bhi taraf'); if (id === 'noTrade') add(30, 'Event day par bahar rehna safe'); }
  if (trade && sig.orRatio == null) add(-8, 'Opening range ka data nahi (din ka pattern adhoora)');
  const ivUp = sig.ivChg != null && sig.ivChg >= M.ivRise, ivDown = sig.ivChg != null && sig.ivChg <= -3, exp0 = sig.dte === 0;
  const strong = sig.moveX != null && Math.abs(sig.moveX) >= 0.9, moveUp = (sig.moveX || 0) > 0;     // halki teji → credit spread; bahut strong move → debit spread ko bonus
  switch (id) {
    case 'ic':
      if (dt === 'range') add(22, 'Range day: IC ke liye best'); else if (dt === 'mildBull' || dt === 'mildBear') add(-12, 'Trend day me ek side tootegi'); else if (dt === 'wild') add(-22, 'Volatile din: short strikes khatre me'); else if (dt === 'unclear') add(-5, 'Day type saaf nahi');
      if (sig.orRatio != null && sig.orRatio < M.orQ) add(6, 'Opening shaant (OR chhota)');
      break;
    case 'bullPut': case 'bearCall': {
      const up = id === 'bullPut';
      if (dt === (up ? 'mildBull' : 'mildBear')) add(20, up ? 'Upar ka trend: neeche ka put spread safe' : 'Neeche ka trend: upar ka call spread safe');
      else if (dt === (up ? 'mildBear' : 'mildBull')) add(-22, 'Trend ulti taraf hai');
      else if (dt === 'range') add(4, 'Range me bhi chalega, par IC zyada kamata');
      else if (dt === 'wild') add(-12, 'Volatile din');
      if (sig.gap != null && Math.abs(sig.gap) >= M.gapS && (sig.gap > 0) === up && dt !== 'wild') add(4, 'Gap bhi isi taraf');
      break;
    }
    case 'bullCall': case 'bearPut': {
      const up = id === 'bullCall';
      if (dt === (up ? 'mildBull' : 'mildBear')) add(14, 'Trend isi taraf');
      else if (dt === 'wild' && (sig.pos === (up ? 'above' : 'below') || (strong && moveUp === up))) add(8, 'Bada move isi taraf');
      if (strong && moveUp === up && dt !== 'range') add(8, 'Open se strong move (' + Math.abs(sig.moveX).toFixed(1) + '× EM) isi taraf');
      else if (dt === (up ? 'mildBear' : 'mildBull')) add(-22, 'Trend ulti taraf hai');
      else if (dt === 'range') add(-12, 'Range day me debit spread theta khata hai');
      if (sig.ivLevel === 'high') add(-8, 'Mehenga premium khareedna'); else if (sig.ivLevel === 'low') add(6, 'Premium sasta');
      if (exp0) add(-5, 'Expiry day: time value tez girta hai');
      break;
    }
    case 'straddle':
      if (dt === 'range') add(-22, 'Range day: dono legs ka theta jalega');
      else if (dt === 'mildBull' || dt === 'mildBear') add(-6, 'Ek taraf ka trend: spread sasta padta');
      else if (dt === 'wild') add(ivUp ? -10 : 10, ivUp ? 'IV pehle hi badh chuka, mehenga' : 'Bada move chal raha hai');
      if (sig.orRatio != null && sig.orRatio < 0.3 && sig.ivLevel === 'low') add(12, 'Squeeze + sasta IV: breakout ka mauka');
      if (sig.ivLevel === 'high') add(-10, 'IV zyada: straddle mehenga');
      if (exp0) add(-6, 'Expiry day: theta bahut tez');
      break;
    case 'wait':
      if (dt === 'unclear') add(18, 'Signals abhi saaf nahi: agla 5-min candle close dekho');
      if (['range', 'mildBull', 'mildBear'].includes(dt)) add(-15, 'Signal saaf hai, wait se mauka chhootega');
      if (dt === 'wild' && !ivUp) add(8, 'Volatile: thoda settle hone do');
      break;
    case 'noTrade':
      if (dt === 'wild' && (ivUp || (sig.rangeX || 0) >= 2)) add(18, 'Bahut volatile' + (ivUp ? ' aur IV badh raha' : ' (din ki range ' + (sig.rangeX || 0).toFixed(1) + '× EM)') + ': aaj skip');
      if (['range', 'mildBull', 'mildBear'].includes(dt)) add(-20, 'Achha setup hai, skip karna jaldi hai');
      if (dt === 'unclear') add(6, 'Kuch saaf nahi');
      if (!sig.event && dt !== 'wild') add(-10, 'Data me koi bada risk nahi dikh raha');
      break;
  }
  if (credit && st) {
    if (ivUp) add(-8, 'IV badh raha hai (seller ke khilaaf)'); else if (ivDown) add(5, 'IV gir raha hai (seller ko fayda)');
    if (exp0) add(id === 'ic' ? -15 : -10, 'Expiry day: gamma risk');
    if (st.creditPct != null) { if (st.creditPct < 0.2) add(-15, 'Credit wing ka 20% se kam: risk layak nahi'); else if (st.creditPct >= 0.3) add(5, 'Credit achha (wing ka ' + Math.round(st.creditPct * 100) + '%)'); }
    if (st.rrStruct != null && st.rrStruct > 4.5) add(-8, 'Max loss max profit ka ' + st.rrStruct.toFixed(1) + '×');
  }
  return { score: Math.round(Math.max(5, Math.min(95, s))), why: why.filter(w => Math.abs(w.v) >= 2).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3) };
}

/* Poora menu: inp (signals jaisa) + cfg {morning, risk, ic, lot} */
function build(inp, cfg) {
  const sig = signals(Object.assign({}, inp, { cfg: cfg.morning })), ph = inp.phase || phase(inp.now), list = STRATS.map(s0 => {
    const legs = s0.kind === 'none' || !inp.mkt.ready ? [] : legsFor(inp.mkt, s0.id, sig, cfg), st = legs && legs.length ? stats(inp.mkt, legs, cfg.lot, cfg.risk) : null;
    return Object.assign({}, s0, { legs, st }, score(s0.id, sig, ph, st, cfg));
  });
  const best = list.reduce((a, b) => b.score > a.score ? b : a).id;
  return { sig, ph, list, best };
}

/* ---------- din ke end ka review ---------- */
const ACT = { range: 'Range day', trendUp: 'Upar ka trend day', trendDown: 'Neeche ka trend day', wild: 'Volatile day', mixed: 'Mixed / choppy day' };
const GOOD = { range: ['ic', 'bullPut', 'bearCall'], trendUp: ['bullPut', 'bullCall'], trendDown: ['bearCall', 'bearPut'], wild: ['straddle', 'noTrade', 'wait'], mixed: ['wait', 'noTrade'] };
/* pick = {id, best, sig:{em, orHi, orLo}} */
function review(day, pick) {
  const hl = D.hiLo(day), op = D.open(day), close = day.close ?? D.lastPx(day);
  if (!hl || !op || !close || !pick || !pick.sig || !(pick.sig.em > 0)) return null;
  const em = pick.sig.em, o = op.px, orHi = pick.sig.orHi ?? o, orLo = pick.sig.orLo ?? o, R = hl.hi - hl.lo;
  let actual;
  if (close > orHi + 0.3 * em && close - o > 0.4 * em) actual = 'trendUp';
  else if (close < orLo - 0.3 * em && o - close > 0.4 * em) actual = 'trendDown';
  else if (R > 1.6 * em) actual = 'wild';
  else if (close >= orLo - 0.3 * em && close <= orHi + 0.3 * em && R <= 1.3 * em) actual = 'range';
  else actual = 'mixed';
  const good = GOOD[actual].slice();
  if (R > 1.6 * em && !good.includes('straddle')) good.push('straddle');          // bada move kisi bhi taraf = straddle ka din
  return { actual, label: ACT[actual], open: o, close, hi: hl.hi, lo: hl.lo, rangeX: R / em, good, pickOk: good.includes(pick.id), coachOk: good.includes(pick.best) };
}

KP.morning = { defaultMorning, PHASES, phase, phaseLeft, DT, signals, dayType, STRATS, SBY, legsFor, stats, score, build, review, ACT };
})();
