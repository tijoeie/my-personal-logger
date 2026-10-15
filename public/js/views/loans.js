// Loans tab: money borrowed from friends, receivables (money owed to me), bank loans/EMIs.
import { DAY, PAY_METHODS } from '../core/constants.js';
import { S } from '../core/state.js';
import { esc, uid, money, moneyH, today, iso, parseISO, addMonths, fmtDate, sum } from '../core/util.js';
import { chargeCard, totalEMI } from '../domain/finance.js';
import { openForm, expose, confirmThen } from '../ui/form.js';

const paidTo = (payments, key, id) => sum((payments || []).filter(p => p[key] === id));
const byDateDesc = (a, b) => b.date.localeCompare(a.date);

function payRow(p, sign, cls, delCall) {
  return `<div class="row">
    <div class="grow sub">${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div>
    <span class="amt ${cls}"${delCall ? ' style="margin-right:8px"' : ''}>${sign}${moneyH(p.amount)}</span>
    ${delCall ? `<button class="btn small danger" onclick="${delCall}">✕</button>` : ''}
  </div>`;
}

function borrowedPanel(b) {
  const pays = (S.borrowedPayments || []).filter(p => p.bId === b.id).sort(byDateDesc);
  const amtPaid = sum(pays);
  const amtLeft = Math.max(0, Number(b.total) - amtPaid);
  const pct = b.total > 0 ? Math.min(100, Math.round(amtPaid / b.total * 100)) : 0;
  const done = amtLeft <= 0;
  const totalMonths = Number(b.months || 0);
  return `<div class="panel">
    <h2>${esc(b.name)} <small>— ${done ? 'fully repaid ✓' : money(amtLeft) + ' remaining'}</small></h2>
    <div class="progress"><div style="width:${pct}%;background:var(--critical)"></div></div>
    <div class="sub">${money(amtPaid)} repaid of ${money(b.total)} · ${pct}% done${b.note ? ' · ' + esc(b.note) : ''}</div>
    ${Number(b.monthly || 0) > 0
      ? `<div class="sub">${money(b.monthly)}/month · ${pays.length}${totalMonths ? '/' + totalMonths : ''} payments${b.dueDate ? ' · due ' + fmtDate(b.dueDate) : ''}</div>`
      : (b.dueDate ? `<div class="sub">One-shot · due ${fmtDate(b.dueDate)}</div>` : '')}
    <div class="toolbar" style="margin-top:10px;margin-bottom:0">
      ${!done ? `<button class="btn small primary" onclick="logBorrowedPayment('${b.id}')">Log repayment</button>` : ''}
      <button class="btn small" onclick="editBorrowed('${b.id}')">Edit</button>
      <button class="btn small danger" onclick="delBorrowed('${b.id}')">Delete</button>
    </div>
    ${pays.length ? `<div style="margin-top:8px">${pays.map(p => payRow(p, '-', 'neg', `delBorrowedPayment('${p.id}')`)).join('')}</div>` : ''}
  </div>`;
}

function receivablePanel(g) {
  const pays = (S.loansGivenPayments || []).filter(p => p.gId === g.id).sort(byDateDesc);
  const totalMonths = Number(g.months || 0);
  const remaining = Math.max(0, totalMonths - pays.length);
  const amtPaid = sum(pays);
  const amtLeft = Math.max(0, Number(g.total) - amtPaid);
  const pct = g.total > 0 ? Math.min(100, Math.round(amtPaid / g.total * 100)) : 0;
  const lastPay = pays[0];
  return `<div class="panel">
    <h2>${esc(g.name)} <small>— ${remaining === 0 ? 'fully received ✓' : remaining + ' months left'}</small></h2>
    <div class="progress"><div style="width:${pct}%;background:var(--series-2)"></div></div>
    <div class="sub">${money(amtPaid)} received of ${money(g.total)} · ${pct}% done${remaining > 0 ? ` · ${money(amtLeft)} remaining` : ''}</div>
    ${g.monthly ? `<div class="sub">${money(g.monthly)}/month · ${pays.length}/${totalMonths} payments${g.note ? ' · ' + esc(g.note) : ''}</div>` : ''}
    ${lastPay ? `<div class="sub" style="color:var(--muted)">Last received: ${fmtDate(lastPay.date)}</div>` : '<div class="sub" style="color:var(--warning)">No payments logged yet</div>'}
    <div class="toolbar" style="margin-top:10px;margin-bottom:0">
      <button class="btn small primary" onclick="logLoanGivenPayment('${g.id}')">Log received</button>
      <button class="btn small" onclick="editLoanGiven('${g.id}')">Edit</button>
      <button class="btn small danger" onclick="delLoanGiven('${g.id}')">Delete</button>
    </div>
    ${pays.length ? `<div style="margin-top:8px">${pays.map(p => payRow(p, '+', 'pos', `delLoanGivenPayment('${p.id}')`)).join('')}</div>` : ''}
  </div>`;
}

