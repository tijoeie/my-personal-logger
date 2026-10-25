// Money rules: balances, salary periods, recurring payments, card spend.
import { DAY, CURR_SYM } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { uid, today, iso, parseISO, addMonths, sum } from '../core/util.js';

import * as acct from './accounts.js';

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

// ---- salary periods (the day the salary lands in the bank → day before the next one) ----
// The company often pays early when the salary day falls on a weekend, so a period starts on the day a
// "Salary" credit actually arrived (logged by the bank feed), if one is found within a week before to
// four days after the nominal salary day. With no such credit it starts on the nominal day.
export function nominalStart(y, m) { return new Date(y, m, S.settings.salaryDay || 25); }
export function salaryCredit(y, m) {
  const nom = nominalStart(y, m);
  const from = new Date(nom.getFullYear(), nom.getMonth(), Math.max(1, nom.getDate() - 7));
  const to = new Date(nom.getFullYear(), nom.getMonth(), nom.getDate() + 4);
  const hits = (S.incomes || []).filter(i => /salary/i.test(i.note || '') && !/reconcil/i.test(i.note || '') && Number(i.amount) > 0 && i.date)
    .map(i => parseISO(i.date)).filter(d => d >= from && d <= to).sort((x, y2) => x - y2);
  return hits[0] || null;
}
export const monthStart = (y, m) => salaryCredit(y, m) || nominalStart(y, m);
function periodKey(d) {
  const y = d.getFullYear(), m = d.getMonth();
  return d >= monthStart(y, m) ? [y, m] : [y, m - 1];
}
export const periodStart = d => monthStart(...periodKey(d));
export function periodOf(d) {
  const [y, m] = periodKey(d);
  return { start: monthStart(y, m), end: new Date(monthStart(y, m + 1) - DAY) };
}
export const prevPeriod = p => periodOf(new Date(p.start - DAY));
export function periodLabel(p) {
  const f = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${f(p.start)} – ${f(p.end)}`;
}
export function inPeriod(dateStr, p) {
  const d = parseISO(dateStr);
  return d >= p.start && d <= p.end;
}
export function nextSalaryDate() {
  const t = today();
  const y = t.getFullYear(), m = t.getMonth();
  const got = salaryCredit(y, m);
  if (got) return t < got ? got : nominalStart(y, m + 1);
  return t <= nominalStart(y, m) ? nominalStart(y, m) : nominalStart(y, m + 1);
}

// ---- recurring payments ----
// Logged on the 25th (salary day). The cycle key is the month of the most recent 25th,
// so opening the app on e.g. the 3rd still counts as last cycle.
const RECURRING_DAY = 25;
const RECURRING_GRACE_DAYS = 5;
export function recurringCycle() {
  const t = today();
  let d = new Date(t.getFullYear(), t.getMonth(), RECURRING_DAY);
  if (t < d) d = new Date(t.getFullYear(), t.getMonth() - 1, RECURRING_DAY);
  return { date: d, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}
// A few days' grace so a bank debit on e.g. the 23rd still counts for the cycle starting the 25th
function recurringWindowStart() { return new Date(recurringCycle().date - RECURRING_GRACE_DAYS * DAY); }
export function recurringLogged(id) {
  const start = recurringWindowStart();
  return S.expenses.some(e => e.recurringId === id && parseISO(e.date) >= start);
}
// If the bank feed already logged this payment, claim that entry instead of adding a duplicate
export function claimBankEntry(r, key) {
  const start = recurringWindowStart();
  const e = S.expenses.find(x => x.source === 'n8n' && !x.recurringId && parseISO(x.date) >= start && Math.abs(Number(x.amount) - Number(r.amount)) < 0.01);
  if (!e) return false;
  Object.assign(e, { cat: r.cat, note: r.name, recurringId: r.id, recurringMonth: key });
  return true;
}
export function autoLogRecurring() {
  const { date, key } = recurringCycle();
  let added = 0;
  for (const r of (S.recurring || [])) {
    if (r.active === false || recurringLogged(r.id)) continue;
    if (claimBankEntry(r, key)) { added++; continue; }
    S.expenses.push({ id: uid(), date: iso(date), cat: r.cat, amount: Number(r.amount), note: r.name, payMethod: 'bank', recurringId: r.id, recurringMonth: key, createdAt: Date.now() });
    added++;
  }
  if (added) save();
  return added;
}

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
