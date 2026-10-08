/* Side panel (Shadow DOM). Sirf view + clicks; logic app.js me. */
(function () {
'use strict';
const KP = globalThis.KP;
const { book: B, an: A, coach: C, morning: M, risk: RK, fmt: { f2, rs, rsS, cls, nf0 } } = KP;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['plan', 'Aaj ka plan'], ['chain', 'Chain'], ['positions', 'Positions'], ['ic', 'Iron condor'], ['coach', 'Coach'], ['payoff', 'Payoff'], ['settings', 'Settings']];
const pct = v => Math.round(v * 100) + '%';
const rsInf = v => v === Infinity ? 'Unlimited' : v === -Infinity ? '−Unlimited' : rs(v);
const MAN = [['prevClose', 'Kal ka close', '0.05'], ['pdh', 'Kal ka High', '0.05'], ['pdl', 'Kal ka Low', '0.05'], ['orHi', 'OR high (9:15–9:30)', '0.05'], ['orLo', 'OR low (9:15–9:30)', '0.05'], ['vix', 'India VIX', '0.01'], ['vixChg', 'VIX change %', '0.1']];
const MCFG = [['gapS', 'Gap chhota (<%)', '0.05'], ['gapB', 'Gap bada (≥%)', '0.05'], ['orQ', 'OR shaant (<× EM)', '0.05'], ['orW', 'OR wild (>× EM)', '0.05'], ['ivRise', 'IV rise caution (%)', '0.5'],
  ['ivLow', 'IV/VIX kam (<)', '0.5'], ['ivHigh', 'IV/VIX zyada (>)', '0.5'], ['icDelta', 'IC short delta', '0.01'], ['spreadDelta', 'Spread short delta', '0.01']];
const RCFG = [['slCredit', 'Credit: SL (× credit)', '0.1'], ['tgtCredit', 'Credit: target (× credit)', '0.05'], ['slDebit', 'Debit: SL (× debit)', '0.05'], ['tgtDebit', 'Debit: target (× debit)', '0.1'],
  ['legSlPctShort', 'Naked SELL default: SL %', '5'], ['legTgtPctShort', 'Naked SELL default: target %', '5'],
  ['legSlPctLong', 'BUY default: SL %', '5'], ['legTgtPctLong', 'BUY default: target %', '5'],
  ['legSlPctShortExp', 'Expiry day SELL: SL %', '5'], ['legSlPctLongExp', 'Expiry day BUY: SL %', '5']];
/* Kite jaisa: ☐ Stoploss [   ] %  (checkbox on hone par hi input chalta hai) */
const kbox = (chkId, inId, label, attrs) => '<span class="kbox"><label><input type="checkbox"' + (chkId ? ' id="' + chkId + '"' : '') + (attrs ? attrs.chk : '') + '> ' + label + '</label>' +
  '<span class="kpct"><input type="number" min="0.5" step="0.5"' + (inId ? ' id="' + inId + '"' : '') + (attrs ? attrs.inp : ' disabled') + '><i>%</i></span></span>';
const oiChk = '<label class="chk"><input type="checkbox" data-cfg="oishift.alerts"> OI shift alerts (Resistance / Support / short covering badle to decision card)</label>' +
  '<label class="chk"><input type="checkbox" data-cfg="oishift.info"> Position nahi ho tab bhi OI alerts dikhao (ℹ️ naya trade wala card)</label>';
const paChk = '<label class="chk"><input type="checkbox" data-cfg="pa.alerts"> Price action alerts (har 5-min candle close par: breakout, rejection, fakeout…)</label>';
const autoExitChk = '<label class="chk"><input type="checkbox" data-cfg="risk.legAutoExit"> Leg ka SL / target hit ho to wo leg khud exit (SL order jaisa)</label>';
const AIQ = ['Meri position abhi kaisi hai? Simple me samjhao', 'Coach ne ye option kyun chuna?', 'Mera aaj ka strategy choice sahi tha? Kya miss kiya?', 'SL / target ke hisaab se ab kya karna chahiye, aur kyun?', 'Aaj ke signals ka matlab samjhao'];
/* Claude ka jawab: escape, phir **bold**, bullets, headings */
function md(t) {
  const out = []; let ul = false;
  for (const raw of String(t).split('\n')) {
    const line = esc(raw).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'), m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) { if (!ul) { out.push('<ul>'); ul = true; } out.push('<li>' + m[1] + '</li>'); continue; }
    if (ul) { out.push('</ul>'); ul = false; }
    const h = /^\s*#{1,4}\s+(.*)$/.exec(line);
    out.push(h ? '<p><b>' + h[1] + '</b></p>' : line.trim() ? '<p>' + line + '</p>' : '');
  }
  if (ul) out.push('</ul>');
  return out.join('');
}
const cfgInputs = (pre, list) => list.map(([k, l, s]) => '<label>' + l + '<input type="number" step="' + s + '" data-cfg="' + pre + '.' + k + '"></label>').join('');
const scoreCls = s => s >= 75 ? 'hi' : s >= 55 ? 'mid' : 'lo', scoreLab = s => s >= 75 ? 'Recommended' : s >= 55 ? 'Theek' : 'Kamzor';
/* CSS shadow root me: constructable stylesheet (Kite ki CSP <link>/<style> block kare tab bhi chale), fail ho to <link>. */
KP.adoptCSS = async (root, url, text) => {
  try {
    const css = text ?? await (await fetch(url)).text(), sh = new CSSStyleSheet(); sh.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sh];
  } catch (e) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; root.prepend(l); }
};
const time = ms => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const hmOf = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');   // IST minute → "10:35"
const dayTime = ms => new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

class Panel {
  constructor(app) { this.app = app; this.rT = 0; this.hoverX = null; this.chainSig = ''; this.ticket = null; this.actx = null; }
  $(id) { return this.root.getElementById(id); }

  mount() {
    this.host = document.createElement('div'); this.host.id = 'kp-paper-root';
    document.documentElement.appendChild(this.host);
    const r = this.root = this.host.attachShadow({ mode: 'open' });
    r.innerHTML = this.skeleton();
    KP.adoptCSS(r, chrome.runtime.getURL('ui/panel.css'));
    // Kite ke keyboard shortcuts panel ke andar typing par na chalein
    ['keydown', 'keyup', 'keypress'].forEach(ev => this.host.addEventListener(ev, e => e.stopPropagation()));
    r.addEventListener('click', e => this.onClick(e));
    r.addEventListener('change', e => this.onChange(e));
    r.addEventListener('input', e => { if (/^(tLots|tSl|tTg|tLmt)$/.test(e.target.id)) { if (/^(tSl|tTg)$/.test(e.target.id) && this.ticket) this.ticket.def = false; this.renderTicket(); } });
    r.addEventListener('keydown', e => { if (e.target.id === 'aiQ' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const q = e.target.value; e.target.value = ''; this.ask(q); } });
    const cv = this.$('payoffCv');
    cv.addEventListener('mousemove', e => { const b = cv.getBoundingClientRect(); this.hoverX = e.clientX - b.left; this.drawPayoff(); });
    cv.addEventListener('mouseleave', () => { this.hoverX = null; this.drawPayoff(); });
    this.setCollapsed(this.app.S.ui.collapsed);
    if (this.app.S.ui.size && this.app.S.ui.size !== 'normal') this.setSize(this.app.S.ui.size);
    this.openTab(this.app.S.ui.tab || 'chain');
    this.fillForms(); this.loadSync(); this.loadAI(); this.loadKC();
  }

