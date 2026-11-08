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
// Every date the app shows is DD/MM/YYYY
export function dmy(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// 'DD/MM/YYYY' -> 'YYYY-MM-DD' (null when it is not a real date, '' when empty)
export function parseDmy(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export const fmtDateObj = d => dmy(iso(d));
export function fmtDate(s) {
  return s ? (dmy(s) || String(s)) : '—';
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
