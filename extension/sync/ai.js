/* AI coach: student ki APNI key (Google Gemini free tier, ya Anthropic Claude), sirf background me rehti hai.
   Content script / Kite page ko key kabhi wapas nahi milti. AI ko sirf fake trades + chain numbers jaate hain.
   deps = {get, set, fetch, now} taaki Node me test ho sake. */
(function (root) {
'use strict';
const AI = 'kp_ai', CLAUDE_MODEL = 'claude-opus-5-5', DAILY = 50, MAX_TOKENS = 1200;
const CLAUDE_API = 'https://api.anthropic.com/v1/messages', GEM = 'https://generativelanguage.googleapis.com/v1beta/';
const istDay = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const mask = k => k ? k.slice(0, 8) + '…' + k.slice(-4) : '';
const CLAUDE_RE = /^sk-ant-[A-Za-z0-9_\-]{20,}$/, GEMINI_RE = /^AIza[0-9A-Za-z_\-]{30,}$/;
const clean = s => String(s || '').replace(/[\s​-‍⁠﻿"'`]/g, '');

const SYSTEM = [
  'Tum ek options trading teacher ho jo Indian students ko NIFTY weekly options par PAPER (fake money) practice karwa raha hai.',
  'Student Kite web ke upar ek practice extension use kar raha hai. Har sawaal ke saath "Context" JSON aata hai: market, signals, subah ka strategy choice, positions, trade plan (SL/target), coach alerts aur rule-based coach ke scores.',
  'Niyam:',
  '- Hinglish me jawab do (Roman script), jaise ek achha teacher class me samjhata hai. Chhote paragraphs ya bullets. Aam taur par 120–220 shabd; student zyada maange tabhi lamba.',
  '- Sirf Context ke numbers use karo. Koi price, news ya level apne se mat banao. Data na ho to saaf bolo ki nahi pata.',
  '- Rule-based coach ka score grading ke liye fixed hai. Tum use badal nahi sakte, lekin uske "kyun" ko samjha sakte ho, aur agar tumhe lagta hai koi rule is situation me kamzor hai to wajah ke saath bata sakte ho.',
  '- Sikhane par focus: concept (theta, delta, gamma, IV, opening range, risk:reward, SL discipline) ko student ki apni situation se jodo. Jahan galti dikhe, pyaar se par seedha batao, aur agli baar ke liye ek concrete rule do.',
  '- Ye paper trading hai. Kabhi asli paise ka trade karne ko mat kaho, aur guaranteed profit jaisi baat mat karo. Zarurat ho to ek line: "ye seekhne ke liye hai, trading advice nahi".',
  '- ₹ amounts Indian format me likho (₹12,500). Strikes aur levels jaise Context me hain waise.'
].join('\n');

/* purana config {key} (sirf Claude) → naya {provider, claudeKey, geminiKey, geminiModel, geminiAuto} */
async function getCfg(deps) {
  const c = (await deps.get(AI)) || {};
  if (c.key && !c.claudeKey) { c.claudeKey = c.key; delete c.key; }
  if (!c.provider) c.provider = c.claudeKey && !c.geminiKey ? 'claude' : 'gemini';
  return c;
}
const activeKey = c => c.provider === 'claude' ? c.claudeKey : c.geminiKey;
async function status(deps) {
  const c = await getCfg(deps), today = istDay(deps.now());
  return { provider: c.provider, hasKey: !!activeKey(c), masked: mask(activeKey(c)), claudeMasked: mask(c.claudeKey), geminiMasked: mask(c.geminiKey),
    model: c.provider === 'claude' ? CLAUDE_MODEL : (c.geminiModel || (c.geminiAuto && c.geminiAuto.model) || 'auto (latest Flash)'), geminiModel: c.geminiModel || '',
    geminiModels: (c.geminiAuto && c.geminiAuto.names) || [], used: c.day === today ? c.used || 0 : 0, limit: DAILY };
}
/* p = {provider?, claudeKey?, geminiKey?, geminiModel?}; '' key = hatao, undefined = waisi hi rahe */
async function setCfg(deps, p) {
  const c = await getCfg(deps);
  if (p.provider === 'claude' || p.provider === 'gemini') c.provider = p.provider;
  if (p.claudeKey !== undefined) { const k = clean(p.claudeKey); if (k && !CLAUDE_RE.test(k)) throw new Error('Claude key "sk-ant-…" se shuru hoti hai (abhi ' + k.length + ' characters).'); c.claudeKey = k || null; }
  if (p.geminiKey !== undefined) { const k = clean(p.geminiKey); if (k && !GEMINI_RE.test(k)) throw new Error('Gemini key "AIza…" se shuru hoti hai, ~39 characters (abhi ' + k.length + '). aistudio.google.com → Get API key.'); c.geminiKey = k || null; c.geminiAuto = null; }
  if (p.geminiModel !== undefined) c.geminiModel = p.geminiModel || '';
  await deps.set(AI, c);
  return status(deps);
}
/* purana API (sirf Claude key) */
const setKey = (deps, key) => setCfg(deps, { claudeKey: key, provider: key ? 'claude' : undefined });

/* ---------- Gemini ---------- */
function gemErr(status, j) {
  const e = j && j.error, m = (e && e.message) || ('HTTP ' + status), st = e && e.status;
  const why = /API_KEY_INVALID|API key not valid/i.test(m) ? 'Gemini API key galat hai.' : st === 'RESOURCE_EXHAUSTED' || status === 429 ? 'Gemini free limit (per minute / per din) poori ho gayi. Thodi der baad try karo.'
    : st === 'PERMISSION_DENIED' || status === 403 ? 'Is key ko Gemini API ki permission nahi (aistudio.google.com se key banao).' : status === 404 ? 'Ye Gemini model nahi mila. Settings me "Key check karo" dabao.'
    : /location is not supported|region/i.test(m) ? 'Gemini API is region me available nahi.' : status >= 500 ? 'Gemini abhi busy hai, thodi der me try karo.' : '';
  return (why ? why + ' ' : '') + '(' + String(m).slice(0, 160) + ')';
}
const gh = key => ({ 'x-goog-api-key': key, 'content-type': 'application/json' });
async function listModels(deps, key) {
  let r; try { r = await deps.fetch(GEM + 'models?pageSize=200', { headers: gh(key) }); } catch (e) { throw new Error('Network error: ' + e.message); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(gemErr(r.status, j));
  return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
}
const BAD = /(lite|tts|image|embed|live|audio|vision|exp|preview|thinking|learnlm|gemma|aqa|robotics|computer|native|nano)/i;
/* Google kuch model list me dikhata hai par naye users ke liye 404 deta hai ("no longer available"). Aise model yaad rakho. */
const gone = (c, names) => names.filter(n => !(c.geminiGone || []).includes(n));
function pickModel(names) {
  const ver = n => { const m = /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(n); return m ? +m[1] : -1; };
  return names.filter(n => ver(n) > 0).sort((a, b) => ver(b) - ver(a))[0] || names.find(n => n === 'gemini-flash-latest')
    || names.filter(n => /^gemini.*flash/i.test(n) && !BAD.test(n)).sort().pop() || names.filter(n => /^gemini/i.test(n) && !BAD.test(n)).sort().pop() || null;
}
async function geminiModel(deps, c) {
  if (c.geminiModel) return c.geminiModel;
  if (c.geminiAuto && c.geminiAuto.key === c.geminiKey.slice(-6) && deps.now() - c.geminiAuto.at < 3 * 864e5) return c.geminiAuto.model;
  const names = gone(c, await listModels(deps, c.geminiKey)), model = pickModel(names);
  if (!model) throw new Error('Is Gemini key par koi text model nahi mila.');
  c.geminiAuto = { model, names, key: c.geminiKey.slice(-6), at: deps.now() }; await deps.set(AI, c);
  return model;
}
async function askGemini(deps, c, msgs, retried) {
  const model = await geminiModel(deps, c);
  let r;
  try {
    r = await deps.fetch(GEM + 'models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', headers: gh(c.geminiKey), body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] }, contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.6, maxOutputTokens: 4096 } }) });
  } catch (e) { return { ok: false, error: 'Network error: ' + e.message }; }
  const j = await r.json().catch(() => null);
  if (!r.ok && !retried && (r.status === 404 || /no longer available|not found/i.test((j && j.error && j.error.message) || ''))) {
    // band model: yaad rakho, manual choice hatao, auto (latest Flash) se ek baar dobara
    c.geminiGone = [...new Set([...(c.geminiGone || []), model])];
    if (c.geminiModel === model) c.geminiModel = '';
    c.geminiAuto = null; await deps.set(AI, c);
    const again = await askGemini(deps, c, msgs, true);
    return again.ok ? { ...again, note: model + ' band ho gaya, ab ' + again.model + ' use ho raha hai.' } : again;
  }
  if (!r.ok) return { ok: false, error: gemErr(r.status, j) };
  const cand = j && j.candidates && j.candidates[0], text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('').trim();
  if (!text) return { ok: false, error: 'Gemini ne jawab nahi diya' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.' };
  return { ok: true, text, model: j.modelVersion || model };
}

