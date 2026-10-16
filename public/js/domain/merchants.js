// "Learn my categories": when the user sets the category of a bank-feed expense, remember it for
// that shop's bank text and apply it to earlier and future entries from the same shop.
//
// S.merchantRules = [{ key, cat, label }]  key = normalizeKey(bank text)
// Bank-feed expenses keep the original bank text in `bankText` (the note may be edited later);
// `catManual: true` marks a category the user chose by hand and that rules must never overwrite.
// The same normalizeKey lives in server/merchants.js (the server applies rules to new alerts);
// a test keeps the two identical.

// Shop identity: lower-case letters only, digit runs dropped (branch / terminal numbers vary),
// e.g. "ADNOC AL DANA 966 ABUDHABI AE" and "...973..." are the same shop.
export function normalizeKey(text) {
  return String(text || '').toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export const bankTextOf = e => e.bankText || e.note || '';

export function findRule(rules, text) {
  const key = normalizeKey(text);
  return key ? (rules || []).find(r => r.key === key) || null : null;
}

// Remember (or update) a rule. Returns the rule.
export function setRule(S, text, cat) {
  const key = normalizeKey(text);
  if (!key) return null;
  S.merchantRules = S.merchantRules || [];
  let r = S.merchantRules.find(x => x.key === key);
  if (!r) { r = { key, cat, label: String(text).replace(/\s+/g, ' ').trim().slice(0, 40) }; S.merchantRules.push(r); }
  else r.cat = cat;
  return r;
}

// Apply a rule to earlier bank-feed expenses from the same shop. Skips ones the user set by hand.
// Returns the entries that changed.
export function applyRule(S, rule) {
  const changed = [];
  for (const e of S.expenses || []) {
    if (e.source !== 'n8n' || e.catManual || e.payMethod === 'cc_payment') continue;
    if (normalizeKey(bankTextOf(e)) !== rule.key || e.cat === rule.cat) continue;
    e.cat = rule.cat;
    changed.push(e);
  }
  return changed;
}

// Category of a rule that matches this bank text, else null
export function ruleCategory(rules, text) {
  const r = findRule(rules, text);
  return r ? r.cat : null;
}
