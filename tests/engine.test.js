// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
for (const f of ['pricing', 'book', 'analytics', 'coach', 'options', 'day', 'risk', 'morning']) require('../extension/engine/' + f + '.js');
const KP = globalThis.KP;

const NOW = Date.parse('2026-10-07T04:30:00Z');      // Wed 10:00 IST
const EXP = '2026-10-13';                             // Tue
function chain(F, iv, now = NOW) {
  const m = new KP.Market(); m.clock = () => now; m.expiry = EXP;
  const T = Math.max(1e-7, (KP.expiryCloseMs(EXP) - now) / KP.YEAR_MS), rows = [];
  const c = Math.round(F / 50) * 50;
  for (let K = c - 1500; K <= c + 1500; K += 50)
    rows.push({ K, ce: { ltp: KP.bs('CE', F, K, T, iv).p }, pe: { ltp: KP.bs('PE', F, K, T, iv).p } });
  m.update({ expiry: EXP, rows, source: 'test' });
  return m;
}
const ctxOf = (mkt, book, coach) => ({ mkt, book: book || KP.book.newBook(), coach: coach || KP.coach.defaultCoach(), lot: 65 });
function placeIC(ctx, cfg) {
  const b = KP.an.icLegs(ctx.mkt, cfg), pnl0 = KP.book.total(ctx.book, ctx.mkt), c0 = ctx.book.charges;
  const fills = b.legs.map(l => { const o = KP.book.trade(ctx.book, { type: l.type, K: l.K, lots: b.lots, side: l.side, lot: ctx.lot, px: ctx.mkt.ltp(l.type, l.K), t: NOW });
    return { type: l.type, K: l.K, qty: (l.side === 'BUY' ? 1 : -1) * b.lots * ctx.lot, avg: o.px }; });
  KP.coach.snapBase(ctx, fills, pnl0, ctx.book.charges - c0);
  return b;
}

test('bs: known value + put-call parity (r=0)', () => {
  assert.ok(Math.abs(KP.bs('CE', 100, 100, 1, 0.2).p - 7.9656) < 0.01);
  const c = KP.bs('CE', 25000, 24800, 0.02, 0.13).p, p = KP.bs('PE', 25000, 24800, 0.02, 0.13).p;
  assert.ok(Math.abs(c - p - 200) < 1e-6);
});

test('impliedVol round-trip', () => {
  const px = KP.bs('PE', 25000, 24600, 0.016, 0.155).p;
  assert.ok(Math.abs(KP.impliedVol('PE', px, 25000, 24600, 0.016) - 0.155) < 1e-4);
  assert.equal(KP.impliedVol('CE', 0, 25000, 25500, 0.01), null);
});

test('Market: parity forward, smile IV, live LTP', () => {
  const m = chain(25012, 0.13);
  assert.ok(Math.abs(m.S - 25012) < 0.5, 'fwd ' + m.S);
  assert.equal(m.step, 50);
  assert.ok(Math.abs(m.ivFor(25300) - 0.13) < 0.002);
  assert.equal(m.atm(), 25000);
  assert.equal(m.ltp('CE', 25500), m.rows.get(25500).ce.ltp);
  assert.equal(m.dte(), 4);
});

test('IST clock helpers', () => {
  assert.equal(KP.isMarketOpen(NOW), true);
  assert.equal(KP.isMarketOpen(Date.parse('2026-10-07T10:05:00Z')), false);   // 15:35 IST
  assert.equal(KP.isMarketOpen(Date.parse('2026-10-11T05:00:00Z')), false);   // Sunday
  assert.equal(KP.nextWeekday(NOW, 2), '2026-10-13');
  assert.equal(KP.nextWeekday(Date.parse('2026-10-13T09:00:00Z'), 2), '2026-10-13');   // Tue 14:30 IST
  assert.equal(KP.nextWeekday(Date.parse('2026-10-13T10:30:00Z'), 2), '2026-10-20');   // Tue after close
});

test('book: open, partial close, realised P&L, charges', () => {
  const b = KP.book.newBook();
  KP.book.trade(b, { type: 'CE', K: 25300, lots: 2, side: 'SELL', lot: 65, px: 80 });
  KP.book.trade(b, { type: 'CE', K: 25300, lots: 1, side: 'BUY', lot: 65, px: 50 });
  const p = b.pos['25300CE'];
  assert.equal(p.qty, -65); assert.equal(p.avg, 80); assert.equal(p.real, 65 * 30);
  assert.equal(b.charges, 40);
  KP.book.settle(b, 25400);                         // 100 intrinsic
  assert.equal(b.booked, 65 * 30 + (-65) * (100 - 80));
  assert.deepEqual(b.pos, {});
});

test('iron condor: breakevens and max loss match analyse()', () => {
  const ctx = ctxOf(chain(25000, 0.13));
  const b = placeIC(ctx, { mode: 'pts', dist: 300, wing: 200, lots: 1 });
  const st = KP.an.icStats(ctx.mkt, b, 65);
  const an = KP.an.analyse(ctx.mkt, KP.book.openLegs(ctx.book));
  assert.deepEqual(b.legs.map(l => l.K), [24500, 24700, 25300, 25500]);
  assert.ok(Math.abs(an.be[0] - st.beLo) < 1 && Math.abs(an.be[1] - st.beHi) < 1, JSON.stringify(an.be));
  assert.ok(Math.abs(an.mn + st.maxL) < 1 && Math.abs(an.mx - st.maxP) < 1);
  assert.ok(an.pop > 0.5 && an.pop < 0.95);
  assert.equal(ctx.book.orders[3].side, 'BUY');     // pehla order = hedge (orders newest-first)
});

test('coach: calm IC → no alert; spot beyond short call → CE danger + POS', () => {
  const ctx = ctxOf(chain(25000, 0.13));
  placeIC(ctx, { mode: 'pts', dist: 300, wing: 200, lots: 1 });
  assert.equal(KP.coach.maxLevel(KP.coach.evaluate(ctx)), 0);
  ctx.mkt = chain(25380, 0.15);
  const { ev, fired } = KP.coach.tick(ctx);
  assert.equal(ev.CE.level, 3);
  assert.ok(fired.some(a => a.side === 'CE' && a.lv === 3));
  assert.equal(KP.coach.tick(ctx).fired.length, 0, 'same level dobara fire nahi');
  KP.coach.markReaction(ctx.coach, NOW + 120e3);
  assert.equal(ctx.coach.alerts[0].reacted, 120);
});

test('options: hold first, hedge-first orders, exit closes everything, scores 5..95', () => {
  const ctx = ctxOf(chain(25000, 0.13));
  placeIC(ctx, { mode: 'pts', dist: 300, wing: 200, lots: 2 });
  ctx.mkt = chain(25250, 0.14);
  const r = KP.opts.score(ctx, KP.opts.build(ctx), 'manual');
  assert.equal(r.opts[0].id, 'hold');
  assert.equal(r.tested.type, 'CE');
  for (const o of r.opts) {
    assert.ok(o.score >= 5 && o.score <= 95);
    const firstSell = o.orders.findIndex(x => x.side === 'SELL'), lastBuy = o.orders.map(x => x.side).lastIndexOf('BUY');
    if (firstSell >= 0 && lastBuy >= 0) assert.ok(lastBuy < firstSell, o.id + ' hedge pehle');
  }
  const ex = r.opts.find(o => o.id === 'exit');
  assert.equal(ex.sim.legs.length, 0);
  assert.ok(r.opts.some(o => o.id === 'rollUn') && r.opts.some(o => o.id === 'half'));
});

test('finalizeBase: no adjustments → actual == shadow at expiry', () => {
  const ctx = ctxOf(chain(25000, 0.13));
  placeIC(ctx, { mode: 'pts', dist: 300, wing: 200, lots: 1 });
  KP.coach.finalizeBase(ctx, 25100);
  const f = ctx.coach.base.final;
  assert.ok(Math.abs(f.actual - f.shadow) < 1e-6, JSON.stringify(f));
});

