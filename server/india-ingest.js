// Balance updates for Indian bank accounts, sent by n8n from the bank's monthly statement.
//   POST /api/ingest-balance  { source, asOf: 'YYYY-MM-DD', accounts: [{ last4, balance, branch? }] }
// An account matches by its last 4 digits (Settings > Indian bank accounts), or, until those are
// filled in, by branch name for a Federal Bank account that has no digits yet.
// A statement never moves a balance backwards: an older statement than the one on record is skipped.
'use strict';

class BalanceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Mutates S.indiaAccounts. Returns { updated: [...], unmatched: [...], skipped: [...] }.
function applyBalances(S, body) {
  const { asOf, accounts, source } = body || {};
  if (!isIsoDate(asOf)) throw new BalanceError(400, 'asOf must be YYYY-MM-DD');
  if (!Array.isArray(accounts) || !accounts.length) throw new BalanceError(400, 'accounts must be a non-empty list');
  const mine = (S.indiaAccounts || []).filter(a => !a.hidden);
  const out = { updated: [], unmatched: [], skipped: [], added: [] };
  const used = new Set();

  for (const row of accounts) {
    const last4 = String(row.last4 || '').replace(/\D/g, '').slice(-4);
    const balance = Number(row.balance);
    if (!last4 || !Number.isFinite(balance)) { out.unmatched.push({ last4: last4 || null, reason: 'bad row' }); continue; }

    let acc = mine.find(a => !used.has(a.id) && a.last4 === last4);
    if (!acc && row.branch) {
      const same = mine.filter(a => !used.has(a.id) && !a.last4 && /federal/i.test(a.bank) && norm(a.branch) === norm(row.branch));
      if (same.length === 1) acc = same[0];
    }
    if (!acc) { out.unmatched.push({ last4, branch: row.branch || null, reason: 'no account with these digits' }); continue; }
    if ((acc.currency || 'INR') !== 'INR') { out.skipped.push({ last4, reason: `${acc.currency} account` }); continue; }
    used.add(acc.id);

    // account statements carry transactions: keep each once (by bank transaction id), even when the balance is older
    const txns = Array.isArray(row.txns) ? row.txns : [];
    if (txns.length) {
      const list = S.indiaTxns = S.indiaTxns || [];
      const seen = new Set(list.filter(t => t.accountId === acc.id && t.tranId).map(t => `${t.tranId}|${t.date}|${t.amount}`));
      let n = 0;
      for (const t of txns) {
        const amount = Number(t.amount);
        if (!t.id || !isIsoDate(t.date) || !(amount > 0) || (t.kind !== 'in' && t.kind !== 'out')) continue;
        const key = `${t.id}|${t.date}|${amount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ id: `st-${acc.id}-${t.id}`.slice(0, 60), accountId: acc.id, date: t.date, amount, kind: t.kind,
          note: String(t.note || (t.kind === 'in' ? 'Deposit' : 'Withdrawal')).slice(0, 120), tranId: t.id, source: source || 'statement', createdAt: Date.now() });
        n++;
      }
      if (n) out.added.push({ last4, count: n });
    }

    if (acc.balanceDate && acc.balanceDate > asOf) { out.skipped.push({ last4, reason: `newer balance already on record (${acc.balanceDate})` }); continue; }
    if (acc.balanceDate === asOf && Number(acc.balance) === balance) { out.skipped.push({ last4, reason: 'already up to date' }); continue; }
    out.updated.push({ last4, type: acc.type, from: acc.balance ?? null, to: balance, asOf });
    acc.balance = balance;
    acc.balanceDate = asOf;
    acc.balanceSource = source || 'statement';
  }
  return out;
}

module.exports = { applyBalances, BalanceError };
