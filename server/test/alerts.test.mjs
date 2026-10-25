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