test('chainReader.parseExpiry: Kite-style date texts', () => {
  require('../extension/kite/selectors.js'); require('../extension/kite/chainReader.js');
  const P = t => KP.kite.parseExpiry(t, NOW);
  assert.equal(P('Expiry 13 Oct 2026'), '2026-10-13');
  assert.equal(P('13 OCT'), '2026-10-13');
  assert.equal(P('13th Oct, 26'), '2026-10-13');
  assert.equal(P('NIFTY 06 Jan'), '2027-01-06');                 // saal na ho to aage wala
  assert.equal(P('01 Oct 2026 · 13 Oct 2026'), '2026-10-13');    // beeti hui date skip
  assert.equal(P('no date here'), null);
});

/* ---------- Phase 4: morning plan, SL/target ---------- */
const DAY0 = Date.parse('2026-10-07T00:00:00Z') - 5.5 * 3600e3;    // Wed 00:00 IST
const at = m => DAY0 + m * 60e3;                                   // IST minute → ms
/* path = [[minute, price], ...] → har minute linear ticks */
function mkDay(path, prevClose, ivs) {
  const d = KP.day.newDay('2026-10-07', prevClose);
  for (let i = 0; i < path.length - 1; i++) {
    const [m0, p0] = path[i], [m1, p1] = path[i + 1];
    for (let m = m0; m < m1; m++) KP.day.record(d, at(m) + 30e3, p0 + (p1 - p0) * (m - m0) / (m1 - m0), ivs ? ivs(m) : 13);
  }
  const [mL, pL] = path[path.length - 1]; KP.day.record(d, at(mL) + 30e3, pL, ivs ? ivs(mL) : 13);
  return d;
}
const CFG = { morning: KP.morning.defaultMorning(), risk: KP.risk.defaultRisk(), ic: { wing: 200, lots: 1 }, lot: 65 };
const menu = (d, F, m, manual) => KP.morning.build({ mkt: chain(F, 0.13, at(m)), day: d, now: at(m), manual: manual || {}, vix: null }, CFG);
const RANGE = [[555, 25000], [560, 25040], [565, 24960], [569, 25010], [585, 24985], [600, 25015], [614, 25000]];

test('morning.phase: IST boundaries + weekend', () => {
  const P = KP.morning.phase;
  assert.deepEqual([554, 555, 569, 570, 599, 600, 689, 690, 929, 930].map(m => P(at(m))),
    ['pre', 'observe', 'observe', 'assess', 'assess', 'decide', 'decide', 'late', 'late', 'closed']);
  assert.equal(P(Date.parse('2026-10-10T05:00:00Z')), 'closed');      // Saturday
});

test('day recorder: OR15 recorded / partial, 5-min candles, rollover prevClose', () => {
  const d = mkDay(RANGE, 24990);
  const or = KP.day.or15(d, 615);
  assert.equal(or.src, 'recorded'); assert.equal(or.complete, true);
  assert.ok(Math.abs(or.hi - 25040) < 1 && Math.abs(or.lo - 24960) < 1, JSON.stringify(or));
  assert.equal(KP.day.or15(d, 565).complete, false);
  const c5 = KP.day.candles(d, 5); assert.equal(c5[0].t, 555); assert.equal(c5[1].t, 560);
  const late = mkDay([[562, 25000], [600, 25020]]);
  assert.equal(KP.day.or15(late, 600).src, 'partial');
  assert.equal(KP.day.or15(late, 600, { orHi: 25050, orLo: 24950 }).src, 'manual');
  const full = mkDay([[555, 25000], [929, 25080]]);
  const next = KP.day.rollover(full, '2026-10-08');
  assert.equal(next.date, '2026-10-08'); assert.ok(Math.abs(next.prevClose - 25080) < 1);
  assert.equal(KP.day.rollover(next, '2026-10-08'), next);
});

test('signals + dayType: range / trend up / wild / event / observe', () => {
  const r = menu(mkDay(RANGE, 24990), 25000, 615);
  assert.equal(r.sig.dt, 'range', JSON.stringify(r.sig.items));
  assert.ok(Math.abs(r.sig.gap - 0.04) < 0.01);
  assert.ok(r.sig.orRatio > 0.4 && r.sig.orRatio < 0.55, 'orRatio ' + r.sig.orRatio);
  assert.equal(r.best, 'ic', JSON.stringify(r.list.map(s => [s.id, s.score])));

  const up = menu(mkDay([...RANGE.slice(0, 4), [585, 25030], [600, 25080], [614, 25110]], 24950), 25110, 615);
  assert.equal(up.sig.pos, 'above'); assert.equal(up.sig.dt, 'mildBull');
  assert.equal(up.best, 'bullPut', JSON.stringify(up.list.map(s => [s.id, s.score])));

  const wild = menu(mkDay([[555, 25000], [560, 25150], [566, 24900], [569, 25050], [614, 25000]], 24990), 25000, 615);
  assert.equal(wild.sig.dt, 'wild');
  assert.ok(wild.list.find(s => s.id === 'ic').score < 45);

  const ev = menu(mkDay(RANGE, 24990), 25000, 615, { event: true });
  assert.equal(ev.sig.dt, 'event'); assert.equal(ev.best, 'noTrade');

  // OR abhi ban rahi (data adhoora) → Wait; ye ghadi ki wajah se nahi, data ki wajah se
  const obs = menu(mkDay(RANGE.slice(0, 3), 24990), 25000, 566);
  assert.equal(obs.sig.dt, 'unclear'); assert.equal(obs.best, 'wait');
  assert.ok(!obs.list.some(s => s.why.some(w => /9:30|10 baje|window|late/i.test(w.t))), 'koi time-based kaaran nahi');
  // dopahar 1 baje login: range din → IC (pehle "late" ki wajah se No trade aata tha)
  const late = menu(mkDay([...RANGE, [700, 25025], [779, 24990]], 24990), 25000, 780);
  assert.equal(late.sig.dt, 'range', JSON.stringify(late.sig.items.map(i => i.txt)));
  assert.equal(late.best, 'ic', JSON.stringify(late.list.map(s => [s.id, s.score])));
  // dopahar: open se strong move upar (OR breakout confirm na bhi ho) → bullish
  const run = menu(mkDay([...RANGE.slice(0, 4), [700, 25120], [779, 25140]], 24990), 25140, 780);
  assert.equal(run.sig.dt, 'mildBull'); assert.ok(['bullPut', 'bullCall'].includes(run.best), run.best);
  for (const s of r.list) { assert.ok(s.score >= 5 && s.score <= 95); assert.ok(s.why.length <= 3); }
});

test('strategy legs: IC shorts outside OR, credit/debit kinds, R:R + SL/target', () => {
  const r = menu(mkDay(RANGE, 24990), 25000, 615), get = id => r.list.find(s => s.id === id);
  const ic = get('ic'), sc = ic.legs.find(l => l.type === 'CE' && l.side === 'SELL'), sp = ic.legs.find(l => l.type === 'PE' && l.side === 'SELL');
  assert.ok(sc.K > 25040 && sp.K < 24960, sc.K + '/' + sp.K);
  assert.equal(ic.st.kind, 'credit'); assert.ok(ic.st.creditPct > 0 && ic.st.creditPct < 1);
  assert.ok(Math.abs(ic.st.slRs - 1.5 * ic.st.unitRs) < 1e-6 && Math.abs(ic.st.tgtRs - 0.5 * ic.st.unitRs) < 1e-6);
  assert.ok(Math.abs(ic.st.needWin - 0.75) < 1e-9);
  assert.equal(get('bullCall').st.kind, 'debit'); assert.equal(get('bearPut').st.kind, 'debit');
  assert.equal(get('bullPut').st.kind, 'credit');
  const sd = get('straddle'); assert.equal(sd.st.kind, 'debit'); assert.equal(sd.st.maxP, Infinity); assert.equal(sd.st.rrStruct, null);
  assert.deepEqual(get('wait').legs, []); assert.equal(get('wait').st, null);
});

