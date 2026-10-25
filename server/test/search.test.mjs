import test from 'node:test';
import assert from 'node:assert';
import { searchAll } from '../../public/js/domain/search.js';

const S = {
  expenses: [{ id: 1, date: '2026-10-23', amount: 30.2, cat: 'Shopping', note: 'Noon 80038888 AE', payMethod: 'bank' }, { id: 2, date: '2026-09-02', amount: 100, cat: 'Fuel', note: 'ADNOC', payMethod: 'bank' },
    { id: 3, date: '2026-10-05', amount: 500, cat: 'Repayment', note: 'Repay Rinu', payMethod: 'bank' }],
  incomes: [{ date: '2026-10-24', amount: 6685, note: 'Salary' }],
  renewals: [{ title: 'My residence visa', person: 'Me', cat: 'Visa', expiry: '2028-03-20' }],
  borrowedFromFriends: [{ name: 'Rinu', total: 2750 }], subscriptions: [{ name: 'Netflix', amount: 71, cycle: 'monthly' }],
};
test('search: every word must match, across kinds, by text, amount and month', () => {
  assert.equal(searchAll(S, 'noon').total, 1);
  assert.equal(searchAll(S, 'fuel sep').groups[0].items[0].title, 'ADNOC');
  assert.equal(searchAll(S, 'oct noon').total, 1);
  assert.equal(searchAll(S, 'fuel oct').total, 0);
  assert.deepEqual(searchAll(S, 'rinu').groups.map(g => g.kind), ['expenses', 'loans']);
  assert.equal(searchAll(S, '6685').groups[0].kind, 'incomes');
  assert.equal(searchAll(S, 'visa').groups[0].kind, 'renewals');
  assert.equal(searchAll(S, '').total, 0);
});
