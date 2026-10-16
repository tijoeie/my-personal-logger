// n8n Code node ("Run once for each item"): reads the text of Federal Bank's monthly
// CONSOLIDATED STATEMENT and returns the balance of each operative account.
//
//   in : $json.text   (output of "Extract From File" > PDF)
//   out: { parsed, asOf, accounts: [{ last4, branch, balance }], savingsTotal, checkOk, error? }
//
// The layout is two pages and always the same:
//   "SUMMARY OF OPERATIVE ACCOUNTS AS ON 30-09-2026 ... XX4872 CHANGANASSERY MAIN HOLDER ACTIVE SG 11,395.01 REGISTERED ..."
// PDF text extractors differ in spacing and line breaks, so rows are found by their `XX1234` account
// token and the first amount after it, not by columns. As a safety check the operative balances must add
// up to the "Savings" figure in the overview; if they don't, `checkOk` is false and the alert says so.
const text = String($input.item.json.text || '').replace(/ /g, ' ');
const flat = text.replace(/\s+/g, ' ').trim();
const num = s => Number(String(s).replace(/,/g, ''));
const AMOUNT = /^\d[\d,]*\.\d{2}$/;

function fail(error) { return { json: { parsed: false, error, preview: flat.slice(0, 200) } }; }

const dm = flat.match(/OPERATIVE ACCOUNTS AS ON (\d{2})-(\d{2})-(\d{4})/i);
if (!dm) return fail('operative accounts section not found');
const asOf = `${dm[3]}-${dm[2]}-${dm[1]}`;

// the section runs until the disclaimer
const start = flat.search(/OPERATIVE ACCOUNTS AS ON/i);
let section = flat.slice(start);
const end = section.search(/Disclaimer/i);
if (end > 0) section = section.slice(0, end);

const accounts = [];
const re = /X{2,}(\d{4})\b/g;
const hits = [...section.matchAll(re)];
hits.forEach((m, i) => {
  const chunk = section.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : section.length);
  const tokens = chunk.split(' ').filter(Boolean);
  const amountIdx = tokens.findIndex(t => AMOUNT.test(t));
  if (amountIdx < 0) return;
  // branch = words before the relationship column (MAIN HOLDER / JOINT ...)
  const rel = tokens.findIndex(t => /^(MAIN|JOINT|FIRST|SECOND|THIRD)$/i.test(t));
  const branch = tokens.slice(0, rel > 0 ? rel : Math.min(amountIdx, 3)).join(' ');
  accounts.push({ last4: m[1], branch, balance: num(tokens[amountIdx]) });
});
if (!accounts.length) return fail('no accounts found in the operative accounts section');

// cross-check with the overview's Savings figure
const sm = flat.match(/Savings\s+([\d,]+\.\d{2}|0)\b/);
const savingsTotal = sm ? num(sm[1]) : null;
const sum = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
const checkOk = savingsTotal === null ? true : Math.abs(sum - savingsTotal) < 0.02;

return { json: { parsed: true, asOf, accounts, savingsTotal, operativeTotal: sum, checkOk } };