test('chain UI: OI parse, IV per option, ITM/ATM/OTM', () => {
  require('../extension/kite/selectors.js'); require('../extension/kite/chainReader.js');
  const oiNum = KP.kite.oiNum;
  assert.deepEqual(oiNum('-23.23% 34.34'), { oi: 34.34, chg: -23.23 }); assert.deepEqual(oiNum('34.34 +5.10%'), { oi: 34.34, chg: 5.1 });
  assert.deepEqual(oiNum('1,234.5'), { oi: 1234.5, chg: null }); assert.deepEqual(oiNum('−2.5% 7'), { oi: 7, chg: -2.5 }); assert.equal(oiNum('—'), null);
  assert.ok(KP.SEL.oiHeader.test('OI (in lakhs)') && !KP.SEL.oiHeader.test('OI chg %') && !KP.SEL.oiHeader.test('Call LTP'));
  const now = Date.parse('2026-10-08T05:00:00Z'), m = new KP.Market(); m.clock = () => now;
  m.update({ expiry: '2026-10-13', spot: 25010, rows: [24900, 24950, 25000, 25050, 25100].map(K => ({ K, ce: { ltp: KP.r05(KP.bs('CE', 25010, K, m.T ? 5 / 365 : 0, 0.13).p), oi: 10 + K % 7, oiChg: 2 }, pe: { ltp: KP.r05(KP.bs('PE', 25010, K, 5 / 365, 0.13).p), iv: 14.2 } })) });
  assert.equal(m.atm(), 25000);
  assert.deepEqual(['CE', 'PE'].map(T => [24950, 25000, 25050].map(K => m.moneyness(T, K))), [['ITM', 'ATM', 'OTM'], ['OTM', 'ATM', 'ITM']]);
  assert.equal(m.ivOf('PE', 25000), 14.2, 'Kite ka IV ho to wahi');
  const civ = m.ivOf('CE', 25050); assert.ok(civ > 8 && civ < 20, 'CE IV LTP se ' + civ);
  assert.deepEqual(m.oi('CE', 25000), { oi: 10 + 25000 % 7, chg: 2 }); assert.equal(m.oi('PE', 25000), null);
});

test('buildup: price + OI → long / short / covering / unwinding', () => {
  const b = KP.buildup;
  assert.equal(b(5, 10).id, 'long'); assert.match(b(5, 10).who, /Naye buyers/); assert.equal(b(5, 10).e, '🟢');
  assert.equal(b(-5, 10).id, 'short'); assert.equal(b(-5, 10).e, '🔴'); assert.match(b(-5, 10).who, /Naye sellers/);
  assert.equal(b(5, -10).id, 'cover'); assert.equal(b(5, -10).e, '🔵');
  assert.equal(b(-5, -10).id, 'unwind'); assert.equal(b(-5, -10).e, '⚪');
  assert.equal(b(0.4, 30), null, 'price 1% se kam hila: signal nahi'); assert.equal(b(20, -0.2), null); assert.equal(b(null, 5), null);
});

test('price action: levels → zones (confluence ⭐, resistance / support)', () => {
  require('../extension/engine/pa.js');
  const P = KP.pa, day = KP.day.newDay('2026-10-09', 25050, 25205, 24890);
  for (let m = 555; m < 570; m++) KP.day.record(day, Date.parse('2026-10-09T03:45:00Z') + (m - 555) * 60e3, m < 562 ? 25100 + (m - 555) * 15 : 25190 - (m - 562) * 10, 13);
  const or = KP.day.or15(day, 600, {}); assert.equal(or.hi, 25190);
  const { zones, tol } = P.levels({ S: 25120, day, nowMin: 600, manual: {}, em: 160, extra: [{ px: 25200, tag: 'CE OI 🔴 short buildup', w: 2 }] });
  assert.equal(tol, 24);
  const z = zones.find(x => x.tags.includes('OR high'));
  assert.ok(z.tags.includes('Kal ka High') && z.tags.includes('CE OI 🔴 short buildup') && z.tags.some(t => /25,200/.test(t)), 'OR high + PDH + OI + round ek zone: ' + z.tags);
  assert.equal(z.star, true); assert.equal(z.role, 'res');
  assert.equal(zones.find(x => x.tags.includes('Kal ka Low')).role, 'sup');
  const nr = P.nearest(zones, 25120); assert.ok(nr.res.px > 25120 && nr.sup.px < 25120);
  assert.ok(P.levels({ S: 25120, day, nowMin: 565, manual: {}, em: 160 }).zones.every(x => !x.tags.includes('OR high')), 'OR 9:30 se pehle nahi');
});

test('price action: trend HH-HL / LH-LL / range + OR fallback', () => {
  const P = KP.pa, mk = (arr) => arr.map(([h, l], i) => ({ t: 570 + i * 5, o: (h + l) / 2, h, l, c: (h + l) / 2 }));
  const upC = mk([[100, 90], [105, 95], [112, 100], [108, 98], [104, 96], [109, 100], [116, 104], [124, 110], [119, 108], [115, 106], [121, 110], [128, 116]]);
  assert.equal(P.trend(upC).dir, 'up', P.trend(upC).why);
  const dnC = mk([[128, 116], [121, 110], [115, 106], [119, 108], [124, 112], [116, 104], [109, 100], [104, 92], [108, 96], [112, 100], [105, 95], [100, 88]]);
  assert.equal(P.trend(dnC).dir, 'down', P.trend(dnC).why);
  const few = mk([[110, 100], [112, 104]]); few[1].c = 111;
  const t = P.trend(few, { hi: 108, lo: 100, complete: true }); assert.equal(t.dir, 'up'); assert.equal(t.strong, false);
  assert.equal(P.trend(few).dir, 'range');
});

test('price action: patterns (breakout, fakeout, retest, rejection, engulfing, inside) + OI confirm', () => {
  const P = KP.pa, Z = [{ lo: 25195, hi: 25205, px: 25200, score: 6, star: true, tags: ['OR high', 'Kal ka High'] }, { lo: 24995, hi: 25005, px: 25000, score: 3, star: false, tags: ['25,000 (bada round)'] }];
  const C = (o, h, l, c, t) => ({ t: t || 600, o, h, l, c });
  // breakout: pichhla close andar, ab upar strong close
  let ps = P.patterns([C(25180, 25195, 25170, 25190, 595), C(25190, 25240, 25188, 25235)], Z, 24);
  assert.ok(ps.some(p => p.id === 'breakout' && p.dir === 'bull' && p.zone.px === 25200));
  // fakeout: pichhla upar close, ab wapas neeche
  ps = P.patterns([C(25180, 25195, 25170, 25190, 590), C(25190, 25230, 25188, 25225, 595), C(25225, 25228, 25180, 25185)], Z, 24);
  assert.ok(ps.some(p => p.id === 'fakeout' && p.dir === 'bear'));
  // retest: 2 candle pehle breakout, ab 25,200 tak aaya aur upar close
  ps = P.patterns([C(25180, 25195, 25170, 25190, 585), C(25190, 25240, 25188, 25235, 590), C(25235, 25250, 25225, 25245, 595), C(25245, 25248, 25205, 25230)], Z, 24);
  assert.ok(ps.some(p => p.id === 'retest' && p.dir === 'bull'), JSON.stringify(ps.map(p => p.id)));
  // rejection: upar lambi wick 25,200 ko chhu ke neeche close
  ps = P.patterns([C(25150, 25165, 25140, 25160, 595), C(25160, 25203, 25155, 25165)], Z, 24);
  const rj = ps.find(p => p.id === 'rejection'); assert.ok(rj && rj.dir === 'bear' && rj.zone.px === 25200);
  assert.match(P.confirm(rj, [{ T: 'CE', id: 'short' }]).txt, /CE sellers/);
  assert.equal(P.confirm({ id: 'breakout', dir: 'bull', zone: Z[0] }, [{ T: 'CE', id: 'cover' }]).ok, true);
  assert.equal(P.confirm({ id: 'breakout', dir: 'bull', zone: Z[0] }, [{ T: 'CE', id: 'short' }]).ok, false, 'sellers abhi bhi = fakeout ka khatra');
  // bullish engulfing support 25,000 par
  ps = P.patterns([C(25020, 25025, 25000, 25005, 595), C(25002, 25040, 24998, 25030)], Z, 24);
  assert.ok(ps.some(p => p.id === 'engulf' && p.dir === 'bull'));
  // inside bar (level ki zaroorat nahi), aur level se door koi pattern nahi
  ps = P.patterns([C(25100, 25130, 25080, 25120, 595), C(25110, 25125, 25090, 25115)], Z, 24);
  assert.deepEqual(ps.map(p => p.id), ['inside']);
  ps = P.patterns([C(25100, 25110, 25090, 25105, 595), C(25105, 25150, 25100, 25108)], Z, 24);
  assert.deepEqual(ps, [], 'level se door wick = koi pattern nahi');
});