  skeleton() {
    const ic = this.app.S.cfg.ic;
    return '<div class="kp" id="kp">' +
    '<button class="dock" id="dock" title="Paper trading panel kholo">📘 Paper <span class="dot" id="dockDot"></span></button>' +
    '<section class="panel" id="panel" aria-label="Kite paper trading">' +
      '<header class="top"><span class="brand">Kite Practice<span class="paper">PAPER</span></span>' +
      '<span class="feed" id="feed"><i></i><span id="feedTxt">…</span></span><button class="icon" id="size" title="Panel ka size: normal → bada → full page">⤢</button><button class="icon" id="min" title="Chhota karo">⟩</button></header>' +
      '<div class="demobar" id="demoBar" hidden><b>⚠ DEMO feed chal raha hai: ye NAKLI prices hain, Kite ke nahi.</b><span>Kite option chain is page par khuli hai.</span><button class="btn primary" data-act="useKite">Kite live par jao</button></div>' +
      '<div class="kcbar" id="kcBar" hidden><span id="kcBarTxt"></span><button class="icon" data-act="kcBarX" title="Band karo">✕</button></div>' +
      '<div class="mkt"><span>Underlying <b class="num" id="spot">—</b></span><span>ATM IV <b class="num" id="iv">—</b></span><span>Expiry <b id="exp">—</b></span><span>Phase <b id="ph">—</b></span></div>' +
      '<div class="summary"><div><span>Paper P&amp;L</span><b class="num" id="sPnl">₹0</b></div><div><span>Approx margin</span><b class="num" id="sMargin">₹0</b></div>' +
      '<div><span>Net Δ (units)</span><b class="num" id="sDelta">0</b></div><div><span>Θ per day</span><b class="num" id="sTheta">₹0</b></div></div>' +
      '<nav class="tabs" id="tabs">' + TABS.map(([k, l]) => '<button data-tab="' + k + '">' + l + (k === 'coach' ? ' <span id="coachDot"></span>' : '') + '</button>').join('') + '</nav>' +
      '<div class="body">' +
      '<div class="tab" id="tab-plan"><div class="phase" id="phBox"></div><div id="tradeBox"></div>' +
        '<h3>Signals</h3><div id="sigBox"></div>' +
        '<h3>Price action</h3><div id="paBox"></div>' +
        '<details id="manBox"><summary>Data missing ho to khud bharo</summary><div class="form">' +
          MAN.map(([k, l, s]) => '<label>' + l + '<input type="number" step="' + s + '" data-man="' + k + '"></label>').join('') +
          '<label class="chk"><input type="checkbox" data-man="event"> Aaj event day (RBI / Fed / budget / result)</label></div>' +
          '<p class="note">OR: Kite chart (15 min) par 9:15 wali candle ka high / low. VIX: marketwatch me "INDIA VIX" add karo to extension khud padh lega.</p></details>' +
        '<div id="pickBox"></div><div id="revealBox"></div>' +
        '<details id="riskCfg"><summary>SL / target rules (premium ka multiple)</summary><div class="form">' + cfgInputs('risk', RCFG) + autoExitChk + '</div>' +
          '<p class="note">Credit trade: SL 1.5× = credit ka dedh guna loss par bahar. Target 0.5× = credit ka aadha kama liya to book. Poori position ka SL/target sirf alert hai. Har leg ka SL/target (Positions tab) tick on ho to leg khud exit karta hai.</p></details>' +
        '<div id="reviewBox"></div><h3>Journal (pichhle din)</h3><div id="journalBox"></div></div>' +
      '<div class="tab" id="tab-chain"><div id="chainWarn"></div><div class="row" id="demoCtl" hidden>' +
        '<button class="btn" data-act="push" data-v="1">▲ Push</button><button class="btn" data-act="push" data-v="-1">▼ Push</button>' +
        '<button class="btn" data-act="ivshock" data-v="3">IV +3</button><button class="btn" data-act="ivshock" data-v="-3">IV −3</button></div>' +
        '<div class="mlegend"><span class="sw itm"></span>ITM (in the money) <span class="sw atm"></span>ATM (spot ke sabse paas) <span class="sw"></span>OTM · OI lakh me, <b>bold</b> = sabse zyada OI</div>' +
        '<div class="mlegend bul">🟢 Long buildup = price⬆ OI⬆ naye buyers · 🔴 Short buildup = price⬇ OI⬆ naye sellers · 🔵 Short covering = price⬆ OI⬇ sellers bhaag rahe · ⚪ Long unwinding = price⬇ OI⬇ buyers nikal rahe</div><div id="paChain"></div><div class="busum" id="buSum"></div>' +
        '<table class="chain"><thead><tr><th class="c">Call</th><th title="Open interest (lakh contracts) · OI change %">OI</th><th title="Implied volatility %">IV</th><th class="dcol">Δ</th><th>LTP</th><th class="c">Strike</th>' +
          '<th>LTP</th><th class="dcol">Δ</th><th title="Implied volatility %">IV</th><th title="Open interest (lakh contracts) · OI change %">OI</th><th class="c">Put</th></tr></thead><tbody id="chainBody"></tbody></table>' +
        '<p class="note">Kite ki chain me bhi har strike ke neeche C/P ke B/S buttons aate hain. Saare orders FAKE hain, Kite par kuch nahi jaata. <i>Italic</i> price = model (strike Kite par dikh nahi rahi).</p></div>' +
      '<div class="tab" id="tab-positions"><div id="pendBox"></div><table class="ptbl"><thead><tr><th>Instrument</th><th>Qty</th><th>Avg</th><th>LTP</th><th title="Is leg ka stop loss / target (premium price). Hit hone par leg khud exit (Settings me band kar sakte ho).">SL / Target</th><th>P&amp;L</th><th></th></tr></thead><tbody id="posBody"></tbody>' +
        '<tfoot><tr><td>Total <span class="mut" id="bookedNote"></span></td><td></td><td></td><td></td><td class="num" id="posTotal">₹0</td><td><button class="mini" data-act="exitAll">Exit all</button></td></tr></tfoot></table><div class="greeks" id="greeks"></div>' +
        '<div id="margBox"></div><div id="riskBox"></div><details id="rbEdit"><summary>SL / target badlo</summary><div class="form"><label>SL ₹ (max loss)<input type="number" id="rbSl" min="1" step="100"></label><label>Target ₹<input type="number" id="rbTgt" min="1" step="100"></label></div>' +
          '<div class="row"><button class="btn" data-act="riskSave">Save</button><span class="mut">SL door khiskana report card me note hota hai.</span></div></details>' +
        '<details><summary>Orders log</summary><table class="olog"><tbody id="orderBody"></tbody></table></details></div>' +
      '<div class="tab" id="tab-ic"><div class="form">' +
        '<label>Strike selection<select data-cfg="ic.mode"><option value="pts">ATM se points door</option><option value="delta">Delta se</option></select></label>' +
        '<label data-show="pts">Short distance (pts)<input type="number" data-cfg="ic.dist" step="50" min="50"></label>' +
        '<label data-show="delta">Short delta<input type="number" data-cfg="ic.delta" step="0.01" min="0.03" max="0.45"></label>' +
        '<label>Wing width (pts)<input type="number" data-cfg="ic.wing" step="50" min="50"></label>' +
        '<label>Lots<input type="number" data-cfg="ic.lots" min="1" max="50"></label></div>' +
        '<table class="legs"><thead><tr><th>Leg</th><th>Strike</th><th>Δ</th><th>LTP</th></tr></thead><tbody id="icLegs"></tbody></table>' +
        '<div class="stats" id="icStats"></div><button class="btn sell" data-act="placeIC">Place fake iron condor</button>' +
        '<p class="note">Hedges pehle buy hote hain, phir shorts sell — real broker me isi order se margin benefit milta hai.</p></div>' +
      '<div class="tab" id="tab-coach"><div id="coachStatus"></div><div id="coachRisk"></div><div class="stats" id="coachCompare"></div>' +
        '<div class="row"><button class="btn primary" data-act="what">Kya karu?</button><button class="btn" data-act="baseline" title="Abhi ki positions ko original maan ke aage ka compare karo">Baseline set karo</button><button class="btn" data-act="report">Report card</button></div>' +
        '<div id="coachOpts"></div><div id="coachReport"></div>' +
        '<section class="ai" id="aiBox"><h3>🤖 Coach se poocho <span class="mut" id="aiProvLab"></span> <span class="mut" id="aiUse"></span></h3>' +
          '<div class="chips">' + AIQ.map((q, i) => '<button class="mini" data-aiq="' + i + '">' + esc(q) + '</button>').join('') + '</div>' +
          '<div class="chat" id="aiChat"></div>' +
          '<div class="aiin"><textarea id="aiQ" rows="2" maxlength="600" placeholder="Apna sawaal likho… (Enter = bhejo, Shift+Enter = nayi line)"></textarea><div class="aibtns"><button class="btn primary" id="aiGo" data-act="aiAsk">Poocho</button><button class="mini" data-act="aiClear">Chat saaf</button></div></div>' +
          '<p class="note" id="aiNote"></p></section>' +
        '<h3>Alert log</h3><table class="olog"><tbody id="alertLog"></tbody></table>' +
        '<details><summary>Rules edit karo</summary><div class="form" id="rulesForm"></div></details></div>' +
      '<div class="tab" id="tab-payoff"><canvas class="cv" id="payoffCv" aria-label="Payoff chart"></canvas><div class="stats" id="payStats"></div>' +
        '<p class="note">Solid line expiry payoff, dashed blue line aaj ka (T+0). Graph par hover karke kisi bhi level ka P&amp;L dekho.</p></div>' +
      '<div class="tab" id="tab-settings"><h3 class="first">Market data</h3><div class="form">' +
        '<label>Feed<select data-cfg="feed"><option value="kite">Kite option chain (live)</option><option value="demo">Demo (simulated)</option></select></label>' +
        '<label>Lot size<input type="number" data-cfg="lot" min="1"></label><label>Default lots<input type="number" data-cfg="lots" min="1"></label>' +
        '<label>Expiry override<input type="date" data-cfg="expiry"></label>' +
        '<label>Demo mode<select data-cfg="demoMode"><option value="day">Demo din (9:10 se, tez ghadi)</option><option value="free">Free (asli ghadi, time rules off)</option></select></label>' +
        '<label>Demo din ka mizaaj<select data-cfg="demoRegime"><option value="random">Secret (random)</option><option value="range">Range</option><option value="up">Trend up</option><option value="down">Trend down</option><option value="volatile">Volatile</option></select></label>' +
        '<label>Demo speed<select data-cfg="demoSpeed"><option value="1">1×</option><option value="10">10×</option><option value="30">30×</option><option value="60">60×</option><option value="300">300×</option></select></label></div>' +
        '<div class="row"><button class="btn primary" data-act="demoDay">Naya demo din shuru karo</button></div>' +
        '<p class="note">Page hamesha <b>Kite live</b> par khulta hai. Demo sirf is session ke liye hai: page refresh karte hi wapas Kite live. Expiry khaali = Kite chain se padha, na mile to agla Tuesday. Demo din 9:10 se shuru hota hai; 60× par 1 sec = 1 min, poora din ~6 min.</p>' +
        '<h3>SL / target rules</h3><div class="form">' + cfgInputs('risk', RCFG) + autoExitChk + '</div>' +
        '<h3>Price action</h3><div class="form">' + paChk + '</div>' +
        '<h3>OI shift</h3><div class="form">' + oiChk + '</div>' +
        '<details><summary>Morning thresholds (signals / score)</summary><div class="form">' + cfgInputs('morning', MCFG) + '</div>' +
          '<p class="note">EM = spot × ATM IV ÷ √365 (ek din ka expected move). OR ratio = opening range ÷ EM.</p></details>' +
        '<h3>Kite Connect API (official, optional)</h3>' +
        '<p class="note">Isse opening range, aaj ka open aur kal ka close Kite ki official 1-min candles se aate hain (panel 9:15 ke baad khola ho tab bhi). Plan me market / historical data hona chahiye.</p>' +
        '<div class="form"><label>API key<input id="kcKey" autocomplete="off" spellcheck="false" placeholder="developer.kite.trade → My apps"></label>' +
          '<label>API secret<input id="kcSecret" type="password" autocomplete="off" spellcheck="false" placeholder="kisi ko mat bhejna"></label></div>' +
        '<div class="row"><button class="btn" data-act="kcSave">Save</button><button class="btn primary" data-act="kcLogin">Kite se login karo</button><button class="btn" data-act="kcLogout">Logout</button><button class="btn" data-act="kcFetch">Candles abhi laao</button></div>' +
        '<p class="mut" id="kcInfo"></p>' +
        '<p class="note">Developer console me app ka <b>Redirect URL</b>: <code>https://127.0.0.1/kp-kite-callback</code> (http wala bhi chalega). Login ke baad wo tab apne aap band hoga, tum wapas isi Kite tab par aaoge, aur panel ke upar ✅ / ❌ patti me result dikhega. Token roz subah ~6 baje expire hota hai, roz ek baar login. Key / secret / token sirf extension background me rehte hain.</p>' +
        '<label class="chk"><input type="checkbox" id="yBack"> Kite Connect na ho to Yahoo Finance backup (sirf index ka naam jaata hai)</label>' +
        '<h3>AI coach</h3><div class="form">' +
          '<label>AI provider<select id="aiProv"><option value="gemini">Google Gemini (free tier)</option><option value="claude">Claude Opus 5.5 (Anthropic, paid)</option></select></label>' +
          '<label data-aip="gemini">Gemini API key<input id="aiGKey" type="password" placeholder="AIza..." autocomplete="off" spellcheck="false"></label>' +
          '<label data-aip="gemini">Gemini model<select id="aiGModel"><option value="">Auto (latest Flash)</option></select></label>' +
          '<label data-aip="claude">Claude (Anthropic) API key<input id="aiKey" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false"></label></div>' +
        '<div class="row"><button class="btn primary" data-act="aiSave">Save</button><button class="btn" data-act="aiCheck">Key check karo</button><button class="btn" data-act="aiKeyDel">Key hatao</button></div>' +
        '<p class="mut" id="aiKeyInfo"></p>' +
        '<p class="note" data-aip="gemini">Gemini key: aistudio.google.com → "Get API key" → Create API key (free). Free tier me per minute / per din limit hoti hai, aur Google free tier ka data apne products sudharne me use kar sakta hai. YouTube wali key se alag key hoti hai.</p>' +
        '<p class="note" data-aip="claude">Claude key: console.anthropic.com → API keys. Account me credit chahiye (Billing).</p>' +
        '<p class="note">Key sirf is browser ke extension background me rehti hai. Kite page, teacher ya Supabase ko nahi jaati. AI ko sirf fake trades aur chain ke numbers jaate hain. Roz max 50 sawaal.</p>' +
        '<h3>Class (teacher dashboard)</h3><div class="form">' +
        '<label>Supabase URL<input id="sUrl" placeholder="https://xxxx.supabase.co"></label><label>Anon key<input id="sKey" placeholder="eyJ..."></label>' +
        '<label>Class code<input id="sCode" placeholder="ABC123"></label><label>Tumhara naam<input id="sName" maxlength="60"></label></div>' +
        '<div class="row"><button class="btn primary" data-act="join">Class join karo</button><span class="mut" id="syncInfo"></span></div>' +
        '<p class="note">Teacher ko sirf tumhare fake trades, alerts aur P&amp;L jaate hain. Kite login, account ya asli positions kabhi nahi.</p>' +
        '<h3>Debug</h3><div class="row"><button class="btn primary" data-act="chainReport">Chain read report copy karo</button><button class="btn" data-act="snapshot">Kite chain DOM copy karo</button><button class="btn" data-act="reset">Paper account reset</button></div>' +
        '<p class="note" id="dbgInfo">Chain detect na ho to "copy" dabao aur HTML developer ko bhejo (sirf chain ka HTML, koi login data nahi).</p></div>' +
      '</div></section>' +
    '<div class="alerts" id="alerts" aria-live="polite"></div>' +
    '<div class="modal" id="ticket" hidden><div class="mbox"><div class="mhead buy" id="tHead"><div><b id="tInst"></b><div class="msub">PAPER · fake order</div></div><button data-act="tFlip">B ⇄ S</button></div>' +
      '<div class="mbody"><label>Lots<input type="number" id="tLots" min="1" max="100"></label><label>Qty<div class="ro num" id="tQty"></div></label>' +
      '<label><span id="tPxLab">Price (LTP)</span><div class="ro num" id="tPx"></div><input type="number" id="tLmt" step="0.05" min="0.05" hidden></label>' +
      '<div class="mcell"><label>Premium value<div class="ro num" id="tVal"></div></label>' +
        '<div class="otype"><label><input type="radio" name="tOT" id="tMkt" value="MKT" checked> Market</label><label><input type="radio" name="tOT" id="tLim" value="LMT"> Limit</label></div></div></div>' +
      '<div class="mrisk" id="tRisk">' + kbox('tSlOn', 'tSl', 'Stoploss') + kbox('tTgOn', 'tTg', 'Target') + '</div><div class="mriskp" id="tRiskP"></div><div class="mpa" id="tPA"></div>' +
      '<div class="mfoot"><span class="mut">₹20 per order (fake)</span><div class="row flat"><button class="btn" data-act="tCancel">Cancel</button><button class="btn primary" id="tGo" data-act="tGo">Buy</button></div></div></div></div>' +
    '<div class="toast" id="toast"></div></div>';
  }