function loanPanel(l) {
  const monthsLeft = l.emi > 0 && l.outstanding > 0 ? Math.ceil(l.outstanding / l.emi) : null;
  const pays = (S.loanPayments || []).filter(p => p.loanId === l.id).sort(byDateDesc);
  const pct = l.amount > 0 ? Math.min(100, (1 - l.outstanding / l.amount) * 100) : 0;
  return `<div class="panel">
    <h2>${esc(l.name)} <small>${l.outstanding > 0 ? '— active' : '— paid off ✓'}</small></h2>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="sub">${money(l.outstanding)} remaining of ${money(l.amount)} (${Math.round(pct)}% paid)${monthsLeft ? ` · ~${monthsLeft} months left` : ''}</div>
    ${l.emi ? `<div class="sub">EMI: ${money(l.emi)}/month${l.rate ? ` · ${l.rate}% p.a.` : ''}${l.nextPayDate ? ` · next: ${fmtDate(l.nextPayDate)}` : ''}</div>` : ''}
    <div class="toolbar" style="margin-top:10px;margin-bottom:0">
      <button class="btn small primary" onclick="logLoanPayment('${l.id}')">Log payment</button>
      <button class="btn small" onclick="editLoan('${l.id}')">Edit</button>
      <button class="btn small danger" onclick="delLoan('${l.id}')">Delete</button>
    </div>
    ${pays.length ? `<div style="margin-top:8px">${pays.slice(0, 5).map(p => payRow(p, '-', 'neg')).join('')}</div>` : ''}
  </div>`;
}

export function vLoans() {
  const loans = S.loans || [];
  const borrowed = S.borrowedFromFriends || [];
  const given = S.loansGiven || [];
  const totalOutstanding = sum(loans, l => l.outstanding);
  const owed = sum(borrowed, b => Math.max(0, Number(b.total) - paidTo(S.borrowedPayments, 'bId', b.id)));

  return `
  <div class="toolbar"><button class="btn primary" onclick="addLoan()">+ Add loan</button></div>

  ${(loans.length || borrowed.length) ? `
  <div class="cards">
    <div class="card"><div class="k">Loans outstanding</div><div class="v ${totalOutstanding > 0 ? 'neg' : ''}">${money(totalOutstanding)}</div><div class="s">${loans.length} loan${loans.length !== 1 ? 's' : ''}</div></div>
    <div class="card"><div class="k">Monthly EMI</div><div class="v">${money(totalEMI())}</div><div class="s">total commitment</div></div>
    ${borrowed.length ? `<div class="card"><div class="k">Owe to friends</div><div class="v ${owed > 0 ? 'neg' : ''}">${money(owed)}</div><div class="s">${borrowed.length} entr${borrowed.length !== 1 ? 'ies' : 'y'}</div></div>` : ''}
  </div>` : ''}

  <div class="section-lbl">Borrowed from friends</div>
  <div class="toolbar"><button class="btn primary" onclick="addBorrowed()">+ Add borrowed</button></div>
  ${borrowed.length ? borrowed.map(borrowedPanel).join('') : '<div class="panel"><div class="empty">No borrowed money tracked. Add when you borrow from a friend.</div></div>'}

  <div class="section-lbl">Money owed to me</div>
  <div class="toolbar"><button class="btn primary" onclick="addLoanGiven()">+ Add receivable</button></div>
  ${given.length ? given.map(receivablePanel).join('') : '<div class="panel"><div class="empty">No receivables. Track money friends or family owe you.</div></div>'}

  <div class="section-lbl">My loans &amp; EMIs</div>
  ${loans.length ? loans.map(loanPanel).join('') : '<div class="panel"><div class="empty">No loans tracked. Add a personal loan, car loan, or any EMI here.</div></div>'}`;
}

