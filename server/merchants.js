// Server side of "learn my categories": same key as public/js/domain/merchants.js
// (server/test/merchants.test.mjs checks they never drift apart).
'use strict';

function normalizeKey(text) {
  return String(text || '').toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Category the user taught for this shop's bank text, or null
function ruleCategory(rules, text) {
  const key = normalizeKey(text);
  if (!key) return null;
  const r = (rules || []).find(x => x.key === key);
  return r ? r.cat : null;
}

module.exports = { normalizeKey, ruleCategory };
