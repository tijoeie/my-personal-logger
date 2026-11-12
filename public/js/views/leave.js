import { DAY } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { esc, uid, today, iso, parseISO, fmtDateLong as fmtDate } from '../core/util.js';
import { currentLeaveYear, calendarDays, workdaysBetween, annualLeaveTaken, leaveTaken, holidayDates, carryForwardFor, CARRY_CAP, entitlementFor, yearSummary } from '../domain/schedule.js';
import { openForm, expose, confirmThen } from '../ui/form.js';
import { render } from '../ui/shell.js';

const LEAVE_TYPES = [{ v: 'annual', t: 'Annual leave' }, { v: 'sick', t: 'Sick leave (regular)' }, { v: 'sickhalf', t: 'Sick leave (half pay)' }, { v: 'unpaid', t: 'Unpaid' }, { v: 'other', t: 'Other' }];
const TYPE_NAME = Object.fromEntries(LEAVE_TYPES.map(t => [t.v, t.t]));
const STATUS = [{ v: 'approved', t: 'Approved' }, { v: 'pending', t: 'Pending approval' }];
const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`;

export function vLeave() {
  const yr = currentLeaveYear();
  const ls = S.leaveSettings || { entitlementDays: 23, carryForward: 0 };
  const logs = [...(S.leaveLog || [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const entitlement = entitlementFor(yr.year);
  const carryFwd = carryForwardFor(yr.year);
  const autoCarry = Number(ls.carryYear) && yr.year > Number(ls.carryYear);   // worked out from earlier years, not typed
  const totalAvailable = entitlement + carryFwd;
  const taken = annualLeaveTaken(yr);
  const remaining = totalAvailable - taken;
  const daysPassed = Math.round((today() - parseISO(yr.start)) / DAY);
  const accrued = Math.min(entitlement, Math.round(entitlement * daysPassed / 365));
  const sickReg = Number(ls.sickRegular ?? 15), sickHalf = Number(ls.sickHalfPay ?? 30);
  const sickRegTaken = leaveTaken('sick', yr), sickHalfTaken = leaveTaken('sickhalf', yr);
  const pendingAnnual = (S.leaveLog || []).filter(l => l.type === 'annual' && l.status === 'pending' && l.startDate >= yr.start && l.endDate <= yr.end)
    .reduce((n, l) => n + workdaysBetween(l.startDate, l.endDate, holidayDates()), 0);
  const holidays = [...(ls.holidays || [])].sort((a, b) => a.date.localeCompare(b.date));

  return `
  <div class="toolbar"><button class="btn primary" onclick="logLeave()">+ Log leave</button></div>

  <div class="cards">
    <div class="card"><div class="k">Leave year</div><div class="v" style="font-size:16px">${yr.year}</div><div class="s">Jan 1 – Dec 31</div></div>
    <div class="card"><div class="k">Entitlement</div><div class="v">${entitlement} days${carryFwd > 0 ? ` <span style="font-size:13px;color:var(--series-2)">+${carryFwd} c/f</span>` : ''}</div><div class="s">accrued so far: ${accrued} days</div></div>
    <div class="card"><div class="k">Annual taken</div><div class="v">${taken} days</div><div class="s">${logs.filter(l => l.type === 'annual' && l.startDate >= yr.start && l.endDate <= yr.end).length} trips this year</div></div>
    <div class="card"><div class="k">Remaining</div><div class="v ${remaining < 5 ? 'neg' : remaining < 10 ? '' : 'pos'}">${remaining} days</div><div class="s">${remaining > 0 ? 'available to use' : 'none left'}${pendingAnnual ? ` · ${pendingAnnual} pending approval` : ''}</div></div>
    <div class="card"><div class="k">Sick leave (regular)</div><div class="v ${sickReg - sickRegTaken < 3 ? 'neg' : ''}">${sickReg - sickRegTaken} days</div><div class="s">of ${sickReg} · ${sickRegTaken} taken</div></div>
    <div class="card"><div class="k">Sick leave (half pay)</div><div class="v">${sickHalf - sickHalfTaken} days</div><div class="s">of ${sickHalf} · ${sickHalfTaken} taken</div></div>
  </div>
  <div class="panel">
    <h2>Leave balance <small>— working days only (Mon–Fri)</small></h2>
    <div class="progress"><div style="width:${Math.min(100, taken / totalAvailable * 100)}%"></div></div>
    <div class="sub">${taken} of ${totalAvailable} days used (${Math.round(taken / totalAvailable * 100)}%)${carryFwd > 0 ? ` · includes ${carryFwd} carried forward from ${yr.year - 1}` : ''}</div>
  </div>

  <div class="panel">
    <h2>Leave settings</h2>
    <div class="field"><label>Annual entitlement for ${yr.year} (working days)</label><input id="leaveEnt" type="number" value="${entitlement}"></div>
    <div class="field"><label>Carry forward into ${yr.year} (working days, max ${CARRY_CAP})</label><input id="leaveCF" type="number" min="0" max="${CARRY_CAP}" value="${carryFwd}"></div>
    <p class="hint">${autoCarry ? `Worked out automatically: what was left of ${yr.year - 1}, up to ${CARRY_CAP} days. Type a different number and press Save to override it.` : `Each new year the app carries over what is left of the year before, up to ${CARRY_CAP} days.`}</p>
    <div class="field"><label>Sick leave, regular pay (days per year)</label><input id="leaveSickReg" type="number" min="0" value="${sickReg}"></div>
    <div class="field"><label>Sick leave, half pay (days per year)</label><input id="leaveSickHalf" type="number" min="0" value="${sickHalf}"></div>
    <button class="btn primary" onclick="saveLeaveSettings()">Save</button>
  </div>

  <div class="panel">
    <h2>Public holidays <small>— not counted as leave days</small></h2>
    ${holidays.length ? holidays.map(h => `<div class="row">
      <div class="grow"><div class="title">${esc(h.name)}</div><div class="sub">${fmtDate(h.date)}</div></div>
      <button class="btn small danger" onclick="delHoliday('${h.date}')">✕</button></div>`).join('') : '<div class="empty">No public holidays added.</div>'}
    <div style="margin-top:8px"><button class="btn small" onclick="addHoliday()">+ Add holiday</button></div>
  </div>

  ${nextYearPanel(yr.year + 1)}
  ${historyPanel(logs)}`;
}

// Leave that is over looks different from leave still to come, so the list reads at a glance
function leaveWhen(l) {
  const t = iso(today());
  if (l.endDate < t) return 'taken';
  if (l.startDate > t) return 'upcoming';
  return 'now';
}
function leaveRow(l) {
  const when = leaveWhen(l), days = Math.round((parseISO(l.startDate) - today()) / DAY);
  const tag = when === 'taken' ? '<span class="badge ok">✓ taken</span>'
    : when === 'now' ? '<span class="badge leave-now">on leave now</span>'
    : `<span class="badge leave-soon">in ${days} day${days === 1 ? '' : 's'}</span>`;
  return `<div class="row${when === 'taken' ? ' row-done' : ''}">
    <div class="grow">
      <div class="title">${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} <span class="chip">${esc(TYPE_NAME[l.type] || l.type)}</span> ${tag}${l.status === 'pending' ? ' <span class="badge soon">pending approval</span>' : ''}</div>
      <div class="sub">${plural(workdaysBetween(l.startDate, l.endDate, holidayDates()), 'working day')} · ${plural(calendarDays(l.startDate, l.endDate), 'calendar day')}${l.note ? ' · ' + esc(l.note) : ''}</div>
    </div>
    <button class="btn small" onclick="editLeave('${l.id}')">Edit</button>
    <button class="btn small danger" onclick="delLeave('${l.id}')">✕</button>
  </div>`;
}
// Next year's plan at a glance (shown once something is planned for it or it has its own entitlement)
function nextYearPanel(year) {
  const planned = (S.leaveLog || []).some(l => l.startDate >= `${year}-01-01` && l.endDate <= `${year}-12-31`);
  if (!planned && !((S.leaveSettings || {}).entitlementByYear || {})[year]) return '';
  const y = yearSummary(year);
  return `<div class="panel"><h2>${year} plan <small>— working days</small></h2>
    <div class="row"><div class="grow sub">Entitlement</div><span class="amt">${y.entitlement}</span></div>
    <div class="row"><div class="grow sub">Carried in from ${year - 1} (worked out, max ${CARRY_CAP})</div><span class="amt">+${y.carry}</span></div>
    <div class="row"><div class="grow sub">Planned / taken</div><span class="amt neg">−${y.taken}</span></div>
    <div class="row"><div class="grow"><b>Left over</b></div><span class="amt ${y.remaining < 0 ? 'neg' : 'pos'}"><b>${y.remaining} days</b></span></div>
    <div class="hint">${y.remaining > CARRY_CAP ? `Only ${CARRY_CAP} of these can carry into ${year + 1}.` : y.remaining < 0 ? 'More leave planned than you have.' : `All ${y.remaining} carry into ${year + 1}.`}</div></div>`;
}

function historyPanel(logs) {
  if (!logs.length) return '<div class="panel"><h2>Leave history</h2><div class="empty">No leave logged yet.</div></div>';
  const ahead = logs.filter(l => leaveWhen(l) !== 'taken').sort((a, b) => a.startDate.localeCompare(b.startDate));   // nearest first
  const done = logs.filter(l => leaveWhen(l) === 'taken');                                                          // newest first
  return `${ahead.length ? `<div class="panel"><h2>Coming up <small>— not taken yet</small></h2>${ahead.map(leaveRow).join('')}</div>` : ''}
  ${done.length ? `<div class="panel"><h2>Already taken <small>— ${plural(done.length, 'trip')}</small></h2>${done.map(leaveRow).join('')}</div>` : ''}`;
}

const leaveFields = (l = {}) => [
  { name: 'startDate', label: 'Start date', type: 'date', value: l.startDate || iso(today()), required: true },
  { name: 'endDate', label: 'End date', type: 'date', value: l.endDate || iso(today()), required: true },
  { name: 'type', label: 'Type', type: 'select', value: l.type || 'annual', options: LEAVE_TYPES },
  { name: 'status', label: 'Status', type: 'select', value: l.status || 'approved', options: STATUS },
  { name: 'note', label: 'Note', value: l.note || '', placeholder: 'e.g. Kerala trip, Eid holidays' },
];
// Start and end the wrong way round would count negative days: put them in order
const ordered = d => (d.endDate < d.startDate ? { ...d, startDate: d.endDate, endDate: d.startDate } : d);

expose({
  logLeave() {
    openForm('Log leave', leaveFields(), d => {
      S.leaveLog = S.leaveLog || [];
      S.leaveLog.push({ id: uid(), ...ordered(d) });
    }, 'Log it');
  },
  editLeave(id) {
    const l = (S.leaveLog || []).find(x => x.id === id);
    if (l) openForm('Edit leave', leaveFields(l), d => Object.assign(l, ordered(d)), 'Save');
  },
  saveLeaveSettings() {
    S.leaveSettings = S.leaveSettings || {};
    const ent = Number(document.getElementById('leaveEnt').value) || 23;
    S.leaveSettings.entitlementDays = ent;                                         // default for years without their own value
    (S.leaveSettings.entitlementByYear = S.leaveSettings.entitlementByYear || {})[currentLeaveYear().year] = ent;
    S.leaveSettings.carryForward = Math.min(CARRY_CAP, Math.max(0, Number(document.getElementById('leaveCF').value) || 0));
    S.leaveSettings.carryYear = currentLeaveYear().year;   // what is typed here is this year's carry-in; later years follow from it
    S.leaveSettings.sickRegular = Math.max(0, Number(document.getElementById('leaveSickReg').value) || 0);
    S.leaveSettings.sickHalfPay = Math.max(0, Number(document.getElementById('leaveSickHalf').value) || 0);
    save(); render();
  },
  addHoliday() {
    openForm('Add public holiday', [
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Eid Al Fitr' },
    ], d => {
      S.leaveSettings = S.leaveSettings || {};
      const list = S.leaveSettings.holidays = S.leaveSettings.holidays || [];
      if (!list.some(h => h.date === d.date)) list.push({ date: d.date, name: d.name });
    });
  },
  delHoliday: date => confirmThen('Remove this holiday?', () => { S.leaveSettings.holidays = (S.leaveSettings.holidays || []).filter(h => h.date !== date); }),
  delLeave: id => confirmThen('Delete this leave entry?', () => { S.leaveLog = S.leaveLog.filter(l => l.id !== id); }),
});
