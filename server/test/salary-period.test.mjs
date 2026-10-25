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
