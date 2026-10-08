# Kite Practice (Paper) 

Chrome extension jo **kite.zerodha.com** ke upar paper trading karwata hai: prices live Kite option chain se aate hain, lekin har order **FAKE** hota hai. Iske saath ek Adjustment Coach hai (🟡 Watch / 🟠 Adjust / 🔴 Danger alerts, "Kya karu?" options with score, original-vs-tumhara P&L) aur ek teacher dashboard.

**Safety rules (code me enforced):**
- Extension kabhi Kite par asli order nahi lagata, aur Kite ke Buy/Sell buttons ko touch nahi karta.
- Fake B/S buttons ke clicks wahin rok diye jaate hain, Kite ke row click handler tak nahi pahunchte.
- Kite ka login, cookies, token ya asli positions kabhi padhe ya bheje nahi jaate. Sirf screen par dikhne wali option chain ke numbers padhe jaate hain.
- Teacher ko sirf fake trades, alerts aur paper P&L jaata hai.

> Ye Zerodha ka official tool nahi hai. Kite ka DOM padhna unka unofficial use hai, isliye ise sirf private/classroom me "Load unpacked" se chalao, Chrome Web Store par publish mat karo.

## Folder
| Path | Kya hai |
|---|---|
| `extension/` | Chrome extension (Manifest V3) |
| `extension/engine/` | Black-Scholes, paper book, payoff/POP/margin, coach, adjustment options (artifact se port) |
| `extension/kite/selectors.js` | Kite DOM ke saare assumptions ek jagah |
| `dashboard/index.html` | Teacher dashboard (static page) |
| `supabase/schema.sql` | Tables + RLS + 2 RPC (`join_class`, `push_events`) |
| `tests/` | `engine.test.js` (Node), `harness.html` (nakli Kite chain par poora extension) |

## 1. Extension install (har student)
1. Chrome → `chrome://extensions` → **Developer mode** ON.
2. **Load unpacked** → `extension` folder chuno.
3. Kite web kholo → Marketwatch me NIFTY → **More → Option chain**. Right side me "Kite Practice PAPER" panel aayega.
4. Market band ho to Settings tab → Feed = **Demo** se practice karo (▲/▼ Push, IV ± buttons se alerts trigger hote hain).

## 2. Pehli baar: Kite chain detect check (P0)
Kite ka asli DOM abhi verify nahi hua hai. Reader header text se columns pehchanta hai (`Strike`, `LTP`, `IV`), kisi fixed class par nahi.
- Panel ke header me **"Kite live"** (green) dikhe aur Chain tab me strikes aa jaayein → kaam kar raha hai.
- Agar "Option chain kholo" hi dikhta rahe: Settings → **"Kite chain DOM copy karo"** → ek `.html` file me paste karke developer ko bhejo. Usse `kite/selectors.js` update hoga.
- Expiry ke aage "(guess)" dikhe to Settings me **Expiry override** bhar do.

## Subah ka plan + SL / target (v0.2)
Panel ka pehla tab **"Aaj ka plan"** hai. Ye student ko subah ka decision sikhata hai: kaunsi strategy lagani hai, kab lagani hai, ya aaj trade karna hi hai ya nahi.

| Time (IST) | Phase | Rule |
|---|---|---|
| 9:15 se pehle | Pre-open | Gap, VIX aur event check karo |
| 9:15–9:30 | Observe | **Naya order band (hard block).** Sirf exit allowed |
| 9:30–10:00 | Assess | Entry par confirm warning aata hai, log me "early entry" likha jaata hai, score bhi kam hota hai |
| 10:00–11:30 | Decide | Normal entry window |
| 11:30 ke baad | Late | Score kam hota hai, "No trade" ko upar rakha jaata hai |

**Signals** extension khud banata hai:
- Har tick se 1-min candles.
- Opening range (9:15–9:30 ka high/low), aur OR ratio = OR ÷ ek din ka expected move (spot × IV ÷ √365).
- Gap %.
- OR breakout (2 × 5-min candle close).
- ATM IV change, VIX, DTE aur event flag.

Kuch na mile to "Data missing ho to khud bharo" me bharo: kal ka close, OR high/low, VIX ya event day.

**Flow:**
1. Student khud 8 me se ek strategy chunta hai: IC, Bull Put, Bear Call, Bull Call, Bear Put, Long Straddle, Wait, No trade. Saath me apna day type ("Kyun?") batata hai, phir lock karta hai.
2. Lock ke **baad** hi coach ke score (0–100) aur har strategy ka "kyun" dikhta hai. Har card par max P/L, BE, POP, SL/target, Risk:Reward aur zaroori win-rate hota hai.
3. Kisi bhi card par "Place fake" se strategy lagti hai, hedge pehle.
4. 15:30 ke baad review hota hai: din actually kaisa raha (range / trend / volatile / mixed), aur student ka choice sahi tha ya nahi. Ye Journal me save hota hai.

