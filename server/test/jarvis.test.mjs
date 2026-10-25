import test from 'node:test';
import assert from 'node:assert';
import { answer } from '../jarvis.mjs';

const now = new Date(2026, 9, 27, 12, 0);
const S = {
  settings: { salaryDay: 25 },
  incomes: [{ date: '2026-10-24', amount: 6685, note: 'Salary' }],
  accounts: { mashreq: { name: 'Mashreq', type: 'bank', balance: 1000, balanceDate: '2026-10-25' }, noon_cc: { name: 'NOON CC', type: 'credit', balance: 120, balanceDate: '' } },
  expenses: [{ date: '2026-10-27', amount: 20, cat: 'Dining out', note: 'Cafe', payMethod: 'bank' }, { date: '2026-10-26', amount: 100, cat: 'Fuel', note: 'ENOC', payMethod: 'bank' }],
  budgets: { 'Dining out': 100 },
  renewals: [{ title: 'Car registration', expiry: '2026-11-20' }],
  borrowedFromFriends: [{ id: 'b', name: 'Rinu', total: 2750, monthly: 500 }], borrowedPayments: [{ bId: 'b', amount: 1000 }],
  indiaAccounts: [{ bank: 'Federal Bank', type: 'NRE', last4: '9418', currency: 'INR', balance: 13266.89, balanceDate: '2026-10-23' }],
};
const ask = t => answer(S, t, now, async () => ({ rate: 25.87 }));

test('jarvis answers the everyday questions', async () => {
  assert.match(await ask('Balance?'), /Mashreq: AED 880.00[\s\S]*NOON CC: owes AED 120.00[\s\S]*₹13,266.89/);
  assert.match(await ask('spent today?'), /Today: AED 20.00 in 1 payment[\s\S]*Cafe/);
  assert.match(await ask('spent this week'), /AED 120.00 in 2 payments/);
  assert.match(await ask('how much spent this month'), /spent AED 120.00, income AED 6,685.00/);
  assert.match(await ask('what is due'), /Car registration: in 24 days/);
  assert.match(await ask('salary'), /Next salary around 25 Nov/);
  assert.match(await ask('budget'), /Dining out: AED 20.00 of AED 100.00 \(20%\)/);
  assert.match(await ask('who do I owe'), /Rinu: AED 1,750.00/);
  assert.match(await ask('rate'), /₹25.87/);
  assert.match(await ask('/start'), /I'm Jarvis/);
  assert.match(await ask('blah blah'), /did not get that/);
});
