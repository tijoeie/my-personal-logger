import { S } from '../core/state.js';
import { esc, moneyH, fmtDate, fmtTime } from '../core/util.js';
import { payLabel } from '../domain/finance.js';

export function vBankFeed() {
  const items = [
    ...(S.expenses || []).filter(e => e.source === 'n8n').map(e => ({ ...e, kind: 'debit' })),
    ...(S.incomes || []).filter(i => i.source === 'n8n').map(i => ({ ...i, kind: 'credit' })),
  ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const endpoint = `${location.origin}/api/ingest`;

  return `
  <div class="section-lbl">Bank Feed <small>— auto-logged from n8n</small></div>
  <div class="panel">
    <p class="hint">Your n8n automation reads bank alerts from Gmail and posts each transaction here. They're logged straight into Expenses/Income and the Mashreq balance updates automatically — nothing to approve. If a parse comes through wrong, just delete it below and re-log manually.</p>
  </div>
  <div class="panel">
    ${items.length ? items.map(it => `<div class="row">
      <div class="grow">
        <div class="title">${it.kind === 'debit' ? '↑' : '↓'} ${esc(it.note || it.cat || 'Transaction')} <span class="chip">n8n</span></div>
        <div class="sub">${fmtDate(it.date)}${it.createdAt ? ' ' + fmtTime(it.createdAt) : ''} · ${payLabel(it.payMethod)}</div>
      </div>
      <span class="amt ${it.kind === 'debit' ? 'neg' : 'pos'}">${it.kind === 'debit' ? '-' : '+'}${moneyH(it.amount)}</span>
      <button class="btn small danger" onclick="${it.kind === 'debit' ? 'delExpense' : 'delIncome'}('${it.id}')">✕</button>
    </div>`).join('') : '<div class="empty">No transactions received from n8n yet. Once your automation posts one, it will show up here.</div>'}
  </div>
  <div class="panel">
    <h2>n8n setup</h2>
    <p class="hint">Add an HTTP Request node in n8n (after your Telegram step) — <b>POST</b> to:</p>
    <div class="code">${esc(endpoint)}</div>
    <p class="hint">Header: <code>X-Ingest-Secret: &lt;your INGEST_SECRET&gt;</code> (the value in the server's <code>.env</code> file). JSON body:</p>
    <pre class="code">{
  "amount": 123.45,
  "date": "2026-09-22",
  "description": "Carrefour Mall of Emirates",
  "type": "debit",
  "balance": 4321.00
}</pre>
    <p class="hint"><b>type</b> is <code>"debit"</code> (money out) or <code>"credit"</code> (money in). <b>balance</b> is optional — pass it whenever the bank email includes an available/running balance, so Mashreq stays exactly in sync.</p>
  </div>`;
}
