/* My Personal Logger — UAE life assistant */
'use strict';

const LS_KEY = 'mpl_v1';
const DAY = 86400000;

const DEFAULT_SERVICE_TYPES = [
  { id: 'oil',      name: 'Oil change',                  months: 6,  km: 10000 },
  { id: 'service',  name: 'Annual service',              months: 12, km: 15000 },
  { id: 'coolant',  name: 'Coolant change',              months: 24, km: 40000 },
  { id: 'inspect',  name: 'Car inspection (Tasjeel)',    months: 12, km: 0 },
  { id: 'tyres',    name: 'Tyre rotation / check',       months: 6,  km: 10000 },
  { id: 'battery',  name: 'Battery replacement',         months: 24, km: 0 },
  { id: 'brakes',   name: 'Brake pads check',            months: 12, km: 20000 },
  { id: 'ac',       name: 'AC service',                  months: 12, km: 0 },
];

const EXPENSE_CATS = ['Rent', 'Groceries', 'DEWA / Utilities', 'Telecom / Internet', 'Fuel', 'Salik / Parking', 'Car', 'Dining out', 'Health', 'Shopping', 'Family / Remittance', 'Travel', 'Other'];

const UAE_QUICKADD = [
  { title: 'My residence visa',        cat: 'Visa',        person: 'Me' },
  { title: "Wife's residence visa",    cat: 'Visa',        person: 'Wife' },
  { title: 'My Emirates ID',           cat: 'Emirates ID', person: 'Me' },
  { title: "Wife's Emirates ID",       cat: 'Emirates ID', person: 'Wife' },
  { title: 'My passport',              cat: 'Passport',    person: 'Me' },
  { title: "Wife's passport",          cat: 'Passport',    person: 'Wife' },
  { title: 'Driving license',          cat: 'License',     person: 'Me' },
  { title: 'Car registration (Mulkiya)', cat: 'Car',       person: 'Shared' },
  { title: 'Car insurance',            cat: 'Car',         person: 'Shared' },
  { title: 'Health insurance',         cat: 'Insurance',   person: 'Shared' },
  { title: 'Tenancy contract (Ejari)', cat: 'Home',        person: 'Shared' },
];

let S = load();

