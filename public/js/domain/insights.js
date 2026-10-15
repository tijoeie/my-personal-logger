// Dashboard helpers: spending insight for the current salary period and quick-add shortcuts.
// Pure functions over plain data so they can be tested without the app state.
const DAY = 86400000;
const isSpend = e => e.payMethod !== 'cc_payment';
const dayOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const within = (e, from, to) => { const d = dayOf(e.date); return d >= from && d <= to; };
// Balance corrections from Reconcile are real money out but not a purchase: keep them in totals,
// leave them out of 'top category' and 'biggest'.
const isAdjustment = e => /^Reconciliation/i.test(e.note || '');
const total = list => list.reduce((s, e) => s + Number(e.amount || 0), 0);

// period/prev: {start, end} Dates (salary periods); today: Date at midnight
export function periodInsight(expenses, period, prev, today) {
  const elapsed = Math.max(1, Math.round((today - period.start) / DAY) + 1);       // days into this period, incl. today
  const length = Math.round((period.end - period.start) / DAY) + 1;
  const spentList = expenses.filter(e => isSpend(e) && within(e, period.start, today));
  const spent = total(spentList);
  // same number of days into the previous period, so mid-month numbers compare fairly
  const prevCut = new Date(prev.start.getTime() + (elapsed - 1) * DAY);
  const prevSoFar = total(expenses.filter(e => isSpend(e) && within(e, prev.start, prevCut < prev.end ? prevCut : prev.end)));
  const prevFull = total(expenses.filter(e => isSpend(e) && within(e, prev.start, prev.end)));

  const byCat = {};
  for (const e of spentList.filter(e => !isAdjustment(e))) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount || 0);
  const [topCat, topAmt] = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const adjusted = total(spentList.filter(isAdjustment));
  const biggest = spentList.filter(e => !isAdjustment(e)).sort((a, b) => b.amount - a.amount)[0] || null;

  return {
    spent, elapsed, length,
    prevSoFar, prevFull,
    changePct: prevSoFar > 0 ? (spent - prevSoFar) / prevSoFar * 100 : null,
    dailyAvg: spent / elapsed,
    projected: spent / elapsed * length,
    topCat, topAmt, topShare: spent - adjusted > 0 ? topAmt / (spent - adjusted) * 100 : 0, adjusted,
    biggest,
  };
}

// Shortcuts: the three everyday categories first, then the two most used others in the
// last 60 days. Each remembers the most recent amount, card and note for that category.
export const CORE_QUICK = ['Fuel', 'Groceries', 'Dining out'];
const SKIP = new Set(['Other', 'Rent', 'Repayment', 'Loan EMI', 'Family / Remittance', 'Reimbursement']);

export function quickAddItems(expenses, today, max = 5) {
  const since = new Date(today.getTime() - 60 * DAY);
  const recent = expenses.filter(e => isSpend(e) && !e.recurringId && dayOf(e.date) >= since);
  const counts = {};
  for (const e of recent) if (!CORE_QUICK.includes(e.cat) && !SKIP.has(e.cat)) counts[e.cat] = (counts[e.cat] || 0) + 1;
  const extra = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const cats = [...CORE_QUICK, ...extra].slice(0, max);
  const newest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
  return cats.map(cat => {
    const last = expenses.filter(e => e.cat === cat && isSpend(e)).sort(newest)[0];
    return last
      ? { cat, amount: Number(last.amount), payMethod: last.payMethod || 'bank', note: last.source === 'n8n' ? '' : (last.note || '') }
      : { cat, amount: null, payMethod: 'bank', note: '' };
  });
}
