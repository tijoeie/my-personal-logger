// Bank-feed ingest: a straight port of the old Firebase `ingestTransaction`.
// Pure function over the state object so it can be unit-tested without HTTP.
'use strict';

const { categorize } = require('./categorize');

const WEEK = 7 * 86400000;

class IngestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function hasBalance(b) {
  return b != null && b !== '' && b !== 'null' && !Number.isNaN(Number(b));
}

// Which account an alert belongs to, from the card/account last 4 digits on it.
// Returns { id, acc } or null (then it goes to the primary bank, as before).
function routeByLast4(S, last4) {
  const digits = String(last4 || '').replace(/\D/g, '').slice(-4);
  if (digits.length !== 4) return null;
  const hits = Object.entries(S.accounts || {}).filter(([, a]) => String(a.last4 || '') === digits);
  const pick = hits.find(([, a]) => !a.hidden) || hits[0];
  return pick ? { id: pick[0], acc: pick[1] } : null;
}

// Mutates S. Returns the id of the entry that was created or matched.
function applyIngest(S, body, now = Date.now()) {
  const { amount, date, description, type, balance, card } = body || {};
  if (amount == null || !date || !type) throw new IngestError(400, 'Missing required fields: amount, date, type');
  if (type !== 'debit' && type !== 'credit') throw new IngestError(400, "type must be 'debit' or 'credit'");
  if (Number.isNaN(Number(amount))) throw new IngestError(400, 'amount must be a number');

  S.expenses = S.expenses || [];
  S.incomes = S.incomes || [];
  S.accounts = S.accounts || {};

  // Smart routing: the alert's last 4 digits pick the card or account it belongs to
  const route = routeByLast4(S, card);
  const kind = route ? (route.acc.type || 'bank') : 'bank';
  const PRIMARY = 'mashreq';
  // bank whose balance this alert reports: the account itself, or the bank a debit card draws from
  const bankId = !route ? PRIMARY : kind === 'bank' ? route.id : kind === 'debit' ? (route.acc.linkedTo || PRIMARY) : null;

  const entry = {
    id: uid(),
    date: String(date).slice(0, 10),
    amount: Number(amount),
    note: description || '',
    payMethod: !route || route.id === PRIMARY ? 'bank' : route.id,
    source: 'n8n',
    createdAt: now,
  };
  const txDay = new Date(entry.date).getTime();
  const near = x => Math.abs(Number(x.amount) - entry.amount) < 0.01
    && Math.abs(new Date(x.date).getTime() - txDay) <= WEEK;

  if (type === 'debit') {
    // A recurring payment the app already auto-logged: tag it instead of duplicating
    const match = S.expenses.find(e => e.recurringId && e.source !== 'n8n' && near(e));
    if (match) {
      Object.assign(match, { source: 'n8n', date: entry.date, bankNote: entry.note });
      entry.id = match.id;
    } else {
      entry.cat = categorize(entry.note) || 'Other';
      S.expenses.push(entry);
      // a credit-card purchase raises that card's outstanding amount
      if (kind === 'credit') {
        route.acc.balance = Number(route.acc.balance || 0) + entry.amount;
        route.acc.balanceDate = entry.date;
      }
    }
  } else {
    // A receivable repayment the user already logged
    const match = S.incomes.find(i => i.receivableId && i.source !== 'n8n' && near(i));
    if (match) {
      Object.assign(match, { source: 'n8n', date: entry.date, bankNote: entry.note });
      entry.id = match.id;
    } else {
      delete entry.payMethod;
      if (bankId && bankId !== PRIMARY) entry.account = bankId;
      if (kind === 'credit') { entry.toAccount = route.id; route.acc.balance = Math.max(0, Number(route.acc.balance || 0) - entry.amount); }
      S.incomes.push(entry);
    }
  }

  if (hasBalance(balance)) {
    if (kind === 'credit') {
      // "Available limit" on a credit-card alert: outstanding = limit - available (needs the limit)
      if (route.acc.limit) { route.acc.balance = Math.max(0, Number(route.acc.limit) - Number(balance)); route.acc.balanceDate = entry.date; }
    } else if (bankId) {
      // keep the account's own fields (name, last 4, ...) and move only its balance anchor
      const cur = S.accounts[bankId] || { name: 'Mashreq' };
      S.accounts[bankId] = { ...cur, type: 'bank', balance: Number(balance), balanceDate: entry.date, balanceAt: entry.createdAt };
    }
  }
  return entry.id;
}

module.exports = { applyIngest, IngestError };
