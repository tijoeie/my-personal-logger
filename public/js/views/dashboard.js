import { DAY } from '../core/constants.js';
import { S } from '../core/state.js';
import { esc, money, moneyH, today, sum } from '../core/util.js';
import {
  autoLogRecurring, periodOf, prevPeriod, periodLabel, inPeriod, nextSalaryDate,
  mashreqComputed, avgMonthlySpend, totalEMI, accounts, bankBalance, accountName,
} from '../domain/finance.js';
import { allDueItems } from '../domain/schedule.js';
import { periodInsight, quickAddItems } from '../domain/insights.js';
import { PRIMARY, displayName } from '../domain/accounts.js';
import { indiaTotals } from '../domain/india.js';
import { fmtCur } from './india.js';
import { parseISO } from '../core/util.js';
import { expose } from '../ui/form.js';

const CAT_ICON = { 'Fuel': '⛽', 'Groceries': '🛒', 'Dining out': '🍽️', 'Shopping': '🛍️', 'Health': '💊', 'Car': '🚗',
  'Subscriptions': '📺', 'Salik / Parking': '🅿️', 'Telecom / Internet': '📱', 'Travel': '✈️', 'DEWA / Utilities': '💡' };
let quickItems = [];

function quickAddRow() {
  quickItems = quickAddItems(S.expenses, today());
  return `<div class="quick-row">${quickItems.map((q, i) => `
    <button class="quick-chip" onclick="quickAdd(${i})">
      <span class="qi">${CAT_ICON[q.cat] || '🧾'}</span>
      <span class="qt">${esc(q.cat)}</span>
      <span class="qa">${q.amount != null ? money(q.amount) : 'new'}</span>
    </button>`).join('')}</div>`;
}

function insightCard(p) {
  const i = periodInsight(S.expenses, p, prevPeriod(p), today());
  if (!i.spent) return '';
  const up = i.changePct != null && i.changePct > 0;
  const change = i.changePct == null ? ''
    : `<span class="${up ? 'neg' : 'pos'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(i.changePct))}%</span> vs the same point last period (${money(i.prevSoFar)})`;
  return `<div class="panel insight">
    <h2>Spending insight <small>— day ${i.elapsed} of ${i.length}</small></h2>
    <div class="ins-line"><b>${moneyH(i.spent)}</b> spent so far${change ? ' · ' + change : ''}</div>
    ${i.topCat ? `<div class="ins-line">Top category: <b>${esc(i.topCat)}</b> ${money(i.topAmt)} · ${Math.round(i.topShare)}% of ${i.adjusted ? 'logged ' : ''}spending</div>` : ''}
    ${i.adjusted ? `<div class="ins-line hint">Includes ${money(i.adjusted)} of reconcile adjustments (unlogged spending)</div>` : ''}
    <div class="ins-line">${money(i.dailyAvg)}/day · on pace for <b>${money(i.projected)}</b> this period${i.prevFull ? ` (last period ${money(i.prevFull)})` : ''}</div>
    ${i.biggest ? `<div class="ins-line hint">Biggest: ${money(i.biggest.amount)} · ${esc(i.biggest.cat || 'Other')}${i.biggest.note ? ' · ' + esc(i.biggest.note) : ''}</div>` : ''}
  </div>`;
}

expose({ quickAdd: i => window.addExpense(quickItems[i] || {}) });

