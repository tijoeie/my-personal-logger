// Formatting and date helpers. Dates are local-time 'YYYY-MM-DD' strings throughout.
import { DAY } from './constants.js';
import { S } from './state.js';

export function uid() { return Math.random().toString(36).slice(2, 10); }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function parseISO(s) { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); }
export function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
export function daysUntil(dateStr) { return Math.round((parseISO(dateStr) - today()) / DAY); }
export function fmtDate(s) {
  if (!s) return '—';
  return parseISO(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtTime(ms) { return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }

export function money(n) {
  const num = Number(n || 0);
  return (S.settings.currency || 'AED') + ' ' + num.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Money with the decimals in a smaller span (used for headline figures)
export function moneyH(n) {
  const num = Number(n || 0);
  const sign = num < 0 ? '-' : '';
  const [whole, dec] = Math.abs(num).toFixed(2).split('.');
  return `${sign}${S.settings.currency || 'AED'} ${Number(whole).toLocaleString('en')}<span class="dec">.${dec}</span>`;
}
export const sum = (list, f = x => x.amount) => list.reduce((s, x) => s + Number(f(x) || 0), 0);

export function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 200);
}
