// Printable reports rendered in a full-screen overlay; the browser's print dialog saves them as PDF.
import { S } from '../core/state.js';
import { esc, money, today, iso, daysUntil, fmtDate, sum } from '../core/util.js';
import { isBankPay, isCCPay, mashreqComputed, periodOf, inPeriod } from '../domain/finance.js';
import { statusOf, currentLeaveYear, annualLeaveTaken } from '../domain/schedule.js';

function overlay(title, bodyHTML) {
  if (!document.getElementById('_pstyle')) {
    const st = document.createElement('style');
    st.id = '_pstyle';
    st.textContent = '@media print{body>*:not(#_preport){display:none!important}#_preport{position:static!important;overflow:visible!important;height:auto!important;background:#fff!important}.rpt-toolbar{display:none!important}}';
    document.head.appendChild(st);
  }
  document.getElementById('_preport')?.remove();
  const el = document.createElement('div');
  el.id = '_preport';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#1a1a1a;line-height:1.6';
  el.innerHTML = `
    <div class="rpt-toolbar" style="position:sticky;top:0;background:#fff;border-bottom:2px solid #1a1a1a;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:1">
      <span style="font-size:12px;color:#555;letter-spacing:.02em">${esc(title)}</span>
      <div style="display:flex;gap:8px">
        <button onclick="window.print()" style="font:600 12px/1 system-ui;background:#1a1a1a;color:#fff;border:none;border-radius:4px;padding:8px 14px;cursor:pointer">Print / Save PDF</button>
        <button onclick="document.getElementById('_preport').remove()" style="font:600 12px/1 system-ui;background:#f0f0f0;color:#333;border:1px solid #ddd;border-radius:4px;padding:8px 12px;cursor:pointer">✕</button>
      </div>
    </div>
    <div style="max-width:640px;margin:0 auto;padding:32px 28px 64px">${bodyHTML}</div>`;
  document.body.appendChild(el);
}

const mon = n => 'AED ' + Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function card(label, val, sub, isPositive) {
  const color = isPositive === false ? '#b91c1c' : isPositive === true ? '#15803d' : '#1a1a1a';
  return `<div style="padding:14px 16px;border:1px solid #ddd;background:#fff">
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#999;margin-bottom:5px">${label}</div>
    <div style="font-size:17px;font-weight:700;color:${color}">${val}</div>
    ${sub ? `<div style="font-size:11px;color:#bbb;margin-top:2px">${sub}</div>` : ''}
  </div>`;
}
const cards = list => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:24px">${list.join('')}</div>`;