// One tile per account the user shows on the dashboard (Settings → Accounts & cards)
const CARD_COLORS = ['card-red', 'card-purple', 'card-amber', 'card-teal', 'card-gray'];
function accountTiles() {
  const p = periodOf(today());
  let ci = 0;
  return accounts().filter(a => a.dashboard !== false).map(a => {
    const name = esc(displayName(a));
    if (a.type === 'bank') {
      const bal = bankBalance(a.id);
      return `<div class="card card-blue" onclick="setBankBalance('${a.id}')" style="cursor:pointer"><div class="k"><i class="ti ti-building-bank" aria-hidden="true"></i> ${name}</div>
        <div class="v ${bal !== null && bal < 0 ? 'neg' : ''}">${bal !== null ? moneyH(bal) : '—'}</div>
        <div class="s">${bal !== null ? 'current balance' : 'tap to set starting balance'}</div></div>`;
    }
    if (a.type === 'debit') {
      const spent = sum(S.expenses.filter(e => e.payMethod === a.id && inPeriod(e.date, p)));
      return `<div class="card card-green" onclick="switchTab('expenses')" style="cursor:pointer"><div class="k"><i class="ti ti-credit-card" aria-hidden="true"></i> ${name}</div>
        <div class="v">${moneyH(spent)}</div>
        <div class="s">spent this period · from ${esc(accountName(a.linkedTo || PRIMARY))}</div></div>`;
    }
    const bal = Number(a.balance || 0), lim = Number(a.limit || 0);
    const pct = lim > 0 ? Math.min(100, Math.round(bal / lim * 100)) : 0;
    const barColor = pct >= 80 ? 'var(--critical)' : pct >= 50 ? 'var(--warning)' : 'var(--series-2)';
    return `<div class="card ${CARD_COLORS[ci++ % CARD_COLORS.length]}" onclick="setCCBalance('${a.id}')" style="cursor:pointer">
      <div class="k"><i class="ti ti-credit-card" aria-hidden="true"></i> ${name}</div>
      <div class="v ${bal > 0 ? 'neg' : 'pos'}">${moneyH(bal)}</div>
      ${lim > 0 ? `<div class="meter"><div style="width:${pct}%;background:${barColor}"></div></div>
      <div class="s">${money(lim - bal)} avail · ${pct}% used</div>` : `<div class="s">${bal > 0 ? 'outstanding' : 'all clear'}</div>`}
    </div>`;
  }).join('') + indiaTile();
}

// One tile for all Indian accounts that are shown on the dashboard
function indiaTile() {
  const shown = (S.indiaAccounts || []).filter(a => !a.hidden && a.dashboard !== false);
  if (!shown.length) return '';
  const t = indiaTotals(shown, S.remittances, S.indiaTxns, parseISO);
  const parts = ['NRE', 'NRO', 'FCNR', 'SAVINGS'].filter(k => t.byType[k]).map(k => `${k === 'SAVINGS' ? 'Savings' : k} ${fmtCur(t.byType[k].amount, t.byType[k].currency)}`);
  return `<div class="card card-amber" onclick="switchTab('india')" style="cursor:pointer">
    <div class="k"><i class="ti ti-currency-rupee" aria-hidden="true"></i> India accounts</div>
    <div class="v">${moneyH(t.aed)}</div>
    <div class="s">${parts.join(' · ') || 'set balances on the India tab'}${t.estimated ? ' · approx.' : ''}</div>
  </div>`;
}

export function dueRow(i) {
  return `<div class="row">
    <div class="grow"><div class="title">${esc(i.label)}</div><div class="sub">${esc(i.sub)}</div></div>
    <span class="badge ${i.st.cls}">${i.st.label}</span>
  </div>`;
}

function catChart(p) {
  const byCat = {};
  for (const e of S.expenses.filter(e => inPeriod(e.date, p))) byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount);
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="empty">No expenses logged this period yet.</div>';
  const max = entries[0][1];
  return entries.map(([cat, amt]) => `
    <div class="hbar-row" title="${esc(cat)}: ${money(amt)}">
      <div class="lbl">${esc(cat)}</div>
      <div class="track"><div class="bar" style="width:${Math.max(2, amt / max * 100)}%"></div><span class="val">${money(amt)}</span></div>
    </div>`).join('');
}

