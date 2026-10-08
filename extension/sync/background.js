/* Background: fake-trade events ki queue → Supabase RPC (teacher dashboard).
   Sirf tab bhejta hai jab student class join kar chuka ho. Kite ka koi data/cookie yahan nahi aata. */
'use strict';
importScripts('ai.js', 'kiteconnect.js');
const SYNC = 'kp_sync', QUEUE = 'kp_queue', MAX_Q = 3000, BATCH = 200;
let flushing = false, qLock = Promise.resolve();
const withQ = fn => (qLock = qLock.then(fn, fn));          // queue read-modify-write ek-ek karke

const get = async k => (await chrome.storage.local.get(k))[k];
const set = (k, v) => chrome.storage.local.set({ [k]: v });

async function rpc(cfg, fn, body) {
  const r = await fetch(cfg.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) { let m = txt; try { m = JSON.parse(txt).message || txt; } catch (e) {} throw new Error(m.slice(0, 160)); }
  return txt ? JSON.parse(txt) : null;
}

async function enqueue(ev) {
  const cfg = await get(SYNC); if (!cfg || !cfg.studentId) return;
  const n = await withQ(async () => {
    const q = (await get(QUEUE)) || []; q.push(ev); if (q.length > MAX_Q) q.splice(0, q.length - MAX_Q);
    await set(QUEUE, q); return q.length;
  });
  if (n >= 20 || ev.kind !== 'snapshot') flush();
}

async function flush() {
  if (flushing) return; flushing = true;
  try {
    const cfg = await get(SYNC); if (!cfg || !cfg.studentId) return;
    for (;;) {
      const q = (await get(QUEUE)) || []; if (!q.length) break;
      const batch = q.slice(0, BATCH);
      await rpc(cfg, 'push_events', { p_student: cfg.studentId, p_token: cfg.token, p_events: batch });
      await withQ(async () => set(QUEUE, ((await get(QUEUE)) || []).slice(batch.length)));   // beech me aaye events bache rahein
    }
    if (cfg.lastError) { cfg.lastError = ''; await set(SYNC, cfg); }
  } catch (e) {
    const cfg = await get(SYNC); if (cfg) { cfg.lastError = 'sync: ' + e.message; await set(SYNC, cfg); }
  } finally { flushing = false; }
}

async function join(p) {
  const rows = await rpc(p, 'join_class', { p_code: p.classCode, p_name: p.name });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.student_id) throw new Error('join_class ne student id nahi diya');
  await set(SYNC, { url: p.url, anonKey: p.anonKey, classCode: p.classCode, name: p.name, studentId: row.student_id, token: row.token, lastError: '' });
  await set(QUEUE, []);
  await enqueue({ ts: new Date().toISOString(), kind: 'join', payload: { ua: navigator.userAgent.slice(0, 80) } });
}

/* Index ki aaj ki 1-min candles + kal ka close (Yahoo Finance public chart API). Sirf index ka symbol jaata hai, Kite ka kuch nahi. 50 sec cache. */
const intraCache = new Map();
async function intraday(symbol) {
  const c = intraCache.get(symbol); if (c && Date.now() - c.at < 50e3) return c.v;
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1m&range=1d');
  if (!r.ok) throw new Error('Yahoo HTTP ' + r.status);
  const j = await r.json(), res = j && j.chart && j.chart.result && j.chart.result[0]; if (!res) throw new Error('Yahoo: data nahi mila');
  const ts = res.timestamp || [], q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {}, m = res.meta || {}, IST = 19800;
  const bars = []; ts.forEach((t, i) => { if (q.open[i] == null || q.close[i] == null) return; bars.push([Math.floor(((t + IST) % 86400) / 60), q.open[i], q.high[i], q.low[i], q.close[i]]); });
  const date = ts.length ? new Date((ts[ts.length - 1] + IST) * 1000).toISOString().slice(0, 10) : null;
  const v = { src: 'yahoo', date, bars, prevClose: m.chartPreviousClose || m.previousClose || null, lastClose: bars.length ? bars[bars.length - 1][4] : null, price: m.regularMarketPrice || null };
  intraCache.set(symbol, { at: Date.now(), v });
  return v;
}

