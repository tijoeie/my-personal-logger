import test from 'node:test';
import assert from 'node:assert';
import { salaryPlan } from '../../public/js/domain/plan.js';

test('salary plan: committed + everyday averaged over finished cycles, rest is safe to send', () => {
  const S = {
    settings: { salaryDay: 25 },
    incomes: [{ date: '2026-09-25', amount: 6000, note: 'Salary' }, { date: '2026-10-24', amount: 6600, note: 'Salary' }, { date: '2026-08-25', amount: 6000, note: 'Salary' }],
    expenses: [
      { date: '2026-09-27', cat: 'Rent', amount: 2300, payMethod: 'bank' }, { date: '2026-09-30', cat: 'Groceries', amount: 600, payMethod: 'bank' },
      { date: '2026-08-27', cat: 'Rent', amount: 2300, payMethod: 'bank' }, { date: '2026-08-30', cat: 'Dining out', amount: 400, payMethod: 'bank' },
    ],
    remittances: [{ date: '2026-09-01', rate: 23.1, currency: 'INR', aed: 1000, foreign: 23100 }],
    borrowedFromFriends: [], borrowedPayments: [],
  };
  const p = salaryPlan(S, new Date(2026, 9, 26));
  assert.equal(p.salary, 6600);
  assert.equal(p.committed, 2300); assert.equal(p.everyday, 500);
  assert.equal(p.cushion, 330);
  assert.equal(p.left, 6600 - 2300 - 500 - 330);       // 3470
  assert.equal(p.safe, 3450);
  assert.equal(p.inr, Math.round(3450 * 23.1));
  assert.equal(salaryPlan({ settings: {}, incomes: [], expenses: [] }, new Date()), null);
});
