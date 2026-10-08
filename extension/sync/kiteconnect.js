/* Kite Connect (official API, user ki apni app): login → access_token, phir historical 1-min candles (opening range, open, kal ka close).
   API key / secret / token sirf background storage me. Kite web ka session/cookie kabhi nahi padhte; ye alag official API login hai.
   deps = {get, set, fetch, now, sha256hex} taaki Node me test ho sake. */
(function (root) {
'use strict';
const KC = 'kp_kc', API = 'https://api.kite.trade', REDIRECT = 'http://127.0.0.1/kp-kite-callback', IST = 5.5 * 3600e3;
const mask = k => k ? k.slice(0, 4) + '…' + k.slice(-3) : '';
const clean = s => String(s || '').replace(/[\s​-‍⁠﻿"'`]/g, '');
const istDay = ms => new Date(ms + IST).toISOString().slice(0, 10);
/* access_token agle din ~6:00 IST tak chalta hai */
function tokenValid(c, now) {
  if (!c.accessToken || !c.loginAt) return false;
  const d = new Date(now + IST), six = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0) - IST, lastSix = now >= six ? six : six - 864e5;
  return c.loginAt >= lastSix;
}
async function getCfg(deps) { return (await deps.get(KC)) || {}; }
async function status(deps) {
  const c = await getCfg(deps), ok = tokenValid(c, deps.now());
  return { hasKey: !!c.apiKey, key: mask(c.apiKey), hasSecret: !!c.apiSecret, loggedIn: ok, user: ok ? c.userName || c.userId || '' : '', loginAt: c.loginAt || null,
    expired: !!c.accessToken && !ok, lastError: c.lastError || '', redirect: REDIRECT };
}
async function setCfg(deps, p) {
  const c = await getCfg(deps);
  if (p.apiKey !== undefined) { const k = clean(p.apiKey); if (k && !/^[A-Za-z0-9]{6,40}$/.test(k)) throw new Error('API key sahi nahi lagti (sirf letters/numbers, developer.kite.trade → My apps se copy karo).'); if (k !== c.apiKey) { c.accessToken = null; c.loginAt = null; } c.apiKey = k || null; }
  if (p.apiSecret !== undefined) { const s = clean(p.apiSecret); if (s && !/^[A-Za-z0-9]{8,64}$/.test(s)) throw new Error('API secret sahi nahi lagta.'); c.apiSecret = s || null; }
  c.lastError = ''; await deps.set(KC, c);
  return status(deps);
}
function loginUrl(c) { return 'https://kite.zerodha.com/connect/login?v=3&api_key=' + encodeURIComponent(c.apiKey); }
/* redirect URL se request_token → access_token (checksum = SHA256(api_key + request_token + api_secret)) */
async function exchange(deps, url) {
  const c = await getCfg(deps), u = new URL(url), rt = u.searchParams.get('request_token'), st = u.searchParams.get('status');
  if (!rt) { c.lastError = 'Login fail' + (st ? ' (' + st + ')' : '') + ': request_token nahi mila.'; await deps.set(KC, c); return { ok: false, error: c.lastError }; }
  if (!c.apiKey || !c.apiSecret) return { ok: false, error: 'Pehle API key aur secret save karo.' };
  const checksum = await deps.sha256hex(c.apiKey + rt + c.apiSecret);
  let r; try {
    r = await deps.fetch(API + '/session/token', { method: 'POST', headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: c.apiKey, request_token: rt, checksum }).toString() });
  } catch (e) { return { ok: false, error: 'Network error: ' + e.message }; }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.status !== 'success') { c.lastError = 'Token nahi bana: ' + ((j && j.message) || 'HTTP ' + r.status) + (/checksum|api_secret|Invalid/i.test((j && j.message) || '') ? ' (API secret check karo)' : ''); await deps.set(KC, c); return { ok: false, error: c.lastError }; }
  c.accessToken = j.data.access_token; c.userName = j.data.user_name || ''; c.userId = j.data.user_id || ''; c.loginAt = deps.now(); c.lastError = '';
  await deps.set(KC, c);
  return { ok: true, user: c.userName || c.userId };
}
async function logout(deps) { const c = await getCfg(deps); c.accessToken = null; c.loginAt = null; await deps.set(KC, c); return status(deps); }