test('price action: order popup check (warning, kabhi block nahi)', () => {
  const P = KP.pa, Z = [{ lo: 25195, hi: 25205, px: 25200, star: true, tags: ['OR high'] }, { lo: 24995, hi: 25005, px: 25000, star: false, tags: ['round'] }];
  const up = { dir: 'up', label: P.TL.up }, down = { dir: 'down', label: P.TL.down };
  let r = P.orderCheck({ type: 'CE', side: 'SELL' }, { trend: up, zones: Z, S: 25100, tol: 24 }); assert.ok(r.warn.some(w => /CE bech rahe ho/.test(w)));
  r = P.orderCheck({ type: 'PE', side: 'SELL' }, { trend: down, zones: Z, S: 25100, tol: 24 }); assert.ok(r.warn.some(w => /PE bech rahe ho/.test(w)));
  r = P.orderCheck({ type: 'CE', side: 'BUY' }, { trend: up, zones: Z, S: 25180, tol: 24 }); assert.ok(r.warn.some(w => /Resistance 25,200/.test(w)), r.warn);
  r = P.orderCheck({ type: 'CE', side: 'BUY' }, { trend: up, zones: Z, S: 25180, tol: 24, recent: [{ id: 'breakout', dir: 'bull' }] }); assert.ok(!r.warn.length, 'breakout ke baad resistance warning nahi');
  r = P.orderCheck({ type: 'PE', side: 'BUY' }, { trend: down, zones: Z, S: 25020, tol: 24 }); assert.ok(r.warn.some(w => /Support 25,000/.test(w)));
  r = P.orderCheck({ type: 'CE', side: 'SELL' }, { trend: down, zones: Z, S: 25180, tol: 24 }); assert.ok(!r.warn.length && r.ok.some(w => /Resistance 25,200/.test(w)), 'downtrend + resistance ke neeche CE sell = ✓');
  assert.deepEqual(P.orderCheck({ type: 'CE', side: 'SELL' }, null), { warn: [], ok: [] });
  r = P.orderCheck({ type: 'CE', side: 'SELL' }, { trend: down, zones: Z, S: 25180, tol: 24, recent: [{ id: 'retest', dir: 'bull' }] });
  assert.ok(r.warn.length && !r.ok.length, 'warning ke saath ✓ nahi');
});

test('day: kal ka High / Low (Kite Connect backfill + rollover)', () => {
  const day = KP.day.newDay('2026-10-09');
  KP.day.backfill(day, { src: 'kite', date: '2026-10-09', bars: [], prevClose: 25050, prevHigh: 25205, prevLow: 24890 });
  assert.deepEqual([day.prevHigh, day.prevLow], [25205, 24890]);
  const y = KP.day.newDay('2026-10-08'); [[556, 25000], [700, 25300], [800, 24800], [925, 25100]].forEach(([m, S]) => KP.day.record(y, Date.parse('2026-10-08T00:00:00Z') + (m - 330) * 60e3, S, 13));
  const t = KP.day.rollover(y, '2026-10-09'); assert.deepEqual([t.prevClose, t.prevHigh, t.prevLow], [25100, 25300, 24800]);
});

test('risk: intraday defaults — naked SELL 30/40, BUY 25/50, expiry day SL 20', () => {
  const R = KP.risk, cfg = R.defaultRisk(), m = {};
  R.syncLegs(m, [{ type: 'CE', K: 25300, qty: -65, avg: 100 }, { type: 'PE', K: 25000, qty: 65, avg: 100 }], cfg);
  assert.deepEqual([m['25300CE'].sl, m['25300CE'].tgt], [130, 60], 'SELL 100 → SL 130, target 60');
  assert.deepEqual([m['25000PE'].sl, m['25000PE'].tgt], [75, 150], 'BUY 100 → SL 75, target 150');
  const ex = R.effRisk(cfg, true);
  assert.equal(R.defPct(-1, ex, 'sl'), 20); assert.equal(R.defPct(1, ex, 'sl'), 20); assert.equal(R.defPct(-1, ex, 'tgt'), 40, 'expiry par target wahi');
  assert.equal(R.effRisk(cfg, false), cfg);
});

