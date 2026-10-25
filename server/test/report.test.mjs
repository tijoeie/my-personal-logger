import test from 'node:test';
import assert from 'node:assert';
import { lastFinishedPeriod, reportLines, makePdf } from '../report.mjs';

const S = {
  settings: { salaryDay: 25 },
  incomes: [{ date: '2026-09-25', amount: 6326, note: 'Salary' }, { date: '2026-10-24', amount: 6685, note: 'Salary' }],
  expenses: [{ date: '2026-10-02', amount: 100, cat: 'Fuel', note: 'ENOC (x)', payMethod: 'bank' }, { date: '2026-10-03', amount: 50, cat: 'Fuel', payMethod: 'cc_payment' }],
  budgets: { Fuel: 80 },
};
test('report covers the period that just ended and builds a valid PDF', () => {
  const p = lastFinishedPeriod(S, new Date(2026, 9, 24));
  assert.deepEqual([p.start.getDate(), p.start.getMonth(), p.end.getDate(), p.end.getMonth()], [25, 8, 23, 9]);
  const lines = reportLines(S, p).join('\n');
  assert.match(lines, /Spent    AED 100.00/);
  assert.match(lines, /Fuel\s+100.00\s+100%\s+80.00 OVER/);
  const pdf = makePdf(reportLines(S, p));
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.match(pdf.toString('latin1'), /%%EOF\n$/);
});
