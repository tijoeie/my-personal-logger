// Client sync merge rules (public/js/core/merge.js is a plain ES module, so node can load it)
import test from 'node:test';
import assert from 'node:assert';
import { merge3, dedupeRecurring } from '../../public/js/core/merge.js';

const base = {
  settings: { currency: 'AED', salaryDay: 25 },
  accounts: { mashreq: { balance: 100 }, enbd_cc: { balance: 0 } },
  expenses: [{ id: 'a', amount: 1 }, { id: 'b', amount: 2 }],
};
const clone = o => JSON.parse(JSON.stringify(o));

test('merge: bank ingest on server + local expense edit both survive', () => {
  const local = clone(base);
  local.expenses.push({ id: 'c', amount: 3 });              // added on phone
  local.expenses[0].amount = 10;                              // edited on phone
  local.accounts.enbd_cc.balance = 50;                        // card charge on phone
  const server = clone(base);
  server.expenses.push({ id: 'n', amount: 99, source: 'n8n' }); // ingest
  server.accounts.mashreq = { balance: 544.84, balanceAt: 1 };  // ingest anchor

  const m = merge3(base, local, server);
  assert.deepEqual(m.expenses.map(e => e.id).sort(), ['a', 'b', 'c', 'n']);
  assert.equal(m.expenses.find(e => e.id === 'a').amount, 10);
  assert.equal(m.accounts.mashreq.balance, 544.84);
  assert.equal(m.accounts.enbd_cc.balance, 50);
});

test('merge: deletes on either side are honoured', () => {
  const local = clone(base); local.expenses = local.expenses.filter(e => e.id !== 'a');
  const server = clone(base); server.expenses = server.expenses.filter(e => e.id !== 'b');
  assert.deepEqual(merge3(base, local, server).expenses, []);
});

test('merge: unchanged local just takes the server copy', () => {
  const server = clone(base); server.settings.salaryDay = 24;
  assert.equal(merge3(base, clone(base), server).settings.salaryDay, 24);
});

test('dedupeRecurring keeps one entry per cycle, preferring the bank-tagged one', () => {
  const s = { expenses: [
    { id: 'x', recurringId: 'rent', recurringMonth: '2026-09' },
    { id: 'y', recurringId: 'rent', recurringMonth: '2026-09', source: 'n8n' },
    { id: 'z', recurringId: 'rent', recurringMonth: '2026-10' },
    { id: 'p' },
  ] };
  assert.deepEqual(dedupeRecurring(s).expenses.map(e => e.id), ['y', 'z', 'p']);
});