// ---- forms ----
const loanFields = (l = {}) => [
  { name: 'name', label: 'Loan name', value: l.name, required: true, placeholder: 'e.g. Car loan, Personal loan' },
  { name: 'amount', label: 'Total borrowed (AED)', type: 'number', step: '0.01', value: l.amount, required: true },
  { name: 'outstanding', label: 'Current outstanding (AED)', type: 'number', step: '0.01', value: l.outstanding, required: true },
  { name: 'emi', label: 'Monthly EMI (AED)', type: 'number', step: '0.01', value: l.emi || '' },
  { name: 'rate', label: 'Interest rate (% p.a., optional)', type: 'number', step: '0.01', value: l.rate || '' },
  { name: 'nextPayDate', label: 'Next payment date (optional)', type: 'date', value: l.nextPayDate },
  { name: 'note', label: 'Note', value: l.note, placeholder: 'e.g. bank name, purpose' },
];
const loanFromForm = d => ({ name: d.name, amount: Number(d.amount), outstanding: Number(d.outstanding), emi: Number(d.emi) || 0, rate: Number(d.rate) || 0, nextPayDate: d.nextPayDate, note: d.note });

const borrowedFields = (b = {}) => [
  { name: 'name', label: 'Borrowed from (name)', value: b.name, required: true, placeholder: 'e.g. Arun, George' },
  { name: 'total', label: 'Total amount (AED)', type: 'number', step: '0.01', value: b.total, required: true },
  { name: 'monthly', label: 'Monthly repayment (AED, 0 = one-shot)', type: 'number', step: '0.01', value: b.monthly || 0 },
  { name: 'months', label: 'Number of months (0 = one-shot)', type: 'number', step: '1', value: b.months || 0 },
  { name: 'dueDate', label: 'Repay by date (optional)', type: 'date', value: b.dueDate || '' },
  { name: 'note', label: 'Note / purpose', value: b.note || '', placeholder: 'e.g. emergency, event expenses' },
];
const borrowedFromForm = d => ({ name: d.name, total: Number(d.total), monthly: Number(d.monthly) || 0, months: Number(d.months) || 0, dueDate: d.dueDate, note: d.note });

const givenFields = (g = {}) => [
  { name: 'name', label: 'Label (e.g. Eby — Phone EMI)', value: g.name, required: true },
  { name: 'total', label: 'Total amount (AED)', type: 'number', step: '0.01', value: g.total, required: true },
  { name: 'monthly', label: 'Monthly instalment (AED)', type: 'number', step: '0.01', value: g.monthly },
  { name: 'months', label: 'Number of months', type: 'number', step: '1', value: g.months },
  ...(g.id ? [] : [{ name: 'startDate', label: 'Start date', type: 'date' }]),
  { name: 'note', label: 'Note (e.g. ENBD CC 0% EMI)', value: g.note, placeholder: 'optional' },
];

