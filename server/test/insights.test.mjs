import test from 'node:test';
import assert from 'node:assert';
import { periodInsight, quickAddItems } from '../../public/js/domain/insights.js';

const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const period = { start: D('2026-09-25'), end: D('2026-10-24') };
const prev = { start: D('2026-08-25'), end: D('2026-09-24') };

const ex = [
  { date: '2026-09-26', cat: 'Dining out', amount: 100, payMethod: 'bank' },
  { date: '2026-10-01', cat: 'Fuel', amount: 50, payMethod: 'bank' },
  { date: '2026-10-05', cat: 'Dining out', amount: 50, payMethod: 'enbd_cc' },
  { date: '2026-10-05', cat: 'Other', amount: 999, payMethod: 'cc_payment' },  // card repayment, not spend
  { date: '2026-10-20', cat: 'Groceries', amount: 70, payMethod: 'bank' },     // after "today"
  { date: '2026-08-26', cat: 'Fuel', amount: 100, payMethod: 'bank' },         // prev period, within first 11 days
  { date: '2026-09-20', cat: 'Rent', amount: 2300, payMethod: 'bank' },        // prev period, late
];

test('insight: compares with the same point of the previous period', () => {
  const i = periodInsight(ex, period, prev, D('2026-10-05'));
  assert.equal(i.elapsed, 11);
  assert.equal(i.spent, 200);              // 100 + 50 + 50, excludes cc_payment and future
  assert.equal(i.prevSoFar, 100);          // 25 Aug .. 4 Sep only
  assert.equal(i.prevFull, 2400);
  assert.equal(Math.round(i.changePct), 100);
  assert.equal(i.topCat, 'Dining out');
  assert.equal(i.topAmt, 150);
  assert.equal(Math.round(i.topShare), 75);
  assert.equal(i.length, 30);
  assert.equal(Math.round(i.projected), Math.round(200 / 11 * 30));
  assert.equal(i.biggest.amount, 100);
});

test('insight: reconciliation adjustments count in totals but not as a category or biggest', () => {
  const list = [...ex, { date: '2026-10-02', cat: 'Other', amount: 5000, payMethod: 'bank', note: 'Reconciliation — unlogged spending' }];
  const i = periodInsight(list, period, prev, D('2026-10-05'));
  assert.equal(i.spent, 5200);
  assert.equal(i.adjusted, 5000);
  assert.equal(i.topCat, 'Dining out');
  assert.equal(Math.round(i.topShare), 75);
  assert.equal(i.biggest.amount, 100);
});

test('insight: empty period is safe', () => {
  const i = periodInsight([], period, prev, D('2026-09-25'));
  assert.equal(i.spent, 0);
  assert.equal(i.changePct, null);
  assert.equal(i.topCat, null);
});

test('quick add: core categories with last amount, then frequent extras', () => {
  const list = [
    ...ex,
    { date: '2026-10-02', cat: 'Shopping', amount: 28.8, payMethod: 'bank', note: 'Noon' },
    { date: '2026-10-03', cat: 'Shopping', amount: 14, payMethod: 'bank', note: 'Amazon' },
    { date: '2026-10-04', cat: 'Health', amount: 30, payMethod: 'bank' },
    { date: '2026-10-04', cat: 'Rent', amount: 2300, payMethod: 'bank', recurringId: 'rent' },
  ];
  const q = quickAddItems(list, D('2026-10-05'));
  assert.deepEqual(q.map(x => x.cat), ['Fuel', 'Groceries', 'Dining out', 'Shopping', 'Health']);
  assert.equal(q[0].amount, 50);                  // latest Fuel
  assert.equal(q[2].amount, 50);                  // latest Dining out (5 Oct)
  assert.equal(q[2].payMethod, 'enbd_cc');
  assert.equal(q[3].note, 'Amazon');              // latest Shopping
});
