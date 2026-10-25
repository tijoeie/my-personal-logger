import test from 'node:test';
import assert from 'node:assert';
import { snapshot } from '../../public/js/glance.js';

test('glance snapshot: balance, today, cycle, days to salary, next due', () => {
  const S = {
    settings: { salaryDay: 25 },
    incomes: [{ date: '2026-10-24', amount: 6685, note: 'Salary' }],
    accounts: { mashreq: { name: 'Mashreq', type: 'bank', balance: 1000, balanceDate: '2026-10-25' }, noon_cc: { type: 'credit', balance: 50 } },
    expenses: [{ date: '2026-10-27', amount: 20, payMethod: 'bank' }, { date: '2026-10-26', amount: 100, payMethod: 'bank' }],
    renewals: [{ title: 'Visa', expiry: '2026-11-10' }],
    indiaAccounts: [{ currency: 'INR', balance: 100.5 }],
  };
  const s = snapshot(S, new Date(2026, 9, 27, 12));
  assert.deepEqual([s.balance, s.today, s.cycle, s.income, s.days, s.owed], [880, 20, 120, 6685, 29, 50]);
  assert.deepEqual(s.due, { t: 'Visa', d: 14 });
  assert.equal(s.inr, 100.5);
});
