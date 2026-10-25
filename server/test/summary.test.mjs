import test from 'node:test';
import assert from 'node:assert';
import { buildSummary } from '../summary.mjs';

test('weekly summary covers spending, budgets, balances, dues and next salary', () => {
  const S = {
    settings: { salaryDay: 25 },
    incomes: [{ date: '2026-09-25', amount: 6326, note: 'Salary' }, { date: '2026-10-24', amount: 6685, note: 'Salary' }],
    expenses: [
      { date: '2026-10-26', amount: 100, cat: 'Groceries', payMethod: 'bank' },
      { date: '2026-10-27', amount: 900, cat: 'Dining out', payMethod: 'bank' },
      { date: '2026-10-10', amount: 500, cat: 'Fuel', payMethod: 'bank' },
    ],
    budgets: { 'Dining out': 1000 },
    accounts: { mashreq: { name: 'Mashreq', type: 'bank', balance: 2000, balanceDate: '2026-10-25' }, noon_cc: { name: 'NOON CC', type: 'credit', balance: 300, balanceDate: '' } },
    renewals: [{ title: 'Car registration', expiry: '2026-10-30' }],
    indiaAccounts: [{ currency: 'INR', balance: 18266.89 }],
  };
  const t = buildSummary(S, new Date(2026, 9, 28));
  assert.match(t, /Oct – 24 Nov|24 Oct – 24 Nov/);
  assert.match(t, /Spent AED 1,000/);
  assert.match(t, /Dining out 90%/);
  assert.match(t, /Mashreq AED 1,?[0-9,]+/);
  assert.match(t, /NOON CC AED 300/);
  assert.match(t, /Car registration in 2d/);
  assert.match(t, /₹18,267/);
  assert.match(t, /Next salary: 25 Nov/);
});