test('risk: per-leg SL/target % (auto default, ticket %, short upar / long neeche, edit, off, widen, closed leg)', () => {
  const R = KP.risk, cfg = Object.assign(R.defaultRisk(), { legSlPctShort: 100, legTgtPctShort: 50, legSlPctLong: 50, legTgtPctLong: 100 }), map = {};   // positional % (mechanics test)
  R.syncLegs(map, [{ type: 'CE', K: 25300, qty: -65, avg: 100 }, { type: 'CE', K: 25500, qty: 65, avg: 40 }], cfg);
  const sh = map['25300CE'], lg = map['25500CE'];
  assert.equal(sh.sl, 200, 'SELL leg: premium double'); assert.equal(lg.sl, 20, 'BUY leg: aadha');
  assert.equal(sh.tgt, 50, 'SELL leg target: premium aadha'); assert.equal(lg.tgt, 80, 'BUY leg target: double'); assert.equal(cfg.legAutoExit, true);
  assert.equal(R.checkLeg(sh, 180, 1), null); const h1 = R.checkLeg(sh, 201, 2); assert.equal(h1.ltp, 201); assert.equal(h1.type, 'sl'); assert.equal(R.checkLeg(sh, 230, 3), null, 'ek hi baar');
  assert.equal(R.checkLeg(lg, 25, 4), null); assert.equal(R.checkLeg(lg, 19.5, 5).type, 'sl');
  lg.hit = null; assert.equal(R.checkLeg(lg, 81, 5).type, 'target', 'BUY leg upar target');
  assert.equal(R.editLeg(sh, 150), true, 'SL % badhaya = door khiskaya'); assert.equal(sh.sl, 250); assert.equal(sh.widened, 1); assert.equal(sh.hit, null, 'edit ke baad re-arm'); assert.equal(sh.auto, false);
  assert.equal(R.checkLeg(sh, 49, 6).type, 'target', 'SELL leg neeche target'); sh.hit = null;
  assert.equal(R.editLeg(sh, 60, 'tgt'), false); assert.equal(sh.tgt, 40); assert.equal(sh.tAuto, false); assert.equal(R.checkLeg(sh, 45, 7), null);
  assert.equal(R.editLeg(sh, 50), false); assert.equal(sh.sl, 150);
  R.syncLegs(map, [{ type: 'CE', K: 25300, qty: -130, avg: 110 }, { type: 'CE', K: 25500, qty: 65, avg: 40 }], cfg);
  assert.equal(map['25300CE'].sl, 165, 'lots jode: % wahi (50%), trigger naye avg se'); assert.equal(map['25300CE'].tgt, 44);
  R.editLeg(map['25500CE'], 0); assert.equal(map['25500CE'].sl, null, '0 = band'); assert.equal(R.checkLeg(map['25500CE'], 1, 6), null);
  const gone = R.syncLegs(map, [{ type: 'CE', K: 25300, qty: -130, avg: 110 }], cfg);
  assert.deepEqual(gone.map(g => g.key), ['25500CE']); assert.ok(!map['25500CE']);
  R.reLegs(map, Object.assign({}, cfg, { legSlPctShort: 30 })); assert.equal(map['25300CE'].sl, 165, 'manual SL settings se nahi badla');
  const m2 = {}; R.syncLegs(m2, [{ type: 'PE', K: 25000, qty: -65, avg: 80 }], Object.assign({}, cfg, { legSlPctShort: 0 })); assert.equal(m2['25000PE'].sl, null, '% 0 = leg SL band');
  R.reLegs(m2, Object.assign({}, cfg, { legSlPctShort: 30 })); assert.equal(m2['25000PE'].sl, 104, 'auto leg Settings ke naye % se');
  // order ticket se: SL 20%, target 40% (SELL @ 50 → SL 60, target 30; BUY @ 50 → SL 40, target 70)
  const m3 = {}; R.setLeg(m3, '25100CE', -65, 50, 20, 40, cfg); assert.deepEqual([m3['25100CE'].sl, m3['25100CE'].tgt, m3['25100CE'].auto], [60, 30, false]);
  R.setLeg(m3, '25100PE', 65, 50, 20, 40, cfg); assert.deepEqual([m3['25100PE'].sl, m3['25100PE'].tgt], [40, 70]);
  R.syncLegs(m3, [{ type: 'CE', K: 25100, qty: -65, avg: 50 }, { type: 'PE', K: 25100, qty: 65, avg: 50 }], cfg); assert.equal(m3['25100CE'].slPct, 20, 'sync ne ticket ka % nahi badla');
  assert.equal(R.legPx(65, 50, 150, 'sl'), 0.05, 'BUY SL 100%+ = 0 se neeche nahi');
  const t = R.tips([{ hits: [{ type: 'legsl', at: 0, reacted: 600 }, { type: 'legsl', at: 0, reacted: 0, auto: true }, { type: 'legtgt', at: 0, reacted: 0, auto: true }], widened: 0 }]);
  assert.ok(t.some(x => /2 baar kisi leg ka SL hit hua \(1 baar SL order/.test(x))); assert.ok(t.some(x => /target aaya/.test(x))); assert.ok(!t.some(x => /profit book nahi kiya/.test(x)), 'leg target trade target tip me nahi');
  const old = { '25000PE': { sl: 160, auto: true, qty: -65, avg: 80, hit: null, widened: 0 } }; R.syncLegs(old, [{ type: 'PE', K: 25000, qty: -65, avg: 80 }], cfg); assert.deepEqual([old['25000PE'].slPct, old['25000PE'].tgt], [100, 40], 'purana (price wala) save % me');
});

test('risk: SL/target alert once, re-arm, reaction on close, widen counted', () => {
  const p = KP.risk.makePlan({ kind: 'credit', unitRs: 5000, pnl0: 0, at: 0 }, KP.risk.defaultRisk());
  assert.equal(p.slRs, 7500); assert.equal(p.tgtRs, 2500);
  assert.equal(KP.risk.check(p, -1000, 1e3), null);
  assert.equal(KP.risk.check(p, -8000, 2e3).type, 'sl');
  assert.equal(KP.risk.check(p, -9000, 3e3), null, 'dobara nahi');
  KP.risk.check(p, -1000, 4e3);
  assert.equal(KP.risk.check(p, -8000, 5e3), null, '15 min se pehle re-arm nahi');
  KP.risk.check(p, -1000, 6e3);
  assert.equal(KP.risk.check(p, -8000, 20 * 60e3).type, 'sl');
  KP.risk.close(p, -8200, 20 * 60e3 + 90e3);
  assert.equal(p.hits[1].reacted, 90); assert.equal(p.closed.pnl, -8200);
  const q = KP.risk.makePlan({ kind: 'debit', unitRs: 4000, pnl0: 0, at: 0 }, KP.risk.defaultRisk());
  assert.equal(q.slRs, 2000); assert.equal(q.tgtRs, 4000); assert.equal(q.rr, 2);
  KP.risk.edit(q, 3000); assert.equal(q.widened, 1);
  assert.ok(KP.risk.tips([p, q]).some(t => /SL door/.test(t)));
});

test('coach: debit plan skips leg rules; Kya karu? = hold/exit, SL → exit best', () => {
  const ctx = ctxOf(chain(25000, 0.13)); ctx.planKind = 'debit';
  KP.book.trade(ctx.book, { type: 'CE', K: 25000, lots: 1, side: 'BUY', lot: 65, px: ctx.mkt.ltp('CE', 25000) });
  KP.book.trade(ctx.book, { type: 'CE', K: 25200, lots: 1, side: 'SELL', lot: 65, px: ctx.mkt.ltp('CE', 25200) });
  ctx.mkt = chain(25350, 0.13);
  assert.equal(KP.coach.maxLevel(KP.coach.evaluate(ctx)), 0);
  const r = KP.opts.score(ctx, KP.opts.build(ctx), 'sl');
  assert.equal(r.debit, true); assert.deepEqual(r.opts.map(o => o.id), ['hold', 'exit']);
  assert.equal(r.best, 'exit');
  ctx.planKind = null;
  assert.ok(KP.coach.maxLevel(KP.coach.evaluate(ctx)) >= 2, 'credit rules me short call ITM = alert');
});

test('review: range day → IC sahi; trend day → bull put sahi', () => {
  const d = mkDay([...RANGE, [700, 25030], [800, 24980], [929, 25010]], 24990);
  const pick = { id: 'ic', best: 'ic', sig: { em: 170, orHi: 25040, orLo: 24960 } };
  const rv = KP.morning.review(d, pick);
  assert.equal(rv.actual, 'range'); assert.equal(rv.pickOk, true); assert.equal(rv.coachOk, true);
  const t = mkDay([...RANGE.slice(0, 4), [700, 25150], [929, 25200]], 24990);
  const rv2 = KP.morning.review(t, { id: 'ic', best: 'bullPut', sig: { em: 170, orHi: 25040, orLo: 24960 } });
  assert.equal(rv2.actual, 'trendUp'); assert.equal(rv2.pickOk, false); assert.equal(rv2.coachOk, true);
});

test('AI coach (background): key check, request shape, daily limit, errors', async () => {
  require('../extension/sync/ai.js');
  const AI = globalThis.KPAI, mem = {}, calls = [];
  let now = Date.parse('2026-10-07T05:00:00Z'), resp = { ok: true, status: 200, body: { content: [{ type: 'text', text: 'Theek hai, samjhata hoon.' }], usage: { input_tokens: 900, output_tokens: 120 } } };
  const deps = { get: async k => mem[k], set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, now: () => now,
    fetch: async (u, o) => { calls.push({ u, o }); return { ok: resp.ok, status: resp.status, json: async () => resp.body }; } };
  const q = { messages: [{ role: 'user', content: 'Context: {}\n\nSawaal: position?' }] };
  assert.match((await AI.ask(deps, q)).error, /API key/);
  await assert.rejects(AI.setKey(deps, 'hello'), /sk-ant/);
  const s = await AI.setKey(deps, 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ');
  assert.equal(s.hasKey, true); assert.ok(s.masked.endsWith('WXYZ') && !s.masked.includes('xxxxxxxxxxxx'));
  const r = await AI.ask(deps, q);
  assert.equal(r.ok, true); assert.equal(r.text, 'Theek hai, samjhata hoon.'); assert.equal(r.used, 1);
  const body = JSON.parse(calls[0].o.body);
  assert.equal(calls[0].u, 'https://api.anthropic.com/v1/messages'); assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(calls[0].o.headers['anthropic-version'], '2023-06-01'); assert.ok(calls[0].o.headers['x-api-key'].startsWith('sk-ant-'));
  assert.match(body.system, /Hinglish/); assert.equal(body.messages.length, 1);
  assert.match((await AI.ask(deps, { messages: [{ role: 'assistant', content: 'x' }] })).error, /khaali/);
  mem.kp_ai.used = 50; mem.kp_ai.day = AI.istDay(now);
  assert.match((await AI.ask(deps, q)).error, /50 AI sawaal/);
  now += 864e5; assert.equal((await AI.status(deps)).used, 0, 'naye din par counter reset');
  resp = { ok: false, status: 401, body: { error: { message: 'invalid x-api-key' } } };
  assert.match((await AI.ask(deps, q)).error, /key galat/);
  assert.equal((await AI.status(deps)).used, 0, 'fail hua sawaal count nahi hota');
});

test('chainReader.readPrevClose: "+45.10 (0.18%)"', () => {
  const el = { textContent: 'NIFTY 50 25,045.10 +45.10 (0.18%)', parentElement: null };
  assert.ok(Math.abs(KP.kite.readPrevClose({ v: 25045.10, el }) - 25000) < 1e-6);
  assert.equal(KP.kite.readPrevClose({ v: 25045.10, el: { textContent: '+45.10 (5.00%)', parentElement: null } }), null);
});

test('AI coach Gemini: provider switch, auto model (latest Flash), roles, errors, old Claude config migrate', async () => {
  require('../extension/sync/ai.js');
  const AI = globalThis.KPAI, mem = { kp_ai: { key: 'sk-ant-api03-' + 'q'.repeat(40) } }, calls = [];
  let now = Date.parse('2026-10-07T05:00:00Z'), gen = { status: 200, body: { modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'Gemini ka jawab' }] } }] } };
  const deps = { get: async k => mem[k] && JSON.parse(JSON.stringify(mem[k])), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, now: () => now,
    fetch: async (u, o) => { calls.push({ u, o }); const r = /\/models\?/.test(u) ? { status: 200, body: { models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'].map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) } } : gen;
      return { ok: r.status === 200, status: r.status, json: async () => r.body }; } };
  let s = await AI.status(deps);
  assert.equal(s.provider, 'claude', 'purana sirf-Claude config claude hi rahe'); assert.equal(s.hasKey, true);
  await assert.rejects(AI.setCfg(deps, { geminiKey: 'abc' }), /AIza/);
  s = await AI.setCfg(deps, { provider: 'gemini', geminiKey: ' AIzaSy' + 'g'.repeat(33) + '\n' });
  assert.equal(s.provider, 'gemini'); assert.ok(s.geminiMasked.startsWith('AIzaSyg') && s.claudeMasked.startsWith('sk-ant'));
  const q = { messages: [{ role: 'user', content: 'pehla' }, { role: 'assistant', content: 'jawab' }, { role: 'user', content: 'Context: {}\n\nSawaal: SL?' }] };
  const r = await AI.ask(deps, q);
  assert.equal(r.ok, true); assert.equal(r.text, 'Gemini ka jawab'); assert.equal(r.used, 1);
  const g = calls.find(c => /:generateContent$/.test(c.u)), body = JSON.parse(g.o.body);
  assert.match(g.u, /models\/gemini-2\.5-flash:generateContent$/); assert.equal(g.o.headers['x-goog-api-key'].slice(0, 6), 'AIzaSy'); assert.ok(!/key=/.test(g.u));
  assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user']); assert.match(body.systemInstruction.parts[0].text, /Hinglish/);
  const nList = calls.filter(c => /\/models\?/.test(c.u)).length; await AI.ask(deps, q);
  assert.equal(calls.filter(c => /\/models\?/.test(c.u)).length, nList, 'model list cache (dobara ListModels nahi)');
  await AI.setCfg(deps, { geminiModel: 'gemini-2.5-pro' }); await AI.ask(deps, q);
  assert.match(calls[calls.length - 1].u, /gemini-2\.5-pro:generateContent/);
  // Google ne 2.5-pro band kiya (404 "no longer available") → yaad rakho, auto Flash par ek retry
  const okGen = gen;
  deps.fetch = (f => async (u, o) => /2\.5-pro:generateContent/.test(u) ? (calls.push({ u, o }), { ok: false, status: 404, json: async () => ({ error: { code: 404, message: 'This model models/gemini-2.5-pro is no longer available to new users.' } }) }) : f(u, o))(deps.fetch);
  const rg = await AI.ask(deps, q);
  assert.equal(rg.ok, true); assert.match(rg.note, /gemini-2\.5-pro band/); assert.match(calls[calls.length - 1].u, /gemini-2\.5-flash:generateContent/);
  s = await AI.status(deps); assert.equal(s.geminiModel, '', 'manual band model hata'); assert.ok(!s.geminiModels.includes('gemini-2.5-pro'), 'dropdown me band model nahi');
  gen = okGen;
  gen = { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } } };
  assert.match((await AI.ask(deps, q)).error, /free limit/);
  assert.equal((await AI.status(deps)).used, 4, 'fail hua sawaal count nahi');
  const ck = await AI.check(deps); assert.equal(ck.ok, true); assert.match(ck.msg, /Gemini key chal rahi/); assert.ok(ck.models.includes('gemini-2.5-flash'));
  await AI.setCfg(deps, { provider: 'claude' }); assert.equal((await AI.status(deps)).model, 'claude-opus-5-5');
});

