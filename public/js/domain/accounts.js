// Accounts and cards, defined by the user in Settings. Pure functions over S.accounts.
//
// S.accounts[id] = {
//   name, type: 'bank' | 'debit' | 'credit',
//   balance, balanceDate, balanceAt?      bank: anchor balance; credit: outstanding
//   limit?                                credit cards
//   linkedTo?                             debit cards: the bank account they draw from
//   last4?, hidden?, order?
// }
// 'mashreq' is the primary bank: the bank feed (n8n) posts to it, and older entries use
// payMethod 'bank' (or nothing) for it. Every other account uses its own id as payMethod.
export const PRIMARY = 'mashreq';
export const TYPE_LABEL = { bank: 'Bank account', debit: 'Debit card', credit: 'Credit card' };
const TYPE_ORDER = { bank: 0, debit: 1, credit: 2 };

export function accountList(accounts, { includeHidden = false } = {}) {
  return Object.entries(accounts || {})
    .map(([id, a]) => ({ id, ...a, type: a.type || 'bank' }))
    .filter(a => includeHidden || !a.hidden)
    .sort((a, b) => (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || ((a.order ?? 99) - (b.order ?? 99)) || (a.id === PRIMARY ? -1 : b.id === PRIMARY ? 1 : 0) || a.name.localeCompare(b.name));
}

// payMethod value stored on an expense for this account
export const methodFor = id => (id === PRIMARY ? 'bank' : id);

// Account behind a payMethod (null for cash and card repayments)
export function accountOf(accounts, method) {
  if (method === 'cash' || method === 'cc_payment') return null;
  const id = (!method || method === 'bank' || method === 'mashreq') ? PRIMARY : method;
  const a = (accounts || {})[id];
  return a ? { id, ...a, type: a.type || 'bank' } : null;
}

// Bank account that pays for this method: the bank itself, or the bank a debit card is linked to
export function bankOf(accounts, method) {
  const a = accountOf(accounts, method);
  if (!a) return null;
  if (a.type === 'bank') return a.id;
  if (a.type === 'debit') return a.linkedTo || PRIMARY;
  return null;
}

export const isCredit = (accounts, method) => (accountOf(accounts, method) || {}).type === 'credit';

export function displayName(a) {
  const tail = a.last4 ? ` ••${a.last4}` : '';
  return `${a.name}${tail}`;
}

// Options for "Paid with" pickers: banks, debit cards, credit cards, then cash
export function payMethodOptions(accounts) {
  const opts = accountList(accounts).map(a => ({
    v: methodFor(a.id),
    t: a.type === 'bank' ? `${displayName(a)} (bank)` : `${displayName(a)} (${a.type === 'debit' ? 'debit' : 'credit'} card)`,
  }));
  return [...opts, { v: 'cash', t: 'Cash' }];
}

export function payLabel(accounts, method) {
  if (method === 'cash') return 'Cash';
  if (method === 'cc_payment') return 'Card payment';
  const a = accountOf(accounts, method);
  if (!a) return 'Mashreq';
  return a.type === 'bank' ? `${a.name} (bank)` : `${a.name} ${a.type === 'debit' ? 'debit' : 'credit'} card`;
}

// Bank balance = anchor + incomes into it + transfers in - its spending (incl. linked debit
// cards) - card repayments and transfers out, counting only entries after the anchor.
// Bank-feed anchors (balanceAt) already include everything up to that moment, so compare by
// createdAt there; manual anchors compare by date.
export function bankBalance(data, id, parse) {
  const { accounts, expenses = [], incomes = [], transfers = [] } = data;
  const acc = (accounts || {})[id];
  if (!acc || !acc.balanceDate || acc.balance == null) return null;
  const since = parse(acc.balanceDate);
  const after = x => acc.balanceAt
    ? (x.createdAt ? x.createdAt > acc.balanceAt : parse(x.date) > since)
    : parse(x.date) >= since;
  const amt = list => list.reduce((s, x) => s + Number(x.amount || 0), 0);
  const income = amt(incomes.filter(i => (i.account || PRIMARY) === id && after(i)));
  const spend = amt(expenses.filter(e => e.payMethod !== 'cc_payment' && after(e) && bankOf(accounts, e.payMethod) === id));
  const repay = amt(expenses.filter(e => e.payMethod === 'cc_payment' && (e.fromAccount || PRIMARY) === id && after(e)));
  const tIn = amt(transfers.filter(t => t.to === id && after(t)));
  const tOut = amt(transfers.filter(t => t.from === id && after(t)));
  return Number(acc.balance) + income + tIn - spend - repay - tOut;
}

// Which way a transfer goes, given the two ends. 'cash' is a valid end (ATM withdrawal / deposit).
//  - to a credit card: a card repayment (stored as a cc_payment expense so it never counts as spending)
//  - bank/cash to bank/cash: a plain transfer (S.transfers), never spending or income
export function transferKind(accounts, from, to) {
  const t = to === 'cash' ? 'cash' : ((accounts || {})[to] || {}).type;
  return t === 'credit' ? 'card-payment' : 'transfer';
}

// New id from a name, unique within accounts
export function newAccountId(accounts, name, type) {
  const base = (String(name || type).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || type).slice(0, 20);
  const suffix = type === 'credit' ? '_cc' : type === 'debit' ? '_dc' : '';
  let id = base + suffix, n = 2;
  while ((accounts || {})[id] || id === 'bank' || id === 'cash' || id === 'cc_payment') id = `${base}${suffix}_${n++}`;
  return id;
}

// An account can be deleted only if nothing points at it; otherwise it can be hidden
export function isInUse(id, S) {
  const m = methodFor(id);
  return (S.expenses || []).some(e => e.payMethod === m || e.fromAccount === id)
    || (S.transfers || []).some(t => t.from === id || t.to === id)
    || (S.incomes || []).some(i => i.account === id)
    || (S.subscriptions || []).some(s => s.payMethod === m)
    || Object.values(S.accounts || {}).some(a => a.linkedTo === id)
    || id === PRIMARY;
}
