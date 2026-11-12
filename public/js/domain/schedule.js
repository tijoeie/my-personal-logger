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
// Mon-Fri, minus public holidays (list of 'YYYY-MM-DD')
export function workdaysBetween(startStr, endStr, holidays = []) {
  const off = new Set(holidays);
  let count = 0;
  const end = parseISO(endStr);
  const cur = parseISO(startStr);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6 && !off.has(iso(cur))) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
export const holidayDates = () => ((S.leaveSettings || {}).holidays || []).map(h => h.date);

// Working days taken in the leave year for one or more leave types (planned/pending ones count: SAP deducts them too)
export function leaveTaken(types, yr = currentLeaveYear()) {
  const list = Array.isArray(types) ? types : [types];
  return (S.leaveLog || []).filter(l => list.includes(l.type) && l.startDate >= yr.start && l.endDate <= yr.end)
    .reduce((s, l) => s + workdaysBetween(l.startDate, l.endDate, holidayDates()), 0);
}
export const annualLeaveTaken = (yr = currentLeaveYear()) => leaveTaken('annual', yr);

// Carry-forward into a leave year. The number typed in Leave settings is the carry-in for `carryYear`; every later
// year gets what was left of the year before, capped at 10 working days (never below 0).
export const CARRY_CAP = 10;
// Annual entitlement for a year: a per-year value (e.g. 26 days from 2027) wins over the general one
export const entitlementFor = year => {
  const ls = S.leaveSettings || {};
  return Number((ls.entitlementByYear || {})[year]) || Number(ls.entitlementDays) || 23;
};
// One year at a glance: entitlement + carried in - working days taken or planned
export function yearSummary(year) {
  const yr = { start: `${year}-01-01`, end: `${year}-12-31`, year };
  const entitlement = entitlementFor(year), carry = carryForwardFor(year), taken = leaveTaken('annual', yr);
  return { year, entitlement, carry, taken, remaining: entitlement + carry - taken };
}
export function carryForwardFor(year) {
  const ls = S.leaveSettings || {};
  const base = Number(ls.carryYear) || year;
  let carry = Math.min(CARRY_CAP, Math.max(0, Number(ls.carryForward) || 0));
  for (let y = base + 1; y <= year; y++) {
    const taken = leaveTaken('annual', { start: `${y - 1}-01-01`, end: `${y - 1}-12-31`, year: y - 1 });
    carry = Math.min(CARRY_CAP, Math.max(0, entitlementFor(y - 1) + carry - taken));
  }
  return carry;
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
