import { EXPENSE_CATS, CAT_OPTIONS } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { esc, uid, money, moneyH, today, iso, fmtDate, fmtTime, sum } from '../core/util.js';
import {
  periodOf, prevPeriod, periodLabel, inPeriod, mashreqComputed, payLabel, isBankPay, isCCPay,
  chargeCard, recurringCycle, recurringLogged, claimBankEntry,
  accounts, payMethods, bankBalance, accountName, bankAccounts,
} from '../domain/finance.js';
import { PRIMARY, transferKind, displayName, methodFor } from '../domain/accounts.js';
import { indiaLabel } from '../domain/india.js';
import { openForm, expose } from '../ui/form.js';
import { render } from '../ui/shell.js';

let offset = 0; // how many salary periods back the list is showing

// Name for one end of a transfer: a UAE account, cash, or an Indian account ('india:<id>')
function endName(x) {
  if (x === 'cash') return 'Cash';
  if (String(x).startsWith('india:')) {
    const a = (S.indiaAccounts || []).find(i => i.id === x.slice(6));
    return a ? indiaLabel(a) : 'India';
  }
  return accountName(x);
}

export function vExpenses() {
  let p = periodOf(today());
  for (let i = 0; i < offset; i++) p = prevPeriod(p);
  const list = S.expenses.filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment')
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const bankSpent = sum(list.filter(isBankPay));
  const ccSpent = sum(list.filter(isCCPay));
  const periodIncomes = S.incomes.filter(i => inPeriod(i.date, p));
  const income = sum(periodIncomes);
  const byCat = {};
  for (const e of list) byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount);
  const accountRows = accounts().map(a => {
    if (a.type === 'bank') {
      const bal = bankBalance(a.id);
      return `<div class="row">
        <div class="grow"><div class="title">${esc(displayName(a))}</div><div class="sub">${a.balanceDate ? 'anchor: ' + money(a.balance) + ' on ' + fmtDate(a.balanceDate) : 'no starting balance set'}</div></div>
        <span class="amt ${bal !== null && bal < 0 ? 'neg' : 'pos'}">${bal !== null ? moneyH(bal) : '—'}</span>
        <button class="btn small" onclick="setBankBalance('${a.id}')">Set balance</button>
        <button class="btn small" onclick="reconcile('${a.id}')">Reconcile</button>
      </div>`;
    }
    if (a.type === 'debit') {
      const spentHere = sum(list.filter(e => e.payMethod === a.id));
      return `<div class="row">
        <div class="grow"><div class="title">${esc(displayName(a))} <span class="chip">debit</span></div><div class="sub">draws from ${esc(accountName(a.linkedTo || PRIMARY))} · ${money(spentHere)} this period</div></div>
      </div>`;
    }
    const bal = Number(a.balance || 0), lim = Number(a.limit || 0);
    return `<div class="row">
      <div class="grow"><div class="title">${esc(displayName(a))}</div><div class="sub">outstanding${lim ? ' · ' + money(lim - bal) + ' available' : ''}</div></div>
      <span class="amt ${bal > 0 ? 'neg' : ''}">${moneyH(bal)}</span>
      <button class="btn small" onclick="payCreditCard('${a.id}')">Pay card</button>
      <button class="btn small" onclick="setCCBalance('${a.id}')">Set balance</button>
    </div>`;
  }).join('');

  // Money moved between accounts this period: card repayments and transfers (not spending)
  const moves = [
    ...S.expenses.filter(e => e.payMethod === 'cc_payment' && inPeriod(e.date, p)).map(e => ({ kind: 'pay', id: e.id, date: e.date, amount: e.amount, text: `${accountName(e.fromAccount || PRIMARY)} → ${e.toAccount ? accountName(e.toAccount) : (e.note || 'card')}` })),
    ...(S.transfers || []).filter(t => inPeriod(t.date, p)).map(t => ({ kind: 'transfer', id: t.id, date: t.date, amount: t.amount, text: `${endName(t.from)} → ${endName(t.to)}${t.note && !String(t.to).startsWith('india:') ? ' · ' + t.note : ''}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addExpense()">+ Add expense</button>
    <button class="btn" onclick="markSalary()">💰 Salary</button>
    <button class="btn" onclick="addTransfer()">⇄ Transfer</button>
    <button class="btn" onclick="setBudgets()">Budgets</button>
    <div class="spacer"></div>
    <button class="btn small" onclick="expPeriod(1)">←</button>
    <span class="hint">${periodLabel(p)}</span>
    <button class="btn small" ${offset === 0 ? 'disabled' : ''} onclick="expPeriod(-1)">→</button>
  </div>

  <div class="panel">
    <h2>Accounts <small>— add or edit them in Settings</small></h2>
    ${accountRows}
  </div>

  <div class="section-lbl">This period · ${periodLabel(p)}</div>
  <div class="cards">
    <div class="card card-green"><div class="k">Income</div><div class="v">${money(income)}</div><div class="s">this period</div></div>
    <div class="card card-blue"><div class="k">Bank spent</div><div class="v">${money(bankSpent)}</div><div class="s">bank, debit card &amp; cash</div></div>
    <div class="card card-purple"><div class="k">Card spent</div><div class="v">${money(ccSpent)}</div><div class="s">credit cards</div></div>
    <div class="card card-amber"><div class="k">Total out</div><div class="v">${money(bankSpent + ccSpent)}</div><div class="s">bank + CC combined</div></div>
  </div>

  <div class="panel">
    <h2>Expenses <small>— ${list.length} entries</small></h2>
    ${list.length ? list.map(e => `<div class="row">
      <div class="grow">
        <div class="title">${esc(e.cat)}${e.recurringId ? ' <span class="chip">auto</span>' : ''}${e.source === 'n8n' ? ' <span class="chip" title="Logged from bank alert">🏦 bank</span>' : ''}</div>
        <div class="sub">${fmtDate(e.date)}${e.createdAt ? ' ' + fmtTime(e.createdAt) : ''} · ${payLabel(e.payMethod)}${e.note ? ' · ' + esc(e.note) : ''}</div>
      </div>
      <span class="amt">${moneyH(e.amount)}</span>
      ${e.source === 'n8n' ? `<button class="btn small" onclick="setExpenseCat('${e.id}')">Category</button>` : ''}
      <button class="btn small danger" onclick="delExpense('${e.id}')">✕</button>
    </div>`).join('') : '<div class="empty">No expenses this period.</div>'}
  </div>

  <div class="panel">
    <h2>Income <small>— this period</small></h2>
    ${periodIncomes.map(i => `<div class="row">
      <div class="grow"><div class="title">${esc(i.note || 'Salary')}</div><div class="sub">${fmtDate(i.date)}</div></div>
      <span class="amt pos">${moneyH(i.amount)}</span>
      <button class="btn small danger" onclick="delIncome('${i.id}')">✕</button>
    </div>`).join('') || '<div class="empty">No income logged this period.</div>'}
  </div>

  ${moves.length ? `<div class="panel">
    <h2>Transfers <small>— card payments and moves between accounts (not spending)</small></h2>
    ${moves.map(m => `<div class="row">
      <div class="grow"><div class="title">⇄ ${esc(m.text)}</div><div class="sub">${fmtDate(m.date)}</div></div>
      <span class="amt">${moneyH(m.amount)}</span>
      <button class="btn small danger" onclick="delMove('${m.kind}','${m.id}')">✕</button>
    </div>`).join('')}
  </div>` : ''}

  ${Object.keys(S.budgets).length ? `<div class="panel"><h2>Budgets <small>— this period</small></h2>
    ${Object.entries(S.budgets).filter(([, b]) => Number(b) > 0).map(([cat, b]) => {
      const used = byCat[cat] || 0;
      const pct = Math.min(100, used / b * 100);
      return `<div class="hbar-row" title="${esc(cat)}: ${money(used)} of ${money(b)}">
        <div class="lbl">${esc(cat)}</div>
        <div class="track"><div class="bar ${used > b ? 'over' : ''}" style="width:${Math.max(2, pct)}%"></div>
        <span class="val">${money(used)} / ${money(b)}</span></div></div>`;
    }).join('')}</div>` : ''}

  <div class="section-lbl">Recurring payments</div>
  <div class="panel">
    ${(S.recurring || []).map(r => {
      const done = recurringLogged(r.id);
      return `<div class="row">
        <div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${money(r.amount)} · ${esc(r.cat)} · auto-logged on the 25th${r.active === false ? ' · paused' : ''}</div></div>
        <span class="badge ${done ? 'ok' : 'soon'}">${done ? 'logged' : 'pending'}</span>
        ${!done ? `<button class="btn small" onclick="logRecurringPayment('${r.id}')">Log</button>` : ''}
        <button class="btn small" onclick="editRecurring('${r.id}')">Edit</button>
      </div>`;
    }).join('') || '<div class="empty">No recurring payments set up.</div>'}
    <div style="margin-top:8px"><button class="btn small" onclick="addRecurring()">+ Add recurring</button></div>
  </div>`;
}

expose({
  expPeriod(step) { offset = Math.max(0, offset + step); render(); },

  setBankBalance(id = PRIMARY) {
    const acc = S.accounts[id] || {};
    openForm(`Set ${acc.name || 'bank'} balance`, [
      { name: 'balance', label: 'Current balance (AED)', type: 'number', step: '0.01', value: acc.balance ?? '', required: true },
      { name: 'balanceDate', label: 'As of date', type: 'date', value: acc.balanceDate || iso(today()), required: true },
    ], d => {
      S.accounts[id] = { ...acc, type: 'bank', balance: Number(d.balance), balanceDate: d.balanceDate };
      delete S.accounts[id].balanceAt;
    }, 'Set');
  },

  // Enter the real balance; any gap is logged as unlogged spending or income on that account
  reconcile(id = PRIMARY) {
    const acc = S.accounts[id] || {};
    const computed = bankBalance(id);
    openForm(`Reconcile ${acc.name || 'bank'} balance`, [
      { name: 'actual', label: `Your actual ${acc.name || 'bank'} balance right now (AED)`, type: 'number', step: '0.01', required: true },
      { name: 'date', label: 'As of', type: 'date', value: iso(today()), required: true },
    ], d => {
      const actual = Number(d.actual);
      if (computed !== null) {
        const diff = computed - actual;
        if (Math.abs(diff) > 0.5) {
          if (diff > 0) S.expenses.push({ id: uid(), date: d.date, cat: 'Other', amount: diff, note: 'Reconciliation — unlogged spending', payMethod: methodFor(id), createdAt: Date.now() - 1 });
          else S.incomes.push({ id: uid(), date: d.date, amount: -diff, note: 'Reconciliation — unlogged income', account: id === PRIMARY ? undefined : id, createdAt: Date.now() - 1 });
        }
      }
      S.accounts[id] = { ...acc, type: 'bank', balance: actual, balanceDate: d.date, balanceAt: Date.now() };
    }, 'Reconcile');
  },

  setCCBalance(ccId) {
    const acc = S.accounts[ccId] || {};
    openForm(`Set ${acc.name || 'card'} balance`, [
      { name: 'balance', label: 'Outstanding balance (AED)', type: 'number', step: '0.01', value: Number(acc.balance || 0), required: true },
      { name: 'limit', label: 'Credit limit (AED)', type: 'number', step: '1', value: Number(acc.limit || 0) || '' },
    ], d => {
      const upd = { ...acc, balance: Number(d.balance), balanceDate: iso(today()) };
      if (d.limit) upd.limit = Number(d.limit);
      S.accounts[ccId] = upd;
    }, 'Set');
  },

  // Pay a credit card from any bank account (a transfer, never spending)
  payCreditCard(ccId) {
    window.addTransfer({ to: ccId, amount: (S.accounts[ccId] || {}).balance || '' });
  },

  // Move money: bank → bank, bank ↔ cash (ATM), or bank → credit card (card repayment)
  addTransfer(preset = {}) {
    const banks = bankAccounts();
    const fromOpts = [...banks.map(a => ({ v: a.id, t: displayName(a) })), { v: 'cash', t: 'Cash' }];
    const toOpts = [...accounts().filter(a => a.type !== 'debit').map(a => ({ v: a.id, t: `${displayName(a)}${a.type === 'credit' ? ' (pay card)' : ''}` })), { v: 'cash', t: 'Cash (ATM withdrawal)' }];
    openForm(preset.to && (S.accounts[preset.to] || {}).type === 'credit' ? `Pay ${accountName(preset.to)}` : 'Transfer money', [
      { name: 'from', label: 'From', type: 'select', value: preset.from || PRIMARY, options: fromOpts },
      { name: 'to', label: 'To', type: 'select', value: preset.to || (banks[1] || {}).id || 'cash', options: toOpts },
      { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', value: preset.amount ?? '', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'note', label: 'Note', placeholder: 'optional' },
    ], d => {
      if (d.from === d.to) { alert('From and To are the same account.'); return; }
      const amt = Number(d.amount);
      if (transferKind(S.accounts, d.from, d.to) === 'card-payment') {
        S.expenses.push({ id: uid(), date: d.date, cat: 'Other', amount: amt, note: `${accountName(d.to)} payment${d.note ? ' · ' + d.note : ''}`, payMethod: 'cc_payment', fromAccount: d.from, toAccount: d.to, createdAt: Date.now() });
        const card = S.accounts[d.to];
        card.balance = Math.max(0, Number(card.balance || 0) - amt);
        card.balanceDate = d.date;
      } else {
        (S.transfers = S.transfers || []).push({ id: uid(), date: d.date, from: d.from, to: d.to, amount: amt, note: d.note || '', createdAt: Date.now() });
      }
    }, 'Save');
  },
  delMove(kind, id) {
    if (!confirm('Remove this transfer?')) return;
    if (kind === 'transfer') {
      const t = (S.transfers || []).find(x => x.id === id);
      S.transfers = (S.transfers || []).filter(x => x.id !== id);
      if (t && t.remitId) S.remittances = (S.remittances || []).filter(r => r.id !== t.remitId);   // a transfer home
    }
    else {
      const e = S.expenses.find(x => x.id === id);
      S.expenses = S.expenses.filter(x => x.id !== id);
      const card = e && (e.toAccount ? S.accounts[e.toAccount] : null);
      if (card) card.balance = Number(card.balance || 0) + Number(e.amount);   // undo the repayment
    }
    save(); render();
  },

  addRecurring() {
    openForm('Add recurring expense', [
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Internet bill' },
      { name: 'amount', label: 'Amount (AED)', type: 'number', required: true },
      { name: 'cat', label: 'Category', type: 'select', value: 'Other', options: CAT_OPTIONS },
      { name: 'day', label: 'Day of month to log it', type: 'number', value: 1 },
    ], d => {
      S.recurring = S.recurring || [];
      S.recurring.push({ id: uid(), name: d.name, amount: Number(d.amount), cat: d.cat, day: Number(d.day) || 1, active: true });
    });
  },

  editRecurring(id) {
    const r = (S.recurring || []).find(x => x.id === id);
    openForm(`Edit: ${r.name}`, [
      { name: 'name', label: 'Name', value: r.name, required: true },
      { name: 'amount', label: 'Amount (AED)', type: 'number', value: r.amount, required: true },
      { name: 'cat', label: 'Category', type: 'select', value: r.cat, options: CAT_OPTIONS },
      { name: 'day', label: 'Day of month to log', type: 'number', value: r.day },
      { name: 'active', label: 'Active', type: 'select', value: r.active ? 'yes' : 'no', options: [{ v: 'yes', t: 'Yes — auto-log every month' }, { v: 'no', t: 'No — paused' }] },
    ], d => Object.assign(r, { name: d.name, amount: Number(d.amount), cat: d.cat, day: Number(d.day) || 1, active: d.active === 'yes' }));
  },

  logRecurringPayment(id) {
    const r = (S.recurring || []).find(x => x.id === id);
    if (!r || !confirm(`Log ${r.name} payment of ${money(r.amount)} to expenses?`)) return;
    const key = recurringCycle().key;
    if (!claimBankEntry(r, key)) {
      S.expenses.push({ id: uid(), date: iso(today()), cat: r.cat, amount: Number(r.amount), note: r.name, payMethod: 'bank', recurringId: r.id, recurringMonth: key, createdAt: Date.now() });
    }
    save(); render();
  },

  // preset (from dashboard quick-add): { cat, amount, payMethod, note }
  addExpense(preset = {}) {
    openForm(preset.cat ? `Add ${preset.cat}` : 'Add expense', [
      { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', required: true, value: preset.amount ?? '' },
      { name: 'cat', label: 'Category', type: 'select', value: preset.cat || 'Groceries', options: CAT_OPTIONS },
      { name: 'payMethod', label: 'Paid with', type: 'select', value: preset.payMethod || 'bank', options: payMethods() },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'note', label: 'Note', placeholder: 'optional', value: preset.note || '' },
    ], d => {
      S.expenses.push({ id: uid(), ...d, amount: Number(d.amount), createdAt: Date.now() });
      chargeCard(d.payMethod, d.amount, d.date);
    });
  },

  markSalary() {
    openForm('Salary received 🎉', [
      { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', value: S.settings.salaryAmount || '', required: true },
      { name: 'date', label: 'Received on', type: 'date', value: iso(today()), required: true },
      { name: 'note', label: 'Note', value: 'Salary' },
      ...(bankAccounts().length > 1 ? [{ name: 'account', label: 'Received into', type: 'select', value: S.settings.salaryAccount || PRIMARY, options: bankAccounts().map(a => ({ v: a.id, t: displayName(a) })) }] : []),
    ], d => {
      const account = d.account && d.account !== PRIMARY ? d.account : undefined;
      S.incomes.push({ id: uid(), date: d.date, note: d.note, amount: Number(d.amount), ...(account ? { account } : {}), createdAt: Date.now() });
      S.settings.salaryAmount = Number(d.amount);
      if (d.account) S.settings.salaryAccount = d.account;
    });
  },

  setBudgets() {
    openForm('Monthly budgets (AED, blank = none)', EXPENSE_CATS.map(c =>
      ({ name: c, label: c, type: 'number', value: S.budgets[c] || '' })),
    d => { for (const c of EXPENSE_CATS) S.budgets[c] = Number(d[c]) || 0; });
  },

  setExpenseCat(id) {
    const exp = S.expenses.find(e => e.id === id);
    if (!exp) return;
    openForm('Set category', [
      { name: 'cat', label: 'Category', type: 'select', value: exp.cat || 'Other', options: CAT_OPTIONS },
      { name: 'note', label: 'Note', value: exp.note || '' },
    ], d => { exp.cat = d.cat; exp.note = d.note; });
  },

  delExpense(id) {
    const exp = S.expenses.find(e => e.id === id);
    S.expenses = S.expenses.filter(e => e.id !== id);
    // undo the card charge it made
    if (exp && isCCPay(exp)) {
      S.accounts = S.accounts || {};
      const acc = S.accounts[exp.payMethod] || { balance: 0 };
      acc.balance = Math.max(0, Number(acc.balance || 0) - Number(exp.amount));
      S.accounts[exp.payMethod] = acc;
    }
    save(); render();
  },

  delIncome(id) { S.incomes = S.incomes.filter(i => i.id !== id); save(); render(); },
});