function section(title, content) {
  return `<div style="margin-bottom:28px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #e8e8e8">${title}</div>
    ${content}
  </div>`;
}
function row(l, r, bold, rColor) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #f4f4f4;${bold ? 'font-weight:600' : ''}">
    <span style="color:#555;font-size:12px">${l}</span>
    <span style="font-size:12px;color:${rColor || '#1a1a1a'}">${r}</span>
  </div>`;
}
const empty = text => `<div style="padding:14px;color:#aaa">${text}</div>`;

function catBars(items) {
  const max = items[0]?.[1] || 1;
  return `<table style="width:100%;border-collapse:collapse;font-size:12px">
    ${items.map(([cat, amt], i) => `
    <tr style="border-bottom:1px solid #f4f4f4">
      <td style="padding:7px 0;width:130px;color:#444">${esc(cat)}</td>
      <td style="padding:7px 12px;vertical-align:middle">
        <div style="height:6px;background:#f0f0f0;border-radius:1px">
          <div style="height:100%;width:${Math.round(amt / max * 100)}%;background:#1a1a1a;border-radius:1px;opacity:${Math.max(0.25, 1 - i * 0.07)}"></div>
        </div>
      </td>
      <td style="padding:7px 0;text-align:right;font-weight:600;color:#1a1a1a;white-space:nowrap;width:120px">${mon(amt)}</td>
    </tr>`).join('')}
  </table>`;
}
function byCategory(exps) {
  const m = {};
  for (const e of exps) m[e.cat] = (m[e.cat] || 0) + Number(e.amount);
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
function header(kicker, title, size) {
  return `<div style="margin-bottom:24px">
    <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.08em">${kicker}</div>
    <div style="font-size:${size}px;font-weight:800;color:#111;margin:2px 0">${title}</div>
    <div style="font-size:12px;color:#aaa">Generated ${iso(today())}</div>
  </div>`;
}
function bar(label, val, max, color) {
  const pct = max > 0 ? Math.min(100, Math.round(val / max * 100)) : 0;
  return `<div style="padding:10px 14px;border-bottom:1px solid #f2f1ec">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px">
      <span style="font-weight:600">${label}</span>
      <span style="font-weight:700">${mon(val)} ${max ? `<span style="font-weight:400;color:#888">/ ${mon(max)}</span>` : ''}</span>
    </div>
    ${max ? `<div style="height:6px;background:#f2f1ec;border-radius:3px"><div style="height:100%;width:${pct}%;background:${typeof color === 'function' ? color(pct) : color};border-radius:3px"></div></div>` : ''}
  </div>`;
}

export function genMonthlyReport(ym) {
  const [yr, mo] = ym.split('-').map(Number);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleString('en-GB', { month: 'long' });
  const exps = (S.expenses || []).filter(e => e.date && e.date.startsWith(ym) && e.payMethod !== 'cc_payment')
    .sort((a, b) => b.date.localeCompare(a.date));
  const incs = (S.incomes || []).filter(i => i.date && i.date.startsWith(ym));
  const bankExps = exps.filter(isBankPay);
  const totalIncome = sum(incs), totalBank = sum(bankExps), totalCC = sum(exps.filter(isCCPay));
  const net = totalIncome - totalBank;
  const cats = byCategory(exps);

  const expList = exps.map(e => `
    <div style="display:flex;justify-content:space-between;padding:7px 14px;border-bottom:1px solid #f2f1ec;font-size:12px">
      <div>
        <span style="font-weight:600">${esc(e.cat)}</span>
        ${e.note ? `<span style="color:#888"> · ${esc(e.note)}</span>` : ''}
        <span style="color:#bbb;margin-left:6px">${e.date}</span>
      </div>
      <span style="color:${isCCPay(e) ? '#7F77DD' : '#111'};font-weight:700">${mon(e.amount)}</span>
    </div>`).join('') || empty('No expenses recorded');
  const incList = incs.map(i => row(
    `${esc(i.note || 'Salary')} <span style="color:#ccc;font-size:11px">${i.date}</span>`,
    `<span style="color:#1baf7a">+${mon(i.amount)}</span>`,
  )).join('') || empty('No income recorded');

  overlay(`${monthLabel} ${yr} — Monthly Report`, `
    ${header(`${yr} · Monthly Report`, monthLabel, 32)}
    ${cards([
      card('Income', mon(totalIncome), `${incs.length} entr${incs.length === 1 ? 'y' : 'ies'}`, true),
      card('Bank & Cash spent', mon(totalBank), `${bankExps.length} transactions`, null),
      card('CC spent', mon(totalCC), 'ENBD + NOON', null),
      card('Net (income − bank)', mon(net), net >= 0 ? 'surplus' : 'deficit', net >= 0),
    ])}
    ${cats.length ? section('Spending by category', catBars(cats)) : ''}
    ${section('All expenses', expList)}
    ${section('Income', incList)}`);
}

export function genYearlyReport(year) {
  const exps = (S.expenses || []).filter(e => e.date && e.date.startsWith(year + '-') && e.payMethod !== 'cc_payment');
  const incs = (S.incomes || []).filter(i => i.date && i.date.startsWith(year + '-'));
  const totalIncome = sum(incs), totalBank = sum(exps.filter(isBankPay)), totalCC = sum(exps.filter(isCCPay));
  const net = totalIncome - totalBank;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = MONTHS.map((name, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    const mE = exps.filter(e => e.date.startsWith(ym));
    return { name, income: sum(incs.filter(x => x.date.startsWith(ym))), bank: sum(mE.filter(isBankPay)), cc: sum(mE.filter(isCCPay)) };
  });
  const cats = byCategory(exps);
  const signed = n => (n >= 0 ? '+' : '') + mon(n);

  const table = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#f2f1ec">
      <th style="text-align:left;padding:8px 14px;font-weight:700;color:#555">Month</th>
      <th style="text-align:right;padding:8px 10px;font-weight:700;color:#1baf7a">Income</th>
      <th style="text-align:right;padding:8px 10px;font-weight:700;color:#2a78d6">Bank</th>
      <th style="text-align:right;padding:8px 10px;font-weight:700;color:#7F77DD">CC</th>
      <th style="text-align:right;padding:8px 14px;font-weight:700;color:#555">Net</th>
    </tr></thead>
    <tbody>
      ${months.map(m => {
        const n = m.income - m.bank;
        const has = m.income > 0 || m.bank > 0 || m.cc > 0;
        return `<tr style="border-bottom:1px solid #f2f1ec${!has ? ';opacity:.35' : ''}">
          <td style="padding:7px 14px;font-weight:600">${m.name}</td>
          <td style="padding:7px 10px;text-align:right;color:#1baf7a">${m.income > 0 ? mon(m.income) : '—'}</td>
          <td style="padding:7px 10px;text-align:right;color:#2a78d6">${m.bank > 0 ? mon(m.bank) : '—'}</td>
          <td style="padding:7px 10px;text-align:right;color:#7F77DD">${m.cc > 0 ? mon(m.cc) : '—'}</td>
          <td style="padding:7px 14px;text-align:right;font-weight:700;color:${n >= 0 ? '#1baf7a' : '#d03b3b'}">${has ? signed(n) : '—'}</td>
        </tr>`;
      }).join('')}
      <tr style="background:#111;color:#fff;font-weight:700">
        <td style="padding:9px 14px">Total</td>
        <td style="padding:9px 10px;text-align:right;color:#4de84d">${mon(totalIncome)}</td>
        <td style="padding:9px 10px;text-align:right;color:#80b8f0">${mon(totalBank)}</td>
        <td style="padding:9px 10px;text-align:right;color:#b0abee">${mon(totalCC)}</td>
        <td style="padding:9px 14px;text-align:right;color:${net >= 0 ? '#4de84d' : '#f29a9a'}">${signed(net)}</td>
      </tr>
    </tbody></table>`;

  overlay(`${year} — Annual Report`, `
    ${header('Annual Report', year, 36)}
    ${cards([
      card('Total income', mon(totalIncome), `${incs.length} entries`, true),
      card('Total bank/cash', mon(totalBank), 'from Mashreq', null),
      card('Total CC spent', mon(totalCC), 'ENBD + NOON', null),
      card('Net (income − bank)', mon(net), net >= 0 ? 'surplus' : 'deficit', net >= 0),
    ])}
    ${section('Month by month', table)}
    ${cats.length ? section('Top spending categories', catBars(cats)) : ''}`);
}