async function api(deps, path) {
  const c = await getCfg(deps);
  if (!tokenValid(c, deps.now())) throw new Error(c.accessToken ? 'Kite Connect login expire ho gaya (roz subah ~6 baje). Settings → "Kite se login karo".' : 'Kite Connect login nahi hai.');
  const r = await deps.fetch(API + path, { headers: { 'X-Kite-Version': '3', Authorization: 'token ' + c.apiKey + ':' + c.accessToken } });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.status !== 'success') {
    const m = (j && j.message) || 'HTTP ' + r.status, et = j && j.error_type;
    if (et === 'TokenException' || r.status === 403) { c.accessToken = null; await deps.set(KC, c); throw new Error('Kite Connect session khatam: dobara login karo. (' + m + ')'); }
    if (/permission|subscription|not enabled|historical/i.test(m)) throw new Error('Is Kite Connect app me historical data ki permission nahi (plan / add-on check karo). (' + m + ')');
    throw new Error('Kite API: ' + m);
  }
  return j.data;
}
const fmt = ms => { const d = new Date(ms + IST).toISOString(); return d.slice(0, 10) + '+' + d.slice(11, 19); };   // "YYYY-MM-DD+HH:MM:SS" (IST)
const istMinOf = s => { const m = /T(\d\d):(\d\d)/.exec(s); return m ? +m[1] * 60 + +m[2] : null; };
/* aaj ki 1-min candles + kal ka close. token = instrument token (NIFTY 50 = 256265) */
async function intraday(deps, token) {
  const now = deps.now(), today = istDay(now);
  const from = Date.parse(today + 'T09:15:00+05:30');
  let bars = [];
  if (now > from) {
    const d = await api(deps, '/instruments/historical/' + token + '/minute?from=' + fmt(from) + '&to=' + fmt(now));
    bars = (d.candles || []).filter(k => String(k[0]).slice(0, 10) === today).map(k => [istMinOf(k[0]), k[1], k[2], k[3], k[4]]).filter(b => b[0] != null);
  }
  const dd = await api(deps, '/instruments/historical/' + token + '/day?from=' + fmt(now - 10 * 864e5).slice(0, 10) + '+00:00:00&to=' + fmt(now));
  const prev = (dd.candles || []).filter(k => String(k[0]).slice(0, 10) < today).pop();
  return { src: 'kite', date: today, bars, prevClose: prev ? prev[4] : null, lastClose: prev ? prev[4] : null,
    prevHigh: prev ? prev[2] : null, prevLow: prev ? prev[3] : null };              // price action: kal ka High / Low
}

/* ---------- exact margin: Kite basket margin API (sirf calculation, koi order NAHI lagta) ---------- */
async function authHeaders(deps) {
  const c = await getCfg(deps);
  if (!tokenValid(c, deps.now())) throw new Error('Kite Connect login nahi / expire');
  return { 'X-Kite-Version': '3', Authorization: 'token ' + c.apiKey + ':' + c.accessToken };
}
/* NFO instruments (roz ek baar): underlying ke options ka map "expiry|strike|CE" → tradingsymbol */
const INST = 'kp_kc_inst';
function parseInstruments(csv, name) {
  const lines = csv.split(/\r?\n/), head = lines[0].split(','), ix = k => head.indexOf(k);
  const iSym = ix('tradingsymbol'), iName = ix('name'), iExp = ix('expiry'), iK = ix('strike'), iType = ix('instrument_type'), iLot = ix('lot_size'), map = {}; let lot = null;
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(','); if (f.length < head.length) continue;
    const nm = f[iName].replace(/"/g, ''); if (nm !== name) continue;
    const t = f[iType]; if (t !== 'CE' && t !== 'PE') continue;
    map[f[iExp] + '|' + (+f[iK]) + '|' + t] = f[iSym]; lot = lot || +f[iLot];
  }
  return { map, lot };
}
async function instruments(deps, name) {
  const today = istDay(deps.now()), have = await deps.get(INST);
  if (have && have.date === today && have.name === name && Object.keys(have.map).length) return have;
  const r = await deps.fetch(API + '/instruments/NFO', { headers: await authHeaders(deps) });
  if (!r.ok) throw new Error('Instruments list nahi mili (HTTP ' + r.status + ')');
  const p = parseInstruments(await r.text(), name), v = { date: today, name, map: p.map, lot: p.lot };
  if (!Object.keys(v.map).length) throw new Error(name + ' ke options instruments me nahi mile');
  await deps.set(INST, v); return v;
}
/* legs = [{type, K, qty}], expiry 'YYYY-MM-DD', name 'NIFTY' */
async function basketMargin(deps, legs, expiry, name) {
  const inst = await instruments(deps, name), orders = [];
  for (const l of legs) {
    const sym = inst.map[expiry + '|' + (+l.K) + '|' + l.type];
    if (!sym) throw new Error('Kite par ' + name + ' ' + l.K + ' ' + l.type + ' (' + expiry + ') nahi mila');
    orders.push({ exchange: 'NFO', tradingsymbol: sym, transaction_type: l.qty > 0 ? 'BUY' : 'SELL', variety: 'regular', product: 'NRML', order_type: 'MARKET', quantity: Math.abs(l.qty), price: 0, trigger_price: 0 });
  }
  const r = await deps.fetch(API + '/margins/basket?consider_positions=false&mode=compact', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, await authHeaders(deps)), body: JSON.stringify(orders) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.status !== 'success') throw new Error('Kite margin: ' + ((j && j.message) || 'HTTP ' + r.status));
  const fin = j.data.final || j.data.initial || {}, ini = j.data.initial || {};
  return { total: fin.total, span: fin.span, exposure: fin.exposure, premium: fin.option_premium, initialTotal: ini.total, symbols: orders.map(o => o.tradingsymbol), at: deps.now() };
}

root.KPKC = { KC, REDIRECT, status, setCfg, loginUrl, exchange, logout, intraday, api, tokenValid, getCfg, mask, basketMargin, parseInstruments };
})(typeof self !== 'undefined' ? self : globalThis);
