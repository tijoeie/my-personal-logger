import test from 'node:test';
import assert from 'node:assert';
import { S } from '../../public/js/core/state.js';
import { periodOf, nextSalaryDate } from '../../public/js/domain/finance.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const d = (y, m, day) => new Date(y, m - 1, day);

test('a period starts the day the salary actually landed, not always the 25th', () => {
  S.settings.salaryDay = 25;
  S.incomes = [
    { date: '2026-09-25', amount: 6326, note: 'Salary' },
    { date: '2026-10-24', amount: 6685, note: 'Salary' },          // 25 Oct is a Sunday: paid a day early
    { date: '2026-10-06', amount: 28, note: 'Reconciliation — unlogged income' },
  ];
  let p = periodOf(d(2026, 10, 26));
  assert.deepEqual([ymd(p.start), ymd(p.end)], ['2026-10-24', '2026-11-24']);
  p = periodOf(d(2026, 10, 10));
  assert.deepEqual([ymd(p.start), ymd(p.end)], ['2026-09-25', '2026-10-23']);
  assert.equal(ymd(periodOf(d(2026, 10, 23)).end), '2026-10-23');
  assert.equal(ymd(periodOf(d(2026, 10, 24)).start), '2026-10-24');
});

test('without a salary credit the nominal day is used; next salary follows the credit', () => {
  S.settings.salaryDay = 25;
  S.incomes = [];
  const p = periodOf(d(2026, 11, 10));
  assert.deepEqual([ymd(p.start), ymd(p.end)], ['2026-10-25', '2026-11-24']);
  assert.ok(nextSalaryDate() instanceof Date);
});

import { recurringLogged, toggleRecurringPaid, autoLogRecurring } from '../../public/js/domain/finance.js';
test('recurring checklist: ticking counts no money and resets with the salary cycle', () => {
  S.settings.salaryDay = 25; S.incomes = []; S.expenses = []; S.recurring = [{ id: 'rent', name: 'House rent', amount: 2300, cat: 'Rent', active: true }]; S.recurringPaid = {};
  assert.equal(recurringLogged('rent'), false);
  toggleRecurringPaid('rent');
  assert.equal(recurringLogged('rent'), true);
  assert.equal(S.expenses.length, 0);                       // no expense is created
  assert.equal(autoLogRecurring(), 0);
  assert.equal(S.expenses.length, 0);
  toggleRecurringPaid('rent');
  assert.equal(recurringLogged('rent'), false);              // undo
});

import { workdaysBetween, leaveTaken } from '../../public/js/domain/schedule.js';
test('leave: public holidays are not leave days; sick leave is counted per type', () => {
  assert.equal(workdaysBetween('2026-11-30', '2026-12-04'), 5);
  assert.equal(workdaysBetween('2026-11-30', '2026-12-04', ['2026-12-02', '2026-12-03']), 3);
  assert.equal(workdaysBetween('2026-12-05', '2026-12-06', []), 0);                                   // a weekend
  S.leaveSettings = { holidays: [{ date: '2026-12-02', name: 'UAE National Day' }] };
  S.leaveLog = [
    { id: 'a', type: 'annual', startDate: '2026-11-30', endDate: '2026-12-04', status: 'pending' },
    { id: 's', type: 'sick', startDate: '2026-03-02', endDate: '2026-03-03' },
    { id: 'h', type: 'sickhalf', startDate: '2026-04-06', endDate: '2026-04-06' },
  ];
  const yr = { start: '2026-01-01', end: '2026-12-31', year: 2026 };
  assert.equal(leaveTaken('annual', yr), 4);
  assert.equal(leaveTaken('sick', yr), 2);
  assert.equal(leaveTaken('sickhalf', yr), 1);
});

import { carryForwardFor } from '../../public/js/domain/schedule.js';
test('leave: each year carries over what is left of the year before, capped at 10', () => {
  S.leaveSettings = { entitlementDays: 23, carryForward: 7, carryYear: 2026, holidays: [] };
  S.leaveLog = [{ id: 'a', type: 'annual', startDate: '2026-08-10', endDate: '2026-08-21' }, { id: 'b', type: 'annual', startDate: '2026-12-07', endDate: '2026-12-21' }];
  assert.equal(carryForwardFor(2026), 7);          // the typed number for the base year
  assert.equal(carryForwardFor(2027), 9);          // 23 + 7 - 21 = 9
  S.leaveLog = [{ id: 'a', type: 'annual', startDate: '2026-08-10', endDate: '2026-08-14' }];
  assert.equal(carryForwardFor(2027), 10);         // 23 + 7 - 5 = 25 left, capped at 10
  S.leaveLog = [{ id: 'a', type: 'annual', startDate: '2026-01-05', endDate: '2026-12-31' }];
  assert.equal(carryForwardFor(2027), 0);          // nothing left, never negative
  S.leaveLog = [];
  assert.equal(carryForwardFor(2028), 10);         // chains year by year
  delete S.leaveSettings.carryYear;
  assert.equal(carryForwardFor(2027), 7);          // no anchor year: nothing rolls over by itself
});

import { entitlementFor, yearSummary } from '../../public/js/domain/schedule.js';
test('leave: a year can have its own entitlement; the plan for next year adds up', () => {
  S.leaveSettings = { entitlementDays: 23, entitlementByYear: { 2027: 26 }, carryForward: 7, carryYear: 2026, holidays: [] };
  S.leaveLog = [{ id: 'a', type: 'annual', startDate: '2026-08-10', endDate: '2026-08-21' }, { id: 'b', type: 'annual', startDate: '2026-12-07', endDate: '2026-12-21' },
    { id: 'c', type: 'annual', startDate: '2027-06-24', endDate: '2027-07-12' }, { id: 'd', type: 'annual', startDate: '2027-10-07', endDate: '2027-10-25' }];
  assert.deepEqual([entitlementFor(2026), entitlementFor(2027), entitlementFor(2028)], [23, 26, 23]);
  const y = yearSummary(2027);
  assert.deepEqual([y.entitlement, y.carry, y.taken, y.remaining], [26, 9, 26, 9]);       // 26 + 9 - 26
  assert.equal(carryForwardFor(2028), 9);                                                  // all 9 carry again (under the cap of 10)
});
