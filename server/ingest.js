// Bank-feed ingest: a straight port of the old Firebase `ingestTransaction`.
// Pure function over the state object so it can be unit-tested without HTTP.
'use strict';

const WEEK = 7 * 86400000;

class IngestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function hasBalance(b) {
  return b != null && b !== '' && b !== 'null' && !Number.isNaN(Number(b));
}

// Mutates S. Returns the id of the entry that was created or matched.
function applyIngest(S, body, now = Date.now()) {
  const { amount, date, description, type, balance } = body || {};
  if (amount == null || !date || !type) throw new IngestError(400, 'Missing required fields: amount, date, type');
  if (type !== 'debit' && type !== 'credit') throw new IngestError(400, "type must be 'debit' or 'credit'");
  if (Number.isNaN(Number(amount))) throw new IngestError(400, 'amount must be a number');

  S.expenses = S.expenses || [];
  S.incomes = S.incomes || [];
  S.accounts = S.accounts || {};

  const entry = {
    id: uid(),
    date: String(date).slice(0, 10),
    amount: Number(amount),
    note: description || '',
    payMethod: 'bank',
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
      entry.cat = 'Other';
      S.expenses.push(entry);
    }
  } else {
    // A receivable repayment the user already logged
    const match = S.incomes.find(i => i.receivableId && i.source !== 'n8n' && near(i));
    if (match) {
      Object.assign(match, { source: 'n8n', date: entry.date, bankNote: entry.note });
      entry.id = match.id;
    } else {
      S.incomes.push(entry);
    }
  }

  if (hasBalance(balance)) {
    S.accounts.mashreq = { name: 'Mashreq', type: 'bank', balance: Number(balance), balanceDate: entry.date, balanceAt: entry.createdAt };
  }
  return entry.id;
}

module.exports = { applyIngest, IngestError };
