// Money rules: balances, salary periods, recurring payments, card spend.
import { DAY, CURR_SYM } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { uid, today, iso, parseISO, addMonths, sum, fmtDateObj } from '../core/util.js';

import * as acct from './accounts.js';
import * as periods from './periods.js';

// Spending categories by account type. Card repayments (cc_payment) are neither: money moving
// from a bank to a card is not new spending.
export const isCCPay = e => acct.isCredit(S.accounts, e.payMethod);
export const isBankPay = e => e.payMethod !== 'cc_payment' && !isCCPay(e);

export const accounts = (opts) => acct.accountList(S.accounts, opts);
export const payMethods = () => acct.payMethodOptions(S.accounts);
export const payLabel = method => acct.payLabel(S.accounts, method);
export const accountName = id => (((S.accounts || {})[id]) || {}).name || id;
export const bankAccounts = () => accounts().filter(a => a.type === 'bank');
export const creditCards = () => accounts().filter(a => a.type === 'credit');

export const bankBalance = id => acct.bankBalance(S, id, parseISO);
// Primary bank (Mashreq): kept as its own name because older code and the bank feed use it
export const mashreqComputed = () => bankBalance(acct.PRIMARY);

// A credit-card purchase raises that card's outstanding balance
export function chargeCard(method, amount, date) {
  if (!isCCPay({ payMethod: method })) return;
  const acc = S.accounts[method];
  acc.balance = Number(acc.balance || 0) + Number(amount);
  acc.balanceDate = date;
}

// ---- salary periods: the rules live in periods.js (shared with the server's weekly summary) ----
const salaryDay = () => S.settings.salaryDay || 25;
export const periodStart = d => periods.periodOf(salaryDay(), S.incomes, d).start;
export const periodOf = d => periods.periodOf(salaryDay(), S.incomes, d);
export const prevPeriod = p => periodOf(new Date(p.start - DAY));
export function periodLabel(p) {
  return `${fmtDateObj(p.start)} – ${fmtDateObj(p.end)}`;
}
export function inPeriod(dateStr, p) {
  const d = parseISO(dateStr);
  return d >= p.start && d <= p.end;
}
export const nextSalaryDate = () => periods.nextSalaryDate(salaryDay(), S.incomes, today());

// ---- recurring payments ----
// Logged on the 25th (salary day). The cycle key is the month of the most recent 25th,
// so opening the app on e.g. the 3rd still counts as last cycle.
// ---- recurring payments: a monthly checklist, not an expense generator ----
// Rent, parking, car washing and the household money are paid in cash from ATM withdrawals, and each withdrawal is
// already logged as the expense it paid for. So ticking an item here records NO money (nothing is counted twice);
// it only remembers "done for this salary cycle". S.recurringPaid = { itemId: [cycleStartISO, ...] }
export const recurringKey = () => iso(periodOf(today()).start);
export function recurringLogged(id) {
  return ((S.recurringPaid || {})[id] || []).includes(recurringKey());
}
export function toggleRecurringPaid(id) {
  S.recurringPaid = S.recurringPaid || {};
  const key = recurringKey(), list = S.recurringPaid[id] || [];
  S.recurringPaid[id] = list.includes(key) ? list.filter(k => k !== key) : [...list, key].slice(-24);
}
// Kept so older callers keep working: the checklist never adds expenses by itself
export function autoLogRecurring() { return 0; }

// ---- subscriptions in foreign currency ----
export const currSym = c => CURR_SYM[c] || (c || 'AED');
// Convert to AED with the latest remittance rate for that currency (1 AED = X foreign)
export function toAED(amt, cur) {
  if (!cur || cur === 'AED') return Number(amt || 0);
  const rates = (S.remittances || []).filter(r => r.currency === cur && r.rate).sort((a, b) => b.date.localeCompare(a.date));
  if (!rates.length) return null;
  return Number(amt || 0) / Number(rates[0].rate);
}
export function subMonthlyAED(s) {
  const aed = toAED(s.amount, s.currency);
  if (aed === null) return null;
  return s.cycle === 'annual' ? aed / 12 : aed;
}

// Average spend over the last 3 completed periods (for the emergency-fund card)
export function avgMonthlySpend() {
  let total = 0, count = 0, cur = periodOf(today());
  for (let i = 0; i < 3; i++) {
    cur = prevPeriod(cur);
    const s = sum(S.expenses.filter(e => inPeriod(e.date, cur) && e.payMethod !== 'cc_payment'));
    if (s > 0) { total += s; count++; }
  }
  return count ? total / count : 0;
}

export const totalEMI = () => sum((S.loans || []).filter(l => l.outstanding > 0), l => l.emi);
