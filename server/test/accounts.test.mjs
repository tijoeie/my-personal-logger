import test from 'node:test';
import assert from 'node:assert';
import { accountList, accountOf, bankOf, isCredit, payMethodOptions, payLabel, bankBalance, transferKind, newAccountId, isInUse, methodFor } from '../../public/js/domain/accounts.js';

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const accounts = {
  mashreq: { name: 'Mashreq', type: 'bank', balance: 1000, balanceDate: '2026-10-01' },
  enbd_cc: { name: 'ENBD CC', type: 'credit', balance: 300, limit: 15000 },
  noon_cc: { name: 'NOON CC', type: 'credit', balance: 0, limit: 14999 },
  neo_dc: { name: 'Neo VISA', type: 'debit', last4: '2256', linkedTo: 'mashreq' },
  adcb: { name: 'ADCB', type: 'bank', balance: 500, balanceDate: '2026-10-01' },
  old_cc: { name: 'Old card', type: 'credit', hidden: true },
};

test('accounts: ordering, hidden, legacy pay methods', () => {
  assert.deepEqual(accountList(accounts).map(a => a.id), ['mashreq', 'adcb', 'neo_dc', 'enbd_cc', 'noon_cc']);
  assert.equal(accountList(accounts, { includeHidden: true }).length, 6);
  for (const m of ['bank', 'mashreq', undefined, '']) assert.equal(accountOf(accounts, m).id, 'mashreq');
  assert.equal(accountOf(accounts, 'cash'), null);
  assert.equal(bankOf(accounts, 'neo_dc'), 'mashreq');
  assert.equal(bankOf(accounts, 'enbd_cc'), null);
  assert.equal(isCredit(accounts, 'enbd_cc'), true);
  assert.equal(isCredit(accounts, 'neo_dc'), false);
  assert.equal(methodFor('mashreq'), 'bank');
  assert.deepEqual(payMethodOptions(accounts).map(o => o.v), ['bank', 'adcb', 'neo_dc', 'enbd_cc', 'noon_cc', 'cash']);
  assert.equal(payMethodOptions(accounts)[2].t, 'Neo VISA ••2256 (debit card)');
  assert.equal(payLabel(accounts, 'neo_dc'), 'Neo VISA debit card');
  assert.equal(payLabel(accounts, 'bank'), 'Mashreq (bank)');
});

test('accounts: bank balance counts debit card spend, repayments and transfers', () => {
  const data = {
    accounts,
    incomes: [{ date: '2026-10-02', amount: 200 }, { date: '2026-10-02', amount: 50, account: 'adcb' }],
    expenses: [
      { date: '2026-10-03', amount: 10, payMethod: 'bank' },
      { date: '2026-10-03', amount: 20, payMethod: 'neo_dc' },       // debit card -> Mashreq
      { date: '2026-10-03', amount: 99, payMethod: 'enbd_cc' },      // credit card, not bank
      { date: '2026-10-03', amount: 30, payMethod: 'cash' },
      { date: '2026-10-04', amount: 100, payMethod: 'cc_payment' },  // repay from Mashreq (default)
      { date: '2026-10-04', amount: 40, payMethod: 'cc_payment', fromAccount: 'adcb' },
      { date: '2026-09-30', amount: 999, payMethod: 'bank' },        // before anchor
    ],
    transfers: [{ date: '2026-10-05', amount: 150, from: 'mashreq', to: 'adcb' }, { date: '2026-10-06', amount: 60, from: 'adcb', to: 'cash' }],
  };
  assert.equal(bankBalance(data, 'mashreq', parse), 1000 + 200 - 10 - 20 - 100 - 150);
  assert.equal(bankBalance(data, 'adcb', parse), 500 + 50 - 40 + 150 - 60);
  assert.equal(bankBalance(data, 'enbd_cc', parse), null);
});

test('accounts: transfers, ids, deletability', () => {
  assert.equal(transferKind(accounts, 'mashreq', 'enbd_cc'), 'card-payment');
  assert.equal(transferKind(accounts, 'mashreq', 'adcb'), 'transfer');
  assert.equal(transferKind(accounts, 'mashreq', 'cash'), 'transfer');
  assert.equal(newAccountId(accounts, 'ENBD', 'credit'), 'enbd_cc_2');
  assert.equal(newAccountId(accounts, 'FAB Cashback!', 'credit'), 'fab_cashback_cc');
  assert.equal(newAccountId(accounts, 'Wio', 'bank'), 'wio');
  const S = { accounts, expenses: [{ payMethod: 'enbd_cc' }], incomes: [], subscriptions: [], transfers: [] };
  assert.equal(isInUse('enbd_cc', S), true);
  assert.equal(isInUse('noon_cc', S), false);
  assert.equal(isInUse('mashreq', S), true);   // primary can never be deleted
  assert.equal(isInUse('mashreq', S), true);
  assert.equal(isInUse('adcb', S), false);
  assert.equal(isInUse('adcb', { ...S, transfers: [{ from: 'adcb', to: 'cash' }] }), true);
});
