/* Stop loss / target / risk:reward. Poori position ka SL/target SIRF ALERT (student khud exit kare, reaction time measure hota hai).
   Har leg ka SL/target: legAutoExit on ho to wo leg khud exit (fake order), warna alert.
   Basis = premium ka multiple: credit trade me credit, debit trade me diya hua debit. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const { fmt: { rs } } = KP;

/* Intraday default SL / target, avg premium ka % (order popup me pehle se bhara, IC / strategy legs ko bhi). 0 = band.
   SELL (naked): SL 30% (100 → 130), target 40% (→ 60). BUY: SL 25% (100 → 75), target 50% (→ 150).
   Expiry day (gamma tez): SL tight — SELL 20%, BUY 20%.
   legPctV: purane save me positional defaults (100/50) the; v2 par intraday wale lagte hain.
   legAutoExit: leg ka SL/target hit hote hi wo leg fake market order se exit (broker ke SL-M / target order jaisa). */
const LEG_PCT = { legSlPctShort: 30, legTgtPctShort: 40, legSlPctLong: 25, legTgtPctLong: 50, legSlPctShortExp: 20, legSlPctLongExp: 20 };
function defaultRisk() { return Object.assign({ slCredit: 1.5, tgtCredit: 0.5, slDebit: 0.5, tgtDebit: 1.0, legAutoExit: true, legPctV: 2 }, LEG_PCT); }
/* expiry day ho to SL ke expiry wale % */
const effRisk = (R, expiryDay) => expiryDay ? Object.assign({}, R, { legSlPctShort: R.legSlPctShortExp, legSlPctLong: R.legSlPctLongExp }) : R;
/* naked SELL warning: intraday me isse bada SL = khatra */
const MAX_SL = { short: 40, long: 40 };

/* kind 'credit' | 'debit', unitRs = premium ₹ (credit mila ya debit diya, poori qty ka) */
function levels(kind, unitRs, R) {
  const sl = kind === 'credit' ? R.slCredit : R.slDebit, tg = kind === 'credit' ? R.tgtCredit : R.tgtDebit;
  const slRs = Math.max(1, unitRs * sl), tgtRs = Math.max(1, unitRs * tg);
  return { slMult: sl, tgtMult: tg, slRs, tgtRs, rr: tgtRs / slRs, needWin: slRs / (slRs + tgtRs) };
}
function makePlan(o, R) {
  return Object.assign({ strategy: o.strategy || 'manual', name: o.name || 'Manual position', kind: o.kind, unitRs: Math.abs(o.unitRs), pnl0: o.pnl0, at: o.at,
    early: !!o.early, hits: [], widened: 0, closed: null }, levels(o.kind, Math.abs(o.unitRs), R));
}
/* Har tick: returns naya hit ('sl' | 'target') ya null. Ek type ek hi baar fire hota hai,
   lekin P&L wapas normal zone me aaye aur phir hit ho to dobara (15 min baad). */
const REARM_MS = 15 * 60e3;
function check(plan, pnl, now) {
  if (!plan || plan.closed) return null;
  const st = plan.state || (plan.state = { sl: null, target: null });
  for (const [k, hit] of [['sl', pnl <= -plan.slRs], ['target', pnl >= plan.tgtRs]]) {
    if (hit) {
      if (!st[k] || (st[k].out && now - st[k].at > REARM_MS)) {
        const h = { type: k, at: now, pnl, reacted: null }; plan.hits.push(h); st[k] = { at: now, out: false }; return h;
      }
    } else if (st[k]) st[k].out = true;
  }
  return null;
}
/* Position flat hui: pending hits ka reaction time (sec) aur final result */
function close(plan, pnl, now) {
  if (!plan || plan.closed) return null;
  plan.hits.forEach(h => { if (h.reacted == null) h.reacted = (now - h.at) / 1000; });
  plan.closed = { at: now, pnl };
  return plan.closed;
}
/* SL/target edit. SL door khiskana (badhana) count hota hai. */
function edit(plan, slRs, tgtRs) {
  if (slRs > 0) { if (slRs > plan.slRs * 1.05) plan.widened++; plan.slRs = slRs; }
  if (tgtRs > 0) plan.tgtRs = tgtRs;
  plan.rr = plan.tgtRs / plan.slRs; plan.needWin = plan.slRs / (plan.slRs + plan.tgtRs);
  plan.slMult = plan.slRs / plan.unitRs; plan.tgtMult = plan.tgtRs / plan.unitRs;
}
/* ---------- per-leg SL + target (Kite jaisa: avg premium ka %) ----------
   map = {key: {slPct, tgtPct, sl, tgt, auto, tAuto, qty, avg, hit, widened}}. sl/tgt = trigger price (pct + avg se).
   SELL leg: SL = avg × (1 + SL%) (LTP upar gaya), target = avg × (1 − T%). BUY leg: SL = avg × (1 − SL%), target = avg × (1 + T%).
   Order ticket me student SL% / target% bharta hai (zaroori). IC / strategy wale legs ko Settings ke default %.
   auto/tAuto = Settings se aaya % (Settings badlo to badle); student ne bhara/edit kiya to manual. */