export function genFullReport() {
  const accs = S.accounts || {};
  const cc = id => ({ bal: Number((accs[id] || {}).balance || 0), lim: Number((accs[id] || {}).limit || 0) });
  const enbd = cc('enbd_cc'), noon = cc('noon_cc');
  const mashreq = mashreqComputed();
  const p = periodOf(today());
  const periodExps = (S.expenses || []).filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment');
  const cats = byCategory(periodExps);
  const stColor = { overdue: '#d03b3b', due: '#e08b17', soon: '#e08b17', ok: '#1baf7a' };

  const renewalRows = (S.renewals || []).map(r => {
    if (!r.expiry) return row(esc(r.title), '—');
    const st = statusOf(daysUntil(r.expiry), r.remindDays);
    return row(esc(r.title), `${fmtDate(r.expiry)} <span style="color:${stColor[st.cls]};font-weight:700">${st.label}</span>`);
  }).join('') || empty('No renewals tracked');
  const svcRows = (S.serviceTypes || []).map(t => {
    const last = (S.serviceLog || []).filter(l => l.type === t.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    return row(esc(t.name), last ? `Last: ${fmtDate(last.date)}` : 'No record');
  }).join('') || empty('No service types');
  const loanRows = (S.loans || []).filter(l => l.outstanding > 0)
    .map(l => row(esc(l.name), `${mon(l.outstanding)} outstanding · EMI ${money(l.emi)}/mo`)).join('') || empty('No active loans');
  const givenRows = (S.loansGiven || []).map(g => {
    const paid = sum((S.loansGivenPayments || []).filter(x => x.gId === g.id));
    return row(esc(g.name), `${mon(Math.max(0, g.total - paid))} remaining of ${money(g.total)}`);
  }).join('') || empty('Nothing owed');
  const vacRows = (S.vacations || []).map(v => bar(esc(v.name || '—'), sum(v.contribs || []), Number(v.budget || 0), '#8c6aa0')).join('') || empty('No vacations planned');

  const ls = S.leaveSettings || {};
  const totalLeave = Number(ls.entitlementDays || 23) + Math.min(10, Number(ls.carryForward || 0));
  const taken = annualLeaveTaken(currentLeaveYear());
  const ccColor = pct => pct >= 80 ? '#d03b3b' : pct >= 50 ? '#e08b17' : '#2a78d6';

  overlay('Full Snapshot Report', `
    ${header('Full Snapshot', 'My Personal Logger', 28)}
    ${cards([
      card('Mashreq Bank', mashreq !== null ? mon(mashreq) : '—', 'computed balance', null),
      card('Period bank spend', mon(sum(periodExps.filter(isBankPay))), 'this pay cycle', null),
      card('Period CC spend', mon(sum(periodExps.filter(isCCPay))), 'ENBD + NOON', null),
      card('Leave remaining', `${totalLeave - taken} days`, `${taken} taken of ${totalLeave}`, null),
    ])}
    ${section('Credit cards', bar('ENBD CC', enbd.bal, enbd.lim, ccColor) + bar('NOON CC', noon.bal, noon.lim, ccColor))}
    ${cats.length ? section('This period — by category', catBars(cats)) : ''}
    ${section('Renewals', renewalRows)}
    ${section('Car services', svcRows)}
    ${section('My loans & EMIs', loanRows)}
    ${section('Money owed to me', givenRows)}
    ${section('Vacation savings', vacRows)}`);
}
