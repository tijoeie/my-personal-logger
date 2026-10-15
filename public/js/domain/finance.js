// Money rules: balances, salary periods, recurring payments, card spend.
import { DAY, PAY_METHODS, CURR_SYM } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { uid, today, iso, parseISO, addMonths, sum } from '../core/util.js';

export const isBankPay = e => e.payMethod === 'bank' || e.payMethod === 'mashreq' || e.payMethod === 'cash' || !e.payMethod;
export const isCCPay = e => e.payMethod === 'enbd_cc' || e.payMethod === 'noon_cc';
export const CC_NAMES = { enbd_cc: 'ENBD', noon_cc: 'NOON' };

export function payLabel(method) {
  return (PAY_METHODS.find(p => p.v === method) || { t: 'Mashreq' }).t;
}

// Mashreq = anchor balance + income since anchor - bank expenses and card payments since anchor
export function mashreqComputed() {
  const acc = (S.accounts || {}).mashreq || {};
  if (!acc.balanceDate || acc.balance == null) return null;
  const since = parseISO(acc.balanceDate);
  // Bank-reported balances (n8n) already include every transaction up to that moment,
  // so only count entries created after it. Manual anchors keep the date-based rule.
  const after = x => acc.balanceAt
    ? (x.createdAt ? x.createdAt > acc.balanceAt : parseISO(x.date) > since)
    : parseISO(x.date) >= since;
  const income = sum(S.incomes.filter(after));
  const bankExp = sum(S.expenses.filter(e => after(e) && (e.payMethod === 'bank' || e.payMethod === 'mashreq' || !e.payMethod)));
  const ccPay = sum(S.expenses.filter(e => after(e) && e.payMethod === 'cc_payment'));
  return Number(acc.balance) + income - bankExp - ccPay;
}

// A card purchase raises that card's outstanding balance
export function chargeCard(method, amount, date) {
  if (!isCCPay({ payMethod: method })) return;
  S.accounts = S.accounts || {};
  const acc = S.accounts[method] || { name: method === 'enbd_cc' ? 'ENBD CC' : 'NOON CC', type: 'credit', balance: 0, balanceDate: '' };
  acc.balance = Number(acc.balance || 0) + Number(amount);
  acc.balanceDate = date;
  S.accounts[method] = acc;
}

// ---- salary periods (salary day → day before next salary day) ----
export function periodStart(d) {
  const day = S.settings.salaryDay || 25;
  return d.getDate() >= day
    ? new Date(d.getFullYear(), d.getMonth(), day)
    : new Date(d.getFullYear(), d.getMonth() - 1, day);
}
export function periodOf(d) {
  const start = periodStart(d);
  return { start, end: new Date(addMonths(start, 1) - DAY) };
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
  const day = S.settings.salaryDay || 25;
  return t.getDate() <= day
    ? new Date(t.getFullYear(), t.getMonth(), day)
    : new Date(t.getFullYear(), t.getMonth() + 1, day);
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