  /* ---------- events ---------- */
  onClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const app = this.app, a = t.dataset.act;
    if (t.id === 'dock') return this.setCollapsed(false);
    if (t.id === 'min') return this.setCollapsed(true);
    if (t.id === 'size') { const S = ['normal', 'wide', 'full'], cur = S.indexOf(app.S.ui.size || 'normal'); return this.setSize(S[(cur + 1) % S.length]); }
    if (t.dataset.tab) return this.openTab(t.dataset.tab);
    if (t.dataset.o) { const [type, K, side] = t.dataset.o.split('|'); return this.openTicket(type, +K, side); }
    if (t.dataset.exit) return app.exitLeg(t.dataset.exit);
    if (t.dataset.cancel) return app.cancelPending(t.dataset.cancel);
    if (t.dataset.busk) { const tr = this.root.querySelector('#chainBody tr[data-k="' + t.dataset.busk + '"]'); if (tr) { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); } return; }
    if (t.dataset.adj != null) { app.applyOption(+t.dataset.adj); this.$('coachOpts').innerHTML = ''; return; }
    if (t.dataset.place) return app.placeStrategy(t.dataset.place);
    if (t.dataset.aiq != null) return this.ask(AIQ[+t.dataset.aiq]);
    switch (a) {
      case 'aiAsk': { const q = this.$('aiQ').value; this.$('aiQ').value = ''; return this.ask(q); }
      case 'aiClear': app.aiChat = []; app.aiErr = null; return this.renderAI();
      case 'kcBarX': this.$('kcBar').hidden = true; return;
      case 'kcFetch': this.$('kcInfo').textContent = 'Kite Connect se candles laa raha hai…';
        return app.syncIntraday(true).then(() => { this.loadKC(); this.render(true);
          this.showKCResult(app.intraSrc === 'kite' ? { ok: true, user: 'candles aa gayi ✓ (Kite Connect)' } : { ok: false, error: 'candles nahi aayi: ' + (app.intraErr || (app.intraSrc ? 'source ' + app.intraSrc : 'pata nahi')) }); });
      case 'kcSave': return this.saveKC();
      case 'kcLogin': return this.saveKC().then(ok => { if (!ok) { this.showKCResult({ ok: false, error: 'Pehle API key aur API secret dono Save karo' }); return null; } return chrome.runtime.sendMessage({ type: 'kp-kc-login' }); })
        .then(r => { if (!r) return; if (r.ok) { this.showKCResult({ wait: true }); this.kcPoll(); } else this.showKCResult({ ok: false, error: r.error }); });
      case 'kcLogout': return chrome.runtime.sendMessage({ type: 'kp-kc-logout' }).then(() => { this.toast('Kite Connect logout'); this.loadKC(); });
      case 'aiSave': return this.saveAI();
      case 'aiCheck': return this.checkAI();
      case 'aiKeyDel': { if (!confirm('Abhi chune provider (' + (this.$('aiProv').value === 'claude' ? 'Claude' : 'Gemini') + ') ki key hata dein?')) return; return this.saveAI(true); }
      case 'aiPick': { const p = app.D().pick; return this.ask('Maine aaj ' + (p ? M.SBY[p.id].name : '?') + ' choose kiya (mujhe laga din "' + (p ? M.DT[p.reason] : '?') + '" hai). Coach ka score aur mera choice samjhao: kya sahi socha, kya miss kiya, aur agli baar kis signal par dhyan doon?'); }
      case 'lockPick': { const r = this.root.querySelector('input[name="kpPick"]:checked'); return app.lockPick(r && r.value, this.$('pReason').value, this.$('pNote').value); }
      case 'repick': return app.unlockPick();
      case 'demoDay': return app.newDemoDay();
      case 'riskSave': return app.editRisk(+this.$('rbSl').value, +this.$('rbTgt').value);
      case 'exitAll': return app.exitAll();
      case 'placeIC': return app.placeIC();
      case 'what': return this.showOptions('manual');
      case 'baseline': return app.setBaseline();
      case 'report': return this.showReport();
      case 'push': if (app.demo) app.demo.push(+t.dataset.v * Math.max(40, app.mkt.S * (app.mkt.atmIV() || 13) / 100 / Math.sqrt(252) * 0.8)); return;
      case 'ivshock': if (app.demo) app.demo.shockIV(+t.dataset.v); return;
      case 'tFlip': this.ticket.side = this.ticket.side === 'BUY' ? 'SELL' : 'BUY'; if (this.ticket.def) this.fillTicketRisk(); return this.renderTicket();
      case 'tCancel': return this.closeTicket();
      case 'tGo': {
        const k = this.ticket, lots = Math.max(1, parseInt(this.$('tLots').value) || 1), risk = this.ticketRisk();
        if (!app.isExit(k.type, k.K, lots, k.side) && !risk) {         // SL + target ke bina order punch nahi
          this.$('tRisk').classList.add('need'); this.$('tRiskP').className = 'mriskp err';
          this.$('tRiskP').textContent = 'Order punch karne se pehle Stoploss % aur Target % dono tick karke bharo.'; return;
        }
        const lim = this.ticketLimit();
        if (lim === 0) { this.$('tLmt').focus(); return this.toast('Limit price bharo.'); }
        this.closeTicket(); return app.placeOrder(k.type, k.K, lots, k.side, risk, lim);
      }
      case 'join': return this.join();
      case 'snapshot': return this.copySnapshot();
      case 'chainReport': return this.copyReport();
      case 'useKite': { app.setFeed('kite'); this.fillForms(); this.toast('Ab Kite ke live prices ✓ (Demo band)'); return; }
      case 'reset': return app.reset();
      case 'rulesReset': app.S.coach.rules = C.defaultCoach().rules; app.save(); return this.buildRules();
    }
  }
  onChange(e) {
    const el = e.target, app = this.app;
    if (el.id === 'aiProv') return this.showAIProv();
    if (el.id === 'yBack') { app.setCfg('yahooBackup', el.checked); return app.syncIntraday(true); }
    if (el.dataset.cfg) {
      const k = el.dataset.cfg, v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
      if (k === 'feed') return app.setFeed(v);
      if (el.type === 'number' && !(v > 0) && /^(risk|morning)\./.test(k) && !(v === 0 && el.value !== '' && /^risk\.leg(Sl|Tgt)Pct/.test(k))) return this.fillForms();
      app.setCfg(k, k === 'demoSpeed' ? +v : v);
      if (k === 'demoSpeed' && app.demo) app.demo.setSpeed(+v);
      if (k === 'ic.mode') this.fillForms();
      if (/^risk\./.test(k)) this.fillForms();                                   // dono jagah wale inputs same rahein
      if ((k === 'expiry' || k === 'demoMode' || k === 'demoRegime') && app.S.cfg.feed === 'demo') app.startFeed();
      return this.render(true);
    }
    if (el.name === 'tOT') {                                                     // Market ⇄ Limit
      const lim = this.$('tLim').checked, i = this.$('tLmt'), t = this.ticket;
      if (lim && !i.value && t) i.value = f2(app.mkt.ltp(t.type, t.K)).replace(/,/g, '');
      i.hidden = !lim; this.$('tPx').hidden = lim; if (lim) i.select();
      return this.renderTicket();
    }
    if (el.id === 'tSlOn' || el.id === 'tTgOn') {
      const i = this.$(el.id === 'tSlOn' ? 'tSl' : 'tTg'), t = this.ticket; i.disabled = !el.checked;
      if (el.checked) { if (!i.value && t) i.value = RK.defPct(t.side === 'BUY' ? 1 : -1, app.legRisk(), el.id === 'tSlOn' ? 'sl' : 'tgt') || ''; i.select(); } else i.value = '';
      if (t) t.def = false; return this.renderTicket();
    }
    if (el.dataset.legsl) return app.editLegSL(el.dataset.legsl, el.value === '' ? 0 : +el.value, 'sl');
    if (el.dataset.legtgt) return app.editLegSL(el.dataset.legtgt, el.value === '' ? 0 : +el.value, 'tgt');
    // positions: checkbox off = band; on = Settings ka default % (phir box me badlo)
    if (el.dataset.legslon || el.dataset.legtgton) {
      const k = el.dataset.legslon || el.dataset.legtgton, w = el.dataset.legslon ? 'sl' : 'tgt', e = app.S.legSL[k];
      return app.editLegSL(k, el.checked ? (RK.defPct(e ? e.qty : -1, app.legRisk(), w) || 10) : 0, w);
    }
    if (el.dataset.man) return app.setManual(el.dataset.man, el.type === 'checkbox' ? el.checked : (el.value === '' ? '' : +el.value));
    if (el.dataset.rule) { app.S.coach.rules[el.dataset.rule] = el.type === 'checkbox' ? el.checked : +el.value; app.save(); }
  }
  /* panel size: normal (440px) / wide (75% screen) / full (poora page). Kite ka data peeche se padha jaata rehta hai. */
  setSize(sz) {
    this.app.S.ui.size = sz; this.app.save();
    const k = this.$('kp'); k.classList.remove('size-wide', 'size-full'); if (sz !== 'normal') k.classList.add('size-' + sz);
    const b = this.$('size'); b.textContent = sz === 'full' ? '⤡' : '⤢'; b.title = { normal: 'Bada karo', wide: 'Full page karo', full: 'Normal size' }[sz];
    this.chainSig = ''; this.render(true);
    if (sz === 'full') this.toast('Full page: trade panel ke Chain tab ke B/S se karo. Kite peeche live chal raha hai. ⤡ se wapas.');
  }
  setCollapsed(c) {
    this.app.S.ui.collapsed = c; this.app.save();
    this.$('panel').hidden = c; this.$('dock').hidden = !c; this.$('kp').classList.toggle('collapsed', c);
    if (!c) this.render(true);
  }
  openTab(n) {
    if (!TABS.some(t => t[0] === n)) n = 'plan';
    this.app.S.ui.tab = n; this.app.save();
    this.root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === n));
    this.root.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + n));
    if (this.app.S.ui.collapsed) this.setCollapsed(false);
    if (n === 'coach') this.buildRules();
    this.render(true);
  }
  fillForms() {
    const cfg = this.app.S.cfg;
    this.root.querySelectorAll('[data-cfg]').forEach(el => { const v = el.dataset.cfg.split('.').reduce((o, k) => o && o[k], cfg); if (el.type === 'checkbox') el.checked = v !== false; else if (this.root.activeElement !== el) el.value = v ?? ''; });
    this.root.querySelectorAll('[data-show]').forEach(el => el.hidden = el.dataset.show !== cfg.ic.mode);
    this.fillManual();
  }
  fillManual() {
    const man = this.app.D().manual || {};
    this.root.querySelectorAll('[data-man]').forEach(el => { if (this.root.activeElement === el) return; const v = man[el.dataset.man]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; });
  }
  buildRules() {
    const R = this.app.S.coach.rules;
    this.$('rulesForm').innerHTML = C.RULES.map(([k, l, s]) => '<label>' + l + '<input type="number" step="' + s + '" data-rule="' + k + '" value="' + R[k] + '"></label>').join('') +
      '<label class="chk"><input type="checkbox" data-rule="sound"' + (R.sound ? ' checked' : '') + '> Alert sound</label>' +
      '<label class="chk"><input type="checkbox" data-rule="showScore"' + (R.showScore ? ' checked' : '') + '> Recommendation score dikhao</label><button class="btn" data-act="rulesReset" type="button">Default rules</button>';
  }

  /* ---------- render ---------- */
  renderSoon() { if (this.rT) return; this.rT = setTimeout(() => { this.rT = 0; this.render(); }, 400); }
  /* sirf chain table (halka) turant: Kite ke price ke saath sync; baaki panel renderSoon se */
  renderChainNow() { try { this.renderChain(); } catch (e) { console.warn('[KP] chain render', e); } this.renderSoon(); }
  render() {
    const app = this.app, mkt = app.mkt, fs = app.feedState(), legs = app.legs();
    const feed = this.$('feed'); feed.className = 'feed ' + fs.cls; this.$('feedTxt').textContent = fs.txt;
    this.$('demoBar').hidden = !(app.S.cfg.feed === 'demo' && app.kiteChainOnPage);
    const lv = app.lastEv ? C.maxLevel(app.lastEv) : 0;
    this.$('dockDot').textContent = lv ? C.LVI[lv] : ''; this.$('coachDot').textContent = lv ? C.LVI[lv] : '';
    if (app.S.ui.collapsed) return;
    this.$('spot').textContent = mkt.S ? f2(mkt.S) + (mkt.source === 'kite' && !(app.kiteSnap && app.kiteSnap.spot) ? ' (fwd)' : '') : '—';
    this.$('iv').textContent = mkt.ready ? f2(mkt.atmIV()) + '%' : '—';
    this.$('exp').textContent = mkt.expiry ? mkt.expiry + ' · ' + mkt.dte() + 'd' + (app.kiteSnap && app.kiteSnap.expiryGuessed && mkt.source === 'kite' ? ' (guess)' : '') : '—';
    const tot = B.total(app.S.book, mkt), an = legs.length && mkt.ready ? A.analyse(mkt, legs) : null, g = legs.length && mkt.ready ? A.greeks(mkt, legs) : { d: 0, th: 0 };
    const km = app.kcMargin && !app.kcMargin.err && app.kcMargin.total != null && legs.length ? app.kcMargin.total : null;
    this.setNum('sPnl', rsS(tot), tot); this.$('sMargin').textContent = rs(km != null ? km : an ? A.margin(mkt, legs) : 0) + (km != null ? ' ✓' : '');
    this.$('sMargin').title = km != null ? 'Exact margin: Kite basket margin (Kite Connect)' : 'Andaza (SPAN jaisa). Exact ke liye Kite Connect login.';
    this.$('sDelta').textContent = nf0.format(Math.round(g.d)); this.setNum('sTheta', rsS(g.th), g.th);
    const ph = app.phase(), left = ph === 'free' ? null : M.phaseLeft(app.now());
    this.$('ph').textContent = ph === 'free' ? 'Free demo' : M.PHASES[ph][0] + (left != null && left <= 90 ? ' · ' + left + 'm' : '');
    const tab = app.S.ui.tab;
    if (tab === 'plan') this.renderPlan();
    else if (tab === 'chain') this.renderChain();
    else if (tab === 'positions') { this.renderPositions(an, g); this.renderMargin(); this.renderRisk(); this.renderOrders(); }
    else if (tab === 'ic') this.renderIC();
    else if (tab === 'coach') this.renderCoach();
    else if (tab === 'payoff') this.drawPayoff();
    if (this.ticket) this.renderTicket();
  }
  setNum(id, txt, v) { const el = this.$(id); el.textContent = txt; el.className = 'num ' + cls(v); }

  /* ---------- Aaj ka plan ---------- */
  renderPlan() {
    const app = this.app, st = app.D(), ph = app.phase(), now = app.now(), menu = app.mkt.ready ? app.buildMenu() : null, pick = st.pick;
    // phase banner
    const left = ph === 'free' ? null : M.phaseLeft(now), demo = app.demo;
    this.$('phBox').className = 'phase ph-' + ph;
    this.$('phBox').innerHTML = ph === 'free'
      ? '<b>Free demo</b><span>Time rules band hain. Poore din ki practice ke liye Settings → Demo mode = "Demo din".</span>'
      : '<b>' + M.PHASES[ph][0] + ' · ' + time(now) + (left != null ? ' <small>(' + (left >= 60 ? Math.floor(left / 60) + 'h ' : '') + (left % 60) + 'm baaki)</small>' : '') + '</b><span>' + M.PHASES[ph][1] + '</span>' +
        (demo && app.S.cfg.demoMode === 'day' ? '<span class="mut">Demo din · mizaaj: ' + (demo.secret && !(pick && pick.review) ? 'secret 🤫' : { range: 'Range', up: 'Trend up', down: 'Trend down', volatile: 'Volatile' }[demo.regime]) + ' · ' + demo.speed + '× speed</span>' : '');
    // active trade
    const t = app.S.trade;
    this.$('tradeBox').innerHTML = t ? '<h3>Active trade</h3>' + this.riskHTML(t) : '';
    this.placeMarks(this.$('tradeBox'));
    // signals
    this.$('sigBox').innerHTML = menu ? menu.sig.items.map(i => '<div class="sig l' + (i.lv == null ? 'x' : i.lv) + '"><i></i><span>' + esc(i.txt) + '</span></div>').join('') +
      (menu.sig.em ? '<p class="note">Ek din ka expected move (EM) ≈ ' + Math.round(menu.sig.em) + ' pts (spot × IV ÷ √365).</p>' : '')
      : '<p class="empty">Chain data ka intezaar… Kite me option chain kholo ya Settings me Demo chuno.</p>';
    this.$('paBox').innerHTML = this.paHTML(app.pa, false);
    this.fillManual();
    // step 1 / pick summary
    const box = this.$('pickBox'), step1 = !pick || pick.reopen, key = step1 ? 'step1:' + (pick ? pick.at : 0) : 'pick:' + pick.at;
    if (box.dataset.k !== key) {
      box.dataset.k = key;
      box.innerHTML = step1
        ? '<div class="step"><b>Step 1: Tumhara decision</b><p class="mut">Signals dekho aur khud socho: aaj kya karoge? Lock karne ke baad hi coach apna score dikhayega.</p><div class="slist">' +
          M.STRATS.map(s => '<label class="sopt"><input type="radio" name="kpPick" value="' + s.id + '"' + (pick && pick.id === s.id ? ' checked' : '') + '><b>' + esc(s.name) + '</b><span class="mut">' + esc(s.view) + '</span></label>').join('') + '</div>' +
          '<div class="form"><label>Kyun? Tumhare hisaab se aaj ka din<select id="pReason"><option value="">— chuno —</option>' + Object.entries(M.DT).map(([k, l]) => '<option value="' + k + '">' + esc(l) + '</option>').join('') + '</select></label>' +
          '<label>Note (optional)<input id="pNote" maxlength="120" placeholder="jaise: OR ke andar, IV gir raha"></label></div>' +
          '<button class="btn primary" data-act="lockPick">Mera choice lock karo</button></div>'
        : '';
    }
    if (!step1) {
      const live = menu && menu.list.find(s => s.id === pick.id), best = menu && menu.list.find(s => s.id === menu.best);
      box.innerHTML = '<div class="step done"><b>Tumhara choice: ' + esc(M.SBY[pick.id].name) + '</b> <span class="mut">(' + time(pick.at) + ', ' + esc(M.DT[pick.reason] || '') + ')</span>' +
        '<div class="cmp"><div><span>Tumhara score (lock par)</span><b>' + pick.pickScore + '/100</b></div><div><span>Coach ki pasand (lock par)</span><b>' + esc(M.SBY[pick.best].name) + ' · ' + pick.bestScore + '</b></div>' +
        '<div><span>Coach ka day type</span><b>' + esc(M.DT[pick.dt]) + (pick.reason === pick.dt ? ' ✅' : '') + '</b></div>' +
        (live && best ? '<div><span>Abhi (live)</span><b>' + live.score + ' vs ' + esc(best.name) + ' ' + best.score + '</b></div>' : '') + '</div>' +
        (pick.id === pick.best ? '<p class="pos">👍 Tumhara aur coach ka choice same hai.</p>' : '<p class="mut">Coach alag soch raha hai. Neeche har strategy ke "kyun" padho, phir decide karo.</p>') +
        '<div class="row flat"><button class="btn" data-act="repick">Dobara choose karo</button><button class="btn" data-act="aiPick">🤖 AI se samjho</button></div>' + (pick.history && pick.history.length ? ' <span class="mut">(' + pick.history.length + ' baar badla)</span>' : '') + '</div>';
    }
    // step 2/3: reveal cards
    const rb = this.$('revealBox');
    if (step1 || !menu) { rb.innerHTML = ''; rb.dataset.k = ''; }
    else {
      const open = app.legs().length > 0, list = menu.list.slice().sort((a, b) => b.score - a.score);
      const rk = list.map(s => s.id + s.score + (s.legs || []).map(l => l.K).join('')).join('|') + open + (pick.placed ? 1 : 0);
      if (rb.dataset.k !== rk || Date.now() - (this.rbAt || 0) > 4000) {
        rb.dataset.k = rk; this.rbAt = Date.now();
        rb.innerHTML = '<h3>Step 2: Coach ka score (live)</h3>' + list.map(s => {
          const mine = s.id === pick.id, best = s.id === menu.best, x = s.st;
          return '<div class="opt' + (best ? ' best' : '') + (mine ? ' mine' : '') + '">' + (mine ? '<div class="minelab">🙋 Tumhara choice</div>' : '') + (best ? '<div class="bestlab">👍 Coach ki pasand</div>' : '') +
            '<div class="opth"><span class="score s-' + scoreCls(s.score) + '">' + s.score + '<small>/100</small></span><b>' + esc(s.name) + '</b>' +
            (s.kind !== 'none' && x && !open ? '<button class="btn ' + (s.kind === 'credit' ? 'sell' : 'primary') + '" data-place="' + s.id + '">Place fake</button>' : '') + '</div>' +
            (s.why.length ? '<div class="why"><span class="' + (s.score >= 75 ? 'pos' : s.score >= 55 ? '' : 'mut') + '">' + scoreLab(s.score) + '</span>' + s.why.map(w => '<span class="' + (w.v > 0 ? 'pos' : 'neg') + '">' + (w.v > 0 ? '+ ' : '− ') + esc(w.t) + '</span>').join('') + '</div>' : '') +
            '<p class="mut">Kab sahi: ' + esc(s.when) + '</p>' +
            (s.legs && s.legs.length ? '<div class="ords">' + s.legs.map(l => '<span><span class="tag ' + (l.side === 'BUY' ? 'l' : 's') + '">' + l.side + '</span>' + l.lots + 'L ' + l.K + ' ' + l.type + '</span>').join('') + '</div>' : '') +
            (x ? '<div class="omet"><span>' + (x.kind === 'credit' ? 'Credit' : 'Debit') + ' <b>' + rs(x.unitRs) + '</b></span><span>Max profit <b class="pos">' + rsInf(x.maxP) + '</b></span><span>Max loss <b class="neg">' + rsInf(x.maxL) + '</b></span>' +
              '<span>BE <b>' + (x.be.length ? x.be.map(b => nf0.format(b)).join(' – ') : '—') + '</b></span><span>POP <b>' + pct(x.pop) + '</b></span>' +
              '<span>SL <b class="neg">' + rs(-x.slRs) + '</b></span><span>Target <b class="pos">' + rs(x.tgtRs) + '</b></span><span>Risk:Reward <b>1 : ' + x.rr.toFixed(2) + '</b></span><span>Zaroori win-rate <b>' + pct(x.needWin) + '</b></span></div>' : '') + '</div>';
        }).join('') + (open ? '<p class="note">Position khuli hai: nayi strategy lagane se pehle Positions → Exit all.</p>' : '<p class="note">Step 3: kisi bhi card par "Place fake" se wahi strategy lagegi. SL / target upar ke rules se banenge (neeche badal sakte ho). Score future nahi jaanta; ye seekhne ke liye hai, trading advice nahi.</p>');
      }
    }
    // review + journal
    const rv = pick && pick.review;
    this.$('reviewBox').innerHTML = rv ? '<div class="report"><b>Din ka review' + (rv.partial ? ' (adhoora data)' : '') + ': ' + esc(rv.label) + '</b><div class="stats">' +
      '<div><span>Open → Close</span><b>' + nf0.format(rv.open) + ' → ' + nf0.format(rv.close) + '</b></div><div><span>Din ki range</span><b>' + nf0.format(rv.lo) + '–' + nf0.format(rv.hi) + ' (' + rv.rangeX.toFixed(1) + '× EM)</b></div>' +
      '<div><span>Tumhara choice</span><b class="' + (rv.pickOk ? 'pos' : 'neg') + '">' + esc(M.SBY[pick.id].name) + (rv.pickOk ? ' ✅' : ' ❌') + '</b></div>' +
      '<div><span>Coach ka choice</span><b class="' + (rv.coachOk ? 'pos' : 'neg') + '">' + esc(M.SBY[pick.best].name) + (rv.coachOk ? ' ✅' : ' ❌') + '</b></div></div>' +
      '<p class="mut">Aise din par sahi rehti: ' + rv.good.map(id => esc(M.SBY[id].name)).join(', ') + '. Subah tumne din ko "' + esc(M.DT[pick.reason] || '—') + '" samjha tha.</p></div>' : '';
    const J = app.S.journal.filter(j => j.demo === (app.S.cfg.feed === 'demo')).slice(0, 10);
    const ok = J.filter(j => j.pickOk).length, cok = J.filter(j => j.coachOk).length;
    this.$('journalBox').innerHTML = J.length ? '<p class="mut">Pichhle ' + J.length + ' din: tumhara choice ' + ok + ' baar sahi, coach ka ' + cok + ' baar.</p><table class="olog"><tbody>' +
      J.map(j => '<tr><td class="mut num">' + j.date.slice(5) + '</td><td>' + esc(M.SBY[j.pick].name) + (j.pickOk ? ' ✅' : ' ❌') + '</td><td class="mut">coach: ' + esc(M.SBY[j.best].name) + '</td><td>' + esc(M.ACT[j.actual]) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="empty">Abhi koi din review nahi hua. Choice lock karo, din ke end (15:30) par review banega.</p>';
  }

  /* ---------- Margin: andaza (SPAN jaisa) + exact (Kite basket margin) ---------- */
  renderMargin() {
    const app = this.app, legs = app.legs(), box = this.$('margBox');
    if (!legs.length || !app.mkt.ready) { box.innerHTML = ''; return; }
    const d = A.marginDetail(app.mkt, legs), k = app.kcMargin, kc = this.kc;
    const exact = k && !k.err && k.total != null ? '<div class="mx"><span>Exact (Kite)</span><b class="num">' + rs(k.total) + '</b><small class="mut">' + (k.span != null ? 'SPAN ' + rs(k.span) + ' + Exposure ' + rs(k.exposure || 0) + (k.premium ? ' + Premium ' + rs(k.premium) : '') : '') + '</small></div>' : '';
    const note = k && k.err ? '<p class="note">Kite se exact margin nahi aaya: ' + esc(k.err) + '</p>'
      : !kc || !kc.loggedIn ? '<p class="note">Ye <b>andaza</b> hai (NSE SPAN jaisa: market ±9% chale to sabse bada loss + short ka 2% exposure + khareede options ka premium). Zerodha jaisa <b>exact</b> margin chahiye to Settings → Kite Connect se login karo.</p>'
      : !exact ? '<p class="note">Kite se exact margin laa raha hai…</p>' : '<p class="note">Exact = Zerodha ka basket margin calculator (Kite Connect). Isse koi order nahi lagta, sirf hisaab hota hai. ' + (k.at ? 'Updated ' + time(k.at) : '') + '</p>';
    box.innerHTML = '<h3>Margin</h3><div class="stats marg">' +
      '<div><span>SPAN (andaza)</span><b class="num">' + rs(d.span) + '</b></div><div><span>Exposure (short ka 2%)</span><b class="num">' + rs(d.exposure) + '</b></div>' +
      '<div><span>Option premium (khareeda)</span><b class="num">' + rs(d.premium) + '</b></div><div class="tot"><span>Total (andaza)</span><b class="num">' + rs(d.total) + '</b></div>' + exact + '</div>' + note;
  }

  /* ---------- SL / target ---------- */
  riskHTML(t) {
    const app = this.app, pnl = B.total(app.S.book, app.mkt) - t.pnl0, x = Math.max(0, Math.min(1, (pnl + t.slRs) / (t.slRs + t.tgtRs)));
    const hit = t.hits.filter(h => h.type === 'sl' || h.type === 'target').pop() || null;
    return '<div class="risk' + (hit && hit.reacted == null ? (hit.type === 'sl' ? ' rsl' : ' rtg') : '') + '"><div class="rhead"><b>' + esc(t.name) + '</b><span class="tag ' + (t.kind === 'credit' ? 's' : 'l') + '">' + (t.kind === 'credit' ? 'Credit' : 'Debit') + ' ' + rs(t.unitRs) + '</span>' +
      (t.early ? '<span class="tag x">early entry</span>' : '') + (hit && hit.reacted == null ? '<span class="rhit">' + (hit.type === 'sl' ? '🔴 SL hit, exit karo' : '🎯 Target hit, book karo') + '</span>' : '') + '</div>' +
      '<div class="rbar"><i class="rmark" data-x="' + (x * 100).toFixed(1) + '"></i></div>' +
      '<div class="rlab"><span class="neg">SL ' + rs(-t.slRs) + '</span><b class="num ' + cls(pnl) + '">' + rsS(pnl) + '</b><span class="pos">Target ' + rs(t.tgtRs) + '</span></div>' +
      '<div class="omet"><span>Risk:Reward <b>' + RK.rrTxt(t) + '</b></span><span>Zaroori win-rate <b>' + pct(t.needWin) + '</b></span><span>SL = ' + t.slMult.toFixed(2) + '× · Target = ' + t.tgtMult.toFixed(2) + '× ' + (t.kind === 'credit' ? 'credit' : 'debit') + '</span>' +
      (t.widened ? '<span class="neg">SL ' + t.widened + ' baar door khiskaya</span>' : '') + '</div></div>';
  }
  /* CSP-safe: style attribute nahi, CSSOM se position */
  placeMarks(root) { root.querySelectorAll('.rmark').forEach(m => { m.style.left = m.dataset.x + '%'; }); }
  renderRisk() {
    const t = this.app.S.trade, box = this.$('riskBox');
    box.innerHTML = t ? '<h3>Trade plan</h3>' + this.riskHTML(t) : '';
    this.placeMarks(box); this.$('rbEdit').hidden = !t;
    if (t && !this.$('rbEdit').open) { this.$('rbSl').value = Math.round(t.slRs); this.$('rbTgt').value = Math.round(t.tgtRs); }
  }
  showRisk(h, t) {
    const sl = h.type === 'sl';
    this.card(sl ? 3 : 1, (sl ? '🔴 SL hit: ' : '🎯 Target hit: ') + t.name, time(h.at) + ', P&L ' + rsS(h.pnl),
      [sl ? 'Loss tumhare SL ' + rs(-t.slRs) + ' tak pahunch gaya. Plan ke hisaab se ab exit.' : 'Profit target ' + rs(t.tgtRs) + ' tak aa gaya. Plan ke hisaab se book karo.',
        'Extension khud exit nahi karega. Exit tumhe karna hai; kitni der lagi, ye note ho raha hai.'], sl ? 'sl' : 'target', true);
  }

  /* Price action card: trend + level ladder (upar resistance, spot, neeche support) + aakhri pattern. compact = chain tab (paas ke 2+2). */
  paHTML(pa, compact) {
    if (!pa) return '<div class="pacard"><p class="mut">Price action ke liye NIFTY ki candles chahiye: Kite live (option chain khuli) ya Settings → Demo mode "Demo din". 9:15 ke baad record hoti hain.</p></div>';
    const S = pa.S, zs = pa.zones, tr = pa.trend;
    let above = zs.filter(z => z.lo > S), below = zs.filter(z => z.hi < S).reverse(), inside = zs.filter(z => S >= z.lo && S <= z.hi);
    const lim = compact ? 2 : 5; above = above.slice(0, lim).reverse(); below = below.slice(0, lim);
    const row = (z, role) => '<div class="pz ' + role + (z.star ? ' star' : '') + '"><b>' + nf0.format(Math.round(z.px)) + (z.star ? ' ⭐' : '') + '</b><span class="pzt">' + z.tags.map(esc).join(' · ') + '</span><span class="pzd">' + (z.dist > 0 ? '+' : '') + Math.round(z.dist) + '</span></div>';
    const last = (this.app.paLog || []).slice(-1)[0];
    return '<div class="pacard' + (compact ? ' compact' : '') + '"><div class="ptr ' + tr.dir + '"><b>' + tr.label + '</b>' + (tr.strong ? '' : ' <span class="mut">(kamzor)</span>') + (compact ? '' : '<span class="mut">' + esc(tr.why) + '</span>') + '</div>' +
      '<div class="pladder">' + above.map(z => row(z, 'res')).join('') + inside.map(z => row(z, 'in')).join('') +
      '<div class="pz spot">▶ Spot <b>' + nf0.format(Math.round(S)) + '</b></div>' + below.map(z => row(z, 'sup')).join('') + '</div>' +
      (last ? '<div class="plast">Aakhri pattern (' + hmOf(last.t + 5) + '): ' + esc(last.title) + '</div>' : '') +
      (compact ? '' : '<p class="note">⭐ = do ya zyada level ek jagah (confluence), sabse majboot. Lal = resistance (upar), hara = support (neeche). Patterns sirf 5-min candle close par.</p>') + '</div>';
  }
  showPA(p, lv) {
    const hm = hmOf(p.t + 5);
    const why = p.why.slice(); if (p.oi) why.push((p.oi.ok ? '✓ ' : '⚠ ') + p.oi.txt);
    this.card(lv, p.title, '5-min candle close ' + hm + (p.dir === 'bull' ? ' · bullish' : p.dir === 'bear' ? ' · bearish' : ''), why, 'alert');
  }
  /* OI shift card: position wala (🔴/🟠) ya ℹ️ naya trade wala (neela) */
  showOIShift(e, a) {
    const el = this.card(a.lv, (a.mode === 'info' ? 'ℹ️ ' : '📊 ') + e.title, 'OI shift · 5-min close ' + hmOf(e.t) + (a.mode === 'pos' ? ' · tumhari position' : ' · koi position nahi'), a.why, 'alert');
    if (el && a.mode === 'info') el.classList.add('info');
  }
  /* chain ke upar: har case ke Top 3 + resistance / support ka ishara. Strike par click = chain me wahan scroll. */
  renderBuSummary(top) {
    const box = this.$('buSum'); if (!box) return;
    const chip = x => '<button class="busk bu-' + x.b.id + '" data-busk="' + x.K + '">' + nf0.format(x.K) + ' ' + x.T + ' <small>' + (x.b.dOI > 0 ? '+' : '') + x.b.dOI.toFixed(1) + 'L</small></button>';
    const line = id => { const B = KP.BUILDUP[id]; return '<div class="bsl"><span class="bsn">' + B.e + ' ' + B.name + '</span>' + (top[id].length ? top[id].map(chip).join('') : '<span class="mut">abhi koi nahi</span>') + '</div>'; };
    const res = top.short.find(x => x.T === 'CE'), sup = top.short.find(x => x.T === 'PE'), brk = top.cover[0];
    const hint = [res ? 'Resistance ~' + nf0.format(res.K) + ' (CE sellers)' : '', sup ? 'Support ~' + nf0.format(sup.K) + ' (PE sellers)' : '',
      brk ? (brk.T === 'CE' ? 'CE' : 'PE') + ' ' + nf0.format(brk.K) + ' par sellers bhaag rahe → ' + (brk.T === 'CE' ? 'upar' : 'neeche') + ' move ka ishara' : ''].filter(Boolean);
    box.innerHTML = '<div class="bsh">Top 3 (sabse zyada lakh contracts jude / ghate)</div>' + ['short', 'long', 'cover'].map(line).join('') +
      (hint.length ? '<div class="bsl hint">👉 ' + hint.join(' · ') + '</div>' : '') +
      ((lo => lo ? '<div class="bsl hint">📊 Aakhri OI shift (' + hmOf(lo.t) + '): ' + esc(lo.title) + '</div>' : '')((this.app.oiLog || []).slice(-1)[0]));
  }
  showLegSL(l, e, pnl, auto) {
    const n = KP.instName(l.type, l.K), sell = l.qty < 0, sl = e.hit.type === 'sl', lvl = sl ? e.sl : e.tgt;
    const what = (sell ? 'Becha tha ' : 'Khareeda tha ') + f2(l.avg) + ', premium ' + (sl ? 'SL ' : 'target ') + f2(lvl) + ((sell === sl) ? ' ke upar chala gaya.' : ' ke neeche aa gaya.');
    if (auto) {
      this.card(sl ? 2 : 1, (sl ? '🔴 SL order execute: ' : '🎯 Target order execute: ') + n, time(e.hit.at) + ', exit @ ' + f2(e.hit.ltp) + ' (' + (sl ? 'SL ' : 'target ') + f2(lvl) + ')',
        [what + ' Leg fake order se exit ho gayi, is leg par ' + rsS(pnl) + '.', sl ? 'Baaki legs abhi khuli hain. Ab position ka risk dekho (Kya karu?).' : 'Profit book. Baaki legs check karo.'], 'alert');
      return;
    }
    this.card(sl ? 3 : 1, (sl ? '🔴 Leg SL hit: ' : '🎯 Leg target hit: ') + n, time(e.hit.at) + ', LTP ' + f2(e.hit.ltp) + ' (' + (sl ? 'SL ' : 'target ') + f2(lvl) + ')',
      [what + ' Is leg par ' + rsS(pnl) + '.', 'Plan ke hisaab se ye leg ' + (sl ? 'kaato' : 'book karo') + ' (auto exit Settings me band hai). Kitni der lagi, ye note ho raha hai.'], sl ? 'alert' : 'target', KP.keyOf(l.type, l.K));
  }
  renderChain() {
    const app = this.app, mkt = app.mkt, c = app.canTrade(true);
    this.$('demoCtl').hidden = app.S.cfg.feed !== 'demo';
    this.$('chainWarn').innerHTML = c.ok ? '' : '<div class="warn">' + esc(c.why) + '</div>';
    if (!mkt.ready) { this.$('chainBody').innerHTML = '<tr><td colspan="11" class="empty">Kite me option chain kholo (Marketwatch → NIFTY → More → Option chain).</td></tr>'; this.chainSig = ''; return; }
    const atm = mkt.atm(), ks = [];
    for (let i = 12; i >= -12; i--) ks.push(atm - i * mkt.step);
    const sig = ks.join(','), body = this.$('chainBody');
    // CE: bs 0 | OI 1 | IV 2 | Δ 3 | LTP 4 | strike 5 | PE: LTP 6 | Δ 7 | IV 8 | OI 9 | bs 10
    const side = s => s === 'CE' ? '<td class="num oi"></td><td class="num mut"></td><td class="num mut dcol"></td><td class="num ltp"><span></span><span></span><span class="chg"></span><span class="mny"></span></td>'
      : '<td class="num ltp"><span></span><span></span><span class="chg"></span><span class="mny"></span></td><td class="num mut dcol"></td><td class="num mut"></td><td class="num oi"></td>';
    if (sig !== this.chainSig) {
      this.chainSig = sig;
      body.innerHTML = ks.map(K => '<tr data-k="' + K + '"' + (K === atm ? ' class="atm"' : '') + '>' +
        '<td class="c"><span class="bs"><button class="b" data-o="CE|' + K + '|BUY">B</button><button class="s" data-o="CE|' + K + '|SELL">S</button></span></td>' +
        side('CE') + '<td class="k num">' + nf0.format(K) + '</td>' + side('PE') +
        '<td class="c"><span class="bs"><button class="b" data-o="PE|' + K + '|BUY">B</button><button class="s" data-o="PE|' + K + '|SELL">S</button></span></td></tr>').join('');
    }
    // dono side ka max OI (resistance / support ka ishara)
    const maxOI = { CE: 0, PE: 0 };
    for (const K of ks) for (const T of ['CE', 'PE']) { const o = mkt.oi(T, K); if (o && o.oi > maxOI[T]) maxOI[T] = o.oi; }
    // buildup + Top 3 (Long buildup / Short buildup / Short covering): sabse zyada lakh contracts jude/ghate, CE+PE dono milake
    const { BU, top, rank } = app.buildupTop(ks);
    this.renderBuSummary(top);
    const pc = this.$('paChain'); if (pc) { pc.innerHTML = this.paHTML(app.pa, true); }
    for (const tr of body.rows) {
      const K = +tr.dataset.k, td = tr.cells;
      for (const [type, oiI, ivI, dI, ltpI] of [['CE', 1, 2, 3, 4], ['PE', 9, 8, 7, 6]]) {
        const live = mkt.live(type, K), q = app.lotsOf(type, K), [chip, px, chg, mny] = td[ltpI].children;
        const st = mkt.stale(type, K), m = mkt.moneyness(type, K);
        px.textContent = (st ? '⚠ ' : '') + f2(mkt.ltp(type, K)); px.className = live == null ? 'model' : st ? 'model stale' : '';
        px.title = st ? 'Kite LTP ' + f2(live) + ' purana hai (is strike me aaj trade nahi hua). Put-call parity se fair price dikhaya, fill bhi isi par hoga.' : live == null ? 'Kite par strike nahi dikh rahi: model price' : '';
        chip.className = q ? 'qchip ' + (q > 0 ? 'l' : 'sh') : ''; chip.textContent = q ? (q > 0 ? '+' : '') + q + 'L' : '';
        mny.textContent = m; mny.className = 'mny ' + m.toLowerCase();
        // kitna hila: kal close se (pts + %) aur aaj open se
        const mv = app.ltpMove(type, K), sg = x => (x > 0 ? '+' : x < 0 ? '−' : '') + f2(Math.abs(x)), cl = x => x > 0 ? 'pos' : x < 0 ? 'neg' : '';
        const sp = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1) + '%', isOpen = mv && mv.openT <= 9 * 60 + 20;
        chg.innerHTML = !mv ? '' : (mv.dPrev != null ? '<i class="' + cl(mv.dPrev) + '">' + sg(mv.dPrev) + ' (' + sp(mv.pPrev) + ')</i>' : '') +
          (mv.dOpen != null ? '<em class="' + cl(mv.dOpen) + '">' + (isOpen ? 'Open se ' : 'Subah se ') + sg(mv.dOpen) + '</em>' : '');
        td[ltpI].title = !mv ? '' : ['Abhi LTP ' + f2(mv.ltp),
          mv.prev != null ? 'Kal ka close ' + f2(mv.prev) + ' → ' + sg(mv.dPrev) + ' (' + sp(mv.pPrev) + ')' : 'Kal ka close: Kite chain me change % nahi mila',
          mv.open != null ? (isOpen ? 'Aaj open ' : 'Aaj pehli dekhi price (' + hmOf(mv.openT) + ', panel tab khula) ') + f2(mv.open) + ' → ' + sg(mv.dOpen) + ' (' + sp(mv.pOpen) + ')' : ''].filter(Boolean).join('\n');
        td[dI].textContent = mkt.price(type, K).d.toFixed(2);
        const iv = mkt.ivOf(type, K); td[ivI].textContent = iv == null ? '—' : iv.toFixed(1);
        const o = mkt.oi(type, K);
        const bu = BU[K + type], rk = rank[K + type];
        td[oiI].innerHTML = (rk ? '<span class="burank">' + (rk === 1 ? '🔥' : '') + '#' + rk + '</span>' : '') +
          (o ? '<b' + (o.oi === maxOI[type] && o.oi > 0 ? ' class="oimax"' : '') + '>' + f2(o.oi) + '</b>' + (o.chg != null ? '<i class="' + (o.chg >= 0 ? 'pos' : 'neg') + '">' + (o.chg > 0 ? '+' : '') + o.chg.toFixed(1) + '%</i>' : '') : '—') +
          (bu ? '<span class="bu bu-' + bu.id + '">' + bu.e + ' ' + bu.name + '<em> · ' + bu.who + (rk ? ' · ' + (bu.dOI > 0 ? '+' : '') + bu.dOI.toFixed(1) + ' L' : '') + '</em></span>' : '');
        td[oiI].className = 'num oi' + (rk ? ' hl hl-' + bu.id + ' r' + rk : '');
        td[oiI].title = bu ? (rk ? '#' + rk + ' sabse bada ' + bu.name + ' (' + (bu.dOI > 0 ? '+' : '') + bu.dOI.toFixed(2) + ' lakh contracts)\n' : '') + bu.why + '\nLTP ' + (bu.pc > 0 ? '+' : '') + bu.pc.toFixed(1) + '%, OI ' + (bu.oc > 0 ? '+' : '') + bu.oc.toFixed(1) + '% (' + (bu.src === 'kite' ? 'Kite: kal ke close se' : 'aaj subah se, extension ne record kiya') + ')' : 'Price ya OI 1% se kam hila: saaf signal nahi';
        for (const i of [oiI, ivI, dI, ltpI]) td[i].classList.toggle('itm', m === 'ITM');
      }
    }
  }

  renderPositions(an, g) {
    const app = this.app, mkt = app.mkt, book = app.S.book;
    const pend = app.S.pending || [];
    this.$('pendBox').innerHTML = pend.length ? '<h3 class="first">Open orders (limit)</h3><table class="ptbl pend"><tbody>' + pend.map(o => {
      const l = mkt.ready ? mkt.ltp(o.type, o.K) : null;
      return '<tr><td><span class="tag ' + (o.side === 'BUY' ? 'l' : 's') + '">' + o.side + '</span>' + KP.instName(o.type, o.K) + '</td><td class="num">' + o.lots * app.lot + '</td>' +
        '<td class="num">Limit <b>' + f2(o.limit) + '</b></td><td class="num mut">LTP ' + (l == null ? '—' : f2(l)) + '</td>' +
        '<td class="num mut">' + (o.risk ? 'SL ' + o.risk.slPct + '% · Tgt ' + o.risk.tgtPct + '%' : 'exit') + '</td><td><button class="mini" data-cancel="' + o.id + '">Cancel</button></td></tr>';
    }).join('') + '</tbody></table>' : '';
    const list = Object.values(book.pos).sort((a, b) => (!a.qty) - (!b.qty) || a.K - b.K || a.type.localeCompare(b.type));
    // SL input me type kar rahe ho to table dobara mat banao (focus / likha hua na jaaye)
    const ae = this.root.activeElement, typing = ae && ae.dataset && (ae.dataset.legsl || ae.dataset.legtgt);
    if (!typing) this.$('posBody').innerHTML = list.length ? list.map(p => {
      const l = mkt.ready ? mkt.ltp(p.type, p.K) : p.avg, v = p.real + p.qty * (l - p.avg), k = KP.keyOf(p.type, p.K), e = p.qty ? app.S.legSL[k] : null;
      const tag = p.qty > 0 ? '<span class="tag l">BUY</span>' : p.qty < 0 ? '<span class="tag s">SELL</span>' : '<span class="tag x">CLOSED</span>';
      const d = e ? RK.legDist(e, l) : null;
      const box = (w, on, pct, px) => kbox(null, null, w === 'sl' ? 'SL' : 'Tgt', { chk: ' data-leg' + w + 'on="' + k + '"' + (on ? ' checked' : ''), inp: ' data-leg' + w + '="' + k + '" value="' + (on ? pct : '') + '"' + (on ? '' : ' disabled') }) +
        '<span class="lpx">' + (on ? '@ ' + f2(px) : '') + '</span>';
      const sl = !p.qty || !e ? '' : '<span class="lslrow">' + box('sl', e.slPct > 0, e.slPct, e.sl) + '</span><span class="lslrow">' + box('tgt', e.tgtPct > 0, e.tgtPct, e.tgt) + '</span>' +
        (e.hit ? '<span class="lslhit">' + (e.hit.type === 'sl' ? '🔴 SL hit' : '🎯 target hit') + '</span>' : d != null ? '<span class="lsld' + (d < 0.15 * Math.max(1, e.sl) ? ' near' : '') + '">SL ' + f2(d) + ' door</span>' : '');
      return '<tr' + (p.qty ? (e && e.hit ? ' class="slhit"' : '') : ' class="closed"') + '><td>' + tag + KP.instName(p.type, p.K) + '</td><td class="num">' + p.qty + '</td><td class="num">' + (p.qty ? f2(p.avg) : '—') +
        '</td><td class="num">' + f2(l) + '</td><td class="lslc">' + sl + '</td><td class="num ' + cls(v) + '">' + rsS(v) + '</td><td>' + (p.qty ? '<button class="mini" data-exit="' + k + '">Exit</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">Koi fake position nahi. Chain se B/S dabao ya Iron condor tab use karo.</td></tr>';
    const tot = B.total(book, mkt); this.setNum('posTotal', rsS(tot), tot);
    this.$('bookedNote').textContent = '(charges ' + rs(book.charges) + (book.booked ? ', pichhli series ' + rsS(book.booked) : '') + (book.expiry ? ', expiry ' + book.expiry : '') + ')';
    this.$('greeks').innerHTML = an ? '<span>Δ <b>' + nf0.format(Math.round(g.d)) + '</b></span><span>Θ/day <b class="' + cls(g.th) + '">' + rsS(g.th) + '</b></span><span>Vega/1% <b class="' + cls(g.vg) + '">' + rsS(g.vg) + '</b></span>' +
      '<span>Breakevens <b>' + (an.be.length ? an.be.map(b => nf0.format(b)).join(' / ') : '—') + '</b></span><span>POP <b>' + (an.pop * 100).toFixed(0) + '%</b></span>' : '';
  }

  renderIC() {
    const app = this.app, mkt = app.mkt;
    if (!mkt.ready) { this.$('icLegs').innerHTML = '<tr><td colspan="4" class="empty">Chain data ka intezaar…</td></tr>'; this.$('icStats').innerHTML = ''; return; }
    const b = A.icLegs(mkt, app.S.cfg.ic), s = A.icStats(mkt, b, app.lot);
    this.$('icLegs').innerHTML = s.legs.map(l => '<tr><td><span class="tag ' + (l.side === 'BUY' ? 'l' : 's') + '">' + l.side + '</span>' + l.type + '</td><td class="num">' + nf0.format(l.K) +
      '</td><td class="num mut">' + l.d.toFixed(2) + '</td><td class="num' + (l.live ? '' : ' mut') + '">' + f2(l.px) + (l.live ? '' : '*') + '</td></tr>').join('');
    this.$('icStats').innerHTML = '<div><span>Net credit</span><b class="num">' + f2(s.credit) + '</b></div><div><span>Max profit</span><b class="num pos">' + rs(s.maxP) + '</b></div>' +
      '<div><span>Max loss</span><b class="num neg">' + rs(-s.maxL) + '</b></div><div><span>Breakevens</span><b class="num">' + nf0.format(s.beLo) + ' / ' + nf0.format(s.beHi) + '</b></div>' +
      '<div><span>Risk : reward</span><b class="num">' + (s.rr ? s.rr.toFixed(2) : '—') + ' : 1</b></div>';
  }

  renderCoach() {
    const app = this.app, ctx = app.ctx(), mkt = app.mkt, coach = app.S.coach;
    const ev = app.lastEv || (mkt.ready ? C.evaluate(ctx) : null);
    const rows = mkt.ready ? ['CE', 'PE'].map(T => { const s = C.sideInfo(ctx, T); if (!s) return ''; const lv = ev ? ev[T].level : 0;
      return '<div class="srow lvl' + lv + '"><b>' + s.sh.K + ' ' + T + '</b><span>Δ ' + s.delta.toFixed(2) + '</span><span>Premium ' + s.ratio.toFixed(1) + '×</span><span>Doori ' + Math.round(s.dist) + ' pts</span><span class="lv">' + (lv ? C.LVI[lv] + ' ' + C.LV[lv] : '✅ Safe') + '</span></div>'; }).join('') : '';
    const pl = ev ? ev.POS.level : 0;
    const tp = app.S.trade;
    this.$('coachStatus').innerHTML = tp && tp.kind === 'debit' ? '<p class="mut">Buyer trade: coach sirf SL / target dekhta hai (short-leg wale rules lagu nahi).</p>'
      : rows ? rows + (pl ? '<div class="srow lvl' + pl + '"><b>Position</b><span>' + ev.POS.why.map(w => esc(w.t)).join(' ') + '</span></div>' : '')
      : '<p class="empty">"Aaj ka plan" tab se strategy lagao (ya Iron condor tab), coach tumhari position monitor karna shuru kar dega.</p>';
    this.$('coachRisk').innerHTML = tp ? this.riskHTML(tp) : ''; this.placeMarks(this.$('coachRisk'));
    const b = coach.base;
    if (b && mkt.ready) {
      const sh = C.shadowPnl(ctx), ac = C.actualPnl(ctx), d = ac - sh;
      this.$('coachCompare').innerHTML = '<div><span>Original condor (bina adjust)</span><b class="num ' + cls(sh) + '">' + rsS(sh) + '</b></div><div><span>Tumhara actual</span><b class="num ' + cls(ac) + '">' + rsS(ac) + '</b></div>' +
        '<div><span>Adjustments ka asar</span><b class="num ' + cls(d) + '">' + rsS(d) + '</b></div><div><span>Adjustments</span><b>' + coach.adj.length + '</b></div>';
    } else this.$('coachCompare').innerHTML = '';
    const Al = coach.alerts;
    this.$('alertLog').innerHTML = Al.length ? Al.slice().reverse().slice(0, 60).map(a => '<tr><td class="mut num">' + dayTime(a.at) + '</td><td>' + C.LVI[a.lv] + ' ' + esc(a.title) + '</td><td class="num">' + f2(a.spot) +
      '</td><td class="mut">' + (a.reacted == null ? 'React nahi kiya' : 'React: ' + Math.round(a.reacted / 60) + ' min') + '</td></tr>').join('') : '<tr><td class="empty">Abhi koi alert nahi.</td></tr>';
  }

  showOptions(kind) {
    this.openTab('coach');
    const r = this.app.coachOptions(kind), box = this.$('coachOpts'); this.$('coachReport').innerHTML = '';
    if (r.msg) { box.innerHTML = '<p class="empty">' + esc(r.msg) + '</p>'; return; }
    const t = r.tested, base = r.opts[0], mkt = this.app.mkt, showScore = this.app.S.coach.rules.showScore, tp = this.app.S.trade;
    box.innerHTML = '<div class="sit"><b>Situation (' + time(mkt.now()) + ', ' + f2(mkt.S) + ')</b><br>' +
      (r.debit ? 'Buyer trade' + (tp ? ' (' + esc(tp.name) + ')' : '') + ': open P&amp;L ' + rsS(r.mtm) + '. ' + (tp ? esc(RK.desc(tp)) + '. ' : '') + 'Buyer ke liye time dushman hai: har ghante premium ghatta hai.'
        : 'Market ' + (t.type === 'CE' ? 'upar' : 'neeche') + ' ki taraf ' + t.sh.K + ' ' + t.type + ' ko test kar raha hai: delta ' + t.delta.toFixed(2) +
      ', premium ' + t.ratio.toFixed(1) + '×, doori ' + Math.round(t.dist) + ' pts.' + (r.un ? ' Dusri side (' + r.un.sh.K + ' ' + r.un.type + ') ka premium ' + f2(r.un.px) + ' bacha hai.' : '') + (tp ? ' ' + esc(RK.desc(tp)) + '.' : '')) + ' Live market chal raha hai, prices badalte rahenge.</div>' +
      r.opts.map((o, i) => {
        const be = o.an.be.length ? o.an.be.map(b => nf0.format(b)).join(' – ') : '—', dml = o.an.mn - base.an.mn, isBest = showScore && r.best === o.id;
        const btn = '<button class="btn ' + (i === 0 ? '' : o.id === 'exit' ? 'sell' : 'primary') + '" data-adj="' + i + '">' + (i ? 'Ye karo' : 'Kuch mat karo') + '</button>';
        const badge = showScore ? '<span class="score s-' + scoreCls(o.score) + '">' + o.score + '<small>/100</small></span>' : '';
        return '<div class="opt' + (i === 0 ? ' hold' : '') + (isBest ? ' best' : '') + '">' + (isBest ? '<div class="bestlab">👍 Coach ki pasand</div>' : '') + '<div class="opth">' + badge + '<b>' + esc(o.title) + '</b>' + btn + '</div>' +
          (showScore && o.why.length ? '<div class="why"><span class="' + (o.score >= 75 ? 'pos' : o.score >= 55 ? '' : 'mut') + '">' + scoreLab(o.score) + '</span>' + o.why.map(w => '<span class="' + (w.v > 0 ? 'pos' : 'neg') + '">' + (w.v > 0 ? '+ ' : '− ') + esc(w.t) + '</span>').join('') + '</div>' : '') +
          '<p class="mut">Kab sahi: ' + esc(o.when) + '</p>' +
          (o.orders.length ? '<div class="ords">' + o.orders.map(x => '<span><span class="tag ' + (x.side === 'BUY' ? 'l' : 's') + '">' + x.side + '</span>' + x.lots + 'L ' + x.K + ' ' + x.type + '</span>').join('') + '</div>' : '') +
          '<div class="omet"><span>Adjustment cash <b class="' + cls(o.cash) + '">' + (o.orders.length ? rsS(o.cash) : '—') + '</b></span><span>Expiry BE <b>' + be + '</b></span>' +
          '<span>Max profit <b class="pos">' + rs(o.an.mx) + '</b></span><span>Max loss <b class="neg">' + rs(o.an.mn) + '</b>' + (i && Math.abs(dml) > 1 ? ' <small class="' + cls(dml) + '">' + rsS(dml) + '</small>' : '') + '</span>' +
          '<span>POP <b>' + (o.an.pop * 100).toFixed(0) + '%</b></span><span>Net Δ <b>' + o.delta.toFixed(0) + '</b></span></div></div>';
      }).join('') +
      '<p class="note">Score coach ke rules aur abhi ke numbers se banta hai, future nahi jaanta. Numbers poori series ke expiry payoff ke hain (booked P&amp;L aur charges shamil). Ye seekhne ke liye hai, trading advice nahi.</p>';
  }
  showReport() {
    const app = this.app, R = C.report(app.ctx()), plans = app.S.trades.concat(app.S.trade ? [app.S.trade] : []);
    R.tips = R.tips.concat(RK.tips(plans));
    const J = app.S.journal.slice(0, 20), early = plans.filter(p => p.early).length;
    if (J.length) { const ok = J.filter(j => j.pickOk).length, same = J.filter(j => j.pick === j.best).length; R.tips.push('Strategy choice: pichhle ' + J.length + ' din me ' + ok + ' baar sahi nikla, ' + same + ' baar coach ke saath match hua.'); }
    if (early) R.tips.push(early + ' trade 10 baje se pehle liye (early entry). Opening range ka confirmation aane do.');
    this.$('coachOpts').innerHTML = '';
    this.$('coachReport').innerHTML = '<div class="report"><b>Report card</b><div class="stats">' +
      '<div><span>Alerts 🟡 / 🟠 / 🔴</span><b>' + R.cnt[1] + ' / ' + R.cnt[2] + ' / ' + R.cnt[3] + '</b></div>' +
      '<div><span>Avg reaction (🟠🔴)</span><b>' + (R.avgMin == null ? '—' : R.avgMin.toFixed(0) + ' min') + '</b></div>' +
      '<div><span>Ignore kiye</span><b class="' + (R.ignored ? 'neg' : '') + '">' + R.ignored + '</b></div><div><span>Adjustments</span><b>' + R.adj.length + '</b></div></div>' +
      (R.adj.length ? '<p class="mut">' + R.adj.map(a => dayTime(a.at) + ': ' + esc(a.name) + ' @ ' + f2(a.spot)).join('<br>') + '</p>' : '') +
      '<ul>' + R.tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>';
  }

  renderOrders() {
    const o = this.app.S.book.orders;
    this.$('orderBody').innerHTML = o.length ? o.map(x => '<tr><td class="mut num">' + dayTime(x.t) + '</td><td><span class="tag ' + (x.side === 'BUY' ? 'l' : x.side === 'SELL' ? 's' : 'x') + '">' + x.side + '</span>' + esc(x.inst) +
      '</td><td class="num">' + x.qty + '</td><td class="num">' + f2(x.px) + (x.model ? '*' : '') + '</td></tr>').join('') : '<tr><td class="empty">Abhi tak koi fake order nahi.</td></tr>';
  }

  /* ---------- payoff (artifact se port) ---------- */
  drawPayoff() {
    const app = this.app, mkt = app.mkt, cv = this.$('payoffCv'), legs = app.legs(), stats = this.$('payStats');
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(this.host), css = v => cs.getPropertyValue(v).trim();
    if (!legs.length || !mkt.ready) { g.fillStyle = css('--muted'); g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText('Position lo, payoff yahan dikhega', w / 2, h / 2); stats.innerHTML = ''; return; }
    const S = mkt.S, STEP = mkt.step, ks = legs.map(l => l.K); let lo = Math.min(S * 0.96, Math.min(...ks) - 3 * STEP), hi = Math.max(S * 1.04, Math.max(...ks) + 3 * STEP);
    const N = 200, ex = [], t0 = []; for (let i = 0; i <= N; i++) { const x = lo + (hi - lo) * i / N; ex.push([x, A.expPay(x, legs)]); t0.push([x, A.nowPay(mkt, x, legs)]); }
    let ymin = Math.min(...ex.map(p => p[1]), ...t0.map(p => p[1])), ymax = Math.max(...ex.map(p => p[1]), ...t0.map(p => p[1]));
    if (ymax < 0) ymax = 0; if (ymin > 0) ymin = 0; const pad = (ymax - ymin) * 0.1 || 1000; ymin -= pad; ymax += pad;
    const L = 58, Rr = 8, Tp = 12, Bt = 24, X = x => L + (x - lo) / (hi - lo) * (w - L - Rr), Y = y => Tp + (ymax - y) / (ymax - ymin) * (h - Tp - Bt);
    g.font = '10.5px sans-serif'; g.strokeStyle = css('--line'); g.fillStyle = css('--muted'); g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = ymin + (ymax - ymin) * i / 4, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - Rr, y); g.stroke(); g.textAlign = 'right'; g.fillText(rs(v), L - 5, y + 4); }
    g.textAlign = 'center'; for (let i = 0; i <= 4; i++) { const x = lo + (hi - lo) * i / 4; g.fillText(nf0.format(Math.round(x / STEP) * STEP), X(x), h - 7); }
    const y0 = Y(0), green = css('--green'), red = css('--red');
    for (let i = 0; i < N; i++) { const a = ex[i], b = ex[i + 1], m = (a[1] + b[1]) / 2; g.fillStyle = m >= 0 ? green : red; g.globalAlpha = .14;
      g.beginPath(); g.moveTo(X(a[0]), y0); g.lineTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.lineTo(X(b[0]), y0); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = css('--muted'); g.beginPath(); g.moveTo(L, y0); g.lineTo(w - Rr, y0); g.stroke();
    g.lineWidth = 2; for (let i = 0; i < N; i++) { const a = ex[i], b = ex[i + 1]; g.strokeStyle = (a[1] + b[1]) / 2 >= 0 ? green : red; g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke(); }
    g.strokeStyle = css('--blue'); g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); t0.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); g.setLineDash([]);
    g.strokeStyle = css('--head'); g.lineWidth = 1; g.beginPath(); g.moveTo(X(S), Tp); g.lineTo(X(S), h - Bt); g.stroke();
    g.fillStyle = css('--head'); g.textAlign = 'center'; g.fillText('Spot ' + f2(S), Math.min(w - 50, Math.max(L + 40, X(S))), Tp + 10);
    const hx = this.hoverX;
    if (hx !== null && hx >= L && hx <= w - Rr) {
      const xs = lo + (hx - L) / (w - L - Rr) * (hi - lo), pe = A.expPay(xs, legs), pt = A.nowPay(mkt, xs, legs);
      g.strokeStyle = css('--muted'); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(hx, Tp); g.lineTo(hx, h - Bt); g.stroke(); g.setLineDash([]);
      const txt = nf0.format(xs) + '  Expiry ' + rsS(pe) + '  T+0 ' + rsS(pt); g.font = '11px sans-serif'; const tw = g.measureText(txt).width + 12, bx = Math.min(w - Rr - tw, Math.max(L, hx - tw / 2));
      g.fillStyle = css('--panel'); g.strokeStyle = css('--line'); g.fillRect(bx, Tp + 16, tw, 21); g.strokeRect(bx, Tp + 16, tw, 21); g.fillStyle = css('--head'); g.textAlign = 'left'; g.fillText(txt, bx + 6, Tp + 30);
    }
    const an = A.analyse(mkt, legs), live = A.liveMtm(mkt, legs);
    stats.innerHTML = '<div><span>Max profit</span><b class="num pos">' + (an.unlimProfit ? 'Unlimited' : rs(an.mx)) + '</b></div><div><span>Max loss</span><b class="num neg">' + (an.unlimLoss ? 'Unlimited' : rs(an.mn)) + '</b></div>' +
      '<div><span>Breakevens</span><b class="num">' + (an.be.length ? an.be.map(b => nf0.format(b)).join(' / ') : '—') + '</b></div><div><span>Prob. of profit</span><b class="num">' + (an.pop * 100).toFixed(1) + '%</b></div>' +
      '<div><span>Open legs P&amp;L</span><b class="num ' + cls(live) + '">' + rsS(live) + '</b></div>';
  }

  /* ---------- ticket ---------- */
  openTicket(type, K, side) {
    if (this.app.S.ui.collapsed) this.setCollapsed(false);
    this.ticket = { type, K, side }; this.$('tLots').value = this.app.S.cfg.lots || 1;
    this.fillTicketRisk();
    this.$('tRisk').classList.remove('need');
    this.$('tMkt').checked = true; this.$('tLmt').value = ''; this.$('tLmt').hidden = true; this.$('tPx').hidden = false;
    this.$('ticket').hidden = false; this.renderTicket(); this.$('tLots').focus();
  }
  /* SL / target % pehle se: same side me lots jod rahe ho to us leg ka %, warna intraday default (naked SELL 30/40, BUY 25/50; expiry day SL 20) */
  fillTicketRisk() {
    const t = this.ticket, app = this.app, q = t.side === 'BUY' ? 1 : -1;
    const e = app.S.legSL[KP.keyOf(t.type, t.K)], same = e && Math.sign(e.qty) === q, R = app.legRisk();
    const sl = same && e.slPct ? e.slPct : RK.defPct(q, R, 'sl'), tg = same && e.tgtPct ? e.tgtPct : RK.defPct(q, R, 'tgt');
    [['tSlOn', 'tSl', sl], ['tTgOn', 'tTg', tg]].forEach(([c, i, v]) => { this.$(c).checked = v > 0; this.$(i).disabled = !(v > 0); this.$(i).value = v > 0 ? v : ''; });
    t.def = !same;                                                           // student ne badla nahi to B⇄S par naye side ka default
  }
  /* null = market; limit mode me price (0 = khaali / galat) */
  ticketLimit() { if (!this.$('tLim').checked) return null; const v = +this.$('tLmt').value; return v > 0 ? v : 0; }
  /* {slPct, tgtPct} ya null (dono tick + bhare hone chahiye) */
  ticketRisk() {
    const sl = this.$('tSlOn').checked ? +this.$('tSl').value : 0, tg = this.$('tTgOn').checked ? +this.$('tTg').value : 0;
    return sl > 0 && tg > 0 ? { slPct: sl, tgtPct: tg } : null;
  }
  closeTicket() { this.ticket = null; this.$('ticket').hidden = true; }
  renderTicket() {
    const t = this.ticket; if (!t) return;
    const app = this.app, lots = Math.max(1, parseInt(this.$('tLots').value) || 1), ltp = app.mkt.ready ? app.mkt.ltp(t.type, t.K) : 0, live = app.mkt.live(t.type, t.K) != null;
    const lim = this.ticketLimit(), px = lim && !app.limitHit(t.type, t.K, t.side, lim) ? lim : ltp;   // pending limit: hisaab limit price se; turant fill = LTP
    this.$('tHead').className = 'mhead ' + (t.side === 'BUY' ? 'buy' : 'sell');
    this.$('tInst').textContent = t.side + ' ' + KP.instName(t.type, t.K);
    this.$('tPxLab').textContent = lim != null ? 'Limit price (LTP ' + f2(ltp) + ')' : 'Price (LTP)';
    this.$('tQty').textContent = lots * app.lot; this.$('tPx').textContent = f2(ltp) + (!live ? ' (model)' : app.mkt.stale(t.type, t.K) ? ' (fair; Kite LTP ' + f2(app.mkt.live(t.type, t.K)) + ' purana)' : ''); this.$('tVal').textContent = rs(px * lots * app.lot);
    const go = this.$('tGo'); go.textContent = 'Fake ' + (t.side === 'BUY' ? 'Buy' : 'Sell') + (lim != null ? ' (Limit)' : ''); go.className = 'btn ' + (t.side === 'BUY' ? 'primary' : 'sell');
    // SL / target: exit order par zaroori nahi
    const exit = app.isExit(t.type, t.K, lots, t.side), q = (t.side === 'BUY' ? 1 : -1) * lots * app.lot, P = this.$('tRiskP');
    this.$('tRisk').hidden = exit;
    const limTxt = lim ? (app.limitHit(t.type, t.K, t.side, lim) ? 'Limit ' + f2(lim) + ' abhi mil raha hai: turant LTP par fill. ' : 'Limit: fill tab hoga jab LTP ' + (t.side === 'BUY' ? '≤ ' : '≥ ') + f2(lim) + ' aaye (aaj 15:30 tak). ') : '';
    if (exit) { P.className = 'mriskp'; P.textContent = limTxt + 'Exit order: SL / target ki zaroorat nahi.'; this.$('tPA').innerHTML = ''; return; }
    const sl = this.$('tSlOn').checked ? +this.$('tSl').value : 0, tg = this.$('tTgOn').checked ? +this.$('tTg').value : 0;
    const sp = RK.legPx(q, px, sl, 'sl'), tp = RK.legPx(q, px, tg, 'tgt'), parts = [];
    if (sp != null) parts.push('SL trigger ' + f2(sp) + ' (' + rsS(q * (sp - px)) + ')');
    if (tp != null) parts.push('Target ' + f2(tp) + ' (' + rsS(q * (tp - px)) + ')');
    if (sp != null && tp != null) { parts.push('R:R 1 : ' + (Math.abs(tp - px) / Math.abs(sp - px)).toFixed(2)); this.$('tRisk').classList.remove('need'); }
    // kaunsa trade hai + intraday warning
    // price action check (sirf warning / ✓, order kabhi block nahi)
    const pa = app.pa, pc = pa ? KP.pa.orderCheck({ type: t.type, side: t.side }, { trend: pa.trend, zones: pa.zones, S: pa.S, tol: pa.tol, recent: app.paRecent || [] }) : null;
    this.$('tPA').innerHTML = pc && (pc.warn.length || pc.ok.length) ? '<b>Price action:</b> ' + pc.warn.map(w => '<span class="w">⚠ ' + esc(w.replace(/^Price action: /, '')) + '</span>').join('') + pc.ok.map(w => '<span class="o">' + esc(w) + '</span>').join('') : '';
    const naked = app.isNakedSell(t.type, t.side), expDay = app.mkt.ready && app.mkt.dte() === 0, warn = [];
    const kind = t.side === 'BUY' ? 'BUY' : naked ? 'Naked SELL' : 'SELL (hedge ke saath)';
    if (t.side === 'SELL' && naked && sl > RK.MAX_SL.short) warn.push('Naked SELL par ' + sl + '% SL intraday ke liye bahut bada hai (loss unlimited ho sakta hai). 25–30% rakho.');
    if (t.side === 'BUY' && sl > RK.MAX_SL.long) warn.push('BUY par ' + sl + '% SL bada hai. Intraday me 20–30% aam hai.');
    if (t.side === 'BUY' && sl > 0 && tg > 0 && tg / sl < 1.5) warn.push('BUY me R:R kam se kam 1 : 1.5–2 rakho (target ≥ ' + Math.round(sl * 1.5) + '%).');
    if (expDay && sl > 25) warn.push('Aaj expiry hai: gamma tez, SL 20% jitna tight rakho.');
    parts.unshift(kind + (expDay ? ' · expiry day' : ''));
    if (P.className !== 'mriskp err' || (sp != null && tp != null)) {
      P.className = 'mriskp' + (warn.length ? ' warn' : '');
      if (warn.length) parts.push('⚠ ' + warn.join(' '));
      P.textContent = limTxt + (sp != null || tp != null ? parts.join(' · ') : 'Stoploss % aur Target % dono zaroori (premium ka %). ' + (t.side === 'SELL' ? 'SELL: SL upar, target neeche.' : 'BUY: SL neeche, target upar.'));
    }
  }

  /* ---------- alerts ---------- */
  beep(lv) {
    if (!this.app.S.coach.rules.sound) return;
    try { const ac = this.actx = this.actx || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.frequency.value = [520, 620, 820, 980][lv]; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22 * Math.max(1, lv)); o.start(t); o.stop(t + 0.22 * Math.max(1, lv) + 0.05); } catch (e) {}
  }
  card(lv, title, sub, why, kind, exitBtn) {
    const box = this.$('alerts'), el = document.createElement('div'); el.className = 'alertc lvl' + lv; el.setAttribute('role', 'alert');
    el.innerHTML = '<b>' + esc(title) + '</b><div class="mut">' + esc(sub) + '</div>' + (why.length ? '<ul>' + why.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '') +
      '<div class="acts"><button class="btn primary" data-a="what">Kya karu?</button>' + (typeof exitBtn === 'string' ? '<button class="btn sell" data-a="exitleg">Ye leg exit karo</button>' : exitBtn ? '<button class="btn sell" data-a="exit">Exit all</button>' : '') + '<button class="btn" data-a="x">Theek hai</button></div>';
    el.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'what') this.showOptions(kind); if (b.dataset.a === 'exit') this.app.exitAll(); if (b.dataset.a === 'exitleg') this.app.exitLeg(exitBtn); el.remove(); });
    box.prepend(el); while (box.children.length > 3) box.lastChild.remove();
    if (lv <= 1) setTimeout(() => el.remove(), 15000);
    this.beep(lv);
    return el;
  }
  showAlert(a) { this.card(a.lv, C.LVI[a.lv] + ' ' + a.title, time(a.at) + ', ' + f2(a.spot), a.why, 'alert'); }
  showNudge(kind, text) { this.card(1, text, time(this.app.mkt.now()), [], kind); }
  toast(m) { const t = this.$('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(this.tT); this.tT = setTimeout(() => t.classList.remove('on'), 3200); }

  /* ---------- AI coach ---------- */
  ask(q) {
    q = (q || '').trim(); if (!q) return;
    if (this.ai && !this.ai.hasKey) { this.app.aiErr = this.ai.provider === 'claude' ? 'Pehle Settings → "AI coach" me apni Claude (Anthropic) key daalo, ya provider Gemini (free) chuno.' : 'Pehle Settings → "AI coach" me apni Gemini API key daalo (aistudio.google.com se free).'; this.openTab('coach'); this.renderAI(); return; }
    if (this.app.S.ui.tab !== 'coach') this.openTab('coach');
    this.app.askAI(q).then(() => this.loadAI());
    this.$('aiBox').scrollIntoView({ block: 'nearest' });
  }
  restoreAIQ(q) { const el = this.$('aiQ'); if (!el.value) el.value = q; }
  renderAI() {
    const app = this.app, H = app.aiChat || [], chat = this.$('aiChat'), u = app.aiUsed || this.ai;
    chat.innerHTML = H.map(m => '<div class="msg ' + (m.role === 'user' ? 'u' : 'a') + '">' + (m.role === 'user' ? esc(m.content) : md(m.content)) + '</div>').join('') +
      (app.aiBusy ? '<div class="msg a busy">' + (this.ai && this.ai.provider === 'claude' ? 'Claude' : 'Gemini') + ' soch raha hai…</div>' : '') + (app.aiErr ? '<div class="msg err">' + esc(app.aiErr) + '</div>' : '');
    chat.hidden = !chat.innerHTML; chat.scrollTop = chat.scrollHeight;
    this.$('aiGo').disabled = !!app.aiBusy;
    this.$('aiUse').textContent = u && u.limit ? '· aaj ' + (u.used || 0) + '/' + u.limit : '';
    const pn = this.ai ? (this.ai.provider === 'claude' ? 'Claude' : 'Gemini') : 'AI';
    this.$('aiProvLab').textContent = this.ai ? '(' + pn + (this.ai.provider !== 'claude' && this.ai.model ? ' · ' + this.ai.model : '') + ')' : '';
    this.$('aiNote').textContent = this.ai && !this.ai.hasKey ? 'AI coach ke liye Settings → "AI coach" me key daalo. Gemini key aistudio.google.com se free milti hai.'
      : pn + ' ko abhi ka poora context (signals, tumhara choice, positions, SL/target, alerts) apne aap jaata hai. Rule-based score nahi badalta; AI sirf samjhata hai. Seekhne ke liye, trading advice nahi.';
  }
  showAIProv() { const p = this.$('aiProv').value; this.root.querySelectorAll('[data-aip]').forEach(el => { el.hidden = el.dataset.aip !== p; }); }
  fillAIModels(names, sel) {
    const s = this.$('aiGModel'), list = (names || []).filter(n => /^gemini/i.test(n));
    s.innerHTML = '<option value="">Auto (latest Flash)</option>' + list.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
    s.value = list.includes(sel) ? sel : '';
  }
  async saveAI(remove) {
    const prov = this.$('aiProv').value, p = { provider: prov, geminiModel: this.$('aiGModel').value };
    if (remove) { if (prov === 'claude') p.claudeKey = ''; else p.geminiKey = ''; }
    else { const g = this.$('aiGKey').value.trim(), c = this.$('aiKey').value.trim(); if (g) p.geminiKey = g; if (c) p.claudeKey = c; }
    try {
      const r = await chrome.runtime.sendMessage({ type: 'kp-ai-cfg', p });
      if (r && r.ok) { this.$('aiGKey').value = ''; this.$('aiKey').value = ''; this.toast(remove ? 'Key hata di.' : 'AI settings save ✓ (' + (prov === 'claude' ? 'Claude' : 'Gemini') + ')'); }
      else this.toast('Save nahi hua: ' + (r && r.error || 'unknown'));
      await this.loadAI(); return r && r.ok;
    } catch (e) { this.toast('Save nahi hua: ' + e.message); return false; }
  }
  async checkAI() {
    if ((this.$('aiGKey').value.trim() || this.$('aiKey').value.trim()) && !await this.saveAI()) return;
    this.$('aiKeyInfo').textContent = 'Check ho raha hai…';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'kp-ai-check' });
      await this.loadAI();
      if (r && r.models) this.fillAIModels(r.models, this.ai && this.ai.geminiModel);
      this.$('aiKeyInfo').textContent = r && r.ok ? r.msg : '✗ ' + (r && r.error || 'check nahi hua');
    } catch (e) { this.$('aiKeyInfo').textContent = '✗ ' + e.message; }
  }
  /* ---------- Kite Connect ---------- */
  async loadKC() {
    let s = null; try { s = await chrome.runtime.sendMessage({ type: 'kp-kc-status' }); } catch (e) {}
    this.kc = s;
    this.$('yBack').checked = !!this.app.S.cfg.yahooBackup;
    if (!s) return;
    this.$('kcKey').placeholder = s.hasKey ? '✓ saved (' + s.key + ')' : 'developer.kite.trade → My apps';
    this.$('kcSecret').placeholder = s.hasSecret ? '✓ saved' : 'kisi ko mat bhejna';
    const src = this.app.intraSrc, err = this.app.intraErr;
    this.$('kcInfo').textContent = (s.loggedIn ? '✓ Login: ' + s.user + ' (aaj ke liye)' : s.expired ? '✗ Login expire ho gaya: dobara "Kite se login karo"' : s.hasKey && s.hasSecret ? 'Key saved, login baaki' : 'Set nahi hai')
      + (s.lastError ? ' · ' + s.lastError : '') + (src ? ' · candles: ' + (src === 'kite' ? 'Kite Connect ✓' : 'Yahoo backup') : err ? ' · candles error: ' + err : '');
  }
  async saveKC() {
    const p = {}, k = this.$('kcKey').value.trim(), sct = this.$('kcSecret').value.trim();
    if (k) p.apiKey = k; if (sct) p.apiSecret = sct;
    if (!k && !sct) { await this.loadKC(); return !!(this.kc && this.kc.hasKey && this.kc.hasSecret); }
    try { const r = await chrome.runtime.sendMessage({ type: 'kp-kc-cfg', p }); if (!r || !r.ok) { this.toast('Save nahi hua: ' + (r && r.error)); return false; } this.$('kcKey').value = ''; this.$('kcSecret').value = ''; this.toast('Kite Connect key save ✓'); await this.loadKC(); return r.s.hasKey && r.s.hasSecret; }
    catch (e) { this.toast('Save nahi hua: ' + e.message); return false; }
  }
  /* login ka result: badi patti (khud band karne tak). r = {ok, user, error} ya {wait:true} */
  showKCResult(r) {
    const bar = this.$('kcBar'), t = this.$('kcBarTxt');
    bar.className = 'kcbar ' + (r.wait ? 'wait' : r.ok ? 'ok' : 'bad'); bar.hidden = false;
    t.textContent = r.wait ? '⏳ Kite login tab khula hai: wahan login karo. Login ke baad wo tab apne aap band hoga aur yahan result aayega.'
      : r.ok ? '✅ Kite Connect login ho gaya' + (r.user ? ': ' + r.user : '') + '. Opening range / open / kal ka close ab Kite ki candles se aayenge (token kal subah ~6 baje tak).'
      : '❌ Kite Connect login fail: ' + (r.error || 'pata nahi') + '. Settings → Kite Connect me key / secret aur developer console ka Redirect URL check karo.';
    clearTimeout(this.kcBarT); if (r.ok) this.kcBarT = setTimeout(() => { bar.hidden = true; }, 20000);
  }
  /* message miss ho jaaye to bhi: status badalte hi patti */
  kcPoll() {
    let n = 0; const start = Date.now();                            // is login attempt ke baad ka result hi (background ne purana error saaf kiya)
    clearInterval(this.kcT);
    this.kcT = setInterval(async () => {
      await this.loadKC(); const s = this.kc || {};
      if (s.loggedIn && s.loginAt >= start) { clearInterval(this.kcT); this.showKCResult({ ok: true, user: s.user }); this.app.syncIntraday(true); }
      else if (s.lastError) { clearInterval(this.kcT); this.showKCResult({ ok: false, error: s.lastError }); }
      else if (++n > 100) { clearInterval(this.kcT); this.showKCResult({ ok: false, error: '5 min me login complete nahi hua (tab band kar diya ya redirect URL galat?)' }); }
    }, 3000);
  }
  async loadAI() {
    try { const s = await chrome.runtime.sendMessage({ type: 'kp-ai-status' }); if (s && !s.error) this.ai = s; } catch (e) {}
    const s = this.ai;
    if (s) {
      if (this.root.activeElement !== this.$('aiProv')) { this.$('aiProv').value = s.provider; this.showAIProv(); }
      if (this.root.activeElement !== this.$('aiGModel')) this.fillAIModels(s.geminiModels, s.geminiModel);
      this.$('aiGKey').placeholder = s.geminiMasked ? '✓ saved (' + s.geminiMasked + ')' : 'AIza...';
      this.$('aiKey').placeholder = s.claudeMasked ? '✓ saved (' + s.claudeMasked + ')' : 'sk-ant-...';
    }
    this.$('aiKeyInfo').textContent = s ? (s.hasKey ? '✓ ' + (s.provider === 'claude' ? 'Claude' : 'Gemini') + ' key: ' + s.masked + ' · model: ' + s.model + ' · aaj ' + s.used + '/' + s.limit + ' sawaal' : (s.provider === 'claude' ? 'Claude' : 'Gemini') + ' key nahi hai') : '';
    if (s) this.app.aiUsed = { used: s.used, limit: s.limit };
    this.renderAI();
  }
  async saveKey(k) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'kp-ai-key', key: k });
      if (r && r.ok) { this.$('aiKey').value = ''; this.toast(k ? 'API key save ho gayi ✓' : 'API key hata di.'); } else this.toast('Key save nahi hui: ' + (r && r.error || 'unknown'));
    } catch (e) { this.toast('Key save nahi hui: ' + e.message); }
    this.loadAI();
  }

  /* ---------- sync + debug ---------- */
  async loadSync() {
    try { const s = await chrome.runtime.sendMessage({ type: 'kp-sync-get' }); if (!s) return;
      this.$('sUrl').value = s.url || ''; this.$('sKey').value = s.anonKey || ''; this.$('sCode').value = s.classCode || ''; this.$('sName').value = s.name || '';
      this.$('syncInfo').textContent = s.studentId ? 'Joined ✓ · queue ' + (s.queued || 0) + (s.lastError ? ' · ' + s.lastError : '') : 'Join nahi kiya';
    } catch (e) {}
  }
  async join() {
    const p = { url: this.$('sUrl').value.trim().replace(/\/+$/, ''), anonKey: this.$('sKey').value.trim(), classCode: this.$('sCode').value.trim().toUpperCase(), name: this.$('sName').value.trim() };
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(p.url) || !p.anonKey || !p.classCode || !p.name) { this.toast('URL, key, class code aur naam sab bharo.'); return; }
    this.$('syncInfo').textContent = 'Join ho raha hai…';
    try { const r = await chrome.runtime.sendMessage({ type: 'kp-join', p }); this.toast(r && r.ok ? 'Class join ho gayi ✓' : 'Join fail: ' + (r && r.error || 'unknown')); } catch (e) { this.toast('Join fail: ' + e.message); }
    this.loadSync();
  }
  async copyReport() {
    let rep; try { rep = KP.kite.debugReport(Date.now(), this.app.mkt); } catch (e) { rep = 'REPORT ERROR: ' + e.message; }
    try { await navigator.clipboard.writeText(rep); this.$('dbgInfo').textContent = 'Report copy ho gaya (' + rep.split('\n').length + ' lines). Ab chat me paste karo.'; }
    catch (e) { this.$('dbgInfo').textContent = rep; }
  }
  async copySnapshot() {
    const s = KP.kite.snapshotHTML();
    if (!s) { this.$('dbgInfo').textContent = 'Is page par "Strike" + "LTP" wala koi element nahi mila. Kite option chain kholo.'; return; }
    try { await navigator.clipboard.writeText(s.html); this.$('dbgInfo').textContent = 'Copied ' + Math.round(s.html.length / 1024) + ' KB (' + (s.found ? 'chain detect hua' : 'chain detect NAHI hua') + '). Ab ise ek .html file me paste karke bhejo.'; }
    catch (e) { this.$('dbgInfo').textContent = 'Clipboard blocked: ' + e.message; }
  }
}
KP.Panel = Panel;
})();
