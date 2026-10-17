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

// ---- weekly / monthly ACCOUNT STATEMENT (one account, with transactions) ----
// "Statement Period: 10/10/2026 to 16/10/2026 ... Account Number: XXXXX9418 ... Opening Balance OPNBAL 18744.89 CR
//  13/10/2026 13/10/2026 UPIOUT/..../VI- TFR S16315847 179 0 18565.89 CR INAPPKER@ybl/Payment f/4814 ... GRAND TOTAL 478 0"
// Each row ends with `TYPE TRANID withdrawal deposit balance CR|DR`; wrapped particulars may land before or after that tail.
if (!/OPERATIVE ACCOUNTS AS ON/i.test(flat) && /Opening Balance/i.test(flat)) {
  const iso = (d, m, y) => `${y}-${m}-${d}`;
  const pm = flat.match(/Statement Period:?\s*(\d{2})\/(\d{2})\/(\d{4})\s*to\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const am = flat.match(/Account Number:?\s*X*(\d{4})\b/i) || flat.match(/\bX{3,}(\d{4})\b/);
  const om = flat.match(/Opening Balance\s+OPNBAL\s+(-?[\d,]+(?:\.\d+)?)\s*(CR|DR)/i);
  if (!pm || !am || !om) return fail('account statement: period, account number or opening balance not found');
  const bm = flat.match(/Branch Name:?\s*([A-Z][A-Z ]*?)(?=\s+(?:Account|Statement|Savings|Customer|Branch|Swift|MICR)|$)/);
  const opening = num(om[1]) * (om[2].toUpperCase() === 'DR' ? -1 : 1);
  let body = flat.slice(flat.indexOf(om[0]) + om[0].length);
  const gt = body.search(/GRAND TOTAL/i);
  if (gt >= 0) body = body.slice(0, gt);
  const dateRe = /(\d{2})\/(\d{2})\/(\d{4}) \d{2}\/\d{2}\/\d{4} /g;
  const starts = [...body.matchAll(dateRe)];
  const tail = /([A-Z]{2,8}) ([A-Z0-9]{4,}) (-?[\d,]+(?:\.\d+)?) (-?[\d,]+(?:\.\d+)?) (-?[\d,]+(?:\.\d+)?) (CR|DR)\b/;
  const txns = [];
  let running = opening, consistent = true;
  starts.forEach((m, i) => {
    const chunk = body.slice(m.index + m[0].length, i + 1 < starts.length ? starts[i + 1].index : body.length);
    const t = chunk.match(tail);
    if (!t) { consistent = false; return; }
    const w = num(t[3]), d = num(t[4]), bal = num(t[5]) * (t[6] === 'DR' ? -1 : 1);
    const desc = (chunk.slice(0, t.index) + ' ' + chunk.slice(t.index + t[0].length)).replace(/\s+/g, ' ').trim();
    if (Math.abs(running - w + d - bal) > 0.02) consistent = false;
    running = bal;
    txns.push({ id: t[2], date: iso(m[1], m[2], m[3]), kind: d > 0 ? 'in' : 'out', amount: d > 0 ? d : w, note: desc.slice(0, 120), balance: bal });
  });
  const totals = flat.match(/GRAND TOTAL\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)/i);
  let totalsOk = true;
  if (totals) {
    const sw = txns.reduce((x, y) => x + (y.kind === 'out' ? y.amount : 0), 0), sd = txns.reduce((x, y) => x + (y.kind === 'in' ? y.amount : 0), 0);
    totalsOk = Math.abs(sw - num(totals[1])) < 0.02 && Math.abs(sd - num(totals[2])) < 0.02;
  }
  const closing = Math.round(running * 100) / 100;
  return { json: { parsed: true, kind: 'account', asOf: iso(pm[4], pm[5], pm[6]), periodFrom: iso(pm[1], pm[2], pm[3]),
    accounts: [{ last4: am[1], branch: bm ? bm[1].trim() : '', balance: closing, txns }], txnCount: txns.length, checkOk: consistent && totalsOk } };
}

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