test('Kite stale ITM LTP (asli DOM se): parity fair price use hota hai', () => {
  const now = Date.parse('2026-10-05T05:00:00Z'), m = new KP.Market(); m.clock = () => now;
  // user ke asli Kite copy ke numbers
  m.update({ expiry: '2026-10-06', source: 'kite', rows: [[21300, 1191.35, 2.85], [22000, 603.95, 16.85], [22500, 198.95, 109.35], [22600, 142.8, 152.75], [22700, 97.45, 207.05], [23000, 23.4, 433.15]]
    .map(([K, c, p]) => ({ K, ce: { ltp: c }, pe: { ltp: p } })) });
  assert.ok(Math.abs(m.S - 22590.05) < 0.01);
  assert.equal(m.stale('CE', 21300), true); assert.equal(m.ltp('CE', 21300), 1292.9);   // 2.85 + (22590.05 - 21300)
  assert.equal(m.stale('CE', 22000), false); assert.equal(m.ltp('CE', 22000), 603.95);   // liquid ITM: Kite LTP hi
  assert.equal(m.stale('PE', 22600), false); assert.equal(m.ltp('PE', 21300), 2.85);    // OTM side kabhi replace nahi
  assert.equal(m.parity('CE', 22700), null, 'OTM call ka parity nahi');
});

