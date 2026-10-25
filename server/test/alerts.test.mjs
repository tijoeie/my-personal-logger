import test from 'node:test';
import assert from 'node:assert';
import { computeAlerts, markSent } from '../alerts.mjs';

const at = (d, h = 12) => new Date(2026, 9, d, h, 0);
const base = () => ({
  settings: { salaryDay: 25 },
  incomes: [{ date: '2026-10-24', amount: 6685, note: 'Salary' }],
  budgets: { 'Dining out': 100 },
  expenses: [{ id: 'a', date: '2026-10-26', cat: 'Dining out', amount: 85, payMethod: 'bank' }],
  renewals: [{ id: 'r1', title: 'Car registration', person: 'Tijo', expiry: '2026-11-20' }],
});

test('budget alert at 80%, then 100%, each once', () => {
  const S = base();
  let a = computeAlerts(S, at(27));
  assert.equal(a.filter(x => x.key.includes('budget')).length, 1);
  assert.match(a[0].text, /85% of its budget/);
  markSent(S, a, at(27));
  assert.equal(computeAlerts(S, at(27)).length, 0);
  S.expenses.push({ id: 'b', date: '2026-10-27', cat: 'Dining out', amount: 30, payMethod: 'bank' });
  a = computeAlerts(S, at(27));
  assert.match(a[0].text, /over budget/);
});

test('renewal reminders step 30 -> 7 -> 1 and skip the moot ones; quiet hours hold alerts', () => {
  const S = base(); S.budgets = {}; S.expenses = [];
  let a = computeAlerts(S, at(27));                         // 24 days left
  assert.match(a[0].text, /in 24 days/); markSent(S, a, at(27));
  assert.equal(computeAlerts(S, at(28)).length, 0);
  a = computeAlerts(S, new Date(2026, 10, 14, 9)); assert.match(a[0].text, /in 6 days/); markSent(S, a);
  a = computeAlerts(S, new Date(2026, 10, 19, 9)); assert.match(a[0].text, /tomorrow/); markSent(S, a);
  a = computeAlerts(S, new Date(2026, 10, 22, 9)); assert.match(a[0].text, /expired 2 days ago/);
  assert.equal(computeAlerts(S, at(27, 23)).length, 0);     // 11 pm: held
});

test('a large fresh bank payment is flagged once; habitual categories are not', () => {
  const S = base(); S.budgets = {}; S.renewals = [];
  S.expenses = [{ id: 'x', date: '2026-10-27', cat: 'Shopping', amount: 900, note: 'Noon', payMethod: 'bank', source: 'n8n', createdAt: at(27).getTime() },
    { id: 'y', date: '2026-10-27', cat: 'Family / Remittance', amount: 2000, note: 'Home', payMethod: 'bank', source: 'n8n', createdAt: at(27).getTime() }];
  const a = computeAlerts(S, at(27));
  assert.equal(a.length, 1); assert.match(a[0].text, /AED 900 at Noon/);
});

test('odd charges: duplicate, price change, new shop', () => {
  const now = at(27), t = now.getTime(), old = t - 20 * 86400000;
  const mk = (id, note, amount, ago, cat = 'Other', date = '2026-10-27') => ({ id, note, amount, cat, date, payMethod: 'bank', source: 'n8n', createdAt: t - ago });
  const hist = Array.from({ length: 30 }, (_, i) => ({ ...mk('h' + i, 'LULU ' + (i % 3), 20, 0, 'Groceries', '2026-09-20'), createdAt: old }));
  const S = { settings: { salaryDay: 25 }, incomes: [], budgets: {}, renewals: [], expenses: [...hist,
    { ...mk('s1', 'NETFLIX.COM', 35, 0, 'Subscriptions', '2026-09-27'), createdAt: old }, mk('s2', 'NETFLIX.COM', 40, 1000, 'Subscriptions'),
    mk('d1', 'PIZZA HUT', 45, 600000), mk('d2', 'PIZZA HUT', 45, 1000),
    mk('n1', 'BRAND NEW SHOP', 250, 5000)] };
  const text = computeAlerts(S, now).map(a => a.text).join('\n');
  assert.match(text, /Price change: NETFLIX.COM was AED 35 .* AED 40/);
  assert.match(text, /Possible duplicate charge: AED 45 at PIZZA HUT/);
  assert.match(text, /First payment to a new place: AED 250 at BRAND NEW SHOP/);
  assert.doesNotMatch(text, /LULU/);
});

test('odd charges ignore relabelled repayments and other non-shop entries', () => {
  const now = at(27), t = now.getTime();
  const hist = Array.from({ length: 30 }, (_, i) => ({ id: 'h' + i, note: 'LULU', amount: 20, cat: 'Groceries', date: '2026-09-20', payMethod: 'bank', source: 'n8n', createdAt: t - 20 * 86400000 }));
  const S = { settings: { salaryDay: 25 }, incomes: [], budgets: {}, renewals: [], expenses: [...hist, { id: 'r', note: 'Repay Rinu', amount: 501, cat: 'Repayment', linked: true, date: '2026-10-27', payMethod: 'bank', source: 'n8n', createdAt: t - 1000 }] };
  assert.equal(computeAlerts(S, now).filter(a => a.key.startsWith('new:')).length, 0);
});

test('salary plan alert goes out once after the salary lands', () => {
  const S = base(); S.budgets = {}; S.renewals = [];
  S.expenses = [{ id: 'e', date: '2026-09-27', cat: 'Rent', amount: 2300, payMethod: 'bank' }];
  S.incomes = [{ date: '2026-09-25', amount: 6000, note: 'Salary' }, { date: '2026-10-24', amount: 6685, note: 'Salary' }];
  const a = computeAlerts(S, at(25));
  assert.equal(a.filter(x => x.key.startsWith('plan:')).length, 1);
  assert.match(a.find(x => x.key.startsWith('plan:')).text, /Salary plan/);
  markSent(S, a, at(25));
  assert.equal(computeAlerts(S, at(26)).filter(x => x.key.startsWith('plan:')).length, 0);
});
