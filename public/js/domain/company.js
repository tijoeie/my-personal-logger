// Company expenses paid from your own pocket and paid back later: they leave your personal spending (and the
// reimbursement leaves your income) while the bank balance stays exactly as the bank has it.
//   S.companyPaid: [{ id, date, amount, note, cat, payMethod, orig, comp, reimbursedDate, reimbursedAmount, incomeComp }]
import { accountOf, bankOf, countedAfterAnchor, PRIMARY } from './accounts.js';

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Math.random().toString(36).slice(2, 10);

// Anchor adjustment that keeps the computed balance unchanged when an entry that was counted after the anchor is removed
function keepBalance(S, accountId, entry, delta) {
  const acc = (S.accounts || {})[accountId];
  if (!acc || acc.balance == null || !acc.balanceDate) return 0;
  if (!countedAfterAnchor(acc, entry, parse)) return 0;
  acc.balance = Math.round((Number(acc.balance) + delta) * 100) / 100;
  return delta;
}

// Expense -> company list. Returns the new record, or null if the expense is not found.
export function moveToCompany(S, expenseId) {
  const e = (S.expenses || []).find(x => x.id === expenseId);
  if (!e) return null;
  const bank = bankOf(S.accounts, e.payMethod);                       // null for credit cards and cash: no anchor to correct
  const comp = bank ? keepBalance(S, bank, e, -Number(e.amount)) : 0;  // the removed expense was lowering the balance; lower the anchor instead
  S.expenses = S.expenses.filter(x => x.id !== expenseId);
  const rec = { id: uid(), date: e.date, amount: Number(e.amount), note: e.note || e.cat || 'Company expense', cat: e.cat, payMethod: e.payMethod, orig: e, bank, comp, reimbursedDate: '', reimbursedAmount: 0 };
  (S.companyPaid = S.companyPaid || []).push(rec);
  return rec;
}

// The reimbursement arrived. incomeId = the income entry to take out of your income (optional).
export function markReimbursed(S, id, { date, amount, incomeId }) {
  const rec = (S.companyPaid || []).find(x => x.id === id);
  if (!rec) return null;
  rec.reimbursedDate = date; rec.reimbursedAmount = Number(amount);
  rec.incomeComp = 0;
  const inc = incomeId && (S.incomes || []).find(i => i.id === incomeId);
  if (inc) {
    const acc = inc.toAccount ? null : (inc.account || PRIMARY);
    rec.incomeComp = acc ? keepBalance(S, acc, inc, Number(inc.amount)) : 0;
    rec.incomeOrig = inc;
    S.incomes = S.incomes.filter(i => i.id !== incomeId);
  }
  return rec;
}

// Put it back as a normal personal expense (and undo the balance correction)
export function undoCompany(S, id) {
  const rec = (S.companyPaid || []).find(x => x.id === id);
  if (!rec || !rec.orig) return null;
  if (rec.comp && rec.bank && S.accounts[rec.bank]) S.accounts[rec.bank].balance = Math.round((Number(S.accounts[rec.bank].balance) - rec.comp) * 100) / 100;
  if (rec.incomeOrig) {
    const acc = rec.incomeOrig.account || PRIMARY;
    if (rec.incomeComp && S.accounts[acc]) S.accounts[acc].balance = Math.round((Number(S.accounts[acc].balance) - rec.incomeComp) * 100) / 100;
    (S.incomes = S.incomes || []).push(rec.incomeOrig);
  }
  (S.expenses = S.expenses || []).push(rec.orig);
  S.companyPaid = S.companyPaid.filter(x => x.id !== id);
  return rec.orig;
}

export const waiting = S => (S.companyPaid || []).filter(r => !r.reimbursedDate);
