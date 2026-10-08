/* Kite option chain DOM → snapshot {spot, expiry, rows:[{K, ce:{ltp,iv}, pe:{ltp,iv}}], table, rowEls}.
   Sirf screen par dikhne wala market data padhta hai. Koi cookie/token/storage/network nahi. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/* cell ka text, lekin hamare injected buttons ([data-kp-host]) ke andar ka kuch nahi (page ne galti se text daala ho to bhi) */
function rawText(el) {
  if (!el) return '';
  if (!el.querySelector || !el.querySelector('[data-kp-host]')) return el.textContent || '';
  let t = ''; for (const n of el.childNodes) { if (n.nodeType === 3) t += n.nodeValue; else if (n.nodeType === 1 && !n.hasAttribute('data-kp-host')) t += ' ' + rawText(n) + ' '; }
  return t;
}
function cellText(el) { return rawText(el).replace(/\s+/g, ' ').trim(); }
function num(el) {
  const m = cellText(el).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
/* Kite 2026 cell me "% change + price" ek saath ("54.60% 26.05"): % wale number chhod ke aakhri number */
function priceNum(el) {
  const t = cellText(el).replace(/,/g, ''), all = [...t.matchAll(/-?\d+(?:\.\d+)?(?!\d|\.\d|\s*%)/g)].map(m => parseFloat(m[0]));
  return all.length ? all[all.length - 1] : null;
}
const directCells = tr => [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');

/* logical column ranges (colspan ke saath): [{a,b}] */
function spans(cells) { let x = 0; return cells.map(c => { const n = Math.max(1, parseInt(c.getAttribute && c.getAttribute('colspan')) || 1), s = { a: x, b: x + n }; x += n; return s; }); }

/* header row se columns. Strike ke left = CE, right = PE; strike ke sabse paas wala LTP column.
   Har column ke liye header ka element + colspan range rakhte hain; body cells baad me position (x) se milate hain. */
function headerMap(table) {
  const SEL = KP.SEL, hrows = [...table.querySelectorAll(SEL.headerRows)];
  for (let r = hrows.length - 1; r >= 0; r--) {
    const els = directCells(hrows[r]), cells = els.map(cellText), sp = spans(els), si = cells.findIndex(t => SEL.strikeHeader.test(t));
    if (si < 0) continue;
    const pick = (re, from, to, dir) => { for (let i = from; dir < 0 ? i >= to : i <= to; i += dir) if (re.test(cells[i])) return i; return -1; };
    const col = i => i < 0 ? null : { el: els[i], span: sp[i] };
    const ci = pick(SEL.ltpHeader, si - 1, 0, -1), pi = pick(SEL.ltpHeader, si + 1, cells.length - 1, 1);
    if (ci < 0 || pi < 0) continue;
    return { strike: col(si), ncols: sp[sp.length - 1].b,
      ce: { ltp: col(ci), iv: col(pick(SEL.ivHeader, si - 1, 0, -1)), oi: SEL.oiHeader ? col(pick(SEL.oiHeader, si - 1, 0, -1)) : null },
      pe: { ltp: col(pi), iv: col(pick(SEL.ivHeader, si + 1, cells.length - 1, 1)), oi: SEL.oiHeader ? col(pick(SEL.oiHeader, si + 1, cells.length - 1, 1)) : null } };
  }
  return null;
}
/* body row ke wo cells jo header column ke neeche hain: pehle screen position (x overlap), na ho to colspan range */
function colCells(rowEls, rowSp, col) {
  if (!col) return [];
  const hr = col.el.getBoundingClientRect ? col.el.getBoundingClientRect() : null;
  if (hr && hr.width > 0) {
    const hit = rowEls.filter(c => { const r = c.getBoundingClientRect(); if (!(r.width > 0)) return false; const ov = Math.min(r.right, hr.right) - Math.max(r.left, hr.left); return ov > 0.5 * Math.min(r.width, hr.width); });
    if (hit.length) return hit;
  }
  return rowEls.filter((c, i) => rowSp[i].a < col.span.b && rowSp[i].b > col.span.a);
}
const textOf = cs => cs.map(cellText).join(' ');
/* Kite OI cell: "-23.23% 34.34" → {oi: 34.34 (lakh), chg: -23.23}. % wala number change hai, baaki OI. */
function oiNum(t) {
  const s = String(t || '').replace(/,/g, '').replace(/[−–]/g, '-'), pm = s.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  const rest = pm ? s.replace(pm[0], ' ') : s, om = rest.match(/\d+(?:\.\d+)?/);
  return om ? { oi: parseFloat(om[0]), chg: pm ? parseFloat(pm[1]) : null } : null;
}
function strikeNum(t) { const m = t.replace(/,/g, '').match(/\d+(?:\.\d+)?(?!\d|\.\d|\s*%)/); return m ? parseFloat(m[0]) : null; }

function findChain() {
  for (const sel of KP.SEL.chainRoots) {
    for (const root of document.querySelectorAll(sel)) {
      const tables = root.matches(KP.SEL.table) ? [root] : root.querySelectorAll(KP.SEL.table);
      for (const t of tables) { const map = headerMap(t); if (map) return { root, table: t, map }; }
    }
  }
  return null;
}

/* "13 Oct", "13 OCT 2026", "13th Oct, 26" → 'YYYY-MM-DD' (year na ho to aaj ke baad wala) */
function parseExpiry(text, nowMs) {
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*('?\d{2,4})?\b/ig;
  const today = KP.istDay(nowMs); let m, best = null;
  while ((m = re.exec(text))) {
    const d = +m[1], mo = MON[m[2].toLowerCase()];
    let y = m[3] ? +m[3].replace("'", '') : null; if (y != null && y < 100) y += 2000;
    const ty = +today.slice(0, 4), cand = [];
    if (y) cand.push(y); else cand.push(ty, ty + 1);
    for (const yy of cand) {
      const iso = new Date(Date.UTC(yy, mo, d)).toISOString().slice(0, 10);
      if (iso >= today) { best = iso; break; }
    }
    if (best) return best;
  }
  return null;
}
function readExpiry(root, nowMs) {
  for (const sel of KP.SEL.expiryNodes) {
    for (const el of root.querySelectorAll(sel)) {
      const t = el.tagName === 'SELECT' ? (el.selectedOptions[0] && el.selectedOptions[0].textContent) || '' : cellText(el);
      const e = parseExpiry(t.slice(0, 200), nowMs); if (e) return e;
    }
  }
  return parseExpiry(cellText(root).slice(0, 1500), nowMs);
}
function readSpot(root) {
  for (const sel of KP.SEL.spotNodes) { const el = root.querySelector(sel) || document.querySelector(sel); const v = el && num(el); if (v > 1000) return { v, el }; }
  return null;
}
const sgn = s => parseFloat(s.replace(/,/g, '').replace('−', '-'));
/* spot element ke paas "+45.10 (0.18%)" mile to kal ka close */
function readPrevClose(sp) {
  let el = sp && sp.el;
  for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
    const m = KP.SEL.changeText.exec(cellText(el).slice(0, 300));
    if (m) { const ch = sgn(m[1]), pc = sp.v - ch; return pc > 0 && Math.abs(ch / pc * 100 - sgn(m[2])) < 0.05 ? pc : null; }
  }
  return null;
}
/* Chain page URL se underlying: /markets/option-chain/INDICES/NIFTY%2050/256265 → {name:'NIFTY 50', token:256265} */
function pageIndex() {
  const p = location.pathname.split('/').map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } }), i = p.indexOf('option-chain');
  if (i < 0) return null;
  const tok = p.slice(i + 1).find(s => /^\d{3,10}$/.test(s)), name = p[i + 2] && !/^\d+$/.test(p[i + 2]) ? p[i + 2] : null;
  return name || tok ? { name, token: tok ? +tok : null } : null;
}
/* Kite header / chain title: "NIFTY 50  22,776.10  220.35 (0.98%)" → spot + kal ka close (text se, class ka andaza nahi). Element cache. */
let hdrEl = null;
function readIndexHeader(name) {
  if (!name) return null;
  const RE = /([\d,]+\.\d+)\s*([+\-−]?[\d,]+\.\d+)\s*\(\s*([+\-−]?[\d.]+)\s*%\s*\)/;
  // har text node ke beech space (Kite me naam / price / change alag spans me bina space ke hote hain)
  const spaced = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = []; for (let n = w.nextNode(); n && out.length < 40; n = w.nextNode()) out.push(n.nodeValue); return out.join(' ').replace(/\s+/g, ' ').trim(); };
  const tryEl = el => { const t = spaced(el).slice(0, 200), at = t.toUpperCase().indexOf(name.toUpperCase()); if (at < 0) return null; const m = RE.exec(t.slice(at + name.length)); if (!m) return null;
    const ltp = sgn(m[1]), ch = sgn(m[2]), pc = ltp - ch; return pc > 0 && Math.abs(ch / pc * 100 - sgn(m[3])) < 0.06 ? { spot: ltp, prevClose: +pc.toFixed(2) } : null; };
  if (hdrEl && hdrEl.isConnected) { const r = tryEl(hdrEl); if (r) return r; }
  hdrEl = null;
  if (Date.now() - hdrMissAt < 15000) return null;                 // poora page scan mehenga: fail ho to 15 sec ruko
  const it = document.createNodeIterator(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim().toUpperCase() === name.toUpperCase() ? 1 : 2 });
  for (let n = it.nextNode(), k = 0; n && k < 20; n = it.nextNode(), k++) {
    let el = n.parentElement;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) { const r = tryEl(el); if (r) { hdrEl = el; return r; } }
  }
  hdrMissAt = Date.now();
  return null;
}
let hdrMissAt = 0;
/* India VIX (marketwatch me ho to). Poora document scan mehenga hai, isliye 15 sec cache. */
let vixCache = { at: 0, v: null };
function readVix(nowMs) {
  if (nowMs - vixCache.at < 15000) return vixCache.v;
  vixCache = { at: nowMs, v: null };
  const it = document.createNodeIterator(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: n => KP.SEL.vixLabel.test(n.nodeValue) ? 1 : 2 });
  const n = it.nextNode(); if (!n) return null;
  let el = n.parentElement;
  for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
    const t = cellText(el).replace(/,/g, ''), m = t.match(/INDIA\s*VIX\D*?(\d{1,2}\.\d{1,2})/i);
    if (m) { const p = t.slice(m.index + m[0].length).match(/([+\-−]?\d+(?:\.\d+)?)\s*%/); vixCache.v = { v: +m[1], chg: p ? sgn(p[1]) : null, src: 'kite' }; break; }
  }
  return vixCache.v;
}

