import { DAY } from '../core/constants.js';
import { S } from '../core/state.js';
import { esc, money, moneyH, today, sum } from '../core/util.js';
import {
  autoLogRecurring, periodOf, prevPeriod, periodLabel, inPeriod, nextSalaryDate,
  mashreqComputed, avgMonthlySpend, totalEMI,
} from '../domain/finance.js';
import { allDueItems } from '../domain/schedule.js';

function ccCard(id, cls) {
  const acc = (S.accounts || {})[id] || {};
  const bal = Number(acc.balance || 0);
  const lim = Number(acc.limit || 0);
  const pct = lim > 0 ? Math.min(100, Math.round(bal / lim * 100)) : 0;
  const barColor = pct >= 80 ? 'var(--critical)' : pct >= 50 ? 'var(--warning)' : 'var(--series-2)';
  const label = id === 'enbd_cc' ? 'ENBD CC' : 'NOON CC';
  return `<div class="card ${cls}" onclick="setCCBalance('${id}')" style="cursor:pointer">
    <div class="k"><i class="ti ti-credit-card" aria-hidden="true"></i> ${label}</div>
    <div class="v ${bal > 0 ? 'neg' : 'pos'}">${moneyH(bal)}</div>
    ${lim > 0 ? `<div class="meter"><div style="width:${pct}%;background:${barColor}"></div></div>
    <div class="s">${money(lim - bal)} avail · ${pct}% used</div>` : `<div class="s">${bal > 0 ? 'outstanding' : 'all clear'}</div>`}
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
  const mashreq = mashreqComputed();

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
    <div class="section-lbl">Accounts</div>
    <div class="cards">
      <div class="card card-gray"><div class="k"><i class="ti ti-calendar" aria-hidden="true"></i> Next salary</div><div class="v">${salDays === 0 ? 'Today 🎉' : salDays + ' days'}</div><div class="s">${nextSal.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · sometimes early</div></div>
      <div class="card card-blue"><div class="k"><i class="ti ti-building-bank" aria-hidden="true"></i> Mashreq</div><div class="v ${mashreq !== null && mashreq < 0 ? 'neg' : ''}">${mashreq !== null ? moneyH(mashreq) : '—'}</div>
        <div class="s">${mashreq !== null ? 'current balance' : '<a href="#" onclick="switchTab(\'expenses\');return false">Set starting balance</a>'}</div></div>
      ${ccCard('enbd_cc', 'card-red')}
      ${ccCard('noon_cc', 'card-purple')}
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
