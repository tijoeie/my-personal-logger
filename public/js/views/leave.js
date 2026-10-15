import { DAY } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { esc, uid, today, iso, parseISO, fmtDate } from '../core/util.js';
import { currentLeaveYear, calendarDays, workdaysBetween, annualLeaveTaken } from '../domain/schedule.js';
import { openForm, expose, confirmThen } from '../ui/form.js';
import { render } from '../ui/shell.js';

const LEAVE_TYPES = [{ v: 'annual', t: 'Annual leave' }, { v: 'sick', t: 'Sick leave' }, { v: 'unpaid', t: 'Unpaid' }, { v: 'other', t: 'Other' }];
const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`;

export function vLeave() {
  const yr = currentLeaveYear();
  const ls = S.leaveSettings || { entitlementDays: 23, carryForward: 0 };
  const logs = [...(S.leaveLog || [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const entitlement = ls.entitlementDays || 23;
  const carryFwd = Number(ls.carryForward) || 0;
  const totalAvailable = entitlement + carryFwd;
  const taken = annualLeaveTaken(yr);
  const remaining = totalAvailable - taken;
  const daysPassed = Math.round((today() - parseISO(yr.start)) / DAY);
  const accrued = Math.min(entitlement, Math.round(entitlement * daysPassed / 365));

  return `
  <div class="toolbar"><button class="btn primary" onclick="logLeave()">+ Log leave</button></div>

  <div class="cards">
    <div class="card"><div class="k">Leave year</div><div class="v" style="font-size:16px">${yr.year}</div><div class="s">Jan 1 – Dec 31</div></div>
    <div class="card"><div class="k">Entitlement</div><div class="v">${entitlement} days${carryFwd > 0 ? ` <span style="font-size:13px;color:var(--series-2)">+${carryFwd} c/f</span>` : ''}</div><div class="s">accrued so far: ${accrued} days</div></div>
    <div class="card"><div class="k">Annual taken</div><div class="v">${taken} days</div><div class="s">${logs.filter(l => l.type === 'annual' && l.startDate >= yr.start).length} trips this year</div></div>
    <div class="card"><div class="k">Remaining</div><div class="v ${remaining < 5 ? 'neg' : remaining < 10 ? '' : 'pos'}">${remaining} days</div><div class="s">${remaining > 0 ? 'available to use' : 'none left'}</div></div>
  </div>
  <div class="panel">
    <h2>Leave balance <small>— working days only (Mon–Fri)</small></h2>
    <div class="progress"><div style="width:${Math.min(100, taken / totalAvailable * 100)}%"></div></div>
    <div class="sub">${taken} of ${totalAvailable} days used (${Math.round(taken / totalAvailable * 100)}%)${carryFwd > 0 ? ` · includes ${carryFwd} carried forward from ${yr.year - 1}` : ''}</div>
  </div>

  <div class="panel">
    <h2>Leave settings</h2>
    <div class="field"><label>Annual entitlement (working days)</label><input id="leaveEnt" type="number" value="${entitlement}"></div>
    <div class="field"><label>Carry forward from previous year (working days, max 10)</label><input id="leaveCF" type="number" min="0" max="10" value="${carryFwd}"></div>
    <button class="btn primary" onclick="saveLeaveSettings()">Save</button>
  </div>

  <div class="panel">
    <h2>Leave history</h2>
    ${logs.length ? logs.map(l => `<div class="row">
        <div class="grow">
          <div class="title">${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} <span class="chip">${esc(l.type)}</span></div>
          <div class="sub">${plural(workdaysBetween(l.startDate, l.endDate), 'working day')} · ${plural(calendarDays(l.startDate, l.endDate), 'calendar day')}${l.note ? ' · ' + esc(l.note) : ''}</div>
        </div>
        <button class="btn small danger" onclick="delLeave('${l.id}')">✕</button>
      </div>`).join('') : '<div class="empty">No leave logged yet.</div>'}
  </div>`;
}

expose({
  logLeave() {
    openForm('Log leave', [
      { name: 'startDate', label: 'Start date', type: 'date', value: iso(today()), required: true },
      { name: 'endDate', label: 'End date', type: 'date', value: iso(today()), required: true },
      { name: 'type', label: 'Type', type: 'select', value: 'annual', options: LEAVE_TYPES },
      { name: 'note', label: 'Note', placeholder: 'e.g. Kerala trip, Eid holidays' },
    ], d => {
      S.leaveLog = S.leaveLog || [];
      S.leaveLog.push({ id: uid(), startDate: d.startDate, endDate: d.endDate, type: d.type, note: d.note });
    }, 'Log it');
  },
  saveLeaveSettings() {
    S.leaveSettings = S.leaveSettings || {};
    S.leaveSettings.entitlementDays = Number(document.getElementById('leaveEnt').value) || 23;
    S.leaveSettings.carryForward = Math.min(10, Math.max(0, Number(document.getElementById('leaveCF').value) || 0));
    save(); render();
  },
  delLeave: id => confirmThen('Delete this leave entry?', () => { S.leaveLog = S.leaveLog.filter(l => l.id !== id); }),
});