function read(nowMs) {
  const found = findChain(); if (!found) return null;
  const { root, table, map } = found, rows = [], rowEls = [];
  /* column → cell index: ek row par geometry/colspan se nikalo, phir same cell-count wali saari rows me wahi index (tez; har cell naapna nahi padta) */
  const idxCache = new Map();
  const idxFor = (c, sp) => {
    let ix = idxCache.get(c.length);
    if (!ix) {
      const at = col => colCells(c, sp, col).map(x => c.indexOf(x));
      ix = { s: at(map.strike), ce: at(map.ce.ltp), pe: at(map.pe.ltp), ceIv: map.ce.iv ? at(map.ce.iv) : [], peIv: map.pe.iv ? at(map.pe.iv) : [],
        ceOi: map.ce.oi ? at(map.ce.oi) : [], peOi: map.pe.oi ? at(map.pe.oi) : [] };
      idxCache.set(c.length, ix);
    }
    return ix;
  };
  const pick = (c, is) => is.map(i => c[i]).filter(Boolean), pv = cs => priceNum({ textContent: textOf(cs) });
  for (const tr of table.querySelectorAll(KP.SEL.bodyRows)) {
    const c = directCells(tr); if (c.length < 3) continue;
    const ix = idxFor(c, spans(c)), sc = pick(c, ix.s), K = strikeNum(textOf(sc)); if (!(K > 0) || !sc.length) continue;
    const cc = pick(c, ix.ce), pc = pick(c, ix.pe);
    if (!cc.length || !pc.length) continue;
    const co = ix.ceOi.length ? oiNum(textOf(pick(c, ix.ceOi))) : null, po = ix.peOi.length ? oiNum(textOf(pick(c, ix.peOi))) : null;
    // Kite ka LTP header 2 cells par: "pct-change" (kal se %) + "last-price"
    const lch = cs => { const m = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(textOf(cs).replace(/,/g, '').replace(/[−–]/g, '-')); return m ? parseFloat(m[1]) : null; };
    rows.push({ K, ce: { ltp: pv(cc), ltpChg: lch(cc), iv: ix.ceIv.length ? pv(pick(c, ix.ceIv)) : null, oi: co && co.oi, oiChg: co && co.chg },
      pe: { ltp: pv(pc), ltpChg: lch(pc), iv: ix.peIv.length ? pv(pick(c, ix.peIv)) : null, oi: po && po.oi, oiChg: po && po.chg } });
    // buttons: CE wale strike ke sabse paas wale Call LTP cell me, PE wale Put LTP cell me
    rowEls.push({ K, tr, strikeCell: sc[0], callCell: cc[cc.length - 1], putCell: pc[0] });
  }
  if (!rows.length) return null;
  const sp = readSpot(root), idx = pageIndex();
  let vix = null, hdr = null; try { vix = readVix(nowMs); } catch (e) {}
  if (!sp) { try { hdr = readIndexHeader((idx && idx.name) || 'NIFTY 50'); } catch (e) {} }
  return { source: 'kite', spot: sp ? sp.v : hdr ? hdr.spot : null, prevClose: sp ? readPrevClose(sp) : hdr ? hdr.prevClose : null, vix, index: idx, expiry: readExpiry(root, nowMs), rows, table, rowEls,
    underlying: (/\b(BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|NIFTY)\b/.exec(cellText(root).slice(0, 800)) || [])[1] || null };
}

