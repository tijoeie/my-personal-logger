import test from 'node:test';
import assert from 'node:assert';
import { moveToCompany, markReimbursed, undoCompany, waiting } from '../../public/js/domain/company.js';
import { bankBalance } from '../../public/js/domain/accounts.js';

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const make = () => ({
  accounts: { mashreq: { name: 'Mashreq', type: 'bank', balance: 1000, balanceDate: '2026-11-01', balanceAt: 1000 } },
  expenses: [{ id: 'p1', date: '2026-11-02', cat: 'Salik / Parking', amount: 300, note: 'Q MOBILITY', payMethod: 'bank', createdAt: 2000 },
             { id: 'old', date: '2026-10-20', cat: 'Fuel', amount: 50, note: 'ADNOC', payMethod: 'bank', createdAt: 500 }],
  incomes: [{ id: 'r1', date: '2026-11-03', amount: 300, note: 'Aani', createdAt: 3000 }],
  transfers: [],
});

test('company expense leaves personal totals but the bank balance stays the same', () => {
  const S = make();
  const before = bankBalance(S, 'mashreq', parse);                    // 1000 - 300 + 300 = 1000
  moveToCompany(S, 'p1');
  assert.deepEqual(S.expenses.map(e => e.id), ['old']);
  assert.equal(bankBalance(S, 'mashreq', parse), before);              // the balance does not move when the expense leaves the list
  assert.equal(waiting(S).length, 1);
  markReimbursed(S, S.companyPaid[0].id, { date: '2026-11-03', amount: 300, incomeId: 'r1' });
  assert.equal(S.incomes.length, 0);
  assert.equal(bankBalance(S, 'mashreq', parse), before);              // paid out and paid back: nothing changed
  assert.equal(waiting(S).length, 0);
});

test('an entry older than the anchor needs no balance correction, and undo restores everything', () => {
  const S = make();
  const before = bankBalance(S, 'mashreq', parse);
  moveToCompany(S, 'old');
  assert.equal(bankBalance(S, 'mashreq', parse), before);
  undoCompany(S, S.companyPaid[0].id);
  assert.equal(S.expenses.length, 2);
  assert.equal(bankBalance(S, 'mashreq', parse), before);
  const S2 = make(); const b2 = bankBalance(S2, 'mashreq', parse);
  moveToCompany(S2, 'p1'); markReimbursed(S2, S2.companyPaid[0].id, { date: '2026-11-03', amount: 300, incomeId: 'r1' });
  undoCompany(S2, S2.companyPaid[0].id);
  assert.deepEqual([S2.expenses.length, S2.incomes.length, bankBalance(S2, 'mashreq', parse)], [2, 1, b2]);
});
