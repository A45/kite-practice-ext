/* Kite web DOM ke saare assumptions SIRF yahan. Kite ka UI badle to bas ye file update karo.
   P0 spike (Settings → "Kite chain DOM copy karo") ke baad inhe confirm/tighten karna hai. */
(function () {
'use strict';
const KP = globalThis.KP = globalThis.KP || {};
KP.SEL = {
  // option chain container ke candidates, pehla jisme parse-able table mile wahi use hoga
  chainRoots: ['[class*="option-chain"]', '[class*="optionchain"]', '[class*="OptionChain"]', '[class*="chain"]', 'body'],
  table: 'table',
  headerRows: 'thead tr',
  bodyRows: 'tbody tr',
  // header text se column pehchan (case-insensitive)
  strikeHeader: /^\s*strike/i,
  ltpHeader: /^\s*(?:call|put|ce|pe)?\s*(ltp|last|price|premium)\b/i,     // Kite 2026: "Call LTP" / "Put LTP"
  ivHeader: /^\s*iv\b/i,
  oiHeader: /^\s*(?:call|put|ce|pe)?\s*oi\b(?!\s*(?:chg|change))/i,       // "OI (in lakhs)"
  // expiry: in elements ka text pehle dekha jaata hai, phir chain root ka shuru ka text
  // pehle "chuna hua" tab (Kite 2026 me expiry tabs: 6 Oct / 13 Oct / ...), phir purane guesses
  expiryNodes: ['[role="tab"][aria-selected="true"]', '[aria-pressed="true"]', '[aria-current="true"]', '[class*="expiry"] [class*="selected"]', '[class*="expiry"] [class*="active"]',
    '[class*="selected"]', '[class*="active"]', '[class*="expiry"] select', '[class*="expiry"]', 'select'],
  // underlying spot (optional; na mile to parity forward use hota hai)
  spotNodes: ['[class*="underlying"] [class*="last-price"]', '[class*="underlying"] [class*="price"]', '[class*="spot"]'],
  // spot ke aas-paas ka change text, jaise "+45.10 (0.18%)" → kal ka close = spot − change (UNVERIFIED, P0)
  changeText: /([+\-−]?\d[\d,]*\.\d+)\s*\(\s*([+\-−]?\d+(?:\.\d+)?)\s*%\s*\)/,
  // marketwatch me "INDIA VIX" ka label (student ko add karna hoga), uske paas ka number (UNVERIFIED, P0)
  vixLabel: /^\s*INDIA\s*VIX\s*$/i,
};
})();
