// Month-end report for one salary period, as a small text-only PDF (no dependencies).
import { periodOf } from '../public/js/domain/periods.js';

const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const rpad = (s, n) => String(s).slice(0, n).padStart(n);

// The period that just ended, given "now"
export function lastFinishedPeriod(S, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (S.settings || {}).salaryDay || 25;
  const cur = periodOf(day, S.incomes, today);
  return periodOf(day, S.incomes, new Date(cur.start - DAY));
}

export function reportLines(S, p) {
  const inP = e => { const d = parseISO(e.date); return d >= p.start && d <= p.end; };
  const spendAll = (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && inP(e));
  const incomes = (S.incomes || []).filter(inP);
  const spent = spendAll.reduce((s, e) => s + Number(e.amount || 0), 0);
  const earned = incomes.reduce((s, e) => s + Number(e.amount || 0), 0);
  const L = [];
  L.push(`Month-end report  ${iso(p.start)} to ${iso(p.end)}  (${Math.round((p.end - p.start) / DAY) + 1} days)`, '');
  L.push(`Income   AED ${num(earned)}`, `Spent    AED ${num(spent)}`, `Saved    AED ${num(earned - spent)}   (${earned ? Math.round((earned - spent) / earned * 100) : 0}% of income)`, '');
  const byCat = {};
  for (const e of spendAll) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount || 0);
  L.push('SPENDING BY CATEGORY', pad('Category', 28) + rpad('Spent', 12) + rpad('Share', 8) + rpad('Budget', 12));
  for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    const b = Number((S.budgets || {})[c] || 0);
    L.push(pad(c, 28) + rpad(num(v), 12) + rpad(spent ? Math.round(v / spent * 100) + '%' : '', 8) + rpad(b ? num(b) + (v > b ? ' OVER' : '') : '', 12));
  }
  L.push('', 'INCOME', pad('Date', 12) + pad('Description', 50) + rpad('AED', 12));
  for (const i of incomes.sort((a, b) => a.date.localeCompare(b.date))) L.push(pad(i.date, 12) + pad(i.note || i.type || 'Income', 50) + rpad(num(i.amount), 12));
  L.push('', 'ALL EXPENSES', pad('Date', 12) + pad('Category', 20) + pad('Description', 42) + rpad('AED', 12));
  for (const e of spendAll.sort((a, b) => a.date.localeCompare(b.date))) L.push(pad(e.date, 12) + pad(e.cat || 'Other', 20) + pad(e.note || '', 42) + rpad(num(e.amount), 12));
  return L;
}

const clean = s => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, m => '\\' + m);

export function makePdf(lines) {
  const perPage = 62, pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  const objs = [];                       // 1 catalog, 2 pages, 3 font, then (page, content) pairs
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
  pages.forEach((pl, i) => {
    const stream = 'BT /F1 8.5 Tf 11 TL 36 806 Td\n' + pl.map(l => `(${clean(l)}) '`).join('\n') + '\nET';
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n'; const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + off.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
