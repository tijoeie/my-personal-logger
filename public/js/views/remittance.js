// Remittance tab: transfers home, exchange-rate history, home commitments.
import { REMIT_CURRENCIES, FREQ_OPTIONS } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { esc, uid, money, today, iso, parseISO, fmtDate, sum } from '../core/util.js';
import { openForm, expose, confirmThen } from '../ui/form.js';
import { payMethods, chargeCard, isCCPay } from '../domain/finance.js';
import { bankOf } from '../domain/accounts.js';
import { indiaLabel } from '../domain/india.js';
import { render } from '../ui/shell.js';

export function vRemittance() {
  const list = [...(S.remittances || [])].sort((a, b) => b.date.localeCompare(a.date));
  const thisYear = today().getFullYear();
  const yearList = list.filter(r => parseISO(r.date).getFullYear() === thisYear);
  const cur = S.settings.remitCurrency || 'INR';
  const allRates = list.filter(r => r.currency === cur && r.rate);
  const bestRate = allRates.length ? Math.max(...allRates.map(r => Number(r.rate))) : null;
  const lastRate = allRates[0] ? Number(allRates[0].rate) : null;

  let rateChart = '<div class="empty">Log at least 2 transfers with the same currency to see rate history.</div>';
  if (allRates.length >= 2) {
    const min = Math.min(...allRates.map(r => Number(r.rate)));
    rateChart = allRates.slice(0, 12).map(r => `<div class="hbar-row" title="Rate ${Number(r.rate).toFixed(2)} on ${fmtDate(r.date)}">
        <div class="lbl">${parseISO(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
        <div class="track"><div class="bar" style="width:${Math.max(5, (Number(r.rate) - min) / (bestRate - min || 1) * 100)}%"></div><span class="val">${Number(r.rate).toFixed(2)}</span></div>
      </div>`).join('');
  }

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addRemittance()">+ Log transfer</button>
    <button class="btn" onclick="addHomeObligation()">+ Home commitment</button>
    <select class="btn" onchange="setRemitCurrency(this.value)" style="padding-right:8px">
      ${REMIT_CURRENCIES.map(c => `<option${cur === c ? ' selected' : ''}>${c}</option>`).join('')}
    </select>
  </div>
  <div class="cards">
    <div class="card"><div class="k">Sent in ${thisYear}</div><div class="v">${money(sum(yearList, r => r.aed))}</div><div class="s">${yearList.length} transfers</div></div>
    <div class="card"><div class="k">Last rate</div><div class="v">${lastRate ? lastRate.toFixed(2) : '—'}</div><div class="s">1 AED = ${cur}</div></div>
    <div class="card"><div class="k">Best rate seen</div><div class="v">${bestRate ? bestRate.toFixed(2) : '—'}</div><div class="s">from your history</div></div>
  </div>
  <div class="panel">
    <h2>Transfer history</h2>
    ${list.length ? list.map(r => `<div class="row">
        <div class="grow">
          <div class="title">${money(r.aed)} → ${Number(r.foreign).toLocaleString()} ${esc(r.currency)}
            ${bestRate && Number(r.rate) === bestRate ? '<span class="badge ok" style="font-size:10px;margin-left:4px">best rate</span>' : ''}
          </div>
          <div class="sub">${fmtDate(r.date)}${r.rate ? ` · rate ${Number(r.rate).toFixed(2)}` : ''}${r.via ? ` · via ${esc(r.via)}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</div>
        </div>
        <button class="btn small danger" onclick="delRemittance('${r.id}')">✕</button>
      </div>`).join('') : '<div class="empty">No transfers logged yet.</div>'}
  </div>
  <div class="panel">
    <h2>Home commitments <small>— recurring obligations back home</small></h2>
    ${(S.homeObligations || []).map(o => `<div class="row">
      <div class="grow">
        <div class="title">${esc(o.name)}</div>
        <div class="sub">${o.currency ? o.amount + ' ' + esc(o.currency) : money(o.amount)} · ${esc(o.freq)}${o.note ? ' · ' + esc(o.note) : ''}</div>
      </div>
      <button class="btn small" onclick="editHomeObligation('${o.id}')">Edit</button>
      <button class="btn small danger" onclick="delHomeObligation('${o.id}')">✕</button>
    </div>`).join('') || '<div class="empty">No home commitments tracked. Add things like parents\' allowance, LIC premium, property tax.</div>'}
  </div>

  <div class="panel">
    <h2>Rate history <small>— ${cur} only</small></h2>
    ${rateChart}
  </div>`;
}

const obligationFields = (o = {}) => [
  { name: 'name', label: 'What is it?', value: o.name, required: true, placeholder: 'e.g. Parents allowance, LIC premium' },
  { name: 'amount', label: 'Amount', type: 'number', step: '0.01', value: o.amount, required: true },
  { name: 'currency', label: 'Currency', value: o.currency ?? (S.settings.remitCurrency || 'INR'), placeholder: 'INR, AED, etc.' },
  { name: 'freq', label: 'Frequency', type: 'select', value: o.freq || 'monthly', options: FREQ_OPTIONS },
  { name: 'note', label: 'Note', value: o.note, placeholder: 'optional' },
];
const obligationFromForm = d => ({ name: d.name, amount: Number(d.amount), currency: d.currency, freq: d.freq, note: d.note });

expose({
  setRemitCurrency(c) { S.settings.remitCurrency = c; save(); render(); },
  // preset.toIndia: pre-select the Indian account that receives the money
  addRemittance(preset = {}) {
    const india = (S.indiaAccounts || []).filter(a => !a.hidden);
    const lastTo = [...(S.remittances || [])].reverse().find(r => r.toIndia);
    openForm('Send money home', [
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'aed', label: 'Amount sent (AED)', type: 'number', step: '0.01', required: true },
      { name: 'currency', label: 'To currency', type: 'select', value: S.settings.remitCurrency || 'INR', options: REMIT_CURRENCIES.map(c => ({ v: c, t: c })) },
      { name: 'foreign', label: 'Amount received', type: 'number', step: '0.01', required: true },
      ...(india.length ? [{ name: 'toIndia', label: 'Credited to', type: 'select', value: preset.toIndia || (lastTo && lastTo.toIndia) || india[0].id,
        options: [...india.map(a => ({ v: a.id, t: indiaLabel(a) })), { v: '', t: 'Someone else (family, bill)' }] }] : []),
      { name: 'payMethod', label: 'Paid from', type: 'select', value: S.settings.remitFrom || 'bank', options: payMethods() },
      { name: 'via', label: 'Service used', placeholder: 'e.g. Al Ansari, Wise, bank' },
      { name: 'note', label: 'Note', placeholder: 'e.g. savings, family expense' },
    ], d => {
      const rate = d.foreign && d.aed ? (Number(d.foreign) / Number(d.aed)) : 0;
      const to = (S.indiaAccounts || []).find(a => a.id === d.toIndia);
      const remitId = uid();
      S.remittances = S.remittances || [];
      S.remittances.push({ id: remitId, date: d.date, aed: Number(d.aed), currency: d.currency, foreign: Number(d.foreign), rate, via: d.via, note: d.note, ...(to ? { toIndia: to.id } : {}) });
      // Money to your own NRE/NRO account is savings moved home, not spending; to anyone else it is an expense
      if (to) {
        // which UAE account the money left: the bank itself, the bank behind a debit card, a credit card, or cash
        const from = d.payMethod === 'cash' ? 'cash' : (bankOf(S.accounts, d.payMethod) || d.payMethod);
        (S.transfers = S.transfers || []).push({ id: uid(), remitId, date: d.date, from, to: 'india:' + to.id, amount: Number(d.aed), note: `To ${indiaLabel(to)}${d.note ? ' · ' + d.note : ''}`, createdAt: Date.now() });
        if (isCCPay({ payMethod: d.payMethod })) chargeCard(d.payMethod, d.aed, d.date);
      } else {
        S.expenses.push({ id: uid(), remitId, date: d.date, cat: 'Family / Remittance', amount: Number(d.aed), payMethod: d.payMethod, note: `Transfer to ${d.currency}${d.note ? ' — ' + d.note : ''}`, createdAt: Date.now() });
        chargeCard(d.payMethod, d.aed, d.date);
      }
      S.settings.remitFrom = d.payMethod;
    });
  },

  // removes the transfer and the transfer/expense it created
  delRemittance: id => confirmThen('Delete this transfer?', () => {
    S.remittances = (S.remittances || []).filter(r => r.id !== id);
    S.transfers = (S.transfers || []).filter(t => t.remitId !== id);
    S.expenses = S.expenses.filter(e => e.remitId !== id);
  }),
  addHomeObligation() {
    openForm('Add home commitment', obligationFields(), d => {
      (S.homeObligations = S.homeObligations || []).push({ id: uid(), ...obligationFromForm(d) });
    });
  },
  editHomeObligation(id) {
    const o = (S.homeObligations || []).find(x => x.id === id);
    openForm('Edit home commitment', obligationFields(o), d => Object.assign(o, obligationFromForm(d)));
  },
  delHomeObligation: id => confirmThen('Delete this commitment?', () => {
    S.homeObligations = (S.homeObligations || []).filter(o => o.id !== id);
  }),
});
