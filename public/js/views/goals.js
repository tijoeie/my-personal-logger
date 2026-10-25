import { S } from '../core/state.js';
import { esc, uid, money, moneyH, today, iso, fmtDate } from '../core/util.js';
import { goalStats } from '../domain/goals.js';
import { openForm, expose, confirmThen } from '../ui/form.js';

const fmtMonth = d => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const list = () => S.goals || [];

export function vGoals() {
  return `
  <div class="toolbar"><button class="btn primary" onclick="addGoal()">+ New goal</button></div>
  ${list().length ? list().map(g => {
    const s = goalStats(g, today());
    const verdict = s.done ? '<span class="pos">Goal reached 🎉</span>'
      : s.onTrack === false ? `<span class="warn">Behind: needs ${money(s.neededMonthly || 0)}/month to hit ${fmtDate(g.targetDate)}</span>`
      : s.eta ? `at ${money(s.monthly)}/month you finish around <b>${fmtMonth(s.eta)}</b> (${s.monthsToGo} month${s.monthsToGo > 1 ? 's' : ''})`
      : s.neededMonthly ? `save <b>${money(s.neededMonthly)}/month</b> to hit ${fmtDate(g.targetDate)}` : 'set a monthly amount to see when you finish';
    return `<div class="panel">
      <h2>${esc(g.icon || '🎯')} ${esc(g.name)} <small>— ${money(s.saved)} of ${money(s.target)}</small></h2>
      <div class="progress"><div style="width:${s.pct}%;background:${s.done ? 'var(--ok, #2e9e6b)' : ''}"></div></div>
      <div class="sub">${Math.round(s.pct)}% · ${money(s.left)} to go${g.note ? ' · ' + esc(g.note) : ''}</div>
      <div class="sub">${verdict}</div>
      <div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <button class="btn small primary" onclick="addGoalSaving('${g.id}')">+ Add savings</button>
        <button class="btn small" onclick="editGoal('${g.id}')">Edit</button>
        <button class="btn small danger" onclick="delGoal('${g.id}')">Delete</button>
      </div>
      ${(g.contribs || []).length ? `<div style="margin-top:8px">${g.contribs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map(c => `<div class="row"><div class="grow sub">${fmtDate(c.date)}${c.note ? ' · ' + esc(c.note) : ''}</div><span class="amt pos">+${moneyH(c.amount)}</span><button class="btn small danger" onclick="delGoalSaving('${g.id}','${c.id}')">✕</button></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="panel"><div class="empty">No savings goals yet.<br>Try an emergency fund, a new car or a laptop. 🎯</div></div>'}`;
}

const fields = (g = {}) => [
  { name: 'name', label: 'Goal', value: g.name, required: true, placeholder: 'e.g. Emergency fund, New car' },
  { name: 'icon', label: 'Emoji (optional)', value: g.icon || '' },
  { name: 'target', label: 'Target amount (AED)', type: 'number', step: '1', value: g.target, required: true },
  { name: 'monthly', label: 'Monthly saving (AED)', type: 'number', step: '1', value: g.monthly || '' },
  { name: 'targetDate', label: 'Wanted by (optional)', type: 'date', value: g.targetDate || '' },
  { name: 'note', label: 'Note', value: g.note || '' },
];
const fromForm = d => ({ name: d.name, icon: d.icon, target: Number(d.target), monthly: Number(d.monthly) || 0, targetDate: d.targetDate || '', note: d.note || '' });

expose({
  addGoal() { openForm('New savings goal', fields(), d => { (S.goals = S.goals || []).push({ id: uid(), ...fromForm(d), contribs: [] }); }); },
  editGoal(id) { const g = list().find(x => x.id === id); if (g) openForm('Edit goal', fields(g), d => Object.assign(g, fromForm(d))); },
  addGoalSaving(id) {
    const g = list().find(x => x.id === id);
    openForm(`Add savings — ${g.name}`, [
      { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', value: g.monthly || '', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'note', label: 'Note', placeholder: 'optional' },
    ], d => { (g.contribs = g.contribs || []).push({ id: uid(), date: d.date, amount: Number(d.amount), note: d.note || '' }); });
  },
  delGoalSaving(gid, cid) { const g = list().find(x => x.id === gid); if (g) confirmThen('Remove this saving?', () => { g.contribs = g.contribs.filter(c => c.id !== cid); }); },
  delGoal: id => confirmThen('Delete this goal and its savings record?', () => { S.goals = list().filter(g => g.id !== id); }),
});