expose({
  addLoan() {
    openForm('Add loan', loanFields(), d => { (S.loans = S.loans || []).push({ id: uid(), ...loanFromForm(d) }); });
  },
  editLoan(id) {
    const l = (S.loans || []).find(x => x.id === id);
    openForm('Edit loan', loanFields(l), d => Object.assign(l, loanFromForm(d)));
  },
  logLoanPayment(id) {
    const l = (S.loans || []).find(x => x.id === id);
    openForm(`Log payment — ${l.name}`, [
      { name: 'amount', label: 'Payment amount (AED)', type: 'number', step: '0.01', value: l.emi || '', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'payMethod', label: 'Paid from', type: 'select', value: 'bank', options: PAY_METHODS },
      { name: 'note', label: 'Note', placeholder: 'optional' },
    ], d => {
      const amt = Number(d.amount);
      (S.loanPayments = S.loanPayments || []).push({ id: uid(), loanId: id, date: d.date, amount: amt, note: d.note });
      l.outstanding = Math.max(0, Number(l.outstanding) - amt);
      if (l.nextPayDate) l.nextPayDate = iso(addMonths(parseISO(l.nextPayDate), 1));
      S.expenses.push({ id: uid(), date: d.date, cat: 'Loan EMI', amount: amt, note: `${l.name} payment`, payMethod: d.payMethod, createdAt: Date.now() });
      chargeCard(d.payMethod, amt, d.date);
    }, 'Log payment');
  },
  delLoan: id => confirmThen('Delete this loan and all its payments?', () => {
    S.loans = S.loans.filter(l => l.id !== id);
    S.loanPayments = (S.loanPayments || []).filter(p => p.loanId !== id);
  }),

  addLoanGiven() {
    openForm('Add receivable', givenFields(), d => {
      (S.loansGiven = S.loansGiven || []).push({ id: uid(), name: d.name, total: Number(d.total), monthly: Number(d.monthly) || 0, months: Number(d.months) || 0, startDate: d.startDate, note: d.note });
    });
  },
  editLoanGiven(id) {
    const g = (S.loansGiven || []).find(x => x.id === id);
    if (!g) return;
    openForm('Edit receivable', givenFields(g), d => {
      Object.assign(g, { name: d.name, total: Number(d.total), monthly: Number(d.monthly) || 0, months: Number(d.months) || 0, note: d.note });
    });
  },
  logLoanGivenPayment(id) {
    const g = (S.loansGiven || []).find(x => x.id === id);
    if (!g) return;
    openForm('Log received payment', [
      { name: 'amount', label: 'Amount received (AED)', type: 'number', step: '0.01', value: g.monthly || '', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'receivedInto', label: 'Received into', type: 'select', value: 'bank', options: [{ v: 'bank', t: 'Mashreq (bank)' }, { v: 'cash', t: 'Cash' }] },
      { name: 'note', label: 'Note', placeholder: 'optional' },
    ], d => {
      const amt = Number(d.amount);
      const pay = { id: uid(), gId: id, date: d.date, amount: amt, note: d.note };
      (S.loansGivenPayments = S.loansGivenPayments || []).push(pay);
      if (d.receivedInto !== 'bank') return;
      const note = `${g.name} — repayment received${d.note ? ' · ' + d.note : ''}`;
      // If the bank feed already logged this credit, claim it instead of adding it twice
      const from = parseISO(d.date) - 7 * DAY, to = +parseISO(d.date) + 7 * DAY;
      const bank = S.incomes.find(i => i.source === 'n8n' && !i.receivableId && Math.abs(Number(i.amount) - amt) < 0.01 && parseISO(i.date) >= from && parseISO(i.date) <= to);
      if (bank) {
        Object.assign(bank, { note, receivableId: pay.id });
        pay.incomeId = bank.id;
      } else {
        pay.incomeId = uid();
        S.incomes.push({ id: pay.incomeId, date: d.date, amount: amt, note, receivableId: pay.id, createdAt: Date.now() });
      }
    }, 'Log');
  },
  delLoanGivenPayment: pid => confirmThen('Remove this payment record?', () => {
    const pay = (S.loansGivenPayments || []).find(p => p.id === pid);
    S.loansGivenPayments = (S.loansGivenPayments || []).filter(p => p.id !== pid);
    // Drop the Mashreq income it created (a bank-feed credit stays, just unlinked)
    if (pay && pay.incomeId) {
      const inc = S.incomes.find(i => i.id === pay.incomeId);
      if (inc && inc.source === 'n8n') delete inc.receivableId;
      else S.incomes = S.incomes.filter(i => i.id !== pay.incomeId);
    }
  }),
  delLoanGiven: id => confirmThen('Delete this receivable and all its payment records?', () => {
    S.loansGiven = (S.loansGiven || []).filter(g => g.id !== id);
    S.loansGivenPayments = (S.loansGivenPayments || []).filter(p => p.gId !== id);
  }),

  addBorrowed() {
    openForm('Borrow from friend', borrowedFields(), d => {
      (S.borrowedFromFriends = S.borrowedFromFriends || []).push({ id: uid(), ...borrowedFromForm(d) });
    });
  },
  editBorrowed(id) {
    const b = (S.borrowedFromFriends || []).find(x => x.id === id);
    if (b) openForm('Edit borrowed', borrowedFields(b), d => Object.assign(b, borrowedFromForm(d)));
  },
  logBorrowedPayment(id) {
    const b = (S.borrowedFromFriends || []).find(x => x.id === id);
    if (!b) return;
    const remaining = Math.max(0, Number(b.total) - paidTo(S.borrowedPayments, 'bId', id));
    openForm(`Repay — ${b.name}`, [
      { name: 'amount', label: 'Amount paid (AED)', type: 'number', step: '0.01', value: b.monthly || remaining, required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'payMethod', label: 'Paid from', type: 'select', value: 'bank', options: PAY_METHODS },
      { name: 'note', label: 'Note', placeholder: 'optional' },
    ], d => {
      const amt = Number(d.amount);
      (S.borrowedPayments = S.borrowedPayments || []).push({ id: uid(), bId: id, date: d.date, amount: amt, note: d.note });
      S.expenses.push({ id: uid(), date: d.date, cat: 'Repayment', amount: amt, note: `Repay ${b.name}`, payMethod: d.payMethod, createdAt: Date.now() });
      chargeCard(d.payMethod, amt, d.date);
    }, 'Log repayment');
  },
  delBorrowedPayment: pid => confirmThen('Remove this repayment record?', () => {
    S.borrowedPayments = (S.borrowedPayments || []).filter(p => p.id !== pid);
  }),
  delBorrowed: id => confirmThen('Delete this entry and all its repayment records?', () => {
    S.borrowedFromFriends = S.borrowedFromFriends.filter(b => b.id !== id);
    S.borrowedPayments = (S.borrowedPayments || []).filter(p => p.bId !== id);
  }),
});