test('Kite Connect: login exchange (checksum), 6AM expiry, 1-min candles → OR / open / kal ka close', async () => {
  require('../extension/sync/kiteconnect.js');
  const KC = globalThis.KPKC, crypto = require('node:crypto'), mem = {}, calls = [];
  let now = Date.parse('2026-10-07T05:00:00Z');                                   // 10:30 IST
  const IST = t => Date.parse(t + '+05:30');
  const deps = { get: async k => mem[k] && JSON.parse(JSON.stringify(mem[k])), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, now: () => now,
    sha256hex: async s => crypto.createHash('sha256').update(s).digest('hex'),
    fetch: async (u, o) => { calls.push({ u, o }); let body;
      if (/session\/token/.test(u)) body = { status: 'success', data: { access_token: 'AT123', user_name: 'Aman', user_id: 'AB1234' } };
      else if (/\/minute\?/.test(u)) body = { status: 'success', data: { candles: [['2026-10-07T09:15:00+0530', 22690, 22700, 22650, 22660, 10], ['2026-10-07T09:20:00+0530', 22660, 22680, 22602, 22610, 10], ['2026-10-07T09:29:00+0530', 22610, 22640, 22605, 22630, 5], ['2026-10-07T09:45:00+0530', 22630, 22655, 22620, 22650, 5]] } };
      else if (/\/day\?/.test(u)) body = { status: 'success', data: { candles: [['2026-10-05T00:00:00+0530', 1, 1, 1, 22400, 0], ['2026-10-06T00:00:00+0530', 1, 1, 1, 22555.8, 0], ['2026-10-07T00:00:00+0530', 1, 1, 1, 22650, 0]] } };
      return { ok: true, status: 200, json: async () => body }; } };
  await assert.rejects(KC.setCfg(deps, { apiKey: 'ab cd!' }), /API key/);
  await KC.setCfg(deps, { apiKey: ' kitekey123\n', apiSecret: 'secretabc12345' });
  const r = await KC.exchange(deps, 'http://127.0.0.1/kp-kite-callback?action=login&type=login&status=success&request_token=RT9');
  assert.equal(r.ok, true);
  const body = new URLSearchParams(calls[0].o.body);
  assert.equal(body.get('checksum'), crypto.createHash('sha256').update('kitekey123' + 'RT9' + 'secretabc12345').digest('hex'));
  let s = await KC.status(deps); assert.equal(s.loggedIn, true); assert.equal(s.user, 'Aman'); assert.ok(!JSON.stringify(s).includes('AT123'), 'token status me nahi');
  const v = await KC.intraday(deps, 256265);
  assert.equal(v.src, 'kite'); assert.equal(v.prevClose, 22555.8); assert.deepEqual(v.bars[0], [555, 22690, 22700, 22650, 22660]);
  const h = calls.find(c => /\/minute\?/.test(c.u)); assert.equal(h.o.headers.Authorization, 'token kitekey123:AT123'); assert.match(h.u, /historical\/256265\/minute\?from=2026-10-07\+09:15:00&to=2026-10-07\+10:30:00/);
  // backfill → OR / open / gap
  const d = KP.day.newDay('2026-10-07'); KP.day.backfill(d, v);
  const or = KP.day.or15(d, 640); assert.equal(or.lo, 22602); assert.equal(or.hi, 22700); assert.equal(or.src, 'recorded');
  assert.equal(KP.day.open(d).px, 22690); assert.equal(d.prevClose, 22555.8); assert.equal(d.backfill, 'kite');
  // agle din 6 AM IST ke baad token expire
  now = IST('2026-10-08T05:59:00'); assert.equal((await KC.status(deps)).loggedIn, true);
  now = IST('2026-10-08T06:01:00'); s = await KC.status(deps); assert.equal(s.loggedIn, false); assert.equal(s.expired, true);
  await assert.rejects(KC.intraday(deps, 256265), /expire/);
  // bad request_token
  assert.equal((await KC.exchange(deps, 'http://127.0.0.1/kp-kite-callback?status=cancelled')).ok, false);
});

test('margin: SPAN jaisa andaza (hedge ka fayda) + Kite basket margin request', async () => {
  const m = chain(22600, 0.12), L = (t, K, q) => ({ type: t, K, qty: q, avg: m.ltp(t, K) }), md = l => KP.an.marginDetail(m, l);
  const naked = md([L('CE', 22800, -65)]), spread = md([L('CE', 22800, -65), L('CE', 23000, 65)]), long = md([L('CE', 22600, 65)]);
  assert.ok(naked.span > 80000 && naked.span < 200000, 'naked SPAN ' + naked.span);
  assert.ok(Math.abs(naked.exposure - 65 * m.S * 0.02) < 1);
  assert.ok(spread.span < naked.span / 5, 'hedge ka fayda: ' + spread.span + ' vs ' + naked.span);
  assert.ok(spread.span <= 200 * 65 + 1, 'spread SPAN max loss se zyada nahi');
  assert.equal(long.span, 0); assert.equal(long.exposure, 0); assert.ok(Math.abs(long.total - 65 * m.ltp('CE', 22600)) < 1e-6);
  // Kite basket margin
  require('../extension/sync/kiteconnect.js');
  const KC = globalThis.KPKC, mem = { kp_kc: { apiKey: 'kk123456', apiSecret: 'ss12345678', accessToken: 'AT', loginAt: Date.parse('2026-10-07T04:00:00Z') } }, calls = [];
  const csv = 'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n' +
    '1,1,NIFTY26O1322800CE,"NIFTY",0,2026-10-13,22800,0.05,65,CE,NFO-OPT,NFO\n2,2,NIFTY26O1323000CE,"NIFTY",0,2026-10-13,23000,0.05,65,CE,NFO-OPT,NFO\n3,3,BANKNIFTY26OCT55000CE,"BANKNIFTY",0,2026-10-28,55000,0.05,30,CE,NFO-OPT,NFO\n';
  const deps = { get: async k => mem[k] && JSON.parse(JSON.stringify(mem[k])), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }, now: () => Date.parse('2026-10-07T05:00:00Z'),
    fetch: async (u, o) => { calls.push({ u, o }); if (/instruments\/NFO/.test(u)) return { ok: true, status: 200, text: async () => csv };
      return { ok: true, status: 200, json: async () => ({ status: 'success', data: { initial: { total: 160000 }, final: { total: 41234.5, span: 12000, exposure: 28000, option_premium: 1234.5 } } }) }; } };
  const v = await KC.basketMargin(deps, [{ type: 'CE', K: 22800, qty: -65 }, { type: 'CE', K: 23000, qty: 65 }], '2026-10-13', 'NIFTY');
  assert.equal(v.total, 41234.5); assert.equal(v.span, 12000); assert.deepEqual(v.symbols, ['NIFTY26O1322800CE', 'NIFTY26O1323000CE']);
  const post = calls.find(c => /margins\/basket/.test(c.u)), body = JSON.parse(post.o.body);
  assert.match(post.u, /consider_positions=false/); assert.equal(post.o.method, 'POST'); assert.equal(post.o.headers.Authorization, 'token kk123456:AT');
  assert.deepEqual(body.map(o => o.transaction_type + ' ' + o.quantity), ['SELL 65', 'BUY 65']); assert.ok(body.every(o => o.exchange === 'NFO' && o.product === 'NRML'));
  await KC.basketMargin(deps, [{ type: 'CE', K: 22800, qty: -65 }], '2026-10-13', 'NIFTY');
  assert.equal(calls.filter(c => /instruments/.test(c.u)).length, 1, 'instruments din me ek hi baar');
  await assert.rejects(KC.basketMargin(deps, [{ type: 'PE', K: 21000, qty: -65 }], '2026-10-13', 'NIFTY'), /nahi mila/);
});

