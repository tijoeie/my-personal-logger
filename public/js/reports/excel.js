// Multi-sheet Excel export in SpreadsheetML 2003 (.xls) — opens in Excel and Numbers, no library needed.
import { S } from '../core/state.js';
import { daysUntil, sum } from '../core/util.js';
import { mashreqComputed } from '../domain/finance.js';
import { statusOf } from '../domain/schedule.js';

const xmlEsc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cell = (c, style) => `<Cell${style ? ' ss:StyleID="h"' : ''}><Data ss:Type="${typeof c === 'number' && !style ? 'Number' : 'String'}">${xmlEsc(c)}</Data></Cell>`;
const hdr = (...cols) => '<Row>' + cols.map(c => cell(c, true)).join('') + '</Row>';
const drow = (...cols) => '<Row>' + cols.map(c => cell(c)).join('') + '</Row>';
const sheet = (name, rows) => `<Worksheet ss:Name="${name}"><Table>${rows.join('')}</Table></Worksheet>`;
const byDateDesc = (a, b) => b.date.localeCompare(a.date);

export function buildExcel() {
  const accs = S.accounts || {};
  const acc = id => accs[id] || {};
  const mashreq = mashreqComputed();

  const accounts = [hdr('Account', 'Balance (AED)', 'Limit (AED)', 'As of'),
    drow('Mashreq Bank', mashreq ?? '', '', ''),
    drow('ENBD CC', Number(acc('enbd_cc').balance || 0), Number(acc('enbd_cc').limit || 0), acc('enbd_cc').balanceDate || ''),
    drow('NOON CC', Number(acc('noon_cc').balance || 0), Number(acc('noon_cc').limit || 0), acc('noon_cc').balanceDate || '')];

  const expenses = [hdr('Date', 'Category', 'Amount (AED)', 'Note', 'Pay Method'),
    ...[...(S.expenses || [])].sort(byDateDesc).map(e => drow(e.date, e.cat, Number(e.amount), e.note || '', e.payMethod || ''))];

  const incomes = [hdr('Date', 'Amount (AED)', 'Note'),
    ...[...(S.incomes || [])].sort(byDateDesc).map(i => drow(i.date, Number(i.amount), i.note || ''))];

  const renewals = [hdr('Name', 'Expiry', 'Status', 'Remind Days', 'Notes'),
    ...(S.renewals || []).map(r => drow(r.title, r.expiry || '', r.expiry ? statusOf(daysUntil(r.expiry), r.remindDays).label : '—', r.remindDays || 60, r.note || ''))];

  const loans = [hdr('Name', 'Total (AED)', 'Outstanding (AED)', 'EMI/month', 'Rate %', 'Note'),
    ...(S.loans || []).map(l => drow(l.name, Number(l.amount), Number(l.outstanding), Number(l.emi), Number(l.rate || 0), l.note || ''))];

  const receivables = [hdr('Name', 'Total (AED)', 'Monthly (AED)', 'Months', 'Amount Received', 'Remaining', 'Note'),
    ...(S.loansGiven || []).map(g => {
      const paid = sum((S.loansGivenPayments || []).filter(p => p.gId === g.id));
      return drow(g.name, Number(g.total), Number(g.monthly || 0), Number(g.months || 0), paid, Math.max(0, g.total - paid), g.note || '');
    })];

  const car = [hdr('Type', 'Date', 'Odometer (km)', 'Cost (AED)', 'Notes'),
    ...[...(S.serviceLog || [])].sort(byDateDesc).map(l => {
      const t = (S.serviceTypes || []).find(x => x.id === l.type);
      return drow(t ? t.name : l.type, l.date, l.odo ? Number(l.odo) : '', l.cost ? Number(l.cost) : '', l.notes || '');
    })];

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style>
</Styles>
${sheet('Accounts', accounts)}
${sheet('Expenses', expenses)}
${sheet('Income', incomes)}
${sheet('Renewals', renewals)}
${sheet('Loans', loans)}
${sheet('Receivables', receivables)}
${sheet('Car Services', car)}
</Workbook>`;
}