**SL / target** sirf alert dete hain, auto exit nahi hota. Student khud exit karta hai aur uska reaction time record hota hai.

| Trade type | SL | Target |
|---|---|---|
| Credit trade | 1.5× credit | 0.5× credit |
| Debit trade | 0.5× debit | 1× debit |

Ye defaults Settings me badal sakte ho. Trade ke beech SL ko door khiskaya to wo report card me note hota hai.

**Chain tab:**
- Columns: Call B/S · OI · IV · Δ · LTP | Strike | LTP · Δ · IV · OI · Put B/S. Normal size me Δ chhupa rehta hai (⤢ wide / full me dikhta hai).
- OI aur OI change % Kite ki chain se (lakh me), sabse zyada OI **bold**. Demo feed me OI nakli andaza hai.
- IV: Kite ka IV column ho to wahi, warna us option ke LTP se nikala (Black-Scholes).
- LTP ke neeche kitna hila:
  - pehli line kal ke close se, jaise "+31.10 (+30.8%)" (hara = badha, laal = gira). Kite chain ke change % se nikalta hai.
  - doosri line "Open se −4.65" aaj ke open se. Ye 9:15 ke baad extension ki pehli dekhi price hai; panel der se khula ho to "Subah se" likhta hai.
  - cell par mouse le jao to poore number dikhte hain.
- Har LTP ke neeche ITM / ATM / OTM, Kite jaisa ITM hissa peela. ATM = spot ke sabse paas wali strike.
- Har strike ke OI ke neeche **buildup** (LTP change % + OI change % se):
  🟢 Long buildup (price⬆ OI⬆, naye buyers) · 🔴 Short buildup (price⬇ OI⬆, naye sellers) · 🔵 Short covering (price⬆ OI⬇, sellers bhaag rahe) · ⚪ Long unwinding (price⬇ OI⬇, buyers nikal rahe).
  **Top 3 highlight:** Long buildup, Short buildup aur Short covering, teeno me sabse bade 3-3 strikes (CE + PE milake, kitne lakh contracts jude / ghate ke hisaab se) rangeen box me, #1 par 🔥. Chain ke upar summary patti (click = us strike par scroll) + "👉 Resistance / Support" ishara.
  Change % Kite ki chain se (kal ke close se). Na mile to aaj 9:15 ke baad pehli dikhi value se. Dono me se koi 1% se kam hila to label nahi (saaf signal nahi). Cell par mouse le jao to % aur matlab dikhta hai.

**Price action** (NIFTY spot ki 5-min candles, 9:15 ke baad record; Kite live ya Demo din):
- **Card** ("Aaj ka plan" me poora, Chain tab me chhota):
  - Trend: 📈 Uptrend (HH-HL) / 📉 Downtrend (LH-LL) / ↔ Range. Swing kam hon to opening range se (kamzor).
  - Level ladder: upar resistance (laal), Spot, neeche support (hara). Levels = kal ka High/Low/Close, OR high/low, aaj ka High/Low, round numbers, OI (CE/PE short buildup ya max OI). Paas-paas ke levels ek zone; ⭐ = confluence (sabse majboot).
  - Kal ka High/Low: Kite Connect se, warna kal ka din record hua ho to usse, warna "Data missing ho to khud bharo" me daalo.
- **Alerts** (har 5-min candle close par, level ke paas hi): 🚀 Breakout / 🔻 Breakdown, ✅ retest hold, 🪤 Fakeout, 🕯️ Rejection (pin bar), 🟩/🟥 Engulfing, ⏸️ Inside bar. OI saath ho to "✓ Asli breakout: sellers bhaag rahe", ulta ho to "⚠ fakeout ho sakta hai". Ek hi pattern same level par 15 min me dobara nahi. Settings → "Price action alerts" se band.
- **Order popup:** trend ke khilaaf order (uptrend me CE sell, downtrend me CE buy…), ya resistance/support ke bilkul paas buy par ⚠ warning; sahi setup par ✓. Order kabhi block nahi hota.

**OI shift alerts** (seller ke liye): Resistance = sabse bada CE 🔴 short buildup strike, Support = sabse bada PE 🔴. Ye badle to card aata hai.

Kab aata hai:
- Har 5-min candle close par, 9:30 ke baad.
- Naya level 2 baar lagatar wahi rahe tabhi.
- Naye #1 ka OI badlaav purane se kam se kam 1.2× ho.
- Ek hi baat 30 min me ek baar.