test('OI shift: Resistance / Support badle (2 baar + 1.2×), covering, range, dedupe', () => {
  require('../extension/engine/oishift.js');
  const OS = KP.oishift;
  // chhota buildupTop: short = {K+T: dOI}, cover = {K+T: dOI}
  const bt = (short, cover = {}) => {
    const BU = {}, top = { long: [], short: [], cover: [] };
    for (const [k, d] of Object.entries(short)) { BU[k] = { id: 'short', dOI: d }; top.short.push({ K: parseFloat(k), T: k.slice(-2), b: BU[k] }); }
    for (const [k, d] of Object.entries(cover)) { BU[k] = { id: 'cover', dOI: d }; top.cover.push({ K: parseFloat(k), T: k.slice(-2), b: BU[k] }); }
    for (const id of ['short', 'cover']) { top[id].sort((a, b) => Math.abs(b.b.dOI) - Math.abs(a.b.dOI)); top[id] = top[id].slice(0, 3); }
    return { BU, top };
  };
  const sn = (short, cover) => OS.snap(bt(short, cover), 25100, 50);
  let r = OS.step(null, sn({ '25200CE': 5, '25000PE': 4 }), 600);
  assert.equal(r.events.length, 0, 'pehli baar sirf baseline');
  assert.equal(r.st.base.R.K, 25200); assert.equal(r.st.base.Su.K, 25000);
  // 25300 CE #1 bana: ek baar = koi alert nahi, doosri baar = res_up
  r = OS.step(r.st, sn({ '25300CE': 8, '25200CE': 4, '25000PE': 4 }), 605); assert.equal(r.events.length, 0, 'ek tick kaafi nahi');
  r = OS.step(r.st, sn({ '25300CE': 8, '25200CE': 4, '25000PE': 4 }), 610);
  assert.deepEqual(r.events.map(e => e.id), ['res_up']); assert.equal(r.events[0].from, 25200); assert.equal(r.events[0].to, 25300);
  assert.match(r.events[0].title, /Resistance 25,200 → 25,300/); assert.equal(r.events[0].bias, 'bull');
  // 1.2× rule: naya #1 thoda hi bada = shor
  let s2 = OS.step(null, sn({ '25200CE': 5, '25000PE': 4 }), 600).st;
  for (const t of [605, 610, 615]) { const x = OS.step(s2, sn({ '25250CE': 5.5, '25200CE': 5, '25000PE': 4 }), t); s2 = x.st; assert.equal(x.events.length, 0, '1.1× = no alert'); }
  // #2/#3 adla-badli = koi event nahi
  s2 = OS.step(null, sn({ '25200CE': 9, '25300CE': 3, '25400CE': 2, '25000PE': 4 }), 600).st;
  for (const t of [605, 610]) { const x = OS.step(s2, sn({ '25200CE': 9, '25300CE': 2, '25400CE': 3, '25000PE': 4 }), t); s2 = x.st; assert.equal(x.events.length, 0); }
  // range chhoti: R neeche + Su upar → sirf range_narrow
  let s3 = OS.step(null, sn({ '25300CE': 5, '24900PE': 5 }), 600).st, ev = [];
  for (const t of [605, 610]) { const x = OS.step(s3, sn({ '25200CE': 9, '25000PE': 9 }), t); s3 = x.st; ev = ev.concat(x.events); }
  assert.deepEqual(ev.map(e => e.id), ['range_narrow']); assert.equal(ev[0].from, 400); assert.equal(ev[0].to, 200);
  // range badi
  s3 = OS.step(null, sn({ '25200CE': 5, '25000PE': 5 }), 600).st; ev = [];
  for (const t of [605, 610]) { const x = OS.step(s3, sn({ '25300CE': 9, '24900PE': 9 }), t); s3 = x.st; ev = ev.concat(x.events); }
  assert.deepEqual(ev.map(e => e.id), ['range_wide']);
  // short covering resistance ke paas: 2 baar dikhe tabhi, ek hi baar
  let s4 = OS.step(null, sn({ '25200CE': 5, '25000PE': 4 }), 600).st;
  let x = OS.step(s4, sn({ '25200CE': 5, '25000PE': 4 }, { '25250CE': -3 }), 605); s4 = x.st; assert.equal(x.events.length, 0);
  x = OS.step(s4, sn({ '25200CE': 5, '25000PE': 4 }, { '25250CE': -3 }), 610); s4 = x.st;
  assert.deepEqual(x.events.map(e => e.id + e.K), ['res_cover25250'], 'same strike par cover_new dobara nahi');
  x = OS.step(s4, sn({ '25200CE': 5, '25000PE': 4 }, { '25250CE': -3 }), 615); s4 = x.st; assert.equal(x.events.length, 0, 'ek baar hi');
  // ATM ke paas naya 🔵 PE
  x = OS.step(s4, sn({ '25200CE': 5, '25000PE': 4 }, { '25250CE': -3, '25100PE': -2 }), 620); s4 = x.st; assert.equal(x.events.length, 0);
  x = OS.step(s4, sn({ '25200CE': 5, '25000PE': 4 }, { '25250CE': -3, '25100PE': -2 }), 625);
  assert.deepEqual(x.events.map(e => e.id + e.K), ['cover_new25100']);
  // baseline par pehle se covering = alert nahi
  const s5 = OS.step(null, sn({ '25200CE': 5, '25000PE': 4 }, { '25150CE': -4 }), 600).st;
  assert.equal(OS.step(s5, sn({ '25200CE': 5, '25000PE': 4 }, { '25150CE': -4 }), 605).events.length, 0);
  // dedupe: wahi shift 30 min me dobara nahi (upar, neeche, phir upar)
  let s6 = OS.step(null, sn({ '25200CE': 5, '25000PE': 4 }), 600).st, all = [];
  const go = (sh, t) => { const y = OS.step(s6, sn(sh), t); s6 = y.st; all = all.concat(y.events.map(e => e.id + e.to)); };
  go({ '25300CE': 9, '25000PE': 4 }, 605); go({ '25300CE': 9, '25000PE': 4 }, 610);
  go({ '25200CE': 20, '25000PE': 4 }, 615); go({ '25200CE': 20, '25000PE': 4 }, 620);
  go({ '25300CE': 40, '25000PE': 4 }, 625); go({ '25300CE': 40, '25000PE': 4 }, 630);
  assert.deepEqual(all, ['res_up25300', 'res_dn25200'], '30 min me 25300 dobara nahi');
});

test('OI shift advise: position card vs info card, near/far, Strong/Mixed, expiry', () => {
  const OS = KP.oishift, ev = Object.assign({ id: 'res_up', T: 'CE', from: 25200, to: 25300, t: 610 }, OS.text({ id: 'res_up', from: 25200, to: 25300 }));
  const base = { S: 25150, em: 120, step: 50, trend: 'up', trendLabel: 'Uptrend', dte: 3, nowMin: 610, R: 25300, Su: 25000, ltp: () => 40 };
  // koi position nahi → info card
  let a = OS.advise(ev, Object.assign({ legs: [] }, base));
  assert.equal(a.mode, 'info'); assert.equal(a.lv, 1); assert.equal(a.strength, 'Strong');
  assert.ok(a.why.some(w => /PE sell Support 25,000 ke neeche \(24,950 PE/.test(w)), a.why.join('|'));
  assert.ok(a.why.some(w => /✗ 25,200 CE sell/.test(w))); assert.ok(!a.why.some(w => /Tumhari position/.test(w)));
  // short 25200 CE paas me + Strong → exit / roll up 25350
  a = OS.advise(ev, Object.assign({ legs: [{ type: 'CE', K: 25200, qty: -65, avg: 82 }] }, base));
  assert.equal(a.mode, 'pos'); assert.equal(a.lv, 2);
  assert.ok(a.pos.some(p => /exit karo ya roll upar karo \(25,200 CE → 25,350 CE\)/.test(p)), a.pos.join('|'));
  assert.ok(a.pos.some(p => /SL cost par lao \(avg ₹82\.0\)/.test(p))); assert.ok(a.why.includes('✗ SL door mat karo, average mat karo.'));
  // trend ulta → Mixed, hold + agli candle
  a = OS.advise(ev, Object.assign({}, base, { trend: 'down', legs: [{ type: 'CE', K: 25200, qty: -65, avg: 82 }] }));
  assert.equal(a.strength, 'Mixed, ek candle ruko'); assert.ok(a.pos.some(p => /agli candle dekho/.test(p)));
  // door ki CE (25600) → hold
  a = OS.advise(ev, Object.assign({ legs: [{ type: 'CE', K: 25600, qty: -65, avg: 20 }] }, base));
  assert.ok(a.pos.some(p => /25,600 CE SELL \(450 pts door\): hold/.test(p)), a.pos.join('|'));
  // short PE = doosri side, premium aadha → hold + aadha book, lv1
  a = OS.advise(ev, Object.assign({ legs: [{ type: 'PE', K: 25000, qty: -65, avg: 90 }] }, base));
  assert.equal(a.lv, 1); assert.ok(a.pos.some(p => /koi khatra nahi, hold.*aadha book/.test(p)));
  // covering paas me → abhi exit / hedge
  const cv = Object.assign({ id: 'res_cover', T: 'CE', K: 25200, lvl: 25200, t: 610 }, OS.text({ id: 'res_cover', K: 25200, lvl: 25200 }));
  a = OS.advise(cv, Object.assign({ legs: [{ type: 'CE', K: 25200, qty: -65, avg: 82 }] }, base));
  assert.ok(a.pos.some(p => /abhi exit karo ya hedge lo \(25,300 CE BUY\)/.test(p)));
  assert.equal(OS.advise(cv, Object.assign({ legs: [] }, base)).lv, 2, 'covering info card bhi tez');
  // expiry din 2 baje ke baad
  a = OS.advise(ev, Object.assign({}, base, { dte: 0, nowMin: 845, legs: [{ type: 'CE', K: 25200, qty: -65, avg: 82 }] }));
  assert.ok(a.pos.some(p => /exit ko prefer/.test(p)));
  // BUY leg seller card me nahi ginti
  assert.equal(OS.advise(ev, Object.assign({ legs: [{ type: 'CE', K: 25200, qty: 65, avg: 82 }] }, base)).mode, 'info');
});
