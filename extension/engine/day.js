/* Intraday recorder: har tick se 1-min OHLC (spot) + ATM IV path. Opening range (9:15–9:30) isi se.
   Sirf IST market minutes (555..929) record hote hain. Ek din = ek object, naye din par rollover. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const OPEN = 555, OR_END = 570, CLOSE = 930;            // 09:15, 09:30, 15:30 (IST minutes)

function newDay(date, prevClose, prevHigh, prevLow) {
  return { date, bars: {}, first: null, last: null, iv0: null, iv: {}, prevClose: prevClose || null, close: null, closeSrc: null,
    prevHigh: prevHigh || null, prevLow: prevLow || null };
}
/* bars[min] = [o,h,l,c]; iv[min5] = ATM IV (%) */
function record(day, t, S, iv) {
  if (!(S > 0)) return false;
  const m = KP.istMin(t); if (m < OPEN || m >= CLOSE) return false;
  const b = day.bars[m];
  if (b) { b[1] = Math.max(b[1], S); b[2] = Math.min(b[2], S); b[3] = S; } else day.bars[m] = [S, S, S, S];
  if (day.first == null || m < day.first) day.first = m;
  day.last = m;
  if (iv > 0) { if (day.iv0 == null) day.iv0 = iv; day.iv[m - m % 5] = iv; }
  if (m >= 925) { day.close = S; day.closeSrc = 'recorded'; }
  return true;
}
function minutes(day) { return Object.keys(day.bars).map(Number).sort((a, b) => a - b); }
/* n-minute candles: [{t (start min), o, h, l, c}] */
function candles(day, n) {
  const out = []; let cur = null;
  for (const m of minutes(day)) {
    const t = m - (m - OPEN) % n, [o, h, l, c] = day.bars[m];
    if (!cur || cur.t !== t) { cur = { t, o, h, l, c }; out.push(cur); } else { cur.h = Math.max(cur.h, h); cur.l = Math.min(cur.l, l); cur.c = c; }
  }
  return out;
}
/* Opening range. manual = {orHi, orLo} override. complete = 9:30 ho chuka. */
function or15(day, nowMin, manual) {
  if (manual && manual.orHi > 0 && manual.orLo > 0 && manual.orHi > manual.orLo) return { hi: +manual.orHi, lo: +manual.orLo, src: 'manual', complete: true };
  let hi = -Infinity, lo = Infinity, n = 0;
  for (let m = OPEN; m < OR_END; m++) { const b = day.bars[m]; if (b) { hi = Math.max(hi, b[1]); lo = Math.min(lo, b[2]); n++; } }
  if (!n) return null;
  return { hi, lo, src: day.first > OPEN + 1 ? 'partial' : 'recorded', complete: nowMin >= OR_END };
}
function open(day) { const m = minutes(day)[0]; return m == null ? null : { px: day.bars[m][0], exact: m <= OPEN + 1 }; }
function hiLo(day, fromMin) {
  let hi = -Infinity, lo = Infinity;
  for (const m of minutes(day)) if (m >= (fromMin || 0)) { hi = Math.max(hi, day.bars[m][1]); lo = Math.min(lo, day.bars[m][2]); }
  return hi > -Infinity ? { hi, lo } : null;
}
function lastPx(day) { return day.last == null ? null : day.bars[day.last][3]; }
function ivAt(day, m) { let v = null; for (const k of Object.keys(day.iv).map(Number).sort((a, b) => a - b)) if (k <= m) v = day.iv[k]; return v; }

/* Bahar se aayi 1-min candles (Yahoo: index spot) se din bharo, taaki panel der se khola ho tab bhi OR / open / gap mile.
   v = {date:'YYYY-MM-DD', bars:[[istMin,o,h,l,c]], prevClose, lastClose}. Aaj ki candles ho to wahi prefer (spot index, consistent). */
function backfill(day, v) {
  if (!day || !v || !v.date) return false;
  const src = v.src || 'yahoo';
  if (v.date === day.date) {
    let n = 0;
    for (const [m, o, h, l, c] of v.bars || []) if (m >= OPEN && m < CLOSE && [o, h, l, c].every(x => x > 0)) { day.bars[m] = [o, h, l, c]; n++; }
    // Yahoo ka chartPreviousClose bharosemand nahi (ek din purana deta hai, 22,555 vs asli 22,776): sirf Kite wala prevClose
    if (src !== 'yahoo' && v.prevClose > 0 && (!day.prevClose || day.prevSrc !== 'kite-header')) { day.prevClose = v.prevClose; day.prevSrc = src; }
    if (src === 'yahoo' && day.prevSrc === 'yahoo') { day.prevClose = null; day.prevSrc = null; }          // pehle aaya galat Yahoo close hatao
    if (src !== 'yahoo' && v.prevHigh > 0 && v.prevLow > 0) { day.prevHigh = v.prevHigh; day.prevLow = v.prevLow; day.prevHLSrc = src; }
    if (!n) return v.prevClose > 0;
    const ms = minutes(day); day.first = ms[0]; day.last = ms[ms.length - 1]; day.backfill = src;
    if (day.last >= 925) { day.close = day.bars[day.last][3]; day.closeSrc = src; }
    return true;
  }
  if (v.date < day.date && !day.prevClose && v.lastClose > 0) { day.prevClose = v.lastClose; day.prevSrc = src; return true; }   // pre-open: kal ki aakhri candle = kal ka close
  if (v.date < day.date && src !== 'yahoo' && v.prevHigh > 0 && !day.prevHigh) { day.prevHigh = v.prevHigh; day.prevLow = v.prevLow; day.prevHLSrc = src; }
  return false;
}

/* Naye din par: purane din ka close (15:25 ke baad dekha gaya) naye din ka prevClose ban jaata hai. */
function rollover(day, today) {
  if (day && day.date === today) return day;
  const pc = day && day.date < today ? (day.close || null) : null;
  // kal ka High / Low: sirf tab jab kal ka din (lagbhag) poora record hua ho
  const full = day && day.date < today && day.first != null && day.first <= OPEN + 30 && day.last >= 900, hl = full ? hiLo(day) : null;
  const nd = newDay(today, pc, hl && hl.hi, hl && hl.lo); if (hl) nd.prevHLSrc = 'record';
  return nd;
}

KP.day = { OPEN, OR_END, CLOSE, newDay, record, candles, or15, open, hiLo, lastPx, ivAt, rollover, minutes, backfill };
})();