/* Debug: chhota text report (chat me paste karne layak): headers + ATM ke aas-paas ki rows ka raw cell text aur parsed price */
function debugReport(nowMs, mkt) {
  const f = findChain(); if (!f) return 'CHAIN NOT FOUND on ' + location.pathname;
  const { root, table, map } = f, L = [];
  const hdr = c => c ? '"' + cellText(c.el) + '" span ' + c.span.a + '-' + c.span.b + ' x ' + Math.round(c.el.getBoundingClientRect().left) + '-' + Math.round(c.el.getBoundingClientRect().right) : '-';
  L.push('KP chain report ' + new Date(nowMs).toISOString() + ' ' + location.pathname);
  const feed = KP.app && KP.app.S && KP.app.S.cfg ? KP.app.S.cfg.feed + (KP.app.S.cfg.feed === 'demo' ? ' (' + KP.app.S.cfg.demoMode + ') <<< NAKLI PRICES, Kite nahi' : '') : '?';
  L.push('FEED: ' + feed);
  L.push('headers: strike ' + hdr(map.strike) + ' | CE ltp ' + hdr(map.ce.ltp) + ' | PE ltp ' + hdr(map.pe.ltp) + ' | CE iv ' + hdr(map.ce.iv) + ' | PE iv ' + hdr(map.pe.iv));
  const sp = readSpot(root), idx = pageIndex(), hd = readIndexHeader((idx && idx.name) || 'NIFTY 50');
  L.push('spot node: ' + (sp ? sp.v : 'none') + ' | header: ' + (hd ? hd.spot + ' / kal ka close ' + hd.prevClose : 'none') + ' | index: ' + JSON.stringify(idx) + ' | expiry read: ' + readExpiry(root, nowMs));
  if (mkt) L.push('panel: S(fwd)=' + (mkt.S || 0).toFixed(2) + ' spot=' + mkt.spot + ' expiry=' + mkt.expiry + ' T(days)=' + (mkt.ready ? (mkt.T() * 365).toFixed(2) : '-') + ' atmIV=' + (mkt.ready ? (mkt.atmIV() || 0).toFixed(2) : '-'));
  const rows = [...table.querySelectorAll(KP.SEL.bodyRows)].map(tr => { const c = directCells(tr), s = spans(c); return { c, s, sc: colCells(c, s, map.strike) }; }).filter(r => r.c.length >= 3 && r.sc.length);
  L.push('body rows: ' + rows.length + ' | cells in first row: ' + (rows[0] ? rows[0].c.length + ' [' + rows[0].c.map(cellText).join(' | ') + ']' : '-'));
  const ks = rows.map(r => strikeNum(textOf(r.sc))), S = mkt && mkt.S, mid = S ? ks.reduce((bi, k, i) => Math.abs(k - S) < Math.abs(ks[bi] - S) ? i : bi, 0) : Math.floor(rows.length / 2);
  for (const r of rows.slice(Math.max(0, mid - 4), mid + 5)) {
    const cc = colCells(r.c, r.s, map.ce.ltp), pc = colCells(r.c, r.s, map.pe.ltp), K = strikeNum(textOf(r.sc));
    const ce = priceNum({ textContent: textOf(cc) }), pe = priceNum({ textContent: textOf(pc) });
    L.push('K ' + K + ' | CE cells [' + cc.map(cellText).join(' / ') + '] -> ' + ce + (mkt && mkt.ready ? ' (model ' + mkt.price('CE', K).p.toFixed(2) + ')' : '') +
      ' | PE cells [' + pc.map(cellText).join(' / ') + '] -> ' + pe + (mkt && mkt.ready ? ' (model ' + mkt.price('PE', K).p.toFixed(2) + ')' : ''));
  }
  return L.join('\n');
}

/* Debug/P0: chain wala chhota se chhota element jisme "Strike" + "LTP" dono hon, uska HTML (scripts hata ke) */
function snapshotHTML() {
  const found = findChain();
  let el = found ? found.table.closest('[class]') || found.table : null;
  if (!el) {
    const all = [...document.querySelectorAll('div,section,table')].filter(e => /strike/i.test(e.textContent || '') && /ltp/i.test(e.textContent || ''));
    el = all.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length)[0] || null;
  }
  if (!el) return null;
  const c = el.cloneNode(true);
  c.querySelectorAll('script,style,svg,input,[data-kp-host]').forEach(x => x.remove());
  return { found: !!found, html: c.outerHTML.slice(0, 300000) };
}

KP.kite = Object.assign(KP.kite || {}, { read, findChain, headerMap, parseExpiry, oiNum, snapshotHTML, readPrevClose, priceNum, debugReport, pageIndex, readIndexHeader });
})();