function emptyState() {
  return {
    settings: { currency: 'AED', salaryDay: 25, salaryAmount: 0, joinDate: '', basicSalary: 0, notifyEnabled: false },
    renewals: [],
    serviceTypes: DEFAULT_SERVICE_TYPES.map(t => ({ ...t })),
    serviceLog: [],
    expenses: [],
    incomes: [],
    budgets: {},
    vacations: [],
    remittances: [],
  };
}
function load() {
  const base = emptyState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    // merge over defaults so older/partial backups can't leave keys missing
    if (raw) return Object.assign(base, JSON.parse(raw));
  } catch (e) { console.error('load failed', e); }
  return base;
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- dates ----------
function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseISO(s) { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); }
function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function daysUntil(dateStr) { return Math.round((parseISO(dateStr) - today()) / DAY); }
function fmtDate(s) {
  if (!s) return '—';
  return parseISO(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function money(n) {
  return (S.settings.currency || 'AED') + ' ' + Number(n || 0).toLocaleString('en-AE', { maximumFractionDigits: 0 });
}

// Budget period anchored to salary day (25th → 24th)
function periodStart(d) {
  const day = S.settings.salaryDay || 25;
  return d.getDate() >= day
    ? new Date(d.getFullYear(), d.getMonth(), day)
    : new Date(d.getFullYear(), d.getMonth() - 1, day);
}
function periodOf(d) {
  const start = periodStart(d);
  const end = new Date(addMonths(start, 1) - DAY);
  return { start, end };
}
function periodLabel(p) {
  const f = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${f(p.start)} – ${f(p.end)}`;
}
function inPeriod(dateStr, p) {
  const d = parseISO(dateStr);
  return d >= p.start && d <= p.end;
}
function nextSalaryDate() {
  const t = today();
  const day = S.settings.salaryDay || 25;
  return t.getDate() <= day
    ? new Date(t.getFullYear(), t.getMonth(), day)
    : new Date(t.getFullYear(), t.getMonth() + 1, day);
}

// ---------- due items ----------
function statusOf(days, remind) {
  if (days < 0) return { cls: 'overdue', label: `overdue ${-days}d` };
  if (days <= 30) return { cls: 'due', label: `${days}d left` };
  if (days <= (remind || 90)) return { cls: 'soon', label: `${days}d left` };
  return { cls: 'ok', label: `${days}d left` };
}
function serviceNextDue(type) {
  const logs = S.serviceLog.filter(l => l.type === type.id).sort((a, b) => b.date.localeCompare(a.date));
  const last = logs[0];
  if (!last || !type.months) return { last, due: null };
  return { last, due: iso(addMonths(parseISO(last.date), type.months)) };
}
function allDueItems() {
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

// ---------- modal ----------
function openForm(title, fields, onSubmit, submitLabel) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `<h3>${esc(title)}</h3><form method="dialog" id="dlgForm">
    ${fields.map(f => {
      if (f.type === 'select') {
        return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}">${f.options.map(o => `<option value="${esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`;
      }
      return `<div class="field"><label>${esc(f.label)}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} placeholder="${esc(f.placeholder || '')}"></div>`;
    }).join('')}
    <div class="dlg-actions">
      <button type="button" class="btn" id="dlgCancel">Cancel</button>
      <button type="submit" class="btn primary">${esc(submitLabel || 'Save')}</button>
    </div></form>`;
  dlg.showModal();
  dlg.querySelector('#dlgCancel').onclick = () => dlg.close();
  dlg.querySelector('#dlgForm').onsubmit = (e) => {
    const data = Object.fromEntries(new FormData(e.target).entries());
    onSubmit(data);
    save();
    render();
  };
}

// ---------- rendering ----------
let activeTab = 'dashboard';
const TABS = [
  ['dashboard', 'Dashboard'], ['renewals', 'Renewals'], ['car', 'Car'],
  ['expenses', 'Expenses'], ['vacation', 'Vacation'],
  ['gratuity', 'Gratuity'], ['remittance', 'Remittance'], ['settings', 'Settings'],
];

function render() {
  document.getElementById('nav').innerHTML = TABS.map(([id, label]) =>
    `<button class="${id === activeTab ? 'active' : ''}" onclick="switchTab('${id}')">${label}</button>`).join('');
  const main = document.getElementById('main');
  main.innerHTML = ({
    dashboard: vDashboard, renewals: vRenewals, car: vCar,
    expenses: vExpenses, vacation: vVacation,
    gratuity: vGratuity, remittance: vRemittance, settings: vSettings,
  })[activeTab]();
}
window.switchTab = (t) => { activeTab = t; render(); window.scrollTo(0, 0); };

// ----- Dashboard -----
function vDashboard() {
  const p = periodOf(today());
  const spent = S.expenses.filter(e => inPeriod(e.date, p)).reduce((s, e) => s + Number(e.amount), 0);
  const income = S.incomes.filter(i => inPeriod(i.date, p)).reduce((s, i) => s + Number(i.amount), 0);
  const nextSal = nextSalaryDate();
  const salDays = Math.round((nextSal - today()) / DAY);
  const vacTarget = S.vacations.reduce((s, v) => s + Number(v.budget || 0), 0);
  const vacSaved = S.vacations.reduce((s, v) => s + v.contribs.reduce((a, c) => a + Number(c.amount), 0), 0);

  const due = allDueItems();
  const attention = due.filter(i => i.st.cls !== 'ok');

  return `
  <div class="cards">
    <div class="card"><div class="k">Next salary</div><div class="v">${salDays === 0 ? 'Today 🎉' : salDays + ' days'}</div><div class="s">${nextSal.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · sometimes early</div></div>
    <div class="card"><div class="k">Spent this period</div><div class="v">${money(spent)}</div><div class="s">${periodLabel(p)}</div></div>
    <div class="card"><div class="k">Income this period</div><div class="v">${money(income)}</div><div class="s">${income - spent >= 0 ? `<span class="pos">+${money(income - spent)} left</span>` : `<span class="neg">${money(income - spent)} over</span>`}</div></div>
    <div class="card"><div class="k">Vacation fund</div><div class="v">${money(vacSaved)}</div><div class="s">of ${money(vacTarget)} goal</div></div>
  </div>

  <div class="panel">
    <h2>Needs attention <small>— overdue &amp; due within the reminder window</small></h2>
    ${attention.length ? attention.map(dueRow).join('') : '<div class="empty">Nothing urgent. 👌</div>'}
  </div>

  <div class="panel">
    <h2>All tracked items <small>— sorted by due date</small></h2>
    ${due.length ? due.map(dueRow).join('') : '<div class="empty">Add renewals and log car services to see follow-ups here.</div>'}
  </div>

  <div class="panel">
    <h2>Spending by category <small>— ${periodLabel(p)}</small></h2>
    ${catChart(p)}
  </div>

  <div class="panel">
    <h2>Last 6 salary periods</h2>
    ${trendChart()}
  </div>`;
}
function dueRow(i) {
  return `<div class="row">
    <div class="grow"><div class="title">${esc(i.label)}</div><div class="sub">${esc(i.sub)}</div></div>
    <span class="badge ${i.st.cls}">${i.st.cls === 'overdue' ? i.st.label : (i.st.cls === 'ok' ? i.st.label : i.st.label)}</span>
  </div>`;
}
function catChart(p) {
  const byCat = {};
  for (const e of S.expenses.filter(e => inPeriod(e.date, p))) byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount);
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="empty">No expenses logged this period yet.</div>';
  const max = entries[0][1];
  return entries.map(([cat, amt]) => `
    <div class="hbar-row" title="${esc(cat)}: ${money(amt)}">
      <div class="lbl">${esc(cat)}</div>
      <div class="track"><div class="bar" style="width:${Math.max(2, amt / max * 100)}%"></div><span class="val">${money(amt)}</span></div>
    </div>`).join('');
}
function trendChart() {
  const periods = [];
  let cur = periodOf(today());
  for (let i = 0; i < 6; i++) {
    periods.unshift(cur);
    cur = periodOf(new Date(cur.start - DAY));
  }
  const vals = periods.map(p => S.expenses.filter(e => inPeriod(e.date, p)).reduce((s, e) => s + Number(e.amount), 0));
  const max = Math.max(...vals, 1);
  return `<div class="cols">${vals.map((v, i) => `
      <div class="col" title="${periodLabel(periods[i])}: ${money(v)}">
        <span class="v">${v ? (v >= 10000 ? Math.round(v / 1000) + 'k' : (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k') : ''}</span>
        <div class="bar" style="height:${Math.max(2, v / max * 100)}%"></div>
      </div>`).join('')}</div>
    <div class="cols-x">${periods.map(p => `<span>${p.start.toLocaleDateString('en-GB', { month: 'short' })}</span>`).join('')}</div>
    <div class="hint" style="margin-top:6px">Each bar is a salary period starting on the ${S.settings.salaryDay}th of the labeled month.</div>`;
}

// ----- Renewals -----
function vRenewals() {
  const rows = [...S.renewals].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addRenewal()">+ Add renewal</button>
  </div>
  <div class="panel">
    <h2>Quick add <small>— common UAE documents</small></h2>
    <div class="quickadd">${UAE_QUICKADD.map((q, i) => ({ q, i })).filter(({ q }) => !S.renewals.some(r => r.title === q.title))
      .map(({ q, i }) => `<button onclick="addRenewal(UAE_QUICKADD[${i}])">+ ${esc(q.title)}</button>`).join('') || '<span class="hint">All common items added.</span>'}</div>
  </div>
  <div class="panel">
    ${rows.length ? rows.map(r => {
      const st = r.expiry ? statusOf(daysUntil(r.expiry), r.remindDays) : { cls: 'ok', label: 'no date' };
      const hist = (r.history || []).map(h => `<div class="sub">↻ renewed ${fmtDate(h.date)}${h.cost ? ' · ' + money(h.cost) : ''}</div>`).join('');
      return `<div class="row">
        <div class="grow">
          <div class="title">${esc(r.title)} <span class="chip">${esc(r.person)}</span> <span class="chip">${esc(r.cat)}</span></div>
          <div class="sub">expires ${fmtDate(r.expiry)} · remind ${r.remindDays}d before</div>${hist}
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
        <button class="btn small" onclick="renewItem('${r.id}')">Renewed</button>
        <button class="btn small" onclick="editRenewal('${r.id}')">Edit</button>
        <button class="btn small danger" onclick="delRenewal('${r.id}')">✕</button>
      </div>`;
    }).join('') : '<div class="empty">No renewals tracked yet — use quick add above.</div>'}
  </div>`;
}
window.addRenewal = (preset) => {
  preset = preset || {};
  openForm('Add renewal', [
    { name: 'title', label: 'What is it?', value: preset.title, required: true, placeholder: 'e.g. My residence visa' },
    { name: 'person', label: 'Whose?', type: 'select', value: preset.person || 'Me', options: [{ v: 'Me', t: 'Me' }, { v: 'Wife', t: 'Wife' }, { v: 'Shared', t: 'Shared' }] },
    { name: 'cat', label: 'Category', value: preset.cat || 'Other' },
    { name: 'expiry', label: 'Expiry date', type: 'date', required: true },
    { name: 'remindDays', label: 'Remind me (days before)', type: 'number', value: 60 },
  ], d => S.renewals.push({ id: uid(), ...d, remindDays: Number(d.remindDays) || 60, history: [] }));
};
window.editRenewal = (id) => {
  const r = S.renewals.find(x => x.id === id);
  openForm('Edit renewal', [
    { name: 'title', label: 'What is it?', value: r.title, required: true },
    { name: 'person', label: 'Whose?', type: 'select', value: r.person, options: [{ v: 'Me', t: 'Me' }, { v: 'Wife', t: 'Wife' }, { v: 'Shared', t: 'Shared' }] },
    { name: 'cat', label: 'Category', value: r.cat },
    { name: 'expiry', label: 'Expiry date', type: 'date', value: r.expiry, required: true },
    { name: 'remindDays', label: 'Remind me (days before)', type: 'number', value: r.remindDays },
  ], d => Object.assign(r, d, { remindDays: Number(d.remindDays) || 60 }));
};
window.renewItem = (id) => {
  const r = S.renewals.find(x => x.id === id);
  openForm(`Renewed: ${r.title}`, [
    { name: 'date', label: 'Renewed on', type: 'date', value: iso(today()), required: true },
    { name: 'expiry', label: 'New expiry date', type: 'date', required: true },
    { name: 'cost', label: 'Cost (optional)', type: 'number', step: '0.01' },
  ], d => {
    (r.history = r.history || []).push({ date: d.date, cost: d.cost });
    r.expiry = d.expiry;
    if (d.cost) S.expenses.push({ id: uid(), date: d.date, cat: 'Other', amount: Number(d.cost), note: `Renewal: ${r.title}` });
  }, 'Log renewal');
};
window.delRenewal = (id) => { if (confirm('Delete this renewal?')) { S.renewals = S.renewals.filter(r => r.id !== id); save(); render(); } };

// ----- Car -----
function vCar() {
  const logs = [...S.serviceLog].sort((a, b) => b.date.localeCompare(a.date));
  return `
  <div class="toolbar">
    <button class="btn primary" onclick="logService()">+ Log a service</button>
    <button class="btn" onclick="addServiceType()">+ New service type</button>
  </div>
  <div class="panel">
    <h2>Service schedule</h2>
    ${S.serviceTypes.map(t => {
      const { last, due } = serviceNextDue(t);
      const st = due ? statusOf(daysUntil(due), 60) : null;
      return `<div class="row">
        <div class="grow">
          <div class="title">${esc(t.name)}</div>
          <div class="sub">every ${t.months} months${t.km ? ` or ${t.km.toLocaleString()} km` : ''}
            · ${last ? `last: ${fmtDate(last.date)}${last.odo ? ' @ ' + Number(last.odo).toLocaleString() + ' km' : ''}` : 'never logged'}
            ${due ? ` · next: ${fmtDate(due)}` : ''}</div>
        </div>
        ${st ? `<span class="badge ${st.cls}">${st.label}</span>` : '<span class="badge ok">log first</span>'}
        <button class="btn small" onclick="logService('${t.id}')">Done today</button>
        <button class="btn small" onclick="editServiceType('${t.id}')">Edit</button>
      </div>`;
    }).join('')}
  </div>
  <div class="panel">
    <h2>Service history</h2>
    ${logs.length ? logs.map(l => {
      const t = S.serviceTypes.find(x => x.id === l.type);
      return `<div class="row">
        <div class="grow"><div class="title">${esc(t ? t.name : l.type)}</div>
        <div class="sub">${fmtDate(l.date)}${l.odo ? ' · ' + Number(l.odo).toLocaleString() + ' km' : ''}${l.notes ? ' · ' + esc(l.notes) : ''}</div></div>
        ${l.cost ? `<span class="amt">${money(l.cost)}</span>` : ''}
        <button class="btn small danger" onclick="delService('${l.id}')">✕</button>
      </div>`;
    }).join('') : '<div class="empty">No services logged yet.</div>'}
  </div>`;
}
window.logService = (typeId) => {
  openForm('Log a service', [
    { name: 'type', label: 'Service', type: 'select', value: typeId, options: S.serviceTypes.map(t => ({ v: t.id, t: t.name })) },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'odo', label: 'Odometer (km, optional)', type: 'number' },
    { name: 'cost', label: 'Cost (optional)', type: 'number', step: '0.01' },
    { name: 'notes', label: 'Notes (garage, parts…)', placeholder: 'optional' },
  ], d => {
    S.serviceLog.push({ id: uid(), ...d });
    if (d.cost) S.expenses.push({ id: uid(), date: d.date, cat: 'Car', amount: Number(d.cost), note: (S.serviceTypes.find(t => t.id === d.type) || {}).name || 'Car service' });
  }, 'Log it');
};
window.addServiceType = () => {
  openForm('New service type', [
    { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Transmission fluid' },
    { name: 'months', label: 'Interval (months)', type: 'number', value: 12, required: true },
    { name: 'km', label: 'Interval (km, optional)', type: 'number' },
  ], d => S.serviceTypes.push({ id: uid(), name: d.name, months: Number(d.months), km: Number(d.km) || 0 }));
};
window.editServiceType = (id) => {
  const t = S.serviceTypes.find(x => x.id === id);
  openForm('Edit service type', [
    { name: 'name', label: 'Name', value: t.name, required: true },
    { name: 'months', label: 'Interval (months)', type: 'number', value: t.months, required: true },
    { name: 'km', label: 'Interval (km, optional)', type: 'number', value: t.km || '' },
  ], d => Object.assign(t, { name: d.name, months: Number(d.months), km: Number(d.km) || 0 }));
};
window.delService = (id) => { if (confirm('Delete this log entry?')) { S.serviceLog = S.serviceLog.filter(l => l.id !== id); save(); render(); } };

// ----- Expenses -----
let expOffset = 0; // periods back from current
function vExpenses() {
  let p = periodOf(today());
  for (let i = 0; i < expOffset; i++) p = periodOf(new Date(p.start - DAY));
  const list = S.expenses.filter(e => inPeriod(e.date, p)).sort((a, b) => b.date.localeCompare(a.date));
  const spent = list.reduce((s, e) => s + Number(e.amount), 0);
  const income = S.incomes.filter(i => inPeriod(i.date, p)).reduce((s, i) => s + Number(i.amount), 0);
  const byCat = {};
  for (const e of list) byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount);

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addExpense()">+ Add expense</button>
    <button class="btn" onclick="markSalary()">💰 Salary received</button>
    <button class="btn" onclick="setBudgets()">Budgets</button>
    <div class="spacer"></div>
    <button class="btn small" onclick="expOffset++;render()">←</button>
    <span class="hint">${periodLabel(p)}</span>
    <button class="btn small" ${expOffset === 0 ? 'disabled' : ''} onclick="expOffset--;render()">→</button>
  </div>
  <div class="cards">
    <div class="card"><div class="k">Income</div><div class="v">${money(income)}</div></div>
    <div class="card"><div class="k">Spent</div><div class="v">${money(spent)}</div></div>
    <div class="card"><div class="k">Balance</div><div class="v ${income - spent >= 0 ? 'pos' : 'neg'}">${money(income - spent)}</div></div>
  </div>
  ${Object.keys(S.budgets).length ? `<div class="panel"><h2>Budgets <small>— this period</small></h2>
    ${Object.entries(S.budgets).filter(([, b]) => Number(b) > 0).map(([cat, b]) => {
      const used = byCat[cat] || 0;
      const pct = Math.min(100, used / b * 100);
      return `<div class="hbar-row" title="${esc(cat)}: ${money(used)} of ${money(b)}">
        <div class="lbl">${esc(cat)}</div>
        <div class="track"><div class="bar ${used > b ? 'over' : ''}" style="width:${Math.max(2, pct)}%"></div>
        <span class="val">${money(used)} / ${money(b)}</span></div></div>`;
    }).join('')}</div>` : ''}
  <div class="panel">
    <h2>Expenses <small>— ${list.length} entries</small></h2>
    ${list.length ? list.map(e => `<div class="row">
      <div class="grow"><div class="title">${esc(e.cat)}</div><div class="sub">${fmtDate(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
      <span class="amt">${money(e.amount)}</span>
      <button class="btn small danger" onclick="delExpense('${e.id}')">✕</button>
    </div>`).join('') : '<div class="empty">No expenses in this period.</div>'}
  </div>
  <div class="panel">
    <h2>Income <small>— this period</small></h2>
    ${S.incomes.filter(i => inPeriod(i.date, p)).map(i => `<div class="row">
      <div class="grow"><div class="title">${esc(i.note || 'Salary')}</div><div class="sub">${fmtDate(i.date)}</div></div>
      <span class="amt pos">${money(i.amount)}</span>
      <button class="btn small danger" onclick="delIncome('${i.id}')">✕</button>
    </div>`).join('') || '<div class="empty">No income logged this period.</div>'}
  </div>`;
}
window.addExpense = () => {
  openForm('Add expense', [
    { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', required: true },
    { name: 'cat', label: 'Category', type: 'select', value: 'Groceries', options: EXPENSE_CATS.map(c => ({ v: c, t: c })) },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'note', label: 'Note', placeholder: 'optional' },
  ], d => S.expenses.push({ id: uid(), ...d, amount: Number(d.amount) }));
};
window.markSalary = () => {
  openForm('Salary received 🎉', [
    { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', value: S.settings.salaryAmount || '', required: true },
    { name: 'date', label: 'Received on', type: 'date', value: iso(today()), required: true },
    { name: 'note', label: 'Note', value: 'Salary' },
  ], d => {
    S.incomes.push({ id: uid(), ...d, amount: Number(d.amount) });
    S.settings.salaryAmount = Number(d.amount);
  });
};
window.setBudgets = () => {
  openForm('Monthly budgets (AED, blank = none)', EXPENSE_CATS.map(c =>
    ({ name: c, label: c, type: 'number', value: S.budgets[c] || '' })),
  d => { for (const c of EXPENSE_CATS) S.budgets[c] = Number(d[c]) || 0; });
};
window.delExpense = (id) => { S.expenses = S.expenses.filter(e => e.id !== id); save(); render(); };
window.delIncome = (id) => { S.incomes = S.incomes.filter(i => i.id !== id); save(); render(); };

// ----- Vacation -----
function vVacation() {
  return `
  <div class="toolbar"><button class="btn primary" onclick="addVacation()">+ Plan a vacation</button></div>
  ${S.vacations.length ? S.vacations.map(v => {
    const saved = v.contribs.reduce((s, c) => s + Number(c.amount), 0);
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
      ${v.contribs.length ? `<div style="margin-top:8px">${v.contribs.map(c => `<div class="row"><div class="grow sub">${fmtDate(c.date)}</div><span class="amt">${money(c.amount)}</span></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="panel"><div class="empty">No vacation planned yet. Plan one and start saving for it. ✈️</div></div>'}`;
}
window.addVacation = () => {
  openForm('Plan a vacation', [
    { name: 'name', label: 'Trip name', required: true, placeholder: 'e.g. Kerala 2027' },
    { name: 'dest', label: 'Destination' },
    { name: 'date', label: 'Target date', type: 'date' },
    { name: 'budget', label: 'Savings goal (AED)', type: 'number', required: true },
  ], d => S.vacations.push({ id: uid(), ...d, budget: Number(d.budget), contribs: [] }));
};
window.editVacation = (id) => {
  const v = S.vacations.find(x => x.id === id);
  openForm('Edit vacation', [
    { name: 'name', label: 'Trip name', value: v.name, required: true },
    { name: 'dest', label: 'Destination', value: v.dest },
    { name: 'date', label: 'Target date', type: 'date', value: v.date },
    { name: 'budget', label: 'Savings goal (AED)', type: 'number', value: v.budget, required: true },
  ], d => Object.assign(v, d, { budget: Number(d.budget) }));
};
window.addContrib = (id) => {
  const v = S.vacations.find(x => x.id === id);
  openForm(`Add savings — ${v.name}`, [
    { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', required: true },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
  ], d => v.contribs.push({ date: d.date, amount: Number(d.amount) }));
};
window.delVacation = (id) => { if (confirm('Delete this vacation plan?')) { S.vacations = S.vacations.filter(v => v.id !== id); save(); render(); } };

// ----- Gratuity -----
function calcGratuity(joinDateStr, basicSalary, toDateStr) {
  if (!joinDateStr || !basicSalary) return null;
  const start = parseISO(joinDateStr);
  const end = toDateStr ? parseISO(toDateStr) : today();
  const totalDays = Math.round((end - start) / DAY);
  if (totalDays < 0) return null;
  const years = totalDays / 365.25;
  const dailyBasic = basicSalary / 30;

  // UAE Labour Law: 21 days per year for first 5 years, 30 days per year after
  let amount = 0;
  if (years <= 5) {
    amount = dailyBasic * 21 * years;
  } else {
    amount = dailyBasic * 21 * 5 + dailyBasic * 30 * (years - 5);
  }
  // Capped at 2 years' gross salary
  const cap = basicSalary * 24;
  amount = Math.min(amount, cap);
  return { amount, years, totalDays, dailyBasic, capped: amount >= cap };
}
function vGratuity() {
  const g = S.settings;
  const result = calcGratuity(g.joinDate, Number(g.basicSalary));
  const milestones = [1, 2, 3, 5, 10, 15, 20].map(yr => {
    if (!g.joinDate) return null;
    const d = new Date(parseISO(g.joinDate));
    d.setFullYear(d.getFullYear() + yr);
    const r = calcGratuity(g.joinDate, Number(g.basicSalary), iso(d));
    return r ? { yr, amount: r.amount, date: iso(d) } : null;
  }).filter(Boolean);

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
    <div class="card"><div class="k">Daily basic</div><div class="v">${money(result.dailyBasic)}</div><div class="s">AED ${g.basicSalary}/30 days</div></div>
  </div>

  <div class="panel">
    <h2>How it is calculated <small>— UAE Labour Law</small></h2>
    <div class="row"><div class="grow"><div class="title">First 5 years</div><div class="sub">21 days of basic salary per year</div></div><span class="amt">${money(result.dailyBasic * 21 * Math.min(result.years, 5))}</span></div>
    ${result.years > 5 ? `<div class="row"><div class="grow"><div class="title">After 5 years</div><div class="sub">30 days of basic salary per year</div></div><span class="amt">${money(result.dailyBasic * 30 * (result.years - 5))}</span></div>` : ''}
    ${result.capped ? `<div class="row"><div class="grow"><div class="title" style="color:var(--warning)">Capped</div><div class="sub">Maximum is 2 years total salary</div></div><span class="amt">${money(result.amount)}</span></div>` : ''}
    <div class="hint" style="margin-top:8px">Note: This is the minimum legal gratuity. Some employers pay more. If you resign before 1 year you get nothing; 1–3 years = 1/3; 3–5 years = 2/3; 5+ years = full amount.</div>
  </div>

  <div class="panel">
    <h2>Milestones</h2>
    ${milestones.map(m => `<div class="row">
      <div class="grow"><div class="title">${m.yr} year${m.yr > 1 ? 's' : ''}</div><div class="sub">${fmtDate(m.date)}</div></div>
      <span class="amt">${money(m.amount)}</span>
    </div>`).join('')}
  </div>` : `<div class="panel"><div class="empty">Enter your join date and basic salary above to see your gratuity.</div></div>`}`;
}
window.saveGratuitySettings = () => {
  S.settings.joinDate = document.getElementById('gJoin').value;
  S.settings.basicSalary = Number(document.getElementById('gBasic').value) || 0;
  save(); render();
};

// ----- Remittance -----
const CURRENCIES = ['INR', 'PKR', 'PHP', 'LKR', 'BDT', 'NPR', 'EGP', 'USD', 'EUR', 'GBP', 'Other'];
function vRemittance() {
  const list = [...(S.remittances || [])].sort((a, b) => b.date.localeCompare(a.date));
  const thisYear = today().getFullYear();
  const yearTotal = list.filter(r => parseISO(r.date).getFullYear() === thisYear).reduce((s, r) => s + Number(r.aed), 0);
  const allRates = list.filter(r => r.currency === (S.settings.remitCurrency || 'INR') && r.rate);
  const bestRate = allRates.length ? Math.max(...allRates.map(r => Number(r.rate))) : null;
  const lastRate = allRates[0] ? Number(allRates[0].rate) : null;

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addRemittance()">+ Log transfer</button>
    <select class="btn" onchange="S.settings.remitCurrency=this.value;save();render()" style="padding-right:8px">
      ${CURRENCIES.map(c => `<option${(S.settings.remitCurrency||'INR')===c?' selected':''}>${c}</option>`).join('')}
    </select>
  </div>
  <div class="cards">
    <div class="card"><div class="k">Sent in ${thisYear}</div><div class="v">${money(yearTotal)}</div><div class="s">${list.filter(r=>parseISO(r.date).getFullYear()===thisYear).length} transfers</div></div>
    <div class="card"><div class="k">Last rate</div><div class="v">${lastRate ? lastRate.toFixed(2) : '—'}</div><div class="s">1 AED = ${S.settings.remitCurrency||'INR'}</div></div>
    <div class="card"><div class="k">Best rate seen</div><div class="v">${bestRate ? bestRate.toFixed(2) : '—'}</div><div class="s">from your history</div></div>
  </div>
  <div class="panel">
    <h2>Transfer history</h2>
    ${list.length ? list.map(r => {
      const isBest = bestRate && Number(r.rate) === bestRate;
      return `<div class="row">
        <div class="grow">
          <div class="title">${money(r.aed)} → ${Number(r.foreign).toLocaleString()} ${esc(r.currency)}
            ${isBest ? '<span class="badge ok" style="font-size:10px;margin-left:4px">best rate</span>' : ''}
          </div>
          <div class="sub">${fmtDate(r.date)}${r.rate ? ` · rate ${Number(r.rate).toFixed(2)}` : ''}${r.via ? ` · via ${esc(r.via)}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</div>
        </div>
        <button class="btn small danger" onclick="delRemittance('${r.id}')">✕</button>
      </div>`;
    }).join('') : '<div class="empty">No transfers logged yet.</div>'}
  </div>
  <div class="panel">
    <h2>Rate history <small>— ${S.settings.remitCurrency||'INR'} only</small></h2>
    ${allRates.length >= 2 ? (() => {
      const max = Math.max(...allRates.map(r => Number(r.rate)));
      const min = Math.min(...allRates.map(r => Number(r.rate)));
      return allRates.slice(0, 12).map(r => `<div class="hbar-row" title="Rate ${Number(r.rate).toFixed(2)} on ${fmtDate(r.date)}">
        <div class="lbl">${parseISO(r.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
        <div class="track"><div class="bar" style="width:${Math.max(5,(Number(r.rate)-min)/(max-min||1)*100)}%"></div><span class="val">${Number(r.rate).toFixed(2)}</span></div>
      </div>`).join('');
    })() : '<div class="empty">Log at least 2 transfers with the same currency to see rate history.</div>'}
  </div>`;
}
window.addRemittance = () => {
  openForm('Log a transfer', [
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'aed', label: 'Amount sent (AED)', type: 'number', step: '0.01', required: true },
    { name: 'currency', label: 'To currency', type: 'select', value: S.settings.remitCurrency || 'INR', options: CURRENCIES.map(c => ({ v: c, t: c })) },
    { name: 'foreign', label: 'Amount received', type: 'number', step: '0.01', required: true },
    { name: 'via', label: 'Service used', placeholder: 'e.g. Al Ansari, Wise, bank' },
    { name: 'note', label: 'Note', placeholder: 'e.g. rent, family expense' },
  ], d => {
    const rate = d.foreign && d.aed ? (Number(d.foreign) / Number(d.aed)) : 0;
    S.remittances = S.remittances || [];
    S.remittances.push({ id: uid(), ...d, aed: Number(d.aed), foreign: Number(d.foreign), rate });
    S.expenses.push({ id: uid(), date: d.date, cat: 'Family / Remittance', amount: Number(d.aed), note: `Transfer to ${d.currency}${d.note ? ' — ' + d.note : ''}` });
  });
};
window.delRemittance = (id) => {
  if (confirm('Delete this transfer?')) { S.remittances = (S.remittances || []).filter(r => r.id !== id); save(); render(); }
};

// ----- Settings -----
function vSettings() {
  const notifStatus = 'Notification' in window ? Notification.permission : 'unsupported';
  return `
  <div class="panel">
    <h2>Settings</h2>
    <div class="field"><label>Currency</label><input id="setCur" value="${esc(S.settings.currency)}"></div>
    <div class="field"><label>Salary day of month</label><input id="setDay" type="number" min="1" max="28" value="${S.settings.salaryDay}"></div>
    <button class="btn primary" onclick="saveSettings()">Save settings</button>
  </div>
  <div class="panel">
    <h2>Reminders</h2>
    <p class="hint">When enabled, the app shows a notification each time you open it if anything is overdue or due within 30 days.</p>
    ${notifStatus === 'granted'
      ? `<div class="row"><div class="grow"><div class="title">Notifications enabled</div><div class="sub">You will be alerted on app open when something is due</div></div><span class="badge ok">on</span></div>`
      : notifStatus === 'denied'
      ? `<div class="empty">Notifications blocked in your browser settings. On iPhone: Settings → Safari → Notifications → allow this site.</div>`
      : notifStatus === 'unsupported'
      ? `<div class="empty">Notifications not supported in this browser. Install the app from Safari to your home screen to enable them.</div>`
      : `<button class="btn primary" onclick="enableNotifs()">Enable reminders</button>
         <p class="hint" style="margin-top:8px">On iPhone: make sure you've added this app to your home screen first (share → Add to Home Screen), then tap Enable.</p>`
    }
  </div>
  <div class="panel">
    <h2>Backup &amp; restore</h2>
    <p class="hint">Your data lives only in this browser. Export a backup regularly — especially before clearing browser data or switching devices.</p>
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn" onclick="exportData()">⬇ Export backup (JSON)</button>
      <label class="btn" style="display:inline-block;cursor:pointer">⬆ Import backup<input type="file" accept=".json" style="display:none" onchange="importData(event)"></label>
      <button class="btn danger" onclick="wipeData()">Erase all data</button>
    </div>
  </div>`;
}
window.saveSettings = () => {
  S.settings.currency = document.getElementById('setCur').value || 'AED';
  S.settings.salaryDay = Number(document.getElementById('setDay').value) || 25;
  save(); render();
};

// ----- Notifications -----
window.enableNotifs = async () => {
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { S.settings.notifyEnabled = true; save(); render(); checkAndNotify(); }
  else { render(); }
};
function checkAndNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const urgent = allDueItems().filter(i => i.st.cls === 'overdue' || i.st.cls === 'due');
  if (!urgent.length) return;
  const title = urgent.length === 1 ? urgent[0].label : `${urgent.length} items need attention`;
  const body = urgent.slice(0, 3).map(i => `${i.label}: ${i.st.label}`).join('\n');
  new Notification(title, { body, icon: 'icons/icon-192.png' });
}
window.exportData = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `personal-logger-backup-${iso(today())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
window.importData = (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.settings || !Array.isArray(data.expenses)) throw new Error('not a valid backup');
      S = data; save(); render();
      alert('Backup restored.');
    } catch (e) { alert('Could not import: ' + e.message); }
  };
  reader.readAsText(f);
};
window.wipeData = () => {
  if (confirm('Erase ALL data? This cannot be undone.') && confirm('Really sure? Export a backup first if in doubt.')) {
    localStorage.removeItem(LS_KEY);
    S = load(); render();
  }
};

render();
checkAndNotify();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
