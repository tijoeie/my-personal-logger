// Weekly summary text for Telegram: built on the server from the saved state, using the same domain code as the app.
import { periodOf, nextSalaryDate } from '../public/js/domain/periods.js';
import { periodInsight } from '../public/js/domain/insights.js';
import { bankBalance, isCredit, PRIMARY } from '../public/js/domain/accounts.js';

const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const aed = n => 'AED ' + Math.round(Number(n || 0)).toLocaleString('en-US');
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function buildSummary(S, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (S.settings || {}).salaryDay || 25;
  const p = periodOf(day, S.incomes, today);
  const prev = periodOf(day, S.incomes, new Date(p.start - DAY));
  const ins = periodInsight(S.expenses || [], p, prev, today);
  const inPeriod = e => { const d = parseISO(e.date); return d >= p.start && d <= p.end; };
  const income = (S.incomes || []).filter(inPeriod).reduce((s, i) => s + Number(i.amount || 0), 0);
  const lines = [`📊 Weekly summary · ${fmt(p.start)} – ${fmt(p.end)} (day ${ins.elapsed} of ${ins.length})`, ''];

  lines.push(`Spent ${aed(ins.spent)}` + (ins.changePct == null ? '' : ` (${ins.changePct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(ins.changePct))}% vs same point last period)`));
  lines.push(`Income ${aed(income)} · ${income - ins.spent >= 0 ? aed(income - ins.spent) + ' left' : aed(ins.spent - income) + ' over'}`);
  lines.push(`Pace: ${aed(ins.dailyAvg)}/day → about ${aed(ins.projected)} this period`);

  const byCat = {};
  for (const e of (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && inPeriod(e) && !/^Reconciliation/i.test(e.note || ''))) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount || 0);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) lines.push('', 'Top categories: ' + top.map(([c, v]) => `${c} ${aed(v)}`).join(' · '));

  const budgets = Object.entries(S.budgets || {}).filter(([, b]) => Number(b) > 0).map(([c, b]) => [c, byCat[c] || 0, Number(b)]).filter(([, u, b]) => u >= b * 0.8);
  if (budgets.length) lines.push('', 'Budgets: ' + budgets.map(([c, u, b]) => `${c} ${Math.round(u / b * 100)}% (${aed(u)} of ${aed(b)})`).join(' · '));

  const accs = S.accounts || {};
  const banks = Object.entries(accs).filter(([id, a]) => a.type === 'bank' && !a.hidden).map(([id, a]) => [a.name || id, bankBalance(S, id, parseISO)]).filter(([, v]) => v !== null);
  const cards = Object.entries(accs).filter(([id, a]) => isCredit(accs, id) && !a.hidden).map(([id, a]) => [a.name || id, Number(a.balance || 0)]).filter(([, v]) => v > 0);
  if (banks.length || cards.length) lines.push('');
  if (banks.length) lines.push('Bank: ' + banks.map(([n, v]) => `${n} ${aed(v)}`).join(' · '));
  if (cards.length) lines.push('Cards owed: ' + cards.map(([n, v]) => `${n} ${aed(v)}`).join(' · '));
  const indiaTotal = (S.indiaAccounts || []).filter(a => !a.hidden && (a.currency || 'INR') === 'INR' && a.balance != null && a.balance !== '').reduce((s, a) => s + Number(a.balance), 0);
  if (indiaTotal) lines.push(`India (INR, last statement): ${inr(indiaTotal)}`);

  const due = (S.renewals || []).filter(r => r.expiry).map(r => ({ t: r.title, d: Math.round((parseISO(r.expiry) - today) / DAY) })).filter(r => r.d <= 14).sort((a, b) => a.d - b.d);
  if (due.length) lines.push('', 'Due soon: ' + due.map(r => `${r.t} ${r.d < 0 ? 'overdue ' + -r.d + 'd' : r.d === 0 ? 'today' : 'in ' + r.d + 'd'}`).join(' · '));

  const sal = nextSalaryDate(day, S.incomes, today);
  lines.push('', `Next salary: ${fmt(sal)} (${Math.max(0, Math.round((sal - today) / DAY))} days)`);
  return lines.join('\n');
}
