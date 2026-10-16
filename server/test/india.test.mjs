import test from 'node:test';
import assert from 'node:assert';
import { indiaBalance, indiaTotals, toAED, rateFor, isValidIfsc, maskIfsc, indiaLabel } from '../../public/js/domain/india.js';

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const nre = { id: 'a', bank: 'Federal Bank', type: 'NRE', currency: 'INR', balance: 100000, balanceDate: '2026-10-01', last4: '1234' };
const nro = { id: 'b', bank: 'SBI', type: 'NRO', currency: 'INR', balance: 20000, balanceDate: '2026-10-01' };
const fcnr = { id: 'c', bank: 'HDFC Bank', type: 'FCNR', currency: 'USD', balance: 5000, balanceDate: '2026-10-01' };
const remit = [
  { date: '2026-10-05', aed: 1000, currency: 'INR', foreign: 23100, rate: 23.1, toIndia: 'a' },
  { date: '2026-09-20', aed: 1000, currency: 'INR', foreign: 22800, rate: 22.8, toIndia: 'a' },  // before anchor
];
const txns = [
  { accountId: 'a', date: '2026-10-06', amount: 5000, kind: 'out' },
  { accountId: 'b', date: '2026-10-07', amount: 1500, kind: 'in' },
];

test('india: balance = anchor + remittances + deposits - withdrawals after the anchor', () => {
  assert.equal(indiaBalance(nre, remit, txns, parse), 100000 + 23100 - 5000);
  assert.equal(indiaBalance(nro, remit, txns, parse), 21500);
  assert.equal(indiaBalance({ ...nre, balance: '' }, remit, txns, parse), null);
});

test('india: AED value uses the latest remittance rate, falls back with a flag', () => {
  assert.deepEqual(rateFor('INR', remit), { rate: 23.1, estimated: false });
  assert.equal(Math.round(toAED(23100, 'INR', remit)), 1000);
  assert.equal(rateFor('USD', remit).estimated, true);
  const t = indiaTotals([nre, nro, fcnr], remit, txns, parse);
  assert.equal(t.byType.NRE.amount, 118100);
  assert.equal(t.byType.NRO.amount, 21500);
  assert.equal(t.byType.FCNR.currency, 'USD');
  assert.equal(t.estimated, true);
  assert.equal(t.inr, 118100 + 21500);          // rupee accounts only, USD FCNR excluded, no conversion
  assert.ok(t.aed > (118100 + 21500) / 23.1);
});

test('india: IFSC format and labels', () => {
  assert.equal(maskIfsc(' fdrl0001234 '), 'FDRL0001234');
  assert.equal(isValidIfsc('FDRL0001234'), true);
  assert.equal(isValidIfsc('FDRL1001234'), false);
  assert.equal(indiaLabel(nre), 'Federal Bank NRE ••1234');
  assert.equal(indiaLabel({ bank: 'SBI', type: 'SAVINGS' }), 'SBI Savings');
});

import { cardLabel, cardsOf } from '../../public/js/domain/india.js';
test('india cards: labels and which debit cards belong to an account', () => {
  const cards = [
    { id: '1', bank: 'Federal Bank', kind: 'debit', last4: '1234', network: 'RuPay', linkedTo: 'a' },
    { id: '2', bank: 'HDFC Bank', kind: 'credit', last4: '', network: 'Visa' },
    { id: '3', bank: 'Federal Bank', kind: 'debit', linkedTo: 'b' },
  ];
  assert.equal(cardLabel(cards[0]), 'Federal Bank debit card ••1234 · RuPay');
  assert.equal(cardLabel(cards[1]), 'HDFC Bank credit card · Visa');
  assert.deepEqual(cardsOf(cards, 'a').map(c => c.id), ['1']);
});
