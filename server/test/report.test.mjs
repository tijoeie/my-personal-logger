import test from 'node:test';
import assert from 'node:assert';
import { lastFinishedPeriod, buildReportPdf } from '../report.mjs';

const S = {
  settings: { salaryDay: 25 },
  incomes: [{ date: '2026-09-25', amount: 6326, note: 'Salary' }, { date: '2026-10-24', amount: 6685, note: 'Salary' }],
  expenses: [{ date: '2026-10-02', amount: 100, cat: 'Fuel', note: 'ENOC (x) \\ INR ₹', payMethod: 'bank' }, { date: '2026-10-03', amount: 50, cat: 'Fuel', payMethod: 'cc_payment' }],
  budgets: { Fuel: 80 },
};
test('report covers the period that just ended and builds a valid multi-page PDF', () => {
  const p = lastFinishedPeriod(S, new Date(2026, 9, 24));
  assert.deepEqual([p.start.getDate(), p.start.getMonth(), p.end.getDate(), p.end.getMonth()], [25, 8, 23, 9]);
  const pdf = buildReportPdf(S, p);
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(pdf.toString('latin1'), /%%EOF\n$/);
  const many = { ...S, expenses: Array.from({ length: 120 }, (_, i) => ({ date: '2026-10-05', amount: 10 + i, cat: 'Other', note: 'item ' + i, payMethod: 'bank' })) };
  assert.match(buildReportPdf(many, p).toString('latin1'), /\/Count [3-9]/);
});