/* ---------- Kite Connect (official API) ---------- */
const sha256hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const kcDeps = { get, set, fetch: (u, o) => fetch(u, o), now: () => Date.now(), sha256hex };
let kcLoginTab = null, kcOrigin = null;
// Kite login ke baad redirect (http://127.0.0.1/kp-kite-callback?request_token=…) pakdo, token banao, tab band
chrome.tabs.onUpdated.addListener((tabId, info) => {
  const url = info.url; if (!url || !/^https?:\/\/127\.0\.0\.1(:\d+)?\/kp-kite-callback/.test(url)) return;   // http ya https, dono
  self.KPKC.exchange(kcDeps, url).then(async r => {
    chrome.tabs.remove(tabId).catch(() => {}); kcLoginTab = null;
    if (kcOrigin != null) chrome.tabs.update(kcOrigin, { active: true }).catch(() => {});      // wapas usi Kite tab par jahan se login dabaya tha
    const ts = await chrome.tabs.query({ url: 'https://kite.zerodha.com/*' }).catch(() => []);
    ts.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'kp-kc-done', r }).catch(() => {}));
  });
});
/* intraday: Kite Connect login ho to official candles, warna (setting on ho to) Yahoo backup */
async function intradayAny(msg) {
  const st = await self.KPKC.status(kcDeps);
  if (st.loggedIn && msg.token) return self.KPKC.intraday(kcDeps, msg.token);
  if (msg.allowYahoo && msg.symbol) return intraday(msg.symbol);
  if (st.loggedIn && !msg.token) throw new Error('index ka instrument token nahi mila (Kite option chain page kholo)');
  throw new Error(!st.hasKey || !st.hasSecret ? 'Kite Connect ki API key / secret save nahi hai' : st.expired ? 'Kite Connect login expire ho gaya (roz subah ~6 baje)' : 'Kite Connect login abhi nahi hua' + (st.lastError ? ' (' + st.lastError + ')' : ''));
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'kp-kc-login' && sender && sender.tab) kcOrigin = sender.tab.id;
  if (msg.type === 'kp-intraday') { intradayAny(msg).then(v => reply({ ok: true, v }), e => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'kp-kc-margin') { self.KPKC.basketMargin(kcDeps, msg.legs || [], msg.expiry, msg.name || 'NIFTY').then(v => reply({ ok: true, v }), e => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'kp-kc-status') { self.KPKC.status(kcDeps).then(reply, e => reply({ error: e.message })); return true; }
  if (msg.type === 'kp-kc-cfg') { self.KPKC.setCfg(kcDeps, msg.p || {}).then(s => reply({ ok: true, s }), e => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'kp-kc-logout') { self.KPKC.logout(kcDeps).then(s => reply({ ok: true, s })); return true; }
  if (msg.type === 'kp-kc-login') {
    self.KPKC.setCfg(kcDeps, {}).then(() => self.KPKC.getCfg(kcDeps)).then(c => {          // naya login: purana error saaf
      if (!c.apiKey || !c.apiSecret) return reply({ ok: false, error: 'Pehle API key aur API secret save karo.' });
      chrome.tabs.create({ url: self.KPKC.loginUrl(c) }).then(t => { kcLoginTab = t.id; reply({ ok: true }); });
    });
    return true;
  }
  if (msg.type === 'kp-event') { enqueue(msg.ev); return false; }
  if (msg.type === 'kp-sync-get') {
    Promise.all([get(SYNC), get(QUEUE)]).then(([s, q]) => reply(s ? { url: s.url, anonKey: s.anonKey, classCode: s.classCode, name: s.name, studentId: s.studentId, lastError: s.lastError, queued: (q || []).length } : null));
    return true;
  }
  if (msg.type === 'kp-join') { join(msg.p).then(() => reply({ ok: true }), e => reply({ ok: false, error: e.message })); return true; }
  // AI coach: key yahin rehti hai, content script ko sirf masked status
  const deps = { get, set, fetch: (u, o) => fetch(u, o), now: () => Date.now() };
  if (msg.type === 'kp-ai-status') { self.KPAI.status(deps).then(reply, e => reply({ error: e.message })); return true; }
  if (msg.type === 'kp-ai-key') { self.KPAI.setKey(deps, msg.key).then(s => reply({ ok: true, s }), e => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'kp-ai-cfg') { self.KPAI.setCfg(deps, msg.p || {}).then(s => reply({ ok: true, s }), e => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'kp-ai-check') { self.KPAI.check(deps).then(reply, e => reply({ ok: false, error: e.message })); return true; }
  if (msg.type === 'kp-ai-ask') { self.KPAI.ask(deps, msg.req).then(reply, e => reply({ ok: false, error: e.message })); return true; }
  return false;
});

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('kp-flush', { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('kp-flush', { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'kp-flush') flush(); });
