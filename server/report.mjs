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

const C = { ink: '#111827', mute: '#6B7280', soft: '#9CA3AF', white: '#FFFFFF', line: '#E5E7EB', zebra: '#F5F7FB', track: '#E8ECF3', shadow: '#DDE2EC',
  indigo: '#1E1B4B', blue: '#3B82F6', teal: '#14B8A6', green: '#10B981', red: '#EF4444', amber: '#F59E0B', violet: '#8B5CF6', pink: '#EC4899', sky: '#0EA5E9' };
const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#0EA5E9', '#F97316', '#94A3B8'];
const PW = 595, PH = 842, MX = 36;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

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

  // ---- richer primitives ----
  hgrad(x, top, w, h, c1, c2, c3, steps = 90) {
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1), col = c3 ? (t < .5 ? mix(c1, c2, t * 2) : mix(c2, c3, (t - .5) * 2)) : mix(c1, c2, t);
      this.rect(x + w * i / steps, top, w / steps + 0.6, h, col);
    }
  }
  poly(pts, color) {
    this.ops.push(`${rgb(color)} rg ` + pts.map(([x, t], i) => `${x.toFixed(1)} ${(PH - t).toFixed(1)} ${i ? 'l' : 'm'}`).join(' ') + ' f');
  }
  circle(cx, cy, r, color) {
    const k = r * 0.5523, Y = PH - cy;
    this.ops.push(`${rgb(color)} rg ${(cx + r).toFixed(1)} ${Y.toFixed(1)} m ${(cx + r).toFixed(1)} ${(Y + k).toFixed(1)} ${(cx + k).toFixed(1)} ${(Y + r).toFixed(1)} ${cx.toFixed(1)} ${(Y + r).toFixed(1)} c `
      + `${(cx - k).toFixed(1)} ${(Y + r).toFixed(1)} ${(cx - r).toFixed(1)} ${(Y + k).toFixed(1)} ${(cx - r).toFixed(1)} ${Y.toFixed(1)} c `
      + `${(cx - r).toFixed(1)} ${(Y - k).toFixed(1)} ${(cx - k).toFixed(1)} ${(Y - r).toFixed(1)} ${cx.toFixed(1)} ${(Y - r).toFixed(1)} c `
      + `${(cx + k).toFixed(1)} ${(Y - r).toFixed(1)} ${(cx + r).toFixed(1)} ${(Y - k).toFixed(1)} ${(cx + r).toFixed(1)} ${Y.toFixed(1)} c f`);
  }
  rrect(x, top, w, h, r, color) {
    r = Math.min(r, w / 2, h / 2); const k = r * 0.4477, Y = PH - top - h;
    const f = n => n.toFixed(1);
    this.ops.push(`${rgb(color)} rg ${f(x + r)} ${f(Y)} m ${f(x + w - r)} ${f(Y)} l ${f(x + w - k)} ${f(Y)} ${f(x + w)} ${f(Y + k)} ${f(x + w)} ${f(Y + r)} c `
      + `${f(x + w)} ${f(Y + h - r)} l ${f(x + w)} ${f(Y + h - k)} ${f(x + w - k)} ${f(Y + h)} ${f(x + w - r)} ${f(Y + h)} c `
      + `${f(x + r)} ${f(Y + h)} l ${f(x + k)} ${f(Y + h)} ${f(x)} ${f(Y + h - k)} ${f(x)} ${f(Y + h - r)} c `
      + `${f(x)} ${f(Y + r)} l ${f(x)} ${f(Y + k)} ${f(x + k)} ${f(Y)} ${f(x + r)} ${f(Y)} c f`);
  }
  card(x, top, w, h, r = 10) { this.rrect(x + 1.5, top + 2.5, w, h, r, C.shadow); this.rrect(x, top, w, h, r, C.white); }
  clip(x, top, w, h) { this.ops.push(`q ${x} ${PH - top - h} ${w} ${h} re W n`); }
  unclip() { this.ops.push('Q'); }
  // ring segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise)
  wedge(cx, cy, r0, r1, a0, a1, color) {
    const n = Math.max(2, Math.ceil((a1 - a0) / 0.05)), pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const pts = []; for (let i = 0; i <= n; i++) pts.push(pt(r1, a0 + (a1 - a0) * i / n));
    for (let i = n; i >= 0; i--) pts.push(pt(r0, a0 + (a1 - a0) * i / n));
    this.poly(pts, color);
  }
  build() {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      this.ops = ops;
      this.line(MX, PH - 34, PW - MX, PH - 34, C.line);
      this.text(MX, PH - 28, 'My Personal Logger  |  Month-end report', { size: 7.5, color: C.soft });
      this.text(PW - MX, PH - 28, `${i + 1} / ${n}`, { size: 7.5, color: C.soft, align: 'right' });
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
  const spend = q => (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && inP(e, q));
  const exps = spend(p).sort((a, b) => a.date.localeCompare(b.date));
  const incs = (S.incomes || []).filter(i => inP(i, p)).sort((a, b) => a.date.localeCompare(b.date));
  const sum = l => l.reduce((s, x) => s + Number(x.amount || 0), 0);
  const spent = sum(exps), earned = sum(incs), saved = earned - spent, prevSpent = sum(spend(prev));
  const length = Math.round((p.end - p.start) / DAY) + 1;
  const isAdj = e => /^Reconciliation/i.test(e.note || '');
  const real = exps.filter(e => !isAdj(e));
  const d = new Doc();

  // ===== hero =====
  d.hgrad(0, 0, PW, 214, C.indigo, '#2B3A8F', '#0E8F8A');
  d.clip(0, 0, PW, 214);
  d.circle(PW - 40, 30, 150, mix('#2B3A8F', '#ffffff', 0.07));
  d.circle(PW - 10, 190, 95, mix('#0E8F8A', '#ffffff', 0.10));
  d.circle(60, 235, 80, mix(C.indigo, '#ffffff', 0.06));
  d.unclip();
  d.text(MX, 30, 'MONTH-END REPORT', { size: 8.5, bold: true, color: '#A5B4FC' });
  d.text(MX, 46, `${dShort(p.start)} - ${dLong(p.end)}`, { size: 25, bold: true, color: C.white });
  d.text(MX, 80, `${length} days  |  one salary cycle  |  amounts in AED`, { size: 9.5, color: '#C7D2FE' });
  d.text(MX, 112, saved >= 0 ? 'YOU KEPT' : 'YOU OVERSPENT BY', { size: 8.5, bold: true, color: '#99F6E4' });
  d.text(MX, 124, `AED ${num(Math.abs(saved), 0)}`, { size: 38, bold: true, color: saved >= 0 ? C.white : '#FDE68A' });
  d.text(MX, 172, earned ? (saved >= 0 ? `${Math.round(saved / earned * 100)}% of your income stayed in the bank` : `spending ran ${Math.round(spent / earned * 100)}% of income`) : 'no income logged this period', { size: 9.5, color: '#E0E7FF' });
  // gauge: share of income spent
  const gx = PW - MX - 62, gy = 110, share = earned ? Math.min(1, spent / earned) : 0;
  d.wedge(gx, gy, 40, 54, 0, Math.PI * 2 - 0.001, mix(C.indigo, '#ffffff', 0.22));
  if (share > 0.004) d.wedge(gx, gy, 40, 54, 0, Math.PI * 2 * share, share > 0.999 && saved < 0 ? C.amber : '#5EEAD4');
  d.text(gx, gy - 12, `${earned ? Math.round(spent / earned * 100) : 0}%`, { size: 20, bold: true, color: C.white, align: 'center' });
  d.text(gx, gy + 11, 'of income spent', { size: 7.5, color: '#C7D2FE', align: 'center' });

  // ===== KPI cards overlapping the hero =====
  const kw = (PW - 2 * MX - 24) / 3, ky = 190;
  const avg = spent / length;
  const delta = prevSpent ? Math.round((spent - prevSpent) / prevSpent * 100) : null;
  const kpis = [['INCOME', earned, C.green, `${incs.length} credit${incs.length === 1 ? '' : 's'} received`, 'up'], ['SPENT', spent, C.red, delta == null ? `${exps.length} payments` : `${delta >= 0 ? '+' : ''}${delta}% vs last period`, 'down'],
    ['PER DAY', avg, C.blue, `${exps.length} payments in ${length} days`, 'dot']];
  kpis.forEach(([label, v, color, sub, icon], i) => {
    const x = MX + i * (kw + 12);
    d.card(x, ky, kw, 74);
    d.circle(x + 24, ky + 25, 11, mix(color, '#ffffff', 0.85));
    if (icon === 'up') d.poly([[x + 24, ky + 19], [x + 30, ky + 30], [x + 18, ky + 30]], color);
    else if (icon === 'down') d.poly([[x + 18, ky + 20], [x + 30, ky + 20], [x + 24, ky + 31]], color);
    else d.circle(x + 24, ky + 25, 4, color);
    d.text(x + 42, ky + 15, label, { size: 8, bold: true, color: C.mute });
    d.text(x + 42, ky + 27, num(v, 0), { size: 19, bold: true, color: C.ink });
    d.text(x + 14, ky + 58, sub, { size: 8, color: icon === 'down' && delta > 0 ? C.red : C.mute });
  });

  // ===== spending breakdown: donut + legend =====
  let y = 288;
  const section = (title, sub) => { d.rect(MX, y + 1, 3, 13, C.blue); d.text(MX + 10, y, title, { size: 12.5, bold: true }); if (sub) d.text(PW - MX, y + 3, sub, { size: 8, color: C.mute, align: 'right' }); y += 24; };
  section('Where the money went', `${exps.length} payments`);
  const byCat = {}; for (const e of exps) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const top = cats.slice(0, 7), rest = sum(cats.slice(7).map(([, v]) => ({ amount: v })));
  const slices = rest > 0 ? [...top, ['Everything else', rest]] : top;
  const cx = MX + 78, cy = y + 74;
  let a = 0;
  slices.forEach(([, v], i) => { const da = spent ? v / spent * Math.PI * 2 : 0; if (da > 0.004) d.wedge(cx, cy, 44, 72, a, a + da - 0.012, PALETTE[i % PALETTE.length]); a += da; });
  d.text(cx, cy - 11, num(spent, 0), { size: 15, bold: true, align: 'center' });
  d.text(cx, cy + 6, 'total spent', { size: 7.5, color: C.mute, align: 'center' });
  const lx = MX + 176;
  slices.forEach(([c, v], i) => {
    const ly = y + 4 + i * 18, b = Number((S.budgets || {})[c] || 0), over = b > 0 && v > b;
    d.rrect(lx, ly + 1, 9, 9, 2.5, PALETTE[i % PALETTE.length]);
    d.text(lx + 17, ly, fit(c, 9.5, 150), { size: 9.5 });
    if (over) { d.rrect(lx + 17 + Math.min(150, textW(asciiOnly(c), 9.5)) + 6, ly - 1, 38, 11, 5, '#FEE2E2'); d.text(lx + 17 + Math.min(150, textW(asciiOnly(c), 9.5)) + 25, ly + 1, 'OVER', { size: 6.5, bold: true, color: C.red, align: 'center' }); }
    d.text(PW - MX - 44, ly, num(v, 0), { size: 9.5, bold: true, align: 'right' });
    d.text(PW - MX, ly, `${spent ? Math.round(v / spent * 100) : 0}%`, { size: 9, color: C.mute, align: 'right' });
  });
  y += 158;

  // ===== daily rhythm + weekday =====
  section('Daily rhythm', 'red = peak day   dashed = daily average');
  const cw = 330, chartH = 64, bw = cw / length;
  const byDay = {}; for (const e of real) byDay[e.date] = (byDay[e.date] || 0) + Number(e.amount || 0);
  const maxDay = Math.max(1, ...Object.values(byDay));
  d.card(MX, y, cw + 20, chartH + 30, 8);
  const wd = [0, 0, 0, 0, 0, 0, 0], wdN = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < length; i++) {
    const dt = new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() + i), v = byDay[iso(dt)] || 0;
    wd[dt.getDay()] += v; wdN[dt.getDay()]++;
    if ([0, 6].includes(dt.getDay())) d.rect(MX + 10 + i * bw, y + 8, bw, chartH, '#F3F4F8');
    const h = v / maxDay * (chartH - 10);
    if (h > 0) d.rect(MX + 10 + i * bw + 0.8, y + 8 + chartH - h, Math.max(1.2, bw - 1.6), h, v === maxDay ? C.red : mix(C.blue, C.violet, i / length));
  }
  const avgY = y + 8 + chartH - avg / maxDay * (chartH - 10);
  if (avgY > y + 8) d.line(MX + 10, avgY, MX + 10 + cw, avgY, C.amber, 1, '3 2');
  d.text(MX + 10, y + chartH + 14, dShort(p.start), { size: 7.5, color: C.mute });
  d.text(MX + 10 + cw, y + chartH + 14, dShort(p.end), { size: 7.5, color: C.mute, align: 'right' });
  const wx = MX + cw + 38, ww = PW - MX - wx;
  d.card(wx, y, ww, chartH + 30, 8);
  d.text(wx + 10, y + 8, 'Average by weekday', { size: 8, bold: true, color: C.mute });
  const names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], wavg = wd.map((v, i) => wdN[i] ? v / wdN[i] : 0), wmax = Math.max(1, ...wavg), wbw = (ww - 20) / 7;
  wavg.forEach((v, i) => { const h = v / wmax * 44; d.rrect(wx + 10 + i * wbw + 2, y + 22 + 44 - h, wbw - 4, Math.max(2, h), 2, v === wmax ? C.pink : mix(C.sky, C.teal, i / 6)); d.text(wx + 10 + i * wbw + wbw / 2, y + 70, names[i], { size: 7.5, color: C.mute, align: 'center' }); });
  y += chartH + 44;

  // ===== top merchants / biggest payments =====
  section('Top spending', '');
  const groups = {};
  for (const e of real) { const k = (e.note || e.cat || 'Other').toUpperCase().replace(/[0-9]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'OTHER'; (groups[k] = groups[k] || { v: 0, n: 0 }); groups[k].v += Number(e.amount || 0); groups[k].n++; }
  const mer = Object.entries(groups).sort((a, b) => b[1].v - a[1].v).slice(0, 5);
  const big = real.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
  const half = (PW - 2 * MX - 14) / 2;
  d.card(MX, y, half, 104, 8); d.card(MX + half + 14, y, half, 104, 8);
  d.text(MX + 12, y + 9, 'Top places', { size: 8, bold: true, color: C.mute });
  d.text(MX + half + 26, y + 9, 'Biggest payments', { size: 8, bold: true, color: C.mute });
  const mmax = Math.max(1, ...mer.map(([, g]) => g.v));
  mer.forEach(([k, g], i) => {
    const ry = y + 24 + i * 15.5;
    d.text(MX + 12, ry, fit(k.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), 8.5, 118), { size: 8.5 });
    d.rrect(MX + 136, ry + 1, half - 200, 7, 3, C.track); d.rrect(MX + 136, ry + 1, Math.max(4, g.v / mmax * (half - 200)), 7, 3, PALETTE[i % PALETTE.length]);
    d.text(MX + half - 10, ry, num(g.v, 0), { size: 8.5, bold: true, align: 'right' });
  });
  big.forEach((e, i) => {
    const ry = y + 24 + i * 15.5, x0 = MX + half + 26;
    d.text(x0, ry, dShort(parseISO(e.date)), { size: 8, color: C.mute });
    d.text(x0 + 40, ry, fit(e.note || e.cat || '', 8.5, half - 120), { size: 8.5 });
    d.text(MX + 2 * half + 4, ry, num(e.amount, 0), { size: 8.5, bold: true, color: C.red, align: 'right' });
  });
  y += 120;

  // ===== cash-flow strip =====
  section('Cash flow', '');
  const sw = PW - 2 * MX, fw = earned ? Math.min(1, spent / earned) * sw : 0;
  d.rrect(MX, y, sw, 16, 8, saved >= 0 ? '#BBF7D0' : '#FECACA');
  if (fw > 0) d.rrect(MX, y, Math.max(16, fw), 16, 8, saved >= 0 ? C.red : C.amber);
  d.text(MX + 10, y + 3.5, `Spent ${num(spent, 0)}`, { size: 8, bold: true, color: C.white });
  d.text(MX + sw - 10, y + 3.5, saved >= 0 ? `Kept ${num(saved, 0)}` : `Income ${num(earned, 0)}`, { size: 8, bold: true, color: saved >= 0 ? '#065F46' : '#7F1D1D', align: 'right' });

  // ===== tables =====
  d.add(); y = 48;
  const table = (title, accent, head, rows, cols) => {
    if (y + 60 > PH - 50) { d.add(); y = 48; }
    d.rect(MX, y + 1, 3, 13, accent); d.text(MX + 10, y, title, { size: 12.5, bold: true }); y += 26;
    const header = () => { d.rrect(MX, y, PW - 2 * MX, 18, 5, C.indigo); cols.forEach((c, i) => d.text(c.align === 'right' ? MX + c.x + c.w : MX + c.x + 8, y + 5, head[i], { size: 7.5, bold: true, color: C.white, align: c.align })); y += 20; };
    header();
    rows.forEach((r, ri) => {
      if (y + 17 > PH - 46) { d.add(); y = 48; header(); }
      if (ri % 2 === 0) d.rect(MX, y, PW - 2 * MX, 17, C.zebra);
      cols.forEach((c, i) => d.text(c.align === 'right' ? MX + c.x + c.w : MX + c.x + 8, y + 4.5, fit(String(r[i] ?? ''), 8.5, c.w - 10), { size: 8.5, align: c.align, bold: c.bold, color: c.color ? c.color(r) : C.ink }));
      y += 17;
    });
    d.line(MX, y, PW - MX, y, C.line); y += 18;
  };
  table(`Income  (${incs.length})`, C.green, ['DATE', 'DESCRIPTION', 'AED'], incs.map(i => [dShort(parseISO(i.date)), i.note || i.type || 'Income', num(i.amount)]),
    [{ x: 0, w: 70 }, { x: 70, w: 360 }, { x: 430, w: PW - 2 * MX - 430 - 8, align: 'right', bold: true, color: () => C.green }]);
  table(`All expenses  (${exps.length})`, C.red, ['DATE', 'CATEGORY', 'DESCRIPTION', 'AED'], exps.map(e => [dShort(parseISO(e.date)), e.cat || 'Other', e.note || '', num(e.amount)]),
    [{ x: 0, w: 62 }, { x: 62, w: 108 }, { x: 170, w: 260 }, { x: 430, w: PW - 2 * MX - 430 - 8, align: 'right', bold: true }]);
  return d.build();
}
