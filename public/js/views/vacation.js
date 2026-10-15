import { S } from '../core/state.js';
import { esc, uid, money, moneyH, today, iso, daysUntil, fmtDate, sum } from '../core/util.js';
import { openForm, expose, confirmThen } from '../ui/form.js';

export function vVacation() {
  return `
  <div class="toolbar"><button class="btn primary" onclick="addVacation()">+ Plan a vacation</button></div>
  ${S.vacations.length ? S.vacations.map(v => {
    const saved = sum(v.contribs);
    const pct = v.budget ? Math.min(100, saved / v.budget * 100) : 0;
    const days = v.date ? daysUntil(v.date) : null;
    const monthsLeft = days !== null ? Math.max(1, Math.ceil(days / 30)) : null;
    const needed = v.budget && days > 0 ? Math.max(0, Math.ceil((v.budget - saved) / monthsLeft)) : 0;
    return `<div class="panel">
      <h2>${esc(v.name)} <small>— ${esc(v.dest || '')}${v.date ? ' · ' + fmtDate(v.date) + (days >= 0 ? ` (${days} days away)` : ' (past)') : ''}</small></h2>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="sub">${money(saved)} saved of ${money(v.budget)} (${Math.round(pct)}%)${needed ? ` · save <b>${money(needed)}/month</b> to hit the goal` : ''}</div>
      <div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <button class="btn small" onclick="addContrib('${v.id}')">+ Add savings</button>
        <button class="btn small" onclick="editVacation('${v.id}')">Edit</button>
        <button class="btn small danger" onclick="delVacation('${v.id}')">Delete</button>
      </div>
      ${v.contribs.length ? `<div style="margin-top:8px">${v.contribs.map(c => `<div class="row"><div class="grow sub">${fmtDate(c.date)}</div><span class="amt">${moneyH(c.amount)}</span></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="panel"><div class="empty">No vacation planned yet. Plan one and start saving for it. ✈️</div></div>'}`;
}

const fields = (v = {}) => [
  { name: 'name', label: 'Trip name', value: v.name, required: true, placeholder: 'e.g. Kerala 2027' },
  { name: 'dest', label: 'Destination', value: v.dest },
  { name: 'date', label: 'Target date', type: 'date', value: v.date },
  { name: 'budget', label: 'Savings goal (AED)', type: 'number', value: v.budget, required: true },
];

expose({
  addVacation() {
    openForm('Plan a vacation', fields(), d => S.vacations.push({ id: uid(), ...d, budget: Number(d.budget), contribs: [] }));
  },
  editVacation(id) {
    const v = S.vacations.find(x => x.id === id);
    openForm('Edit vacation', fields(v), d => Object.assign(v, d, { budget: Number(d.budget) }));
  },
  addContrib(id) {
    const v = S.vacations.find(x => x.id === id);
    openForm(`Add savings — ${v.name}`, [
      { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    ], d => v.contribs.push({ date: d.date, amount: Number(d.amount) }));
  },
  delVacation: id => confirmThen('Delete this vacation plan?', () => { S.vacations = S.vacations.filter(v => v.id !== id); }),
});