| Alert | Matlab |
|---|---|
| Resistance upar / neeche | CE writers peeche hate (bullish) / neeche aa kar bech rahe (bearish) |
| Support upar / neeche | Floor upar utha (bullish) / neeche khisak gaya (bearish) |
| 🔵 Resistance / Support par short covering | Breakout / breakdown ka khatra (tez alert) |
| 🔵 ATM ke paas naya short covering (Top 3) | Us taraf move ka fuel |
| Range chhoti / badi | Dono taraf ke writers paas aaye (strangle ke liye achha) / door gaye (volatility) |

Card do tarah ka hota hai:
- **📊 Position card:** jab short leg khuli ho. Batata hai ki us leg ka kya karo: hold, exit ya roll, SL cost par, hedge (2 strike door BUY), ya aadha book. Saath me hamesha "✗ SL door mat karo, average mat karo".
- **ℹ️ Info card (neela):** jab koi position na ho. Batata hai naya trade lena ho to kaunsi side ya strike ✓, kya ✗, ya ⏳ ruko.

Card ki baaki baatein:
- Trend (price action) shift ke saath ho to "Strong", ulta ho to "Mixed, ek candle ruko".
- Expiry din 2 baje ke baad card "exit ko prefer karo" kehta hai.
- Paas = strike spot se 1 EM ke andar.

Settings:
- "OI shift alerts" se saare OI shift alerts band.
- "Position nahi ho tab bhi OI alerts dikhao" band karne par sirf position wale card aate hain.

Ye sirf salah hai, extension khud exit nahi karta.

**Market / Limit order** (order popup, Premium value ke neeche):
- Market = abhi ke LTP par fill.
- Limit = apni price. SELL tab fill hota hai jab LTP ≥ limit, BUY jab LTP ≤ limit, aur fill limit price par. Tab tak Positions tab ke "Open orders" me dikhta hai (Cancel button). Limit abhi hi mil rahi ho to turant LTP par fill. 15:30 (din khatam) par bacha hua order cancel.
- SL / target % limit order par bhi zaroori; fill hone par avg (limit) se trigger banta hai.

**Har leg ka SL / target** (Kite jaisa ☐ Stoploss [ ] % · ☐ Target [ ] %, avg premium ka %):
- **Order popup (B/S) me dono zaroori.** Stoploss % aur Target % tick karke na bharo to order punch nahi hota. Popup me SL trigger price, ₹ risk/reward aur R:R dikhta hai. Exit order (position kam karna) par zaroorat nahi.
- SELL leg: SL = avg × (1 + SL%) (LTP **upar** gaya), target = avg × (1 − T%). BUY leg: SL = avg × (1 − SL%), target = avg × (1 + T%).
- Order ke baad **Positions tab** me wahi box: % badlo ya tick hatao (= band). Tick lagao to Settings ka default % aata hai. Lots jodne par % wahi rehta hai, trigger naye avg se.
- **Intraday defaults** (popup me pehle se bhare, badal sakte ho; IC / "Aaj ka plan" legs ko bhi yahi):
  - Naked SELL: SL 30%, target 40%. BUY: SL 25%, target 50% (R:R 1:2).
  - Expiry day: SL 20% (SELL aur BUY dono).
  - Settings → "SL / target rules" me badlo.
- Popup batata hai trade "Naked SELL" hai, "SELL (hedge ke saath)" ya "BUY". Warning (order phir bhi lagta hai): naked SELL ya BUY par SL > 40%, BUY me R:R 1:1.5 se kam, expiry day par SL > 25%.
- **Hit hote hi wo leg khud exit** hoti hai (fake market order, us waqt ke LTP par), jaise broker par SL-M / target order execute hota hai. Baaki legs khuli rehti hain.
- Settings → "Leg ka SL / target hit ho to wo leg khud exit" tick hatao to sirf alert aata hai (alert me "Ye leg exit karo" button, reaction time record).
- Short ka SL upar / long ka neeche khiskana = "SL door khiskaya".
- Poori position ka SL/target (₹) pehle jaisa sirf alert hai.

**Demo din** (Settings → Demo mode):
- Nakli din 9:10 se shuru hota hai. 60× speed par 1 sec = 1 min, matlab poora din ~6 min.
- Din ka mizaaj: range, trend up, trend down, volatile, ya "secret" (random). Secret wala review ke baad hi pata chalta hai.
- Market band ho tab bhi poori subah ki practice ho sakti hai.

> Kite page se **kal ka close** ("+45.10 (0.18%)" jaisa text) aur **INDIA VIX** (marketwatch me add karo) padhne ka code best-effort hai. Ye asli Kite par abhi verify nahi hua hai (P0). Na mile to manual entry use karo.

## Kite Connect API (optional, official)
Isse opening range (9:15–9:30), aaj ka open aur kal ka close Kite ki official 1-min candles se aate hain, chahe panel 9:15 ke baad khola ho. Iske bina ye data tabhi milta hai jab panel 9:15 se khula ho (live ticks se), ya khud bharo.

