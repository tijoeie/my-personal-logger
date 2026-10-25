// Savings goals beyond the vacation fund (emergency fund, new car, laptop...). Pure functions over a goal object.
//   goal: { id, name, icon?, target, monthly?, targetDate?, contribs: [{ id, date, amount, note? }] }
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
const DAY = 86400000;

export function goalStats(goal, today) {
  const saved = (goal.contribs || []).reduce((s, c) => s + Number(c.amount || 0), 0);
  const target = Number(goal.target || 0);
  const left = Math.max(0, target - saved);
  const monthly = Number(goal.monthly || 0);
  const out = { saved, target, left, pct: target > 0 ? Math.min(100, saved / target * 100) : 0, done: target > 0 && saved >= target, monthly, eta: null, monthsToGo: null, neededMonthly: null, onTrack: null };
  if (out.done) return out;
  if (monthly > 0) { out.monthsToGo = Math.ceil(left / monthly); out.eta = addMonths(today, out.monthsToGo); }
  if (goal.targetDate) {
    const [y, m, d] = goal.targetDate.split('-').map(Number);
    const days = Math.round((new Date(y, m - 1, d) - today) / DAY);
    if (days > 0) {
      out.neededMonthly = Math.ceil(left / Math.max(1, Math.round(days / 30.4)));
      if (monthly > 0) out.onTrack = monthly >= out.neededMonthly;
    } else out.onTrack = false;
  }
  return out;
}