/* ---------- Claude ---------- */
async function askClaude(deps, c, msgs) {
  let r;
  try {
    r = await deps.fetch(CLAUDE_API, { method: 'POST',
      headers: { 'x-api-key': c.claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages: msgs }) });
  } catch (e) { return { ok: false, error: 'Network error: ' + e.message }; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) {
    const m = j && j.error && j.error.message || ('HTTP ' + r.status);
    const why = r.status === 401 ? 'Claude API key galat hai ya band ho chuki hai.' : r.status === 403 ? 'Is key ko is model ki permission nahi.' : r.status === 429 ? 'Bahut jaldi-jaldi sawaal (rate limit). Thoda ruk ke poochho.'
      : r.status === 400 && /credit|balance/i.test(m) ? 'Anthropic account me credit khatam hai (console.anthropic.com → Billing).' : r.status >= 500 ? 'Claude abhi busy hai, thodi der me try karo.' : '';
    return { ok: false, error: (why ? why + ' ' : '') + '(' + String(m).slice(0, 160) + ')' };
  }
  const text = ((j && j.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { ok: true, text: text || '(khaali jawab)', model: CLAUDE_MODEL };
}

/* req = {messages:[{role, content}]} (aakhri user message me context already joda hua) */
async function ask(deps, req) {
  const c = await getCfg(deps), today = istDay(deps.now());
  if (!activeKey(c)) return { ok: false, error: c.provider === 'claude' ? 'Pehle Settings → "AI coach" me apni Claude (Anthropic) API key daalo, ya provider Gemini (free) chuno.' : 'Pehle Settings → "AI coach" me apni Gemini API key daalo (aistudio.google.com se free).' };
  const used = c.day === today ? c.used || 0 : 0;
  if (used >= DAILY) return { ok: false, error: 'Aaj ke ' + DAILY + ' AI sawaal ho gaye. Kal phir poochna.', used, limit: DAILY };
  const msgs = (req.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-12);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { ok: false, error: 'Sawaal khaali hai.' };
  let r;
  try { r = c.provider === 'claude' ? await askClaude(deps, c, msgs) : await askGemini(deps, c, msgs); } catch (e) { r = { ok: false, error: e.message }; }
  if (!r.ok) return r;
  const c2 = await getCfg(deps); c2.day = today; c2.used = used + 1; await deps.set(AI, c2);
  return { ok: true, text: r.text, model: r.model, note: r.note, used: c2.used, limit: DAILY };
}
/* "Key check karo": active provider ki key asli me chalti hai ya nahi (Gemini: model list; Claude: /v1/models, free) */
async function check(deps) {
  const c = await getCfg(deps);
  if (!activeKey(c)) return { ok: false, error: 'Key nahi hai.' };
  if (c.provider === 'gemini') {
    try {
      const names = gone(c, await listModels(deps, c.geminiKey)), model = pickModel(names);
      if (c.geminiModel && !names.includes(c.geminiModel)) c.geminiModel = '';
      c.geminiAuto = model ? { model, names, key: c.geminiKey.slice(-6), at: deps.now() } : null; await deps.set(AI, c);
      return model ? { ok: true, msg: '✓ Gemini key chal rahi hai. Model: ' + (c.geminiModel || model + ' (auto)') + '.', models: names.filter(n => /^gemini/i.test(n)) } : { ok: false, error: 'Key chali, lekin koi Gemini text model nahi mila.' };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  let r; try { r = await deps.fetch('https://api.anthropic.com/v1/models?limit=50', { headers: { 'x-api-key': c.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }); } catch (e) { return { ok: false, error: 'Network error: ' + e.message }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: r.status === 401 ? 'Claude API key galat hai.' : 'Claude: HTTP ' + r.status + ' ' + ((j.error && j.error.message) || '').slice(0, 120) };
  return { ok: true, msg: '✓ Claude key chal rahi hai' + ((j.data || []).some(m => m.id === CLAUDE_MODEL) ? ' (' + CLAUDE_MODEL + ' available).' : '.') };
}

root.KPAI = { MODEL: CLAUDE_MODEL, CLAUDE_MODEL, DAILY, SYSTEM, getCfg, setCfg, setKey, status, ask, check, mask, istDay, pickModel, listModels };
})(typeof self !== 'undefined' ? self : globalThis);