const r2 = x => Math.round(x * 20) / 20;                              // 0.05 tick
function legPx(qty, avg, pct, which) {
  if (!(pct > 0) || !(avg > 0)) return null;
  const up = (qty < 0) === (which === 'sl'), px = r2(avg * (1 + (up ? 1 : -1) * pct / 100));
  return px > 0 ? px : 0.05;
}
const defPct = (qty, R, which) => qty < 0 ? (which === 'sl' ? R.legSlPctShort : R.legTgtPctShort) : (which === 'sl' ? R.legSlPctLong : R.legTgtPctLong);
function price(e) { e.sl = legPx(e.qty, e.avg, e.slPct, 'sl'); e.tgt = legPx(e.qty, e.avg, e.tgtPct, 'tgt'); return e; }
function newLeg(qty, avg, R) { return price({ slPct: defPct(qty, R, 'sl') || null, tgtPct: defPct(qty, R, 'tgt') || null, auto: true, tAuto: true, qty, avg, hit: null, widened: 0 }); }
/* order ticket se aaya SL% / target% (manual). Leg pehle se khuli ho to bhi naya % lagta hai. */
function setLeg(map, k, qty, avg, slPct, tgtPct, R) {
  let e = map[k]; if (!e || Math.sign(e.qty) !== Math.sign(qty)) e = map[k] = newLeg(qty, avg, R);
  Object.assign(e, { qty, avg, slPct: slPct > 0 ? +slPct : null, tgtPct: tgtPct > 0 ? +tgtPct : null, auto: false, tAuto: false, hit: null });
  return price(e);
}
/* open legs ke hisaab se map update; band hui legs return (reaction time ke liye) */
function syncLegs(map, legs, R) {
  const open = {};
  legs.forEach(l => {
    const k = KP.keyOf(l.type, l.K); open[k] = 1; let e = map[k];
    if (!e || Math.sign(e.qty) !== Math.sign(l.qty) || e.slPct === undefined) { map[k] = newLeg(l.qty, l.avg, R); return; }   // naya ya purana (price wala) save
    if (e.avg !== l.avg || e.qty !== l.qty) { e.qty = l.qty; e.avg = l.avg; price(e); e.hit = null; }   // lots jode: % wahi, trigger naye avg se
  });
  const gone = [];
  Object.keys(map).forEach(k => { if (!open[k]) { gone.push(Object.assign({ key: k }, map[k])); delete map[k]; } });
  return gone;
}
/* Settings ka default % badla: auto wale legs dobara */
function reLegs(map, R) {
  Object.values(map).forEach(e => { if (e.auto) e.slPct = defPct(e.qty, R, 'sl') || null; if (e.tAuto) e.tgtPct = defPct(e.qty, R, 'tgt') || null; price(e); e.hit = null; });
}
function legHitNow(e, ltp) {
  if (ltp == null) return null;
  const s = e.qty < 0;
  if (e.sl != null && (s ? ltp >= e.sl : ltp <= e.sl)) return 'sl';
  if (e.tgt != null && (s ? ltp <= e.tgt : ltp >= e.tgt)) return 'target';
  return null;
}
/* returns {type:'sl'|'target', at, ltp} ek hi baar (edit karne par re-arm) */
function checkLeg(e, ltp, now) {
  if (!e || e.hit) return null;
  const type = legHitNow(e, ltp); if (!type) return null;
  e.hit = { type, at: now, ltp }; return e.hit;
}
/* which 'sl' | 'tgt', pct = % (<= 0 / blank = band). SL % badhana = SL door khiskana (widened). */
function editLeg(e, pct, which) {
  const v = pct > 0 ? +pct : null;
  if (which === 'tgt') { e.tAuto = false; e.tgtPct = v; price(e); e.hit = null; return false; }
  const old = e.slPct; e.auto = false;
  const wid = old != null && v != null && v > old * 1.02;
  if (wid) e.widened++;
  e.slPct = v; price(e); e.hit = null;
  return wid;
}
const legDist = (e, ltp) => e.sl == null || ltp == null ? null : (e.qty < 0 ? e.sl - ltp : ltp - e.sl);   // kitna door hai SL (points)

function tips(plans) {
  const t = [], sl = [], tg = [], leg = [], legT = [];
  plans.forEach(p => p.hits.forEach(h => (h.type === 'sl' ? sl : h.type === 'legsl' ? leg : h.type === 'legtgt' ? legT : tg).push(h)));
  const autoN = leg.filter(h => h.auto).length, manL = leg.filter(h => !h.auto);
  if (leg.length) { const slowL = manL.filter(h => h.reacted == null || h.reacted > 300); t.push(leg.length + ' baar kisi leg ka SL hit hua' + (autoN ? ' (' + autoN + ' baar SL order ne khud kaata)' : '') + '.' + (slowL.length ? ' ' + slowL.length + ' baar leg 5 min se zyada nahi kaati.' : manL.length ? ' Har baar leg time par kaati, shabash.' : '')); }
  if (legT.length) t.push(legT.length + ' baar kisi leg ka target aaya aur profit book hua.');
  const slow = sl.filter(h => h.reacted == null || h.reacted > 300);
  if (sl.length) t.push(sl.length + ' baar SL hit hua.' + (slow.length ? ' ' + slow.length + ' baar 5 min se zyada hold kiya. SL ka matlab hai turant bahar.' : ' Har baar time par exit kiya, shabash.'));
  if (tg.length) { const late = tg.filter(h => h.reacted == null || h.reacted > 600); if (late.length) t.push(late.length + ' baar target aane ke baad bhi profit book nahi kiya. Lalach se profit wapas loss ban sakta hai.'); }
  const w = plans.reduce((s, p) => s + p.widened, 0);
  if (w) t.push(w + ' baar SL door khiskaya. Ye sabse common galti hai: plan entry se pehle banao, trade ke beech me mat badlo.');
  return t;
}
const rrTxt = p => '1 : ' + p.rr.toFixed(2);
const desc = p => 'SL ' + rs(-p.slRs) + ' · Target ' + rs(p.tgtRs) + ' · Risk:Reward ' + rrTxt(p);

KP.risk = { defaultRisk, levels, makePlan, check, close, edit, tips, rrTxt, desc, syncLegs, reLegs, checkLeg, editLeg, legDist, legPx, setLeg, defPct, effRisk, LEG_PCT, MAX_SL };
})();
