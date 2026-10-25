// Month-end report for one salary period as a designed PDF (header band, KPI cards, charts, tables).
// Hand-written PDF 1.4 with the standard Helvetica fonts: no dependencies, nothing to install.
import { periodOf } from '../public/js/domain/periods.js';

const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (n, dp = 2) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const dShort = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dLong = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// The period that just ended, given "now"
export function lastFinishedPeriod(S, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (S.settings || {}).salaryDay || 25;
  return periodOf(day, S.incomes, new Date(periodOf(day, S.incomes, today).start - DAY));
}

// ---- PDF drawing kit -------------------------------------------------------------------------
// Helvetica advance widths for ASCII 32..126 (1/1000 em); bold is close enough for fitting text.
const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const asciiOnly = s => String(s).replace(/₹/g, 'INR ').replace(/[—–]/g, '-').replace(/[•·]/g, '.').replace(/[^\x20-\x7e]/g, '?');
const textW = (s, size) => [...s].reduce((a, c) => a + (W[c.charCodeAt(0) - 32] || 556), 0) * size / 1000;
function fit(s, size, maxW) {
  s = asciiOnly(s);
  if (textW(s, size) <= maxW) return s;
  while (s.length > 1 && textW(s + '...', size) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '...';
}
const esc = s => s.replace(/[\\()]/g, m => '\\' + m);
const rgb = h => [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

const C = { navy: '#17324D', blue: '#2F80ED', green: '#1E9E6A', red: '#D64545', amber: '#E5A100', ink: '#1F2937', mute: '#6B7280', zebra: '#F3F6FA', track: '#E6EBF2', white: '#FFFFFF', line: '#D5DCE6' };
const PALETTE = ['#2F80ED', '#1E9E6A', '#E5A100', '#9B51E0', '#D64545', '#00A3C4', '#F2994A', '#6B7280'];
const PW = 595, PH = 842, MX = 36;

class Doc {
  constructor() { this.pages = []; this.add(); }
  add() { this.ops = []; this.pages.push(this.ops); }
  rect(x, top, w, h, color) { this.ops.push(`${rgb(color)} rg ${x.toFixed(1)} ${(PH - top - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); }
  line(x1, t1, x2, t2, color, width = 0.6, dash = '') { this.ops.push(`${rgb(color)} RG ${width} w ${dash ? `[${dash}] 0 d` : '[] 0 d'} ${x1.toFixed(1)} ${(PH - t1).toFixed(1)} m ${x2.toFixed(1)} ${(PH - t2).toFixed(1)} l S`); }
  text(x, top, s, { size = 9, bold = false, color = C.ink, align = 'left' } = {}) {
    s = asciiOnly(s);
    const w = textW(s, size);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${px.toFixed(1)} ${(PH - top - size * 0.8).toFixed(1)} Td (${esc(s)}) Tj ET`);
  }
  build() {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      this.ops = ops;
      this.line(MX, PH - 34, PW - MX, PH - 34, C.line);
      this.text(MX, PH - 28, 'My Personal Logger', { size: 7.5, color: C.mute });
      this.text(PW - MX, PH - 28, `Page ${i + 1} of ${n}`, { size: 7.5, color: C.mute, align: 'right' });
    });
    const objs = [null, '<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    this.pages.forEach((ops, i) => {
      const body = ops.join('\n');
      objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
      objs[6 + i * 2] = `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`;
    });
    let out = '%PDF-1.4\n'; const off = [];
    for (let i = 1; i < objs.length; i++) { off[i] = Buffer.byteLength(out, 'latin1'); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const x = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${off.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

// ---- the report ------------------------------------------------------------------------------
export function buildReportPdf(S, p) {
  const day = (S.settings || {}).salaryDay || 25;
  const prev = periodOf(day, S.incomes, new Date(p.start - DAY));
  const inP = (e, q) => { const d = parseISO(e.date); return d >= q.start && d <= q.end; };
  const spend = (q) => (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && inP(e, q));
  const exps = spend(p).sort((a, b) => a.date.localeCompare(b.date));
  const incs = (S.incomes || []).filter(i => inP(i, p)).sort((a, b) => a.date.localeCompare(b.date));
  const sum = l => l.reduce((s, x) => s + Number(x.amount || 0), 0);
  const spent = sum(exps), earned = sum(incs), saved = earned - spent, prevSpent = sum(spend(prev));
  const length = Math.round((p.end - p.start) / DAY) + 1;
  const isAdj = e => /^Reconciliation/i.test(e.note || '');

  const d = new Doc();
  // header band
  d.rect(0, 0, PW, 104, C.navy);
  d.rect(0, 104, PW, 3, C.blue);
  d.text(MX, 26, 'MONTH-END REPORT', { size: 9, bold: true, color: '#9FB6D1' });
  d.text(MX, 42, `${dShort(p.start)} - ${dLong(p.end)}`, { size: 24, bold: true, color: C.white });
  d.text(MX, 76, `${length} days  |  salary period  |  amounts in AED`, { size: 9.5, color: '#C7D4E6' });
  d.text(PW - MX, 76, `Generated ${dLong(new Date())}`, { size: 8.5, color: '#9FB6D1', align: 'right' });

  // KPI cards
  const kw = (PW - 2 * MX - 24) / 3, ky = 128;
  const kpis = [['INCOME', earned, C.green, `${incs.length} credits`], ['SPENT', spent, C.red, prevSpent ? `${spent >= prevSpent ? 'up' : 'down'} ${Math.abs(Math.round((spent - prevSpent) / prevSpent * 100))}% vs last period` : `${exps.length} payments`],
    [saved >= 0 ? 'SAVED' : 'OVERSPENT', Math.abs(saved), saved >= 0 ? C.blue : C.amber, earned ? `${Math.round(Math.abs(saved) / earned * 100)}% of income` : '']];
  kpis.forEach(([label, v, color, sub], i) => {
    const x = MX + i * (kw + 12);
    d.rect(x, ky, kw, 70, C.zebra); d.rect(x, ky, 4, 70, color);
    d.text(x + 14, ky + 11, label, { size: 8, bold: true, color: C.mute });
    d.text(x + 14, ky + 26, num(v, 0), { size: 22, bold: true, color });
    d.text(x + 14, ky + 55, sub, { size: 8, color: C.mute });
  });

  // highlights
  const byDay = {}; for (const e of exps.filter(e => !isAdj(e))) byDay[e.date] = (byDay[e.date] || 0) + Number(e.amount || 0);
  const busiest = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const biggest = exps.filter(e => !isAdj(e)).sort((a, b) => b.amount - a.amount)[0];
  let y = 218;
  d.text(MX, y, 'Highlights', { size: 12, bold: true, color: C.navy }); y += 20;
  const hl = [['Average per day', `AED ${num(spent / length, 0)}`], ['Busiest day', busiest ? `${dShort(parseISO(busiest[0]))}  -  AED ${num(busiest[1], 0)}` : '-'],
    ['Biggest expense', biggest ? `AED ${num(biggest.amount, 0)}  ${biggest.note || biggest.cat || ''}` : '-'], ['Previous period', prevSpent ? `AED ${num(prevSpent, 0)} spent` : '-']];
  hl.forEach(([k, v], i) => { const cx = MX + (i % 2) * 268, cy = y + Math.floor(i / 2) * 18;
    d.text(cx, cy, k, { size: 8.5, color: C.mute }); d.text(cx + 82, cy, fit(v, 9, 175), { size: 9, bold: true }); });
  y += 50;

  // spending by category (bars + budget ticks)
  d.text(MX, y, 'Where the money went', { size: 12, bold: true, color: C.navy }); y += 20;
  const byCat = {}; for (const e of exps) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const shown = cats.slice(0, 8);
  const scale = Math.max(1, ...shown.map(([c, v]) => Math.max(v, Number((S.budgets || {})[c] || 0))));
  const tx = MX + 118, tw = 250;
  shown.forEach(([c, v], i) => {
    const b = Number((S.budgets || {})[c] || 0), over = b > 0 && v > b;
    d.text(MX, y + 1, fit(c, 9, 112), { size: 9 });
    d.rect(tx, y, tw, 11, C.track);
    d.rect(tx, y, Math.max(2, v / scale * tw), 11, over ? C.red : PALETTE[i % PALETTE.length]);
    if (b > 0) { d.line(tx + b / scale * tw, y - 2, tx + b / scale * tw, y + 13, C.ink, 1.2); }
    d.text(tx + tw + 10, y + 1, num(v, 0), { size: 9, bold: true });
    d.text(PW - MX, y + 1, `${spent ? Math.round(v / spent * 100) : 0}%${over ? '  OVER' : ''}`, { size: 8.5, bold: over, color: over ? C.red : C.mute, align: 'right' });
    y += 20;
  });
  if (cats.length > shown.length) { d.text(MX, y, `+ ${cats.length - shown.length} more categories (AED ${num(sum(cats.slice(8).map(([, v]) => ({ amount: v }))), 0)})`, { size: 8, color: C.mute }); y += 14; }
  if (Object.values(S.budgets || {}).some(Number)) { d.line(MX, y + 4, MX + 8, y + 4, C.ink, 1.2); d.text(MX + 14, y, 'budget limit', { size: 7.5, color: C.mute }); y += 14; }
  y += 8;

  // daily spending chart
  d.text(MX, y, 'Spending day by day', { size: 12, bold: true, color: C.navy }); y += 18;
  const chartH = 70, cw = PW - 2 * MX, bw = cw / length;
  const maxDay = Math.max(1, ...Object.values(byDay));
  d.rect(MX, y, cw, chartH, C.zebra);
  for (let i = 0; i < length; i++) {
    const v = byDay[iso(new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() + i))] || 0;
    const h = v / maxDay * (chartH - 8);
    if (h > 0) d.rect(MX + i * bw + 1, y + chartH - h, Math.max(1, bw - 2), h, v === maxDay ? C.red : C.blue);
  }
  const avgY = y + chartH - (spent / length) / maxDay * (chartH - 8);
  if (avgY > y) d.line(MX, avgY, MX + cw, avgY, C.amber, 0.9, '3 3');
  d.text(MX, y + chartH + 3, dShort(p.start), { size: 7.5, color: C.mute });
  d.text(MX + cw / 2, y + chartH + 3, `peak AED ${num(maxDay, 0)}  |  dashed = daily average`, { size: 7.5, color: C.mute, align: 'center' });
  d.text(MX + cw, y + chartH + 3, dShort(p.end), { size: 7.5, color: C.mute, align: 'right' });
  y += chartH + 24;

  // tables
  const table = (title, head, rows, cols) => {
    const need = 44;
    if (y + need > PH - 50) { d.add(); y = 50; }
    d.text(MX, y, title, { size: 12, bold: true, color: C.navy }); y += 20;
    const header = () => { d.rect(MX, y, PW - 2 * MX, 17, C.navy); cols.forEach((c, i) => d.text(c.align === 'right' ? MX + c.x + c.w : MX + c.x + 6, y + 4.5, head[i], { size: 8, bold: true, color: C.white, align: c.align })); y += 17; };
    header();
    rows.forEach((r, ri) => {
      if (y + 16 > PH - 46) { d.add(); y = 50; header(); }
      if (ri % 2) d.rect(MX, y, PW - 2 * MX, 16, C.zebra);
      cols.forEach((c, i) => d.text(c.align === 'right' ? MX + c.x + c.w : MX + c.x + 6, y + 4, fit(String(r[i] ?? ''), 8.5, c.w - 8), { size: 8.5, align: c.align, bold: c.bold, color: c.color && c.color(r) }));
      y += 16;
    });
    y += 14;
  };
  table(`Income  (${incs.length})`, ['Date', 'Description', 'AED'],
    incs.map(i => [dShort(parseISO(i.date)), i.note || i.type || 'Income', num(i.amount)]),
    [{ x: 0, w: 70 }, { x: 70, w: 360 }, { x: 430, w: PW - 2 * MX - 430, align: 'right', bold: true, color: () => C.green }]);
  table(`All expenses  (${exps.length})`, ['Date', 'Category', 'Description', 'AED'],
    exps.map(e => [dShort(parseISO(e.date)), e.cat || 'Other', e.note || '', num(e.amount)]),
    [{ x: 0, w: 60 }, { x: 60, w: 110 }, { x: 170, w: 260 }, { x: 430, w: PW - 2 * MX - 430, align: 'right', bold: true }]);
  return d.build();
}
