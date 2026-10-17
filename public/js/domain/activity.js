// "New activity": entries that arrived automatically (bank-feed alerts, Indian statement rows)
// after the moment the user last marked the list as seen (S.activitySeenAt, synced across devices).
const FIRST_WINDOW = 48 * 3600e3;   // before anything was ever marked seen, look back two days

export function newActivity(S, now = Date.now()) {
  const since = S.activitySeenAt || now - FIRST_WINDOW;
  const rows = [];
  for (const e of S.expenses || []) if (e.source === 'n8n' && e.createdAt > since) rows.push({ at: e.createdAt, kind: 'out', cur: 'AED', amount: e.amount, text: e.note || e.cat || 'Expense', sub: e.cat || '', date: e.date });
  for (const i of S.incomes || []) if (i.source === 'n8n' && i.createdAt > since) rows.push({ at: i.createdAt, kind: 'in', cur: 'AED', amount: i.amount, text: i.note || i.type || 'Income', sub: 'Income', date: i.date });
  const names = Object.fromEntries((S.indiaAccounts || []).map(a => [a.id, `${a.type}${a.last4 ? ' ••' + a.last4 : ''}`]));
  for (const t of S.indiaTxns || []) if (t.tranId && t.createdAt > since) rows.push({ at: t.createdAt, kind: t.kind, cur: 'INR', amount: t.amount, text: t.note, sub: names[t.accountId] || 'India', date: t.date });
  return rows.sort((a, b) => b.at - a.at);
}
