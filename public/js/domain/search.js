// One search over everything the app holds. Every word typed must match somewhere in the record (text, category,
// amount or a readable date such as "25 oct"), so "noon oct" or "fuel 100" both narrow the list.
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const readable = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${d} ${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : ''; };
const hay = (...parts) => parts.map(p => p == null ? '' : String(p)).join(' ').toLowerCase();

// [kind, label, tab, rows(S) -> [{ title, sub, amount?, date?, text }]]
const SOURCES = [
  ['expenses', 'Expenses', 'expenses', S => (S.expenses || []).map(e => ({ title: e.note || e.cat || 'Expense', sub: [e.cat, e.payMethod === 'bank' ? 'Mashreq' : e.payMethod, e.source === 'n8n' ? 'bank feed' : ''].filter(Boolean).join(' · '),
    amount: -e.amount, date: e.date, text: hay(e.note, e.bankText, e.cat, e.payMethod, e.amount, readable(e.date)) }))],
  ['incomes', 'Income', 'expenses', S => (S.incomes || []).map(i => ({ title: i.note || i.type || 'Income', sub: 'income', amount: +i.amount, date: i.date, text: hay(i.note, i.bankNote, i.type, i.amount, readable(i.date), 'income') }))],
  ['renewals', 'Renewals', 'renewals', S => (S.renewals || []).map(r => ({ title: r.title, sub: [r.person, r.cat].filter(Boolean).join(' · '), date: r.expiry, text: hay(r.title, r.person, r.cat, readable(r.expiry)) }))],
  ['subscriptions', 'Subscriptions', 'renewals', S => (S.subscriptions || []).map(s => ({ title: s.name, sub: [s.cycle, s.note].filter(Boolean).join(' · '), amount: -s.amount, text: hay(s.name, s.note, s.amount, s.cycle) }))],
  ['loans', 'Loans & friends', 'loans', S => [
    ...(S.borrowedFromFriends || []).map(b => ({ title: `Owe ${b.name}`, sub: b.note || '', amount: -b.total, text: hay('owe borrowed', b.name, b.note, b.total) })),
    ...(S.loansGiven || []).map(g => ({ title: g.name, sub: 'owed to me', amount: +g.total, text: hay('receivable', g.name, g.note, g.total) })),
    ...(S.loans || []).map(l => ({ title: l.name, sub: 'loan', amount: -l.outstanding, text: hay('loan emi', l.name, l.note, l.outstanding)}))]],
  ['remittances', 'Remittances', 'remittance', S => (S.remittances || []).map(r => ({ title: `Sent ${r.via || ''}`.trim(), sub: r.note || '', amount: -r.aed, date: r.date, text: hay('remittance sent', r.via, r.note, r.aed, r.foreign, readable(r.date)) }))],
  ['india', 'India', 'india', S => [
    ...(S.indiaAccounts || []).map(a => ({ title: `${a.bank} ${a.type}${a.last4 ? ' ••' + a.last4 : ''}`, sub: a.branch || '', text: hay(a.bank, a.type, a.last4, a.branch, a.balance, 'india nre nro') })),
    ...(S.indiaTxns || []).map(t => ({ title: t.note || 'Transaction', sub: 'India', date: t.date, text: hay(t.note, t.amount, t.tranId, readable(t.date), 'india') }))]],
  ['car', 'Car', 'car', S => [
    ...(S.fuelLog || []).map(f => ({ title: `Fuel ${f.note || ''}`.trim(), sub: 'fuel log', amount: -f.amount, date: f.date, text: hay('fuel', f.note, f.amount, readable(f.date)) })),
    ...(S.serviceLog || []).map(s => ({ title: s.notes || 'Service', sub: 'service log', amount: -Number(s.cost || 0), date: s.date, text: hay('service', s.notes, s.cost, readable(s.date)) }))]],
  ['vacation', 'Vacation', 'vacation', S => (S.vacations || []).map(v => ({ title: v.name, sub: v.dest || '', text: hay(v.name, v.dest, v.budget) }))],
];

export function searchAll(S, query, limit = 8) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { total: 0, groups: [] };
  const groups = [];
  let total = 0;
  for (const [kind, label, tab, rows] of SOURCES) {
    const hits = rows(S).filter(r => words.every(w => r.text.includes(w))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!hits.length) continue;
    total += hits.length;
    groups.push({ kind, label, tab, count: hits.length, items: hits.slice(0, limit) });
  }
  return { total, groups };
}
