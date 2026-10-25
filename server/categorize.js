// Guess an expense category from the shop name on a bank alert. First matching rule wins,
// so specific rules (Noon Food, Amazon Prime) must sit above general ones (Noon, Amazon).
// Anything unmatched returns null and the entry stays "Other"; the Category button on
// the Expenses tab still overrides any guess. Categories are the app's EXPENSE_CATS.
'use strict';

const RULES = [
  ['Bank charges', /atm withdrawal charges|vat as applicable|bank charge|service charge|annual fee|sms charge/i],
  ['Subscriptions', /netflix|youtube|apple\.com\/bill|anthropic|disney|spotify|amazon prime|icloud|osn\+?|playstation/i],
  ['Fuel', /adnoc|enoc|eppco|emarat/i],
  ['Salik / Parking', /q mobility|salik|mawaqif|parking|\bdarb\b/i],
  ['Telecom / Internet', /etisalat|\be&|\bdu\b|virgin mobile/i],
  ['Groceries', /lulu|spinneys|carrefour|fresh mart|big mart|supermar|baqala|noon minutes|careem quik|fresh mkt|union coop|choithrams|waitrose|grocer/i],
  ['Dining out', /restaurant|restau|\brest\b|cafe|cafeteria|kfc|burger|chicken|\btea\b|samawar|chat res|noon food|careem food|talabat|keeta|smiles food|eat and go|prominent foods|mcdonald|starbucks|pizza|shawarma|bakery|refre|shay|duniyav|two state/i],
  ['Travel', /air arabia|airline|etihad|flydubai|booking\.com|hotel/i],
  ['Car', /taxi|al ghazal transport|dubai insurance|car wash|garage|tyre|service station/i],
  ['Health', /pharm|clinic|hospital|medical|family med|dental/i],
  ['Family / Remittance', /quickremit|al ansari|western union|\bwise\b|remit/i],
  ['Shopping', /noon|amazon|temu|shein|namshi|ikea|printing/i],
];

function categorize(note) {
  const text = String(note || '');
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return null;
}

module.exports = { categorize, RULES };