function trendChart() {
  const periods = [];
  let cur = periodOf(today());
  for (let i = 0; i < 6; i++) { periods.unshift(cur); cur = prevPeriod(cur); }
  const vals = periods.map(p => sum(S.expenses.filter(e => inPeriod(e.date, p))));
  const max = Math.max(...vals, 1);
  const short = v => v >= 10000 ? Math.round(v / 1000) + 'k' : (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return `<div class="cols">${vals.map((v, i) => `
      <div class="col" title="${periodLabel(periods[i])}: ${money(v)}">
        <span class="v">${v ? short(v) : ''}</span>
        <div class="bar" style="height:${Math.max(2, v / max * 100)}%"></div>
      </div>`).join('')}</div>
    <div class="cols-x">${periods.map(p => `<span>${p.start.toLocaleDateString('en-GB', { month: 'short' })}</span>`).join('')}</div>
    <div class="hint" style="margin-top:6px">Each bar is a salary period starting on the ${S.settings.salaryDay}th of the labeled month.</div>`;
}

export function vDashboard() {
  autoLogRecurring();
  const p = periodOf(today());
  const spent = sum(S.expenses.filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment'));
  const income = sum(S.incomes.filter(i => inPeriod(i.date, p)));
  const nextSal = nextSalaryDate();
  const salDays = Math.round((nextSal - today()) / DAY);
  const vacTarget = sum(S.vacations, v => v.budget);
  const vacSaved = sum(S.vacations, v => sum(v.contribs || []));
  // emergency fund counts every bank account that has a balance
  const bankBals = accounts().filter(a => a.type === 'bank').map(a => bankBalance(a.id)).filter(v => v !== null);
  const mashreq = bankBals.length ? bankBals.reduce((x, y) => x + y, 0) : null;

  const avg = avgMonthlySpend();
  const efMonths = mashreq !== null && avg > 0 ? mashreq / avg : null;
  const efTarget = S.settings.emergencyMonths || 3;
  const efCls = efMonths === null ? 'gray' : efMonths >= efTarget ? 'green' : efMonths >= 1 ? 'amber' : 'red';
  const efVal = efMonths === null ? '' : efMonths >= efTarget ? 'pos' : efMonths >= 1 ? '' : 'neg';

  const salik = S.salik || {};
  const salikLow = salik.threshold > 0 && salik.balance < salik.threshold;
  const due = allDueItems();
  const attention = due.filter(i => i.st.cls !== 'ok');
  const emi = totalEMI();

  return `
  <div class="dash-pinned">
    <div class="section-lbl">Quick add</div>
    ${quickAddRow()}
    <div class="section-lbl">Accounts</div>
    <div class="cards">
      <div class="card card-gray"><div class="k"><i class="ti ti-calendar" aria-hidden="true"></i> Next salary</div><div class="v">${salDays === 0 ? 'Today 🎉' : salDays + ' days'}</div><div class="s">${nextSal.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · sometimes early</div></div>
      ${accountTiles()}
    </div>

    <div class="section-lbl">This period · ${periodLabel(p)}</div>
    <div class="cards">
      <div class="card ${spent > income ? 'card-red' : 'card-amber'}"><div class="k"><i class="ti ti-arrow-up" aria-hidden="true"></i> Spent</div><div class="v">${moneyH(spent)}</div><div class="s">${income - spent >= 0 ? `<span class="pos">+${money(income - spent)} left</span>` : `<span class="neg">${money(income - spent)} over</span>`}</div></div>
      <div class="card card-green"><div class="k"><i class="ti ti-arrow-down" aria-hidden="true"></i> Income</div><div class="v">${moneyH(income)}</div><div class="s">${periodLabel(p)}</div></div>
      <div class="card card-teal"><div class="k"><i class="ti ti-plane" aria-hidden="true"></i> Vacation fund</div><div class="v">${moneyH(vacSaved)}</div><div class="s">of ${money(vacTarget)} goal</div></div>
      <div class="card card-${efCls}" title="Based on last 3 periods avg spend${avg ? ' · avg ' + money(avg) + '/mo' : ''}">
        <div class="k"><i class="ti ti-shield" aria-hidden="true"></i> Emergency fund</div>
        <div class="v ${efVal}">${efMonths !== null ? efMonths.toFixed(1) + ' mo' : '—'}</div>
        <div class="s">goal: ${efTarget} months${emi ? ` · EMI: ${money(emi)}/mo` : ''}</div>
      </div>
    </div>

    ${insightCard(p)}

    ${salikLow || attention.length ? `
    <div class="section-lbl">Needs attention</div>
    ${salikLow ? `<div class="alert-strip warn"><div class="grow"><div class="al-title"><i class="ti ti-road" aria-hidden="true"></i> Salik balance low</div><div class="al-sub">AED ${salik.balance} remaining · top up to avoid fines</div></div><button class="btn small" onclick="switchTab('car')">Top up</button></div>` : ''}
    ${attention.map(i => `<div class="alert-strip${i.st.cls === 'overdue' ? '' : ' warn'}"><div class="grow"><div class="al-title">${esc(i.label)}</div><div class="al-sub">${esc(i.sub)}</div></div><span class="badge ${i.st.cls}">${i.st.label}</span></div>`).join('')}
    ` : ''}
  </div>

  ${!salikLow && !attention.length ? `<div class="panel"><div class="empty">Nothing urgent 👌</div></div>` : ''}

  <div class="panel">
    <h2>All tracked items <small>— sorted by due date</small></h2>
    ${due.length ? due.map(dueRow).join('') : '<div class="empty">Add renewals and log car services to see follow-ups here.</div>'}
  </div>

  <div class="panel">
    <h2>Spending by category <small>— ${periodLabel(p)}</small></h2>
    ${catChart(p)}
  </div>

  <div class="panel">
    <h2>Last 6 salary periods</h2>
    ${trendChart()}
  </div>`;
}
