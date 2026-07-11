/* My Personal Logger — UAE life assistant */
'use strict';

const APP_VERSION = '0.07';
(function checkVersion() {
  fetch('/my-personal-logger/version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version }) => { if (version !== APP_VERSION) location.reload(true); })
    .catch(() => {});
})();

const LS_KEY = 'mpl_v1';
const DAY = 86400000;

// ---------- Firebase ----------
let auth = null, db = null, messaging = null;
let currentUser = null, unsubscribeSync = null;
try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp({
      apiKey: 'AIzaSyA79ft06v7FzKIdKSBQU5rQEGZbJX9Tom4',
      authDomain: 'personal-life-assistant-logger.firebaseapp.com',
      projectId: 'personal-life-assistant-logger',
      storageBucket: 'personal-life-assistant-logger.firebasestorage.app',
      messagingSenderId: '753120537298',
      appId: '1:753120537298:web:efcdedc823bc23cace9b0b',
    });
    auth = firebase.auth();
    db = firebase.firestore();
    try { messaging = firebase.messaging(); } catch (e) {}
  }
} catch (e) { console.warn('Firebase init failed:', e.message); }

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

const EXPENSE_CATS = ['Rent', 'Groceries', 'DEWA / Utilities', 'Telecom / Internet', 'Fuel', 'Salik / Parking', 'Car', 'Dining out', 'Health', 'Shopping', 'Family / Remittance', 'Travel', 'Loan EMI', 'Other'];

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
    settings: { currency: 'AED', salaryDay: 25, salaryAmount: 0, joinDate: '2020-02-12', basicSalary: 2490, notifyEnabled: false, remitCurrency: 'INR', emergencyMonths: 3 },
    accounts: {
      mashreq:  { name: 'Mashreq',   type: 'bank',   balance: 0,    balanceDate: '' },
      enbd_cc:  { name: 'ENBD CC',   type: 'credit', balance: 0,    balanceDate: '' },
      noon_cc:  { name: 'NOON CC',   type: 'credit', balance: 0,    balanceDate: '' },
    },
    recurring: [
      { id: 'rent',      name: 'House rent',            amount: 2300, cat: 'Rent',              day: 1,  active: true },
      { id: 'parking',   name: 'Car parking',           amount: 220,  cat: 'Salik / Parking',   day: 1,  active: true },
      { id: 'carwash',   name: 'Car washing',           amount: 70,   cat: 'Car',               day: 1,  active: true },
      { id: 'wife_allow',name: "Wife's household",      amount: 1000, cat: 'Family / Remittance', day: 25, active: true },
    ],
    renewals: [],
    serviceTypes: DEFAULT_SERVICE_TYPES.map(t => ({ ...t })),
    serviceLog: [],
    expenses: [],
    incomes: [],
    budgets: {},
    vacations: [],
    remittances: [],
    fuelLog: [],
    salik: { balance: 0, date: '', threshold: 50 },
    leaveSettings: { entitlementDays: 30 },
    leaveLog: [],
    loans: [],
    loanPayments: [],
    homeObligations: [],
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
function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(S));
  cloudSync();
}
async function cloudSync() {
  if (!currentUser || !db) return;
  try {
    setSyncDot('saving');
    await db.collection('users').doc(currentUser.uid).set({
      data: JSON.stringify(S),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    setSyncDot('saved');
  } catch (e) {
    setSyncDot('error');
    console.error('Cloud sync failed:', e);
  }
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- accounts ----------
// Computed Mashreq balance = anchor balance + income since anchor - bank expenses since anchor
function mashreqComputed() {
  const acc = (S.accounts || {}).mashreq || {};
  if (!acc.balanceDate || acc.balance == null) return null;
  const since = parseISO(acc.balanceDate);
  const income = S.incomes.filter(i => parseISO(i.date) >= since).reduce((s, i) => s + Number(i.amount), 0);
  const bankExp = S.expenses.filter(e => parseISO(e.date) >= since && (e.payMethod === 'bank' || !e.payMethod)).reduce((s, e) => s + Number(e.amount), 0);
  const ccPay = S.expenses.filter(e => parseISO(e.date) >= since && e.payMethod === 'cc_payment').reduce((s, e) => s + Number(e.amount), 0);
  return Number(acc.balance) + income - bankExp - ccPay;
}
// Auto-log any recurring expenses not yet logged this month
function autoLogRecurring() {
  const t = today();
  const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  const logged = new Set(S.expenses.filter(e => e.recurringId && e.recurringMonth === monthKey).map(e => e.recurringId));
  let added = 0;
  for (const r of (S.recurring || [])) {
    if (!r.active || logged.has(r.id)) continue;
    const dueDate = new Date(t.getFullYear(), t.getMonth(), Math.min(r.day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
    if (t >= dueDate) {
      S.expenses.push({ id: uid(), date: iso(dueDate), cat: r.cat, amount: r.amount, note: r.name, payMethod: 'bank', recurringId: r.id, recurringMonth: monthKey });
      added++;
    }
  }
  if (added) save();
  return added;
}
const PAY_METHODS = [
  { v: 'bank', t: 'Mashreq (bank)' },
  { v: 'enbd_cc', t: 'ENBD credit card' },
  { v: 'noon_cc', t: 'NOON credit card' },
  { v: 'cash', t: 'Cash' },
];

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
  ['dashboard', '🏠 Home'], ['expenses', '💳 Expenses'], ['renewals', '📋 Renewals'], ['car', '🚗 Car'],
  ['vacation', '✈️ Vacation'],
  ['gratuity', '🏦 Gratuity'], ['remittance', '💸 Remit'], ['leave', '🗓 Leave'],
  ['loans', '💰 Loans'], ['settings', '⚙️ Settings'],
];

function render() {
  document.getElementById('nav').innerHTML = TABS.map(([id, label]) =>
    `<button class="${id === activeTab ? 'active' : ''}" onclick="switchTab('${id}')">${label}</button>`).join('');
  const main = document.getElementById('main');
  main.innerHTML = ({
    dashboard: vDashboard, renewals: vRenewals, car: vCar,
    expenses: vExpenses, vacation: vVacation,
    gratuity: vGratuity, remittance: vRemittance,
    leave: vLeave, loans: vLoans, settings: vSettings,
  })[activeTab]();
}
window.switchTab = (t) => { activeTab = t; render(); window.scrollTo(0, 0); };

// ----- Dashboard -----
function vDashboard() {
  autoLogRecurring();
  const p = periodOf(today());
  const spent = S.expenses.filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment').reduce((s, e) => s + Number(e.amount), 0);
  const income = S.incomes.filter(i => inPeriod(i.date, p)).reduce((s, i) => s + Number(i.amount), 0);
  const nextSal = nextSalaryDate();
  const salDays = Math.round((nextSal - today()) / DAY);
  const vacTarget = S.vacations.reduce((s, v) => s + Number(v.budget || 0), 0);
  const vacSaved = S.vacations.reduce((s, v) => s + v.contribs.reduce((a, c) => a + Number(c.amount), 0), 0);
  const mashreq = mashreqComputed();
  const accs = S.accounts || {};
  const enbd = Number((accs.enbd_cc || {}).balance || 0);
  const noon = Number((accs.noon_cc || {}).balance || 0);

  // Emergency fund: avg spend over last 3 completed periods
  let efTotal = 0, efCount = 0;
  { let cur = periodOf(today());
    for (let i = 0; i < 3; i++) {
      cur = periodOf(new Date(cur.start - DAY));
      const s = S.expenses.filter(e => inPeriod(e.date, cur) && e.payMethod !== 'cc_payment').reduce((a, e) => a + Number(e.amount), 0);
      if (s > 0) { efTotal += s; efCount++; }
    }
  }
  const avgMonthlySpend = efCount ? efTotal / efCount : 0;
  const efMonths = mashreq !== null && avgMonthlySpend > 0 ? mashreq / avgMonthlySpend : null;
  const efTarget = S.settings.emergencyMonths || 3;

  // Salik alert
  const salik = S.salik || {};
  const salikLow = salik.threshold > 0 && salik.balance < salik.threshold;

  const due = allDueItems();
  const attention = due.filter(i => i.st.cls !== 'ok');

  // Total monthly loan EMI
  const totalEMI = (S.loans || []).filter(l => l.outstanding > 0).reduce((s, l) => s + Number(l.emi || 0), 0);

  return `
  <div class="cards">
    <div class="card"><div class="k">Next salary</div><div class="v">${salDays === 0 ? 'Today 🎉' : salDays + ' days'}</div><div class="s">${nextSal.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · sometimes early</div></div>
    <div class="card"><div class="k">Mashreq balance</div><div class="v ${mashreq !== null && mashreq < 0 ? 'neg' : ''}">${mashreq !== null ? money(mashreq) : '—'}</div>
      <div class="s">${mashreq !== null ? 'computed' : '<a href="#" onclick="switchTab(\'expenses\');return false">Set starting balance</a>'}</div></div>
    <div class="card"><div class="k">ENBD CC due</div><div class="v ${enbd > 0 ? 'neg' : ''}">${money(enbd)}</div><div class="s">${enbd > 0 ? 'outstanding' : 'all clear'}</div></div>
    <div class="card"><div class="k">NOON CC due</div><div class="v ${noon > 0 ? 'neg' : ''}">${money(noon)}</div><div class="s">${noon > 0 ? 'outstanding' : 'all clear'}</div></div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">Spent this period</div><div class="v">${money(spent)}</div><div class="s">${periodLabel(p)}</div></div>
    <div class="card"><div class="k">Income this period</div><div class="v">${money(income)}</div><div class="s">${income - spent >= 0 ? `<span class="pos">+${money(income - spent)} left</span>` : `<span class="neg">${money(income - spent)} over</span>`}</div></div>
    <div class="card"><div class="k">Vacation fund</div><div class="v">${money(vacSaved)}</div><div class="s">of ${money(vacTarget)} goal</div></div>
    <div class="card" title="Based on last 3 periods avg spend${avgMonthlySpend ? ' · avg ' + money(avgMonthlySpend) + '/mo' : ''}">
      <div class="k">Emergency fund</div>
      <div class="v ${efMonths !== null ? (efMonths >= efTarget ? 'pos' : efMonths >= 1 ? '' : 'neg') : ''}">${efMonths !== null ? efMonths.toFixed(1) + ' mo' : '—'}</div>
      <div class="s">goal: ${efTarget} months${totalEMI ? ` · EMI: ${money(totalEMI)}/mo` : ''}</div>
    </div>
  </div>

  <div class="panel">
    <h2>Needs attention <small>— overdue &amp; due within the reminder window</small></h2>
    ${salikLow ? `<div class="row"><div class="grow"><div class="title">Salik balance low</div><div class="sub">AED ${salik.balance} remaining · top up to avoid fines</div></div><span class="badge due">low</span><button class="btn small" onclick="switchTab('car')">Top up</button></div>` : ''}
    ${attention.length ? attention.map(dueRow).join('') : (!salikLow ? '<div class="empty">Nothing urgent. 👌</div>' : '')}
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
  const fuel = [...(S.fuelLog || [])].sort((a, b) => b.date.localeCompare(a.date));
  const salik = S.salik || { balance: 0, date: '', threshold: 50 };

  // Fuel stats: current month
  const t = today();
  const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  const fuelThisMonth = fuel.filter(f => f.date.startsWith(monthKey));
  const fuelMonthAED = fuelThisMonth.reduce((s, f) => s + Number(f.amount), 0);
  const fuelMonthL = fuelThisMonth.reduce((s, f) => s + Number(f.litres || 0), 0);
  const lastFuel = fuel[0];
  const avgPricePerL = fuel.length ? fuel.reduce((s, f) => s + (f.litres ? Number(f.amount) / Number(f.litres) : 0), 0) / fuel.filter(f => f.litres).length : 0;

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="logService()">+ Log a service</button>
    <button class="btn" onclick="logFuel()">⛽ Log fuel</button>
    <button class="btn" onclick="addServiceType()">+ New service type</button>
  </div>

  <div class="panel">
    <h2>Salik / Toll tag</h2>
    <div class="row">
      <div class="grow">
        <div class="title">Tag balance <span class="chip ${salik.balance < salik.threshold ? 'danger' : ''}">${salik.balance < salik.threshold ? 'LOW' : 'OK'}</span></div>
        <div class="sub">${salik.date ? 'Updated ' + fmtDate(salik.date) : 'Not set'} · alert below AED ${salik.threshold}</div>
      </div>
      <span class="amt ${salik.balance < salik.threshold ? 'neg' : ''}">AED ${salik.balance}</span>
      <button class="btn small" onclick="updateSalik()">Update</button>
      <button class="btn small" onclick="topUpSalik()">Top up</button>
    </div>
  </div>

  <div class="panel">
    <h2>Fuel log <small>— this month: ${money(fuelMonthAED)}${fuelMonthL ? ', ' + fuelMonthL.toFixed(0) + ' L' : ''}</small></h2>
    <div class="toolbar" style="margin-bottom:8px">
      ${lastFuel ? `<span class="hint">Last fill-up: ${fmtDate(lastFuel.date)} · ${money(lastFuel.amount)}${lastFuel.litres ? ' · ' + Number(lastFuel.litres).toFixed(1) + ' L' : ''}${lastFuel.litres ? ' · AED ' + (Number(lastFuel.amount) / Number(lastFuel.litres)).toFixed(2) + '/L' : ''}</span>` : '<span class="hint">No fill-ups logged yet.</span>'}
      ${fuel.length >= 3 ? `<span class="hint">· avg price AED ${avgPricePerL.toFixed(2)}/L</span>` : ''}
    </div>
    ${fuel.length ? fuel.slice(0, 10).map(f => `<div class="row">
      <div class="grow">
        <div class="title">${money(f.amount)}${f.litres ? ' · ' + Number(f.litres).toFixed(1) + ' L' : ''}${f.litres ? ' <span class="chip">AED ' + (Number(f.amount)/Number(f.litres)).toFixed(2) + '/L</span>' : ''}</div>
        <div class="sub">${fmtDate(f.date)}${f.odo ? ' · ' + Number(f.odo).toLocaleString() + ' km' : ''}${f.note ? ' · ' + esc(f.note) : ''}</div>
      </div>
      <button class="btn small danger" onclick="delFuel('${f.id}')">✕</button>
    </div>`).join('') : ''}
    ${fuel.length > 10 ? `<div class="hint" style="padding:8px 0">Showing last 10 of ${fuel.length} entries.</div>` : ''}
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
window.logFuel = () => {
  openForm('Log fuel fill-up ⛽', [
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'amount', label: 'Amount paid (AED)', type: 'number', step: '0.01', required: true },
    { name: 'litres', label: 'Litres (optional)', type: 'number', step: '0.01', placeholder: 'e.g. 40' },
    { name: 'odo', label: 'Odometer km (optional)', type: 'number' },
    { name: 'note', label: 'Note', placeholder: 'e.g. ENOC, ADNOC, full tank' },
  ], d => {
    S.fuelLog = S.fuelLog || [];
    S.fuelLog.push({ id: uid(), date: d.date, amount: Number(d.amount), litres: d.litres ? Number(d.litres) : 0, odo: d.odo ? Number(d.odo) : 0, note: d.note });
    S.expenses.push({ id: uid(), date: d.date, cat: 'Fuel', amount: Number(d.amount), note: d.note || 'Fuel fill-up', payMethod: 'bank' });
  }, 'Log it');
};
window.delFuel = (id) => {
  if (confirm('Delete this fuel entry?')) { S.fuelLog = S.fuelLog.filter(f => f.id !== id); save(); render(); }
};
window.updateSalik = () => {
  const s = S.salik || {};
  openForm('Update Salik balance', [
    { name: 'balance', label: 'Current Salik balance (AED)', type: 'number', step: '0.01', value: s.balance || '', required: true },
    { name: 'threshold', label: 'Warn me when below (AED)', type: 'number', value: s.threshold || 50 },
  ], d => {
    S.salik = { balance: Number(d.balance), date: iso(today()), threshold: Number(d.threshold) || 50 };
  }, 'Save');
};
window.topUpSalik = () => {
  const s = S.salik || {};
  openForm('Top up Salik ⛽', [
    { name: 'amount', label: 'Top-up amount (AED)', type: 'number', step: '0.01', required: true },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
  ], d => {
    S.salik = { ...s, balance: Number(s.balance || 0) + Number(d.amount), date: d.date };
    S.expenses.push({ id: uid(), date: d.date, cat: 'Salik / Parking', amount: Number(d.amount), note: 'Salik top-up', payMethod: 'bank' });
  }, 'Top up');
};

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
let expOffset = 0;
function payLabel(method) {
  return (PAY_METHODS.find(p => p.v === method) || { t: 'Mashreq' }).t;
}
function vExpenses() {
  let p = periodOf(today());
  for (let i = 0; i < expOffset; i++) p = periodOf(new Date(p.start - DAY));
  const list = S.expenses.filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment').sort((a, b) => b.date.localeCompare(a.date));
  const spent = list.reduce((s, e) => s + Number(e.amount), 0);
  const income = S.incomes.filter(i => inPeriod(i.date, p)).reduce((s, i) => s + Number(i.amount), 0);
  const byCat = {};
  for (const e of list) byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount);
  const mashreq = mashreqComputed();
  const accs = S.accounts || {};
  const enbd = Number((accs.enbd_cc || {}).balance || 0);
  const noon = Number((accs.noon_cc || {}).balance || 0);

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="addExpense()">+ Add expense</button>
    <button class="btn" onclick="markSalary()">💰 Salary</button>
    <button class="btn" onclick="setBudgets()">Budgets</button>
    <div class="spacer"></div>
    <button class="btn small" onclick="expOffset++;render()">←</button>
    <span class="hint">${periodLabel(p)}</span>
    <button class="btn small" ${expOffset === 0 ? 'disabled' : ''} onclick="expOffset--;render()">→</button>
  </div>

  <div class="panel">
    <h2>Accounts</h2>
    <div class="row">
      <div class="grow"><div class="title">Mashreq</div><div class="sub">${accs.mashreq && accs.mashreq.balanceDate ? 'anchor: ' + money(accs.mashreq.balance) + ' on ' + fmtDate(accs.mashreq.balanceDate) : 'no starting balance set'}</div></div>
      <span class="amt ${mashreq !== null && mashreq < 0 ? 'neg' : 'pos'}">${mashreq !== null ? money(mashreq) : '—'}</span>
      <button class="btn small" onclick="setMashreqBalance()">Set balance</button>
      <button class="btn small" onclick="reconcile()">Reconcile</button>
    </div>
    <div class="row">
      <div class="grow"><div class="title">ENBD Credit Card</div><div class="sub">outstanding balance</div></div>
      <span class="amt ${enbd > 0 ? 'neg' : ''}">${money(enbd)}</span>
      <button class="btn small" onclick="payCreditCard('enbd_cc')">Pay from Mashreq</button>
      <button class="btn small" onclick="setCCBalance('enbd_cc')">Set balance</button>
    </div>
    <div class="row">
      <div class="grow"><div class="title">NOON Credit Card</div><div class="sub">outstanding balance</div></div>
      <span class="amt ${noon > 0 ? 'neg' : ''}">${money(noon)}</span>
      <button class="btn small" onclick="payCreditCard('noon_cc')">Pay from Mashreq</button>
      <button class="btn small" onclick="setCCBalance('noon_cc')">Set balance</button>
    </div>
  </div>

  <div class="panel">
    <h2>Recurring this month <small>— auto-logged on their due date</small></h2>
    ${(S.recurring || []).map(r => {
      const t = today();
      const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
      const done = S.expenses.some(e => e.recurringId === r.id && e.recurringMonth === monthKey);
      return `<div class="row">
        <div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${money(r.amount)} · ${esc(r.cat)} · day ${r.day} each month</div></div>
        <span class="badge ${done ? 'ok' : 'soon'}">${done ? 'logged' : 'pending'}</span>
        <button class="btn small" onclick="editRecurring('${r.id}')">Edit</button>
      </div>`;
    }).join('')}
    <button class="btn small" style="margin-top:8px" onclick="addRecurring()">+ Add recurring</button>
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
      <div class="grow">
        <div class="title">${esc(e.cat)}${e.recurringId ? ' <span class="chip">auto</span>' : ''}</div>
        <div class="sub">${fmtDate(e.date)} · ${payLabel(e.payMethod)}${e.note ? ' · ' + esc(e.note) : ''}</div>
      </div>
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

window.setMashreqBalance = () => {
  const acc = (S.accounts || {}).mashreq || {};
  openForm('Set Mashreq starting balance', [
    { name: 'balance', label: 'Current balance (AED)', type: 'number', step: '0.01', value: acc.balance || '', required: true },
    { name: 'balanceDate', label: 'As of date', type: 'date', value: acc.balanceDate || iso(today()), required: true },
  ], d => {
    S.accounts = S.accounts || {};
    S.accounts.mashreq = { name: 'Mashreq', type: 'bank', balance: Number(d.balance), balanceDate: d.balanceDate };
  }, 'Set');
};

window.reconcile = () => {
  const computed = mashreqComputed();
  const label = computed !== null ? `App thinks your balance is ${money(computed)}. Enter your actual balance to auto-log the difference as Miscellaneous.` : 'Enter your current Mashreq balance. This sets the anchor.';
  openForm('Reconcile Mashreq balance', [
    { name: 'actual', label: 'Your actual Mashreq balance right now (AED)', type: 'number', step: '0.01', required: true },
    { name: 'date', label: 'As of', type: 'date', value: iso(today()), required: true },
  ], d => {
    const actual = Number(d.actual);
    if (computed !== null) {
      const diff = computed - actual;
      if (Math.abs(diff) > 0.5) {
        S.expenses.push({ id: uid(), date: d.date, cat: 'Other', amount: diff > 0 ? diff : 0, note: diff > 0 ? 'Reconciliation — unlogged spending' : 'Reconciliation — unlogged income', payMethod: 'bank' });
        if (diff < 0) S.incomes.push({ id: uid(), date: d.date, amount: -diff, note: 'Reconciliation — unlogged income' });
      }
    }
    S.accounts = S.accounts || {};
    S.accounts.mashreq = { name: 'Mashreq', type: 'bank', balance: actual, balanceDate: d.date };
  }, 'Reconcile');
};

window.setCCBalance = (ccId) => {
  const names = { enbd_cc: 'ENBD', noon_cc: 'NOON' };
  const current = Number((S.accounts || {})[ccId]?.balance || 0);
  openForm(`Set ${names[ccId]} CC balance`, [
    { name: 'balance', label: 'Outstanding balance (AED)', type: 'number', step: '0.01', value: current, required: true },
  ], d => {
    S.accounts = S.accounts || {};
    S.accounts[ccId] = { ...(S.accounts[ccId] || {}), balance: Number(d.balance), balanceDate: iso(today()) };
  }, 'Set');
};

window.payCreditCard = (ccId) => {
  const acc = (S.accounts || {})[ccId] || {};
  const names = { enbd_cc: 'ENBD', noon_cc: 'NOON' };
  openForm(`Pay ${names[ccId]} CC from Mashreq`, [
    { name: 'amount', label: 'Amount paid (AED)', type: 'number', step: '0.01', value: acc.balance || '', required: true },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
  ], d => {
    const amt = Number(d.amount);
    S.expenses.push({ id: uid(), date: d.date, cat: 'Other', amount: amt, note: `${names[ccId]} CC payment`, payMethod: 'cc_payment' });
    S.accounts = S.accounts || {};
    S.accounts[ccId] = { ...(S.accounts[ccId] || {}), balance: Math.max(0, Number((S.accounts[ccId] || {}).balance || 0) - amt), balanceDate: d.date };
  }, 'Pay');
};

window.addRecurring = () => {
  openForm('Add recurring expense', [
    { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Internet bill' },
    { name: 'amount', label: 'Amount (AED)', type: 'number', required: true },
    { name: 'cat', label: 'Category', type: 'select', value: 'Other', options: EXPENSE_CATS.map(c => ({ v: c, t: c })) },
    { name: 'day', label: 'Day of month to log it', type: 'number', value: 1 },
  ], d => {
    S.recurring = S.recurring || [];
    S.recurring.push({ id: uid(), name: d.name, amount: Number(d.amount), cat: d.cat, day: Number(d.day) || 1, active: true });
  });
};
window.editRecurring = (id) => {
  const r = (S.recurring || []).find(x => x.id === id);
  openForm(`Edit: ${r.name}`, [
    { name: 'name', label: 'Name', value: r.name, required: true },
    { name: 'amount', label: 'Amount (AED)', type: 'number', value: r.amount, required: true },
    { name: 'cat', label: 'Category', type: 'select', value: r.cat, options: EXPENSE_CATS.map(c => ({ v: c, t: c })) },
    { name: 'day', label: 'Day of month to log', type: 'number', value: r.day },
    { name: 'active', label: 'Active', type: 'select', value: r.active ? 'yes' : 'no', options: [{ v: 'yes', t: 'Yes — auto-log every month' }, { v: 'no', t: 'No — paused' }] },
  ], d => Object.assign(r, { name: d.name, amount: Number(d.amount), cat: d.cat, day: Number(d.day) || 1, active: d.active === 'yes' }));
};

window.addExpense = () => {
  openForm('Add expense', [
    { name: 'amount', label: 'Amount (AED)', type: 'number', step: '0.01', required: true },
    { name: 'cat', label: 'Category', type: 'select', value: 'Groceries', options: EXPENSE_CATS.map(c => ({ v: c, t: c })) },
    { name: 'payMethod', label: 'Paid with', type: 'select', value: 'bank', options: PAY_METHODS },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'note', label: 'Note', placeholder: 'optional' },
  ], d => {
    S.expenses.push({ id: uid(), ...d, amount: Number(d.amount) });
    // track CC spend on the card balance
    if (d.payMethod === 'enbd_cc' || d.payMethod === 'noon_cc') {
      S.accounts = S.accounts || {};
      const acc = S.accounts[d.payMethod] || { name: d.payMethod === 'enbd_cc' ? 'ENBD CC' : 'NOON CC', type: 'credit', balance: 0, balanceDate: '' };
      acc.balance = Number(acc.balance || 0) + Number(d.amount);
      acc.balanceDate = d.date;
      S.accounts[d.payMethod] = acc;
    }
  });
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
window.delExpense = (id) => {
  const exp = S.expenses.find(e => e.id === id);
  S.expenses = S.expenses.filter(e => e.id !== id);
  if (exp && (exp.payMethod === 'enbd_cc' || exp.payMethod === 'noon_cc')) {
    S.accounts = S.accounts || {};
    const acc = S.accounts[exp.payMethod] || { balance: 0 };
    acc.balance = Math.max(0, Number(acc.balance || 0) - Number(exp.amount));
    S.accounts[exp.payMethod] = acc;
  }
  save(); render();
};
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
    <button class="btn" onclick="addHomeObligation()">+ Home commitment</button>
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
    <h2>Home commitments <small>— recurring obligations back home</small></h2>
    ${(S.homeObligations || []).length ? (S.homeObligations).map(o => `<div class="row">
      <div class="grow">
        <div class="title">${esc(o.name)}</div>
        <div class="sub">${o.currency ? o.amount + ' ' + esc(o.currency) : money(o.amount)} · ${esc(o.freq)}${o.note ? ' · ' + esc(o.note) : ''}</div>
      </div>
      <button class="btn small" onclick="editHomeObligation('${o.id}')">Edit</button>
      <button class="btn small danger" onclick="delHomeObligation('${o.id}')">✕</button>
    </div>`).join('') : '<div class="empty">No home commitments tracked. Add things like parents\' allowance, LIC premium, property tax.</div>'}
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
window.addHomeObligation = () => {
  openForm('Add home commitment', [
    { name: 'name', label: 'What is it?', required: true, placeholder: 'e.g. Parents allowance, LIC premium' },
    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
    { name: 'currency', label: 'Currency', value: S.settings.remitCurrency || 'INR', placeholder: 'INR, AED, etc.' },
    { name: 'freq', label: 'Frequency', type: 'select', value: 'monthly', options: [{ v: 'monthly', t: 'Monthly' }, { v: 'annual', t: 'Annual' }, { v: 'quarterly', t: 'Quarterly' }, { v: 'as needed', t: 'As needed' }] },
    { name: 'note', label: 'Note', placeholder: 'optional' },
  ], d => {
    S.homeObligations = S.homeObligations || [];
    S.homeObligations.push({ id: uid(), name: d.name, amount: Number(d.amount), currency: d.currency, freq: d.freq, note: d.note });
  });
};
window.editHomeObligation = (id) => {
  const o = (S.homeObligations || []).find(x => x.id === id);
  openForm('Edit home commitment', [
    { name: 'name', label: 'What is it?', value: o.name, required: true },
    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', value: o.amount, required: true },
    { name: 'currency', label: 'Currency', value: o.currency },
    { name: 'freq', label: 'Frequency', type: 'select', value: o.freq, options: [{ v: 'monthly', t: 'Monthly' }, { v: 'annual', t: 'Annual' }, { v: 'quarterly', t: 'Quarterly' }, { v: 'as needed', t: 'As needed' }] },
    { name: 'note', label: 'Note', value: o.note },
  ], d => Object.assign(o, { name: d.name, amount: Number(d.amount), currency: d.currency, freq: d.freq, note: d.note }));
};
window.delHomeObligation = (id) => {
  if (confirm('Delete this commitment?')) { S.homeObligations = (S.homeObligations || []).filter(o => o.id !== id); save(); render(); }
};

window.delRemittance = (id) => {
  if (confirm('Delete this transfer?')) { S.remittances = (S.remittances || []).filter(r => r.id !== id); save(); render(); }
};

// ----- Leave -----
function currentLeaveYear() {
  const joinDate = S.settings.joinDate;
  if (!joinDate) return null;
  const join = parseISO(joinDate);
  const t = today();
  const thisAnniv = new Date(t.getFullYear(), join.getMonth(), join.getDate());
  const start = t >= thisAnniv ? thisAnniv : new Date(t.getFullYear() - 1, join.getMonth(), join.getDate());
  const end = new Date(start.getFullYear() + 1, join.getMonth(), join.getDate() - 1);
  return { start: iso(start), end: iso(end) };
}
function calendarDays(startStr, endStr) {
  return Math.round((parseISO(endStr) - parseISO(startStr)) / DAY) + 1;
}
function workdaysBetween(startStr, endStr) {
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
function leaveEntryDays(entry) {
  return workdaysBetween(entry.startDate, entry.endDate);
}
function vLeave() {
  const yr = currentLeaveYear();
  const ls = S.leaveSettings || { entitlementDays: 30 };
  const logs = [...(S.leaveLog || [])].sort((a, b) => b.startDate.localeCompare(a.startDate));

  const annualTaken = yr ? logs.filter(l => l.type === 'annual' && l.startDate >= yr.start && l.endDate <= yr.end)
    .reduce((s, l) => s + leaveEntryDays(l), 0) : 0;
  const entitlement = ls.entitlementDays || 30;
  const remaining = entitlement - annualTaken;
  const daysInYear = yr ? Math.round((parseISO(yr.end) - parseISO(yr.start)) / DAY) + 1 : 365;
  const daysPassed = yr ? Math.round((today() - parseISO(yr.start)) / DAY) : 0;
  const accrued = Math.min(entitlement, Math.round(entitlement * daysPassed / daysInYear));

  return `
  <div class="toolbar"><button class="btn primary" onclick="logLeave()">+ Log leave</button></div>

  ${yr ? `
  <div class="cards">
    <div class="card"><div class="k">Leave year</div><div class="v" style="font-size:16px">${fmtDate(yr.start)}</div><div class="s">to ${fmtDate(yr.end)}</div></div>
    <div class="card"><div class="k">Entitlement</div><div class="v">${entitlement} days</div><div class="s">accrued so far: ${accrued} days</div></div>
    <div class="card"><div class="k">Annual taken</div><div class="v">${annualTaken} days</div><div class="s">${logs.filter(l => l.type === 'annual' && yr && l.startDate >= yr.start).length} trips this year</div></div>
    <div class="card"><div class="k">Remaining</div><div class="v ${remaining < 5 ? 'neg' : remaining < 10 ? '' : 'pos'}">${remaining} days</div><div class="s">${remaining > 0 ? 'available to use' : 'none left'}</div></div>
  </div>
  <div class="panel">
    <h2>Leave balance <small>— working days only (Mon–Fri)</small></h2>
    <div class="progress"><div style="width:${Math.min(100, annualTaken / entitlement * 100)}%"></div></div>
    <div class="sub">${annualTaken} of ${entitlement} working days used (${Math.round(annualTaken / entitlement * 100)}%)</div>
  </div>` : `<div class="panel"><div class="empty">Set your join date in the Gratuity tab to enable leave tracking.</div></div>`}

  <div class="panel">
    <h2>Leave settings</h2>
    <div class="field"><label>Annual entitlement (days)</label><input id="leaveEnt" type="number" value="${entitlement}"></div>
    <button class="btn primary" onclick="saveLeaveSettings()">Save</button>
  </div>

  <div class="panel">
    <h2>Leave history</h2>
    ${logs.length ? logs.map(l => {
      const wdays = workdaysBetween(l.startDate, l.endDate);
      const cdays = calendarDays(l.startDate, l.endDate);
      return `<div class="row">
        <div class="grow">
          <div class="title">${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} <span class="chip">${esc(l.type)}</span></div>
          <div class="sub">${wdays} working day${wdays !== 1 ? 's' : ''} · ${cdays} calendar day${cdays !== 1 ? 's' : ''}${l.note ? ' · ' + esc(l.note) : ''}</div>
        </div>
        <button class="btn small danger" onclick="delLeave('${l.id}')">✕</button>
      </div>`;
    }).join('') : '<div class="empty">No leave logged yet.</div>'}
  </div>`;
}
window.logLeave = () => {
  openForm('Log leave', [
    { name: 'startDate', label: 'Start date', type: 'date', value: iso(today()), required: true },
    { name: 'endDate', label: 'End date', type: 'date', value: iso(today()), required: true },
    { name: 'type', label: 'Type', type: 'select', value: 'annual', options: [{ v: 'annual', t: 'Annual leave' }, { v: 'sick', t: 'Sick leave' }, { v: 'unpaid', t: 'Unpaid' }, { v: 'other', t: 'Other' }] },
    { name: 'note', label: 'Note', placeholder: 'e.g. Kerala trip, Eid holidays' },
  ], d => {
    S.leaveLog = S.leaveLog || [];
    S.leaveLog.push({ id: uid(), startDate: d.startDate, endDate: d.endDate, type: d.type, note: d.note });
  }, 'Log it');
};
window.saveLeaveSettings = () => {
  S.leaveSettings = S.leaveSettings || {};
  S.leaveSettings.entitlementDays = Number(document.getElementById('leaveEnt').value) || 30;
  save(); render();
};
window.delLeave = (id) => {
  if (confirm('Delete this leave entry?')) { S.leaveLog = S.leaveLog.filter(l => l.id !== id); save(); render(); }
};

// ----- Loans -----
function vLoans() {
  const loans = S.loans || [];
  const payments = S.loanPayments || [];
  const totalEMI = loans.filter(l => l.outstanding > 0).reduce((s, l) => s + Number(l.emi || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => s + Number(l.outstanding || 0), 0);

  return `
  <div class="toolbar"><button class="btn primary" onclick="addLoan()">+ Add loan</button></div>

  ${loans.length ? `
  <div class="cards">
    <div class="card"><div class="k">Total outstanding</div><div class="v ${totalOutstanding > 0 ? 'neg' : ''}">${money(totalOutstanding)}</div><div class="s">${loans.length} loan${loans.length !== 1 ? 's' : ''}</div></div>
    <div class="card"><div class="k">Monthly EMI</div><div class="v">${money(totalEMI)}</div><div class="s">total commitment</div></div>
  </div>` : ''}

  ${loans.length ? loans.map(l => {
    const monthsLeft = l.emi > 0 && l.outstanding > 0 ? Math.ceil(l.outstanding / l.emi) : null;
    const loanPayments = payments.filter(p => p.loanId === l.id).sort((a, b) => b.date.localeCompare(a.date));
    const pct = l.amount > 0 ? Math.min(100, (1 - l.outstanding / l.amount) * 100) : 0;
    return `<div class="panel">
      <h2>${esc(l.name)} <small>${l.outstanding > 0 ? '— active' : '— paid off ✓'}</small></h2>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="sub">${money(l.outstanding)} remaining of ${money(l.amount)} (${Math.round(pct)}% paid)${monthsLeft ? ` · ~${monthsLeft} months left` : ''}</div>
      ${l.emi ? `<div class="sub">EMI: ${money(l.emi)}/month${l.rate ? ` · ${l.rate}% p.a.` : ''}${l.nextPayDate ? ` · next: ${fmtDate(l.nextPayDate)}` : ''}</div>` : ''}
      <div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <button class="btn small primary" onclick="logLoanPayment('${l.id}')">Log payment</button>
        <button class="btn small" onclick="editLoan('${l.id}')">Edit</button>
        <button class="btn small danger" onclick="delLoan('${l.id}')">Delete</button>
      </div>
      ${loanPayments.length ? `<div style="margin-top:8px">${loanPayments.slice(0, 5).map(p => `<div class="row">
        <div class="grow sub">${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div>
        <span class="amt neg">-${money(p.amount)}</span>
      </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="panel"><div class="empty">No loans tracked. Add a personal loan, car loan, or any EMI here.</div></div>'}`;
}
window.addLoan = () => {
  openForm('Add loan', [
    { name: 'name', label: 'Loan name', required: true, placeholder: 'e.g. Car loan, Personal loan' },
    { name: 'amount', label: 'Total borrowed (AED)', type: 'number', step: '0.01', required: true },
    { name: 'outstanding', label: 'Current outstanding (AED)', type: 'number', step: '0.01', required: true },
    { name: 'emi', label: 'Monthly EMI (AED)', type: 'number', step: '0.01' },
    { name: 'rate', label: 'Interest rate (% p.a., optional)', type: 'number', step: '0.01' },
    { name: 'nextPayDate', label: 'Next payment date (optional)', type: 'date' },
    { name: 'note', label: 'Note', placeholder: 'e.g. bank name, purpose' },
  ], d => {
    S.loans = S.loans || [];
    S.loans.push({ id: uid(), name: d.name, amount: Number(d.amount), outstanding: Number(d.outstanding), emi: Number(d.emi) || 0, rate: Number(d.rate) || 0, nextPayDate: d.nextPayDate, note: d.note });
  });
};
window.editLoan = (id) => {
  const l = (S.loans || []).find(x => x.id === id);
  openForm('Edit loan', [
    { name: 'name', label: 'Loan name', value: l.name, required: true },
    { name: 'amount', label: 'Total borrowed (AED)', type: 'number', step: '0.01', value: l.amount, required: true },
    { name: 'outstanding', label: 'Current outstanding (AED)', type: 'number', step: '0.01', value: l.outstanding, required: true },
    { name: 'emi', label: 'Monthly EMI (AED)', type: 'number', step: '0.01', value: l.emi || '' },
    { name: 'rate', label: 'Interest rate (% p.a.)', type: 'number', step: '0.01', value: l.rate || '' },
    { name: 'nextPayDate', label: 'Next payment date', type: 'date', value: l.nextPayDate },
    { name: 'note', label: 'Note', value: l.note },
  ], d => Object.assign(l, { name: d.name, amount: Number(d.amount), outstanding: Number(d.outstanding), emi: Number(d.emi) || 0, rate: Number(d.rate) || 0, nextPayDate: d.nextPayDate, note: d.note }));
};
window.logLoanPayment = (id) => {
  const l = (S.loans || []).find(x => x.id === id);
  openForm(`Log payment — ${l.name}`, [
    { name: 'amount', label: 'Payment amount (AED)', type: 'number', step: '0.01', value: l.emi || '', required: true },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'payMethod', label: 'Paid from', type: 'select', value: 'bank', options: PAY_METHODS },
    { name: 'note', label: 'Note', placeholder: 'optional' },
  ], d => {
    const amt = Number(d.amount);
    S.loanPayments = S.loanPayments || [];
    S.loanPayments.push({ id: uid(), loanId: id, date: d.date, amount: amt, note: d.note });
    l.outstanding = Math.max(0, Number(l.outstanding) - amt);
    // advance next pay date by one month
    if (l.nextPayDate) { const nd = addMonths(parseISO(l.nextPayDate), 1); l.nextPayDate = iso(nd); }
    S.expenses.push({ id: uid(), date: d.date, cat: 'Loan EMI', amount: amt, note: `${l.name} payment`, payMethod: d.payMethod });
    if (d.payMethod === 'enbd_cc' || d.payMethod === 'noon_cc') {
      S.accounts = S.accounts || {};
      const acc = S.accounts[d.payMethod] || { name: d.payMethod === 'enbd_cc' ? 'ENBD CC' : 'NOON CC', type: 'credit', balance: 0, balanceDate: '' };
      acc.balance = Number(acc.balance || 0) + amt;
      acc.balanceDate = d.date;
      S.accounts[d.payMethod] = acc;
    }
  }, 'Log payment');
};
window.delLoan = (id) => {
  if (confirm('Delete this loan and all its payments?')) {
    S.loans = S.loans.filter(l => l.id !== id);
    S.loanPayments = (S.loanPayments || []).filter(p => p.loanId !== id);
    save(); render();
  }
};

// ----- Settings -----
function vSettings() {
  const notifStatus = 'Notification' in window ? Notification.permission : 'unsupported';
  const syncSection = !auth
    ? `<div class="panel">
        <h2>☁️ Cloud Sync</h2>
        <p class="hint" style="margin-bottom:12px">Sign in with Google to sync your data across iPhone and Mac.</p>
        <p class="hint" style="margin-bottom:12px;color:var(--critical)">Firebase not loaded — check internet connection and reload the app.</p>
       </div>`
    : !currentUser
    ? `<div class="panel">
        <h2>☁️ Cloud Sync</h2>
        <p class="hint" style="margin-bottom:12px">Sign in with Google to sync your data across iPhone and Mac.</p>
        <button class="btn primary" onclick="signIn()" style="width:100%;justify-content:center">Sign in with Google</button>
       </div>`
    : `<div class="panel">
        <h2>☁️ Cloud Sync</h2>
        <div class="row"><div class="grow"><div class="title">Signed in</div><div class="sub">${esc(currentUser.email || '')}</div></div><button class="btn small danger" onclick="signOut()">Sign out</button></div>
       </div>`;
  return `
  ${syncSection}
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
async function registerPush() {
  if (!messaging || !currentUser || !db) return;
  try {
    // Register the FCM service worker
    const swReg = await navigator.serviceWorker.register('/my-personal-logger/firebase-messaging-sw.js');
    const token = await messaging.getToken({
      vapidKey: 'BCZvM34wmBVhJo62QH_chz1fJAY5Xk7lwDuahxXcY7pithx_oaTl65pmVgwhYC24yOg32bqtS7rN8UEINxCoPPQ',
      serviceWorkerRegistration: swReg,
    });
    if (token) {
      await db.collection('push_tokens').doc(currentUser.uid).set({
        token,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        ua: navigator.userAgent.slice(0, 100),
      });
    }
  } catch (e) {
    console.log('Push registration:', e.message);
  }
}

window.enableNotifs = async () => {
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    S.settings.notifyEnabled = true; save(); render(); checkAndNotify();
    registerPush();
  } else { render(); }
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

// ---------- Sync UI ----------
let _syncDotTimer;
function setSyncDot(status) {
  const el = document.getElementById('syncDot');
  if (!el) return;
  clearTimeout(_syncDotTimer);
  if (status === 'saving') { el.textContent = ' ↑'; el.title = 'Saving…'; }
  else if (status === 'saved') { el.textContent = ' ✓'; el.title = 'Synced'; _syncDotTimer = setTimeout(() => { el.textContent = ''; }, 2000); }
  else if (status === 'error') { el.textContent = ' ⚠'; el.title = 'Sync failed — will retry on next save'; }
}
function updateSyncUI() {
  const bar = document.getElementById('syncBar');
  if (!bar) return;
  if (!auth) {
    bar.innerHTML = ''; // Firebase not loaded — offline/local mode, no sync button
  } else if (!currentUser) {
    bar.innerHTML = `<button class="btn small" onclick="signIn()">☁ Sign in to sync</button>`;
  } else {
    bar.innerHTML = `<span class="hint"><span id="syncDot"></span> ${esc(currentUser.displayName ? currentUser.displayName.split(' ')[0] : 'synced')}</span> <button class="btn small" onclick="signOut()">Sign out</button>`;
  }
}
window.signIn = () => {
  if (!auth) { alert('Sign-in unavailable — open the app at tijoeie.github.io/my-personal-logger/'); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithRedirect(provider).catch(e => alert('Sign in failed: ' + e.message));
};
window.signOut = () => {
  if (!auth) return;
  if (confirm('Sign out? Your data stays safely in the cloud.')) auth.signOut();
};

// ---------- Auth state ----------
if (auth) auth.onAuthStateChanged((user) => {
  currentUser = user;
  if (unsubscribeSync) { unsubscribeSync(); unsubscribeSync = null; }
  if (user) {
    // Re-register push token on sign-in if notifications already granted
    if (Notification.permission === 'granted') registerPush();
    unsubscribeSync = db.collection('users').doc(user.uid).onSnapshot((snap) => {
      if (snap.exists && snap.data().data) {
        // Only update if remote data differs from what's in memory
        if (snap.data().data !== JSON.stringify(S)) {
          S = Object.assign(emptyState(), JSON.parse(snap.data().data));
          localStorage.setItem(LS_KEY, JSON.stringify(S));
          render();
        }
        setSyncDot('saved');
      } else {
        // First sign-in on this account — push local data up to the cloud
        cloudSync();
      }
    }, (err) => console.error('Firestore listener error:', err));
  }
  updateSyncUI();
  render();
});

render();
checkAndNotify();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
