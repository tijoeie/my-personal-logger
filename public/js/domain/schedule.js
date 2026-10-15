// Due dates: document renewals, car services, leave and gratuity maths.
import { DAY } from '../core/constants.js';
import { S } from '../core/state.js';
import { today, iso, parseISO, addMonths, daysUntil, fmtDate } from '../core/util.js';

export function statusOf(days, remind) {
  if (days < 0) return { cls: 'overdue', label: `overdue ${-days}d` };
  if (days <= 30) return { cls: 'due', label: `${days}d left` };
  if (days <= (remind || 90)) return { cls: 'soon', label: `${days}d left` };
  return { cls: 'ok', label: `${days}d left` };
}

export function serviceNextDue(type) {
  const last = S.serviceLog.filter(l => l.type === type.id).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last || !type.months) return { last, due: null };
  return { last, due: iso(addMonths(parseISO(last.date), type.months)) };
}

export function allDueItems() {
  const items = [];
  for (const r of S.renewals) {
    if (!r.expiry) continue;
    const d = daysUntil(r.expiry);
    items.push({ kind: 'renewal', ref: r, label: r.title, sub: `${r.person} · ${r.cat} · expires ${fmtDate(r.expiry)}`, days: d, st: statusOf(d, r.remindDays) });
  }
  for (const t of S.serviceTypes) {
    const { last, due } = serviceNextDue(t);
    if (!due) continue;
    const d = daysUntil(due);
    const kmTxt = t.km ? ` (or every ${t.km.toLocaleString()} km)` : '';
    items.push({ kind: 'service', ref: t, label: t.name, sub: `last done ${fmtDate(last.date)}${last.odo ? ' @ ' + Number(last.odo).toLocaleString() + ' km' : ''} · next ${fmtDate(due)}${kmTxt}`, days: d, st: statusOf(d, 60) });
  }
  return items.sort((a, b) => a.days - b.days);
}

// ---- leave (calendar year, working days Mon–Fri) ----
export function currentLeaveYear() {
  const yr = today().getFullYear();
  return { start: `${yr}-01-01`, end: `${yr}-12-31`, year: yr };
}
export function calendarDays(startStr, endStr) {
  return Math.round((parseISO(endStr) - parseISO(startStr)) / DAY) + 1;
}
export function workdaysBetween(startStr, endStr) {
  let count = 0;
  const end = parseISO(endStr);
  const cur = parseISO(startStr);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
export function annualLeaveTaken(yr = currentLeaveYear()) {
  return (S.leaveLog || []).filter(l => l.type === 'annual' && l.startDate >= yr.start && l.endDate <= yr.end)
    .reduce((s, l) => s + workdaysBetween(l.startDate, l.endDate), 0);
}

// ---- gratuity (UAE Labour Law) ----
export function calcGratuity(joinDateStr, basicSalary, toDateStr) {
  if (!joinDateStr || !basicSalary) return null;
  const start = parseISO(joinDateStr);
  const end = toDateStr ? parseISO(toDateStr) : today();
  const totalDays = Math.round((end - start) / DAY);
  if (totalDays < 0) return null;
  const years = totalDays / 365.25;
  const dailyBasic = basicSalary / 30;
  // 21 days per year for the first 5 years, 30 days per year after
  let amount = years <= 5
    ? dailyBasic * 21 * years
    : dailyBasic * 21 * 5 + dailyBasic * 30 * (years - 5);
  // capped at 2 years' salary
  const cap = basicSalary * 24;
  amount = Math.min(amount, cap);
  return { amount, years, totalDays, dailyBasic, capped: amount >= cap };
}
