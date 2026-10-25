// Salary plan: what the new salary has to cover and how much is left to send home safely.
//   salary      the latest "Salary" credit (falls back to Settings > salary amount)
//   committed   what normally leaves every cycle regardless of mood: rent, family money, repayments, EMIs, parking
//               (taken from what you actually paid in the last 3 finished cycles, plus unpaid borrowed instalments)
//   everyday    average of the rest of your spending over the last 3 finished cycles
//   cushion     5% of salary kept back
// Pure functions over plain data so the app and the server's Telegram message share them.
import { periodOf } from './periods.js';

const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const COMMITTED = /^(Rent|Family \/ Remittance|Repayment|Loan EMI|Salik \/ Parking)$/;
const sum = l => l.reduce((s, x) => s + Number(x.amount || 0), 0);
const round50 = n => Math.floor(n / 50) * 50;

export function salaryPlan(S, today) {
  const day = (S.settings || {}).salaryDay || 25;
  const credits = (S.incomes || []).filter(i => /salary/i.test(i.note || '') && !/reconcil/i.test(i.note || '') && Number(i.amount) > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const salary = credits.length ? Number(credits[0].amount) : Number((S.settings || {}).salaryAmount || 0);
  if (!(salary > 100)) return null;

  let cur = periodOf(day, S.incomes, today), committed = 0, everyday = 0, n = 0;
  for (let i = 0; i < 3; i++) {
    cur = periodOf(day, S.incomes, new Date(cur.start - DAY));
    const list = (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && !/^Reconciliation/i.test(e.note || '')
      && parseISO(e.date) >= cur.start && parseISO(e.date) <= cur.end);
    if (!list.length) continue;
    n++;
    committed += sum(list.filter(e => COMMITTED.test(e.cat || '')));
    everyday += sum(list.filter(e => !COMMITTED.test(e.cat || '')));
  }
  if (!n) return null;
  committed /= n; everyday /= n;
  // a borrowed instalment still unpaid this cycle is committed money even if last cycles had none
  const borrowedDue = (S.borrowedFromFriends || []).reduce((s, b) => {
    const left = Number(b.total) - (S.borrowedPayments || []).filter(p => p.bId === b.id).reduce((a, p) => a + Number(p.amount), 0);
    return s + (left > 0 ? Math.min(left, Number(b.monthly) || 0) : 0);
  }, 0);
  committed = Math.max(committed, borrowedDue);
  const cushion = Math.round(salary * 0.05);
  const left = salary - committed - everyday - cushion;
  const rates = (S.remittances || []).filter(r => Number(r.rate) > 0 && (r.currency || 'INR') === 'INR').sort((a, b) => b.date.localeCompare(a.date));
  const rate = rates.length ? Number(rates[0].rate) : null;
  const safe = Math.max(0, round50(left));
  return { salary, committed, everyday, cushion, left, safe, rate, inr: rate ? Math.round(safe * rate) : null, cycles: n };
}