1. developer.kite.trade → My apps → apni app → **Redirect URL** = `http://127.0.0.1/kp-kite-callback`. Plan me market / historical data hona chahiye.
2. Panel → Settings → **Kite Connect API**: API key aur API secret daalo → **Save** → **Kite se login karo**.
3. Kite ke official login page par login karo. Uske baad ek tab "connect nahi hua" dikhayega aur apne aap band ho jaayega; ye normal hai.
4. Token roz subah ~6 baje expire hota hai, isliye roz ek baar login karna hoga.

API key, secret aur token sirf extension ke background me rehte hain. Kite web ka session ya cookie kabhi nahi padha jaata. Kal ka close Kite page ke header se bhi padha jaata hai.

## AI coach: "Coach se poocho" (v0.4: Gemini free ya Claude)
> **v0.4:** Settings → "AI coach" me **AI provider** chuno:
> - **Google Gemini (free tier)**, default. Key aistudio.google.com → Get API key se banti hai. Model apne aap chuna jaata hai (latest stable "Flash"), dropdown se badal bhi sakte ho.
> - **Claude Opus 5.5**, paid.
>
> **"Key check karo"** batata hai ki key chal rahi hai ya nahi, aur kaunsa model chuna gaya. Neeche ka Claude wala text dono providers par lagu hota hai.
Coach tab me ek chat box hai. Student apni situation par sawaal poochta hai aur Claude Hinglish me samjhata hai. Quick buttons bhi hain:
- "Meri position kaisi hai?"
- "Coach ne ye option kyun chuna?"
- "Mera aaj ka choice sahi tha?"
- SL / target par sawaal
- Signals ka matlab

Plan tab me lock ke baad **"🤖 Claude se samjho"** button bhi hai.

- **Setup:**
  - Har student apni Anthropic API key daalta hai: Settings → "AI coach (Claude)". Key console.anthropic.com → API keys se milti hai.
  - Kharcha usi student ke Anthropic account par jaata hai.
  - Roz max 50 sawaal ki limit hai.
- **Key kahan rehti hai:**
  - Key sirf extension ke background worker ke storage me rehti hai. Kite page ya panel ko wapas nahi milti, panel me sirf masked key dikhti hai.
  - Key teacher ya Supabase ko kabhi nahi jaati.
- **Claude ko kya jaata hai:**
  - market numbers, signals, 8 strategies ke rule scores, student ka pick, fake positions, SL/target plan, alerts aur journal (~4 KB JSON).
  - Kite login, cookie ya account ka koi data nahi jaata.
- **Score nahi badalta:** Rule-based score grading ke liye fixed rehta hai. Claude sirf "kyun" samjhata hai.

## 3. Teacher dashboard setup (ek baar, ~10 min)
1. [supabase.com](https://supabase.com) par free project banao.
2. SQL Editor → `supabase/schema.sql` poora paste → **Run**.
3. Project Settings → API se **Project URL** aur **anon public key** copy karo.
4. `dashboard/index.html` browser me kholo (double-click ya kisi bhi static hosting par) → URL + key save → **Naya account** (email/password) → Login.
5. **Class banao** → 6-letter class code milega.
6. Students ko do: URL, anon key, class code. Wo extension → Settings → "Class join karo".

> **v0.1 se upgrade:** `supabase/schema.sql` SQL Editor me **dobara poora Run karo**. Script re-run safe hai aur naye event types (plan / risk / review) allow kar deti hai. Data nahi mitta.

Dashboard me aaj ka pick (score vs coach), pick kitni baar sahi nikla, SL hits, SL reaction time aur early entries bhi dikhte hain.

Dashboard har 30 sec refresh hota hai: paper P&L, abhi ka alert level, 🟡🟠🔴 count, avg reaction time, ignore kiye alerts, adjustments, coach pick, aur har student ki timeline.

## Tests
```bash
node --test tests/engine.test.js          # 19 tests (engine + AI background module)
```
`tests/harness.html` ek nakli Kite-jaisi chain page hai jo extension ki saari scripts load karta hai (chrome.* stub ke saath). Chrome me `--allow-file-access-from-files` ke saath kholo.

## Known limits (v0.1)
- Sirf ek underlying/expiry series ek waqt (NIFTY tuned; lot size Settings me). Positions jis expiry ki hain, Kite me wahi expiry khuli honi chahiye.
- Fills = LTP (bid/ask spread nahi). Chain me jo strike dikh nahi rahi uska price model se (italic / `*`).
- NSE holidays ka calendar nahi hai; market hours = Mon–Fri 09:15–15:30 IST.
- Expiry settle tab hota hai jab extension khula ho (expiry ke baad Kite kholte hi settle hota hai, last dekhe gaye spot par).
- Scenarios/drills (artifact wale) is version me nahi hain — live market script nahi ho sakta.
