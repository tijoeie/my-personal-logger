// India tab: NRE / NRO / FCNR / savings accounts back home, shown in their own currency (rupees) only, never converted to AED.
import { S } from '../core/state.js';
import { esc, uid, today, iso, parseISO, fmtDate } from '../core/util.js';
import { INDIA_TYPES, indiaBalance, indiaTotals, indiaLabel, cardLabel, cardsOf } from '../domain/india.js';
import { openForm, expose, confirmThen } from '../ui/form.js';

const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
export const fmtCur = (n, cur = 'INR') => {
  const v = Number(n || 0);
  const s = v.toLocaleString(cur === 'INR' ? 'en-IN' : 'en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${SYM[cur] || cur + ' '}${s}`;
};
const list = () => (S.indiaAccounts || []).filter(a => !a.hidden);
const balanceOf = a => indiaBalance(a, S.remittances, S.indiaTxns, parseISO);

export function vIndia() {
  const accounts = list();
  if (!accounts.length) {
    return `<div class="panel"><div class="empty">No Indian bank accounts yet.<br><br>
      <button class="btn primary" onclick="addIndiaAccount()">+ Add NRE / NRO account</button>
      <p class="hint" style="margin-top:10px">You can also manage them in Settings → Indian bank accounts.</p></div></div>`;
  }
  const t = indiaTotals(accounts, S.remittances, S.indiaTxns, parseISO);
  const typeCards = ['NRE', 'NRO', 'FCNR', 'SAVINGS'].filter(k => t.byType[k]).map(k => `
    <div class="card ${k === 'NRE' ? 'card-green' : k === 'NRO' ? 'card-amber' : k === 'FCNR' ? 'card-teal' : 'card-gray'}">
      <div class="k">${INDIA_TYPES[k].label}</div>
      <div class="v">${fmtCur(t.byType[k].amount, t.byType[k].currency)}</div>
      <div class="s">${t.byType[k].count} account${t.byType[k].count > 1 ? 's' : ''}</div>
    </div>`).join('');

  const accountPanels = accounts.map(a => {
    const bal = balanceOf(a);
    const cur = a.currency || 'INR';
    const remits = (S.remittances || []).filter(r => r.toIndia === a.id).map(r => ({ date: r.date, amount: r.foreign, kind: 'in', note: `Sent from UAE${r.via ? ' via ' + r.via : ''}`, remit: true }));
    const txns = (S.indiaTxns || []).filter(x => x.accountId === a.id).map(x => ({ ...x }));
    const activity = [...remits, ...txns].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 8);
    return `<div class="panel">
      <h2>${esc(indiaLabel(a))} <small>— ${INDIA_TYPES[a.type].label}${a.branch ? ' · ' + esc(a.branch) : ''}</small></h2>
      <div class="row">
        <div class="grow"><div class="title" style="font-size:20px">${bal !== null ? fmtCur(bal, cur) : '—'}</div>
          <div class="sub">${bal !== null ? `as of ${fmtDate(a.balanceDate)} + activity since` : 'set the current balance to start tracking'}${a.interestRate ? ' · ' + a.interestRate + '% p.a.' : ''}${a.ifsc ? ' · IFSC ' + esc(a.ifsc) : ''}</div></div>
        <button class="btn small" onclick="indiaTxn('${a.id}','in')">+ Deposit</button>
        <button class="btn small" onclick="indiaTxn('${a.id}','out')">− Withdraw</button>
        <button class="btn small" onclick="setIndiaBalance('${a.id}')">Set balance</button>
        <button class="btn small" onclick="editIndiaAccount('${a.id}')">Edit</button>
      </div>
      ${cardsOf(S.indiaCards, a.id).map(c => `<div class="sub">💳 ${esc(cardLabel(c))}</div>`).join('')}
      <p class="hint" style="margin:6px 0 4px">${esc(INDIA_TYPES[a.type].tip)}</p>
      ${activity.length ? activity.map(x => `<div class="row">
        <div class="grow sub">${fmtDate(x.date)} · ${esc(x.note || (x.kind === 'in' ? 'Deposit' : 'Withdrawal'))}</div>
        <span class="amt ${x.kind === 'in' ? 'pos' : 'neg'}">${x.kind === 'in' ? '+' : '−'}${fmtCur(x.amount, cur)}</span>
        ${x.remit ? '' : `<button class="btn small danger" onclick="delIndiaTxn('${x.id}')">✕</button>`}
      </div>`).join('') : '<div class="sub" style="padding:4px 0">No activity yet. Transfers you log in Remittance with this account as the destination appear here.</div>'}
    </div>`;
  }).join('');

  const credit = (S.indiaCards || []).filter(c => c.kind === 'credit');
  const creditPanel = credit.length ? `<div class="panel"><h2>Indian credit cards</h2>${credit.map(c => `<div class="row"><div class="grow"><div class="title">💳 ${esc(cardLabel(c))}</div><div class="sub">${c.limit ? 'limit ' + fmtCur(c.limit, 'INR') : 'no limit set'}</div></div></div>`).join('')}</div>` : '';
  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addRemittanceTo()">+ Send money home</button>
    <button class="btn" onclick="addIndiaAccount()">+ Account</button>
  </div>
  <div class="cards">
    <div class="card card-blue"><div class="k">All rupee accounts</div><div class="v">${fmtCur(t.inr, 'INR')}</div>
      <div class="s">${accounts.length} account${accounts.length > 1 ? 's' : ''}${t.missing ? ` · ${t.missing} without balance` : ''}</div></div>
    ${typeCards}
  </div>
  ${accountPanels}
  ${creditPanel}`;
}

const TXN_KINDS = { in: 'Deposit (interest, rent, transfer in)', out: 'Withdrawal (spending, transfer out)' };
expose({
  indiaTxn(accountId, kind) {
    const a = (S.indiaAccounts || []).find(x => x.id === accountId);
    openForm(`${kind === 'in' ? 'Deposit to' : 'Withdraw from'} ${indiaLabel(a)}`, [
      { name: 'amount', label: `Amount (${a.currency || 'INR'})`, type: 'number', step: '0.01', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'note', label: 'Note', placeholder: kind === 'in' ? 'e.g. interest, rent' : 'e.g. EMI, parents, FD' },
    ], d => {
      (S.indiaTxns = S.indiaTxns || []).push({ id: uid(), accountId, date: d.date, amount: Number(d.amount), kind, note: d.note || TXN_KINDS[kind].split(' (')[0], createdAt: Date.now() });
    }, 'Save');
  },
  delIndiaTxn: id => confirmThen('Remove this entry?', () => { S.indiaTxns = (S.indiaTxns || []).filter(x => x.id !== id); }),
  setIndiaBalance(id) {
    const a = (S.indiaAccounts || []).find(x => x.id === id);
    openForm(`Set balance — ${indiaLabel(a)}`, [
      { name: 'balance', label: `Current balance (${a.currency || 'INR'})`, type: 'number', step: '0.01', value: balanceOf(a) ?? '', required: true },
      { name: 'balanceDate', label: 'As of', type: 'date', value: iso(today()), required: true },
    ], d => { a.balance = Number(d.balance); a.balanceDate = d.balanceDate; }, 'Set');
  },
  addRemittanceTo(id) { window.addRemittance({ toIndia: id || ((list()[0] || {}).id) }); },
});
