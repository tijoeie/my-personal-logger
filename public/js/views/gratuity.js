import { S, save } from '../core/state.js';
import { esc, money, moneyH, iso, parseISO, fmtDate } from '../core/util.js';
import { calcGratuity } from '../domain/schedule.js';
import { expose } from '../ui/form.js';
import { render } from '../ui/shell.js';

export function vGratuity() {
  const g = S.settings;
  const result = calcGratuity(g.joinDate, Number(g.basicSalary));
  const milestones = g.joinDate ? [1, 2, 3, 5, 10, 15, 20].map(yr => {
    const d = parseISO(g.joinDate);
    d.setFullYear(d.getFullYear() + yr);
    const r = calcGratuity(g.joinDate, Number(g.basicSalary), iso(d));
    return r ? { yr, amount: r.amount, date: iso(d) } : null;
  }).filter(Boolean) : [];

  return `
  <div class="panel">
    <h2>Your details <small>— used for calculation only</small></h2>
    <div class="field"><label>Date you joined your current employer</label><input id="gJoin" type="date" value="${esc(g.joinDate || '')}"></div>
    <div class="field"><label>Basic salary (AED/month) <span class="hint">— not total package, just the basic component</span></label><input id="gBasic" type="number" value="${esc(g.basicSalary || '')}" placeholder="e.g. 8000"></div>
    <button class="btn primary" onclick="saveGratuitySettings()">Save</button>
  </div>

  ${result ? `
  <div class="cards">
    <div class="card"><div class="k">Gratuity earned today</div><div class="v">${money(result.amount)}</div><div class="s">${result.years.toFixed(1)} years service${result.capped ? ' · at cap' : ''}</div></div>
    <div class="card"><div class="k">Daily basic</div><div class="v">${money(result.dailyBasic)}</div><div class="s">AED ${esc(g.basicSalary)}/30 days</div></div>
  </div>

  <div class="panel">
    <h2>How it is calculated <small>— UAE Labour Law</small></h2>
    <div class="row"><div class="grow"><div class="title">First 5 years</div><div class="sub">21 days of basic salary per year</div></div><span class="amt">${moneyH(result.dailyBasic * 21 * Math.min(result.years, 5))}</span></div>
    ${result.years > 5 ? `<div class="row"><div class="grow"><div class="title">After 5 years</div><div class="sub">30 days of basic salary per year</div></div><span class="amt">${moneyH(result.dailyBasic * 30 * (result.years - 5))}</span></div>` : ''}
    ${result.capped ? `<div class="row"><div class="grow"><div class="title" style="color:var(--warning)">Capped</div><div class="sub">Maximum is 2 years total salary</div></div><span class="amt">${moneyH(result.amount)}</span></div>` : ''}
    <div class="hint" style="margin-top:8px">Note: This is the minimum legal gratuity. Some employers pay more. If you resign before 1 year you get nothing; 1–3 years = 1/3; 3–5 years = 2/3; 5+ years = full amount.</div>
  </div>

  <div class="panel">
    <h2>Milestones</h2>
    ${milestones.map(m => `<div class="row">
      <div class="grow"><div class="title">${m.yr} year${m.yr > 1 ? 's' : ''}</div><div class="sub">${fmtDate(m.date)}</div></div>
      <span class="amt">${moneyH(m.amount)}</span>
    </div>`).join('')}
  </div>` : `<div class="panel"><div class="empty">Enter your join date and basic salary above to see your gratuity.</div></div>`}`;
}

expose({
  saveGratuitySettings() {
    S.settings.joinDate = document.getElementById('gJoin').value;
    S.settings.basicSalary = Number(document.getElementById('gBasic').value) || 0;
    save(); render();
  },
});
