/* My Personal Logger — UAE life assistant */
'use strict';

const LS_KEY = 'mpl_v1';
const DAY = 86400000;

// Version auto-update: fetch version.json bypassing SW cache; reload if build changed
(function checkVersion() {
  const stored = localStorage.getItem('mpl_build');
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version }) => {
      const el = document.getElementById('appVersion');
      if (el) el.textContent = version;
      if (stored && stored !== version) {
        localStorage.setItem('mpl_build', version);
        location.reload(true);
      } else {
        localStorage.setItem('mpl_build', version);
      }
    }).catch(() => {});
})();

// Prevent double-tap zoom on iOS (belt-and-suspenders alongside touch-action:manipulation)
;(function(){
  let last = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - last < 300) e.preventDefault();
    last = now;
  }, { passive: false });
})();

// ---------- Firebase ----------
let auth = null, db = null, messaging = null;
let currentUser = null, unsubscribeSync = null;
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
  if (typeof firebase.messaging !== 'undefined') {
    try { messaging = firebase.messaging(); } catch (e) { /* not supported (e.g. HTTP) */ }
  }
}

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
      enbd_cc:  { name: 'ENBD CC',   type: 'credit', balance: 0,    balanceDate: '', limit: 15000 },
      noon_cc:  { name: 'NOON CC',   type: 'credit', balance: 0,    balanceDate: '', limit: 14999 },
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
    leaveSettings: { entitlementDays: 23, carryForward: 0 },
    leaveLog: [],
    loans: [],
    loanPayments: [],
    loansGiven: [],
    loansGivenPayments: [],
    borrowedFromFriends: [],
    borrowedPayments: [],
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
  const bankExp = S.expenses.filter(e => parseISO(e.date) >= since && (e.payMethod === 'bank' || e.payMethod === 'mashreq' || !e.payMethod)).reduce((s, e) => s + Number(e.amount), 0);
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
      S.expenses.push({ id: uid(), date: iso(dueDate), cat: r.cat, amount: r.amount, note: r.name, payMethod: 'bank', recurringId: r.id, recurringMonth: monthKey, createdAt: Date.now() });
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
  dlg.innerHTML = `<h3>${esc(title)}</h3><form id="dlgForm">
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
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    dlg.close();
    onSubmit(data);
    save();
    render();
  };
}

// ---------- rendering ----------
let activeTab = 'dashboard';
const TABS = [
  ['dashboard',  'Dashboard',  'ti-layout-dashboard'],
  ['expenses',   'Expenses',   'ti-receipt'],
  ['renewals',   'Renewals',   'ti-rotate-clockwise'],
  ['car',        'Car',        'ti-car'],
  ['vacation',   'Vacation',   'ti-plane'],
  ['remittance', 'Remittance', 'ti-send'],
  ['leave',      'Leave',      'ti-calendar-event'],
  ['loans',      'Loans',      'ti-credit-card'],
  ['gratuity',   'Gratuity',   'ti-award'],
  ['settings',   'Settings',   'ti-settings'],
];

function render() {
  document.getElementById('nav').innerHTML =
    TABS.map(([id, label, icon]) =>
      `<button class="${id === activeTab ? 'active' : ''}" onclick="switchTab('${id}')"><i class="ti ${icon}" aria-hidden="true"></i> ${label}</button>`).join('')
    + (currentUser
      ? `<button class="nav-signout" onclick="signOut()" title="Sign out"><i class="ti ti-logout" aria-hidden="true"></i> Sign out</button>`
      : `<button class="nav-signout" onclick="signIn()" title="Sign in"><i class="ti ti-cloud" aria-hidden="true"></i> Sign in</button>`);
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
  if (currentUser && !_cloudReady) return `<div style='padding:40px;text-align:center;color:var(--text-muted)'><div style='font-size:28px;margin-bottom:12px'>☁️</div><div>Syncing your data…</div></div>`;
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

  const ccCard = (id, bal, cls) => {
    const acc = accs[id] || {};
    const lim = Number(acc.limit || 0);
    const pct = lim > 0 ? Math.min(100, Math.round(bal / lim * 100)) : 0;
    const avail = lim > 0 ? lim - bal : null;
    const barColor = pct >= 80 ? 'var(--critical)' : pct >= 50 ? 'var(--warning)' : 'var(--series-2)';
    const label = id === 'enbd_cc' ? 'ENBD CC' : 'NOON CC';
    return `<div class="card ${cls}" onclick="setCCBalance('${id}')" style="cursor:pointer">
      <div class="k"><i class="ti ti-credit-card" aria-hidden="true"></i> ${label}</div>
      <div class="v ${bal > 0 ? 'neg' : 'pos'}">${money(bal)}</div>
      ${lim > 0 ? `<div style="height:4px;background:var(--grid);border-radius:3px;margin:5px 0 3px"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width .3s"></div></div>
      <div class="s">${money(avail)} avail · ${pct}% used</div>` : `<div class="s">${bal > 0 ? 'outstanding' : 'all clear'}</div>`}
    </div>`;
  };

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
  <div class="section-lbl">Accounts</div>
  <div class="cards">
    <div class="card card-gray"><div class="k"><i class="ti ti-calendar" aria-hidden="true"></i> Next salary</div><div class="v">${salDays === 0 ? 'Today 🎉' : salDays + ' days'}</div><div class="s">${nextSal.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · sometimes early</div></div>
    <div class="card card-blue"><div class="k"><i class="ti ti-building-bank" aria-hidden="true"></i> Mashreq</div><div class="v ${mashreq !== null && mashreq < 0 ? 'neg' : ''}">${mashreq !== null ? money(mashreq) : '—'}</div>
      <div class="s">${mashreq !== null ? 'current balance' : '<a href="#" onclick="switchTab(\'expenses\');return false">Set starting balance</a>'}</div></div>
    ${ccCard('enbd_cc', enbd, 'card-red')}
    ${ccCard('noon_cc', noon, 'card-purple')}
  </div>

  <div class="section-lbl">This period · ${periodLabel(p)}</div>
  <div class="cards">
    <div class="card ${spent > income ? 'card-red' : 'card-amber'}"><div class="k"><i class="ti ti-arrow-up" aria-hidden="true"></i> Spent</div><div class="v">${money(spent)}</div><div class="s">${income - spent >= 0 ? `<span class="pos">+${money(income - spent)} left</span>` : `<span class="neg">${money(income - spent)} over</span>`}</div></div>
    <div class="card card-green"><div class="k"><i class="ti ti-arrow-down" aria-hidden="true"></i> Income</div><div class="v">${money(income)}</div><div class="s">${periodLabel(p)}</div></div>
    <div class="card card-teal"><div class="k"><i class="ti ti-plane" aria-hidden="true"></i> Vacation fund</div><div class="v">${money(vacSaved)}</div><div class="s">of ${money(vacTarget)} goal</div></div>
    <div class="card ${efMonths !== null ? (efMonths >= efTarget ? 'card-green' : efMonths >= 1 ? 'card-amber' : 'card-red') : 'card-gray'}" title="Based on last 3 periods avg spend${avgMonthlySpend ? ' · avg ' + money(avgMonthlySpend) + '/mo' : ''}">
      <div class="k"><i class="ti ti-shield" aria-hidden="true"></i> Emergency fund</div>
      <div class="v ${efMonths !== null ? (efMonths >= efTarget ? 'pos' : efMonths >= 1 ? '' : 'neg') : ''}">${efMonths !== null ? efMonths.toFixed(1) + ' mo' : '—'}</div>
      <div class="s">goal: ${efTarget} months${totalEMI ? ` · EMI: ${money(totalEMI)}/mo` : ''}</div>
    </div>
  </div>

  ${salikLow || attention.length ? `
  <div class="section-lbl">Needs attention</div>
  ${salikLow ? `<div class="alert-strip warn"><div class="grow"><div class="al-title"><i class="ti ti-road" aria-hidden="true"></i> Salik balance low</div><div class="al-sub">AED ${salik.balance} remaining · top up to avoid fines</div></div><button class="btn small" onclick="switchTab('car')">Top up</button></div>` : ''}
  ${attention.map(i => `<div class="alert-strip${i.st.cls === 'overdue' ? '' : ' warn'}"><div class="grow"><div class="al-title">${esc(i.label)}</div><div class="al-sub">${esc(i.sub)}</div></div><span class="badge ${i.st.cls}">${i.st.label}</span></div>`).join('')}
  ` : `<div class="panel"><div class="empty">Nothing urgent 👌</div></div>`}

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
      const notifyOn = r.notify !== false;
      return `<div class="row">
        <div class="grow">
          <div class="title">${esc(r.title)} <span class="chip">${esc(r.person)}</span> <span class="chip">${esc(r.cat)}</span></div>
          <div class="sub">expires ${fmtDate(r.expiry)} · remind ${r.remindDays}d before</div>${hist}
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
        <button class="btn small ${notifyOn ? 'notify-on' : 'notify-off'}" title="${notifyOn ? 'Push notifications ON — click to turn off' : 'Push notifications OFF — click to turn on'}" onclick="toggleRenewalNotify('${r.id}')"><i class="ti ti-bell${notifyOn ? '' : '-off'}" aria-hidden="true"></i></button>
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
window.toggleRenewalNotify = (id) => {
  const r = S.renewals.find(x => x.id === id);
  if (r) { r.notify = r.notify === false ? true : false; save(); render(); }
};

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
  const list = S.expenses.filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment').sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const isBankPay = e => e.payMethod === 'bank' || e.payMethod === 'mashreq' || e.payMethod === 'cash' || !e.payMethod;
  const isCCPay   = e => e.payMethod === 'enbd_cc' || e.payMethod === 'noon_cc';
  const bankSpent = list.filter(isBankPay).reduce((s, e) => s + Number(e.amount), 0);
  const ccSpent   = list.filter(isCCPay).reduce((s, e) => s + Number(e.amount), 0);
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

  <div class="section-lbl">This period · ${periodLabel(p)}</div>

  <div class="cards">
    <div class="card card-green"><div class="k">Income</div><div class="v">${money(income)}</div><div class="s">this period</div></div>
    <div class="card card-blue"><div class="k">Mashreq spent</div><div class="v">${money(bankSpent)}</div><div class="s">bank &amp; cash only</div></div>
    <div class="card card-purple"><div class="k">CC spent</div><div class="v">${money(ccSpent)}</div><div class="s">ENBD + NOON</div></div>
    <div class="card card-amber"><div class="k">Total out</div><div class="v">${money(bankSpent + ccSpent)}</div><div class="s">bank + CC combined</div></div>
  </div>

  <div class="panel">
    <h2>Expenses <small>— ${list.length} entries</small></h2>
    ${list.length ? list.map(e => `<div class="row">
      <div class="grow">
        <div class="title">${esc(e.cat)}${e.recurringId ? ' <span class="chip">auto</span>' : ''}</div>
        <div class="sub">${fmtDate(e.date)}${e.createdAt ? ' ' + new Date(e.createdAt).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : ''} · ${payLabel(e.payMethod)}${e.note ? ' · ' + esc(e.note) : ''}</div>
      </div>
      <span class="amt">${money(e.amount)}</span>
      <button class="btn small danger" onclick="delExpense('${e.id}')">✕</button>
    </div>`).join('') : '<div class="empty">No expenses this period.</div>'}
  </div>

  <div class="panel">
    <h2>Income <small>— this period</small></h2>
    ${S.incomes.filter(i => inPeriod(i.date, p)).map(i => `<div class="row">
      <div class="grow"><div class="title">${esc(i.note || 'Salary')}</div><div class="sub">${fmtDate(i.date)}</div></div>
      <span class="amt pos">${money(i.amount)}</span>
      <button class="btn small danger" onclick="delIncome('${i.id}')">✕</button>
    </div>`).join('') || '<div class="empty">No income logged this period.</div>'}
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

  <div class="section-lbl">Recurring payments</div>
  <div class="panel">
    ${(S.recurring || []).map(r => {
      const t = today();
      const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
      const done = S.expenses.some(e => e.recurringId === r.id && e.recurringMonth === monthKey);
      return `<div class="row">
        <div class="grow"><div class="title">${esc(r.name)}</div><div class="sub">${money(r.amount)} · ${esc(r.cat)} · day ${r.day} each month</div></div>
        <span class="badge ${done ? 'ok' : 'soon'}">${done ? 'logged' : 'pending'}</span>
        <button class="btn small" onclick="editRecurring('${r.id}')">Edit</button>
      </div>`;
    }).join('') || '<div class="empty">No recurring payments set up.</div>'}
    <div style="margin-top:8px"><button class="btn small" onclick="addRecurring()">+ Add recurring</button></div>
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
  const acc = (S.accounts || {})[ccId] || {};
  const current = Number(acc.balance || 0);
  const currentLimit = Number(acc.limit || 0);
  openForm(`Set ${names[ccId]} CC balance`, [
    { name: 'balance', label: 'Outstanding balance (AED)', type: 'number', step: '0.01', value: current, required: true },
    { name: 'limit', label: 'Credit limit (AED)', type: 'number', step: '1', value: currentLimit || '' },
  ], d => {
    S.accounts = S.accounts || {};
    const upd = { ...(S.accounts[ccId] || {}), balance: Number(d.balance), balanceDate: iso(today()) };
    if (d.limit) upd.limit = Number(d.limit);
    S.accounts[ccId] = upd;
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
    S.expenses.push({ id: uid(), ...d, amount: Number(d.amount), createdAt: Date.now() });
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
  const t = today();
  const yr = t.getFullYear();
  return { start: `${yr}-01-01`, end: `${yr}-12-31`, year: yr };
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
  const ls = S.leaveSettings || { entitlementDays: 23, carryForward: 0 };
  const logs = [...(S.leaveLog || [])].sort((a, b) => b.startDate.localeCompare(a.startDate));

  const entitlement = ls.entitlementDays || 23;
  const carryFwd = Number(ls.carryForward) || 0;
  const totalAvailable = entitlement + carryFwd;

  const annualTaken = logs.filter(l => l.type === 'annual' && l.startDate >= yr.start && l.endDate <= yr.end)
    .reduce((s, l) => s + leaveEntryDays(l), 0);
  const remaining = totalAvailable - annualTaken;

  const daysPassed = Math.round((today() - parseISO(yr.start)) / DAY);
  const accrued = Math.min(entitlement, Math.round(entitlement * daysPassed / 365));

  return `
  <div class="toolbar"><button class="btn primary" onclick="logLeave()">+ Log leave</button></div>

  <div class="cards">
    <div class="card"><div class="k">Leave year</div><div class="v" style="font-size:16px">${yr.year}</div><div class="s">Jan 1 – Dec 31</div></div>
    <div class="card"><div class="k">Entitlement</div><div class="v">${entitlement} days${carryFwd > 0 ? ` <span style="font-size:13px;color:var(--series-2)">+${carryFwd} c/f</span>` : ''}</div><div class="s">accrued so far: ${accrued} days</div></div>
    <div class="card"><div class="k">Annual taken</div><div class="v">${annualTaken} days</div><div class="s">${logs.filter(l => l.type === 'annual' && l.startDate >= yr.start).length} trips this year</div></div>
    <div class="card"><div class="k">Remaining</div><div class="v ${remaining < 5 ? 'neg' : remaining < 10 ? '' : 'pos'}">${remaining} days</div><div class="s">${remaining > 0 ? 'available to use' : 'none left'}</div></div>
  </div>
  <div class="panel">
    <h2>Leave balance <small>— working days only (Mon–Fri)</small></h2>
    <div class="progress"><div style="width:${Math.min(100, annualTaken / totalAvailable * 100)}%"></div></div>
    <div class="sub">${annualTaken} of ${totalAvailable} days used (${Math.round(annualTaken / totalAvailable * 100)}%)${carryFwd > 0 ? ` · includes ${carryFwd} carried forward from ${yr.year - 1}` : ''}</div>
  </div>

  <div class="panel">
    <h2>Leave settings</h2>
    <div class="field"><label>Annual entitlement (working days)</label><input id="leaveEnt" type="number" value="${entitlement}"></div>
    <div class="field"><label>Carry forward from previous year (working days, max 10)</label><input id="leaveCF" type="number" min="0" max="10" value="${carryFwd}"></div>
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
  S.leaveSettings.entitlementDays = Number(document.getElementById('leaveEnt').value) || 23;
  S.leaveSettings.carryForward = Math.min(10, Math.max(0, Number(document.getElementById('leaveCF').value) || 0));
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
  const borrowed = S.borrowedFromFriends || [];
  const borrowedPaid = id => (S.borrowedPayments || []).filter(p => p.bId === id).reduce((s, p) => s + Number(p.amount), 0);
  const totalBorrowed = borrowed.reduce((s, b) => s + Math.max(0, Number(b.total) - borrowedPaid(b.id)), 0);

  return `
  <div class="toolbar"><button class="btn primary" onclick="addLoan()">+ Add loan</button></div>

  ${(loans.length || borrowed.length) ? `
  <div class="cards">
    <div class="card"><div class="k">Loans outstanding</div><div class="v ${totalOutstanding > 0 ? 'neg' : ''}">${money(totalOutstanding)}</div><div class="s">${loans.length} loan${loans.length !== 1 ? 's' : ''}</div></div>
    <div class="card"><div class="k">Monthly EMI</div><div class="v">${money(totalEMI)}</div><div class="s">total commitment</div></div>
    ${borrowed.length ? `<div class="card"><div class="k">Owe to friends</div><div class="v ${totalBorrowed > 0 ? 'neg' : ''}">${money(totalBorrowed)}</div><div class="s">${borrowed.length} entr${borrowed.length !== 1 ? 'ies' : 'y'}</div></div>` : ''}
  </div>` : ''}

  <div class="section-lbl">Borrowed from friends</div>
  <div class="toolbar"><button class="btn primary" onclick="addBorrowed()">+ Add borrowed</button></div>
  ${(S.borrowedFromFriends || []).length ? (S.borrowedFromFriends || []).map(b => {
    const bPays = (S.borrowedPayments || []).filter(p => p.bId === b.id).sort((a, b2) => b2.date.localeCompare(a.date));
    const amtPaid = bPays.reduce((s, p) => s + Number(p.amount), 0);
    const amtLeft = Math.max(0, Number(b.total) - amtPaid);
    const pct = b.total > 0 ? Math.min(100, Math.round(amtPaid / b.total * 100)) : 0;
    const isInstalment = Number(b.monthly || 0) > 0;
    const paidCount = bPays.length;
    const totalMonths = Number(b.months || 0);
    const done = amtLeft <= 0;
    return `<div class="panel">
      <h2>${esc(b.name)} <small>— ${done ? 'fully repaid ✓' : money(amtLeft) + ' remaining'}</small></h2>
      <div class="progress"><div style="width:${pct}%;background:var(--critical)"></div></div>
      <div class="sub">${money(amtPaid)} repaid of ${money(b.total)} · ${pct}% done${b.note ? ' · ' + esc(b.note) : ''}</div>
      ${isInstalment ? `<div class="sub">${money(b.monthly)}/month · ${paidCount}${totalMonths ? '/' + totalMonths : ''} payments${b.dueDate ? ' · due ' + fmtDate(b.dueDate) : ''}</div>` : (b.dueDate ? `<div class="sub">One-shot · due ${fmtDate(b.dueDate)}</div>` : '')}
      ${!done ? `<div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <button class="btn small primary" onclick="logBorrowedPayment('${b.id}')">Log repayment</button>
        <button class="btn small" onclick="editBorrowed('${b.id}')">Edit</button>
        <button class="btn small danger" onclick="delBorrowed('${b.id}')">Delete</button>
      </div>` : `<div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <button class="btn small" onclick="editBorrowed('${b.id}')">Edit</button>
        <button class="btn small danger" onclick="delBorrowed('${b.id}')">Delete</button>
      </div>`}
      ${bPays.length ? `<div style="margin-top:8px">${bPays.map(p => `<div class="row">
        <div class="grow sub">${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div>
        <span class="amt neg" style="margin-right:8px">-${money(p.amount)}</span>
        <button class="btn small danger" onclick="delBorrowedPayment('${p.id}')">✕</button>
      </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="panel"><div class="empty">No borrowed money tracked. Add when you borrow from a friend.</div></div>'}

  <div class="section-lbl">Money owed to me</div>
  <div class="toolbar"><button class="btn primary" onclick="addLoanGiven()">+ Add receivable</button></div>
  ${(S.loansGiven || []).length ? (S.loansGiven || []).map(g => {
    const gPayments = (S.loansGivenPayments || []).filter(p => p.gId === g.id).sort((a, b) => b.date.localeCompare(a.date));
    const totalMonths = Number(g.months || 0);
    const paidCount = gPayments.length;
    const remaining = Math.max(0, totalMonths - paidCount);
    const amtPaid = gPayments.reduce((s, p) => s + Number(p.amount), 0);
    const amtLeft = Math.max(0, Number(g.total) - amtPaid);
    const pct = g.total > 0 ? Math.min(100, Math.round(amtPaid / g.total * 100)) : 0;
    const lastPay = gPayments[0];
    return `<div class="panel">
      <h2>${esc(g.name)} <small>— ${remaining === 0 ? 'fully received ✓' : remaining + ' months left'}</small></h2>
      <div class="progress"><div style="width:${pct}%;background:var(--series-2)"></div></div>
      <div class="sub">${money(amtPaid)} received of ${money(g.total)} · ${pct}% done${remaining > 0 ? ` · ${money(amtLeft)} remaining` : ''}</div>
      ${g.monthly ? `<div class="sub">AED ${money(g.monthly)}/month · ${paidCount}/${totalMonths} payments${g.note ? ' · ' + esc(g.note) : ''}</div>` : ''}
      ${lastPay ? `<div class="sub" style="color:var(--muted)">Last received: ${fmtDate(lastPay.date)}</div>` : '<div class="sub" style="color:var(--warning)">No payments logged yet</div>'}
      <div class="toolbar" style="margin-top:10px;margin-bottom:0">
        <button class="btn small primary" onclick="logLoanGivenPayment('${g.id}')">Log received</button>
        <button class="btn small" onclick="editLoanGiven('${g.id}')">Edit</button>
        <button class="btn small danger" onclick="delLoanGiven('${g.id}')">Delete</button>
      </div>
      ${gPayments.length ? `<div style="margin-top:8px">${gPayments.map(p => `<div class="row">
        <div class="grow sub">${fmtDate(p.date)}${p.note ? ' · ' + esc(p.note) : ''}</div>
        <span class="amt pos" style="margin-right:8px">+${money(p.amount)}</span>
        <button class="btn small danger" onclick="delLoanGivenPayment('${p.id}','${g.id}')">✕</button>
      </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="panel"><div class="empty">No receivables. Track money friends or family owe you.</div></div>'}

  <div class="section-lbl">My loans &amp; EMIs</div>
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
    S.expenses.push({ id: uid(), date: d.date, cat: 'Loan EMI', amount: amt, note: `${l.name} payment`, payMethod: d.payMethod, createdAt: Date.now() });
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

// ----- Loans given (receivables) -----
window.addLoanGiven = () => {
  openForm('Add receivable', [
    { name: 'name', label: 'Label (e.g. Eby — Phone EMI)', required: true },
    { name: 'total', label: 'Total amount (AED)', type: 'number', step: '0.01', required: true },
    { name: 'monthly', label: 'Monthly instalment (AED)', type: 'number', step: '0.01' },
    { name: 'months', label: 'Number of months', type: 'number', step: '1' },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'note', label: 'Note (e.g. ENBD CC 0% EMI)', placeholder: 'optional' },
  ], d => {
    S.loansGiven = S.loansGiven || [];
    S.loansGiven.push({ id: uid(), name: d.name, total: Number(d.total), monthly: Number(d.monthly) || 0, months: Number(d.months) || 0, startDate: d.startDate, note: d.note });
  });
};
window.editLoanGiven = (id) => {
  const g = (S.loansGiven || []).find(x => x.id === id);
  if (!g) return;
  openForm('Edit receivable', [
    { name: 'name', label: 'Label', required: true, value: g.name },
    { name: 'total', label: 'Total amount (AED)', type: 'number', step: '0.01', value: g.total },
    { name: 'monthly', label: 'Monthly instalment (AED)', type: 'number', step: '0.01', value: g.monthly },
    { name: 'months', label: 'Number of months', type: 'number', step: '1', value: g.months },
    { name: 'note', label: 'Note', value: g.note },
  ], d => {
    g.name = d.name; g.total = Number(d.total); g.monthly = Number(d.monthly) || 0; g.months = Number(d.months) || 0; g.note = d.note;
  });
};
window.logLoanGivenPayment = (id) => {
  const g = (S.loansGiven || []).find(x => x.id === id);
  if (!g) return;
  openForm('Log received payment', [
    { name: 'amount', label: 'Amount received (AED)', type: 'number', step: '0.01', value: g.monthly || '', required: true },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'note', label: 'Note', placeholder: 'optional' },
  ], d => {
    S.loansGivenPayments = S.loansGivenPayments || [];
    S.loansGivenPayments.push({ id: uid(), gId: id, date: d.date, amount: Number(d.amount), note: d.note });
  }, 'Log');
};
window.delLoanGivenPayment = (pid, gId) => {
  if (confirm('Remove this payment record?')) {
    S.loansGivenPayments = (S.loansGivenPayments || []).filter(p => p.id !== pid);
    save(); render();
  }
};
window.delLoanGiven = (id) => {
  if (confirm('Delete this receivable and all its payment records?')) {
    S.loansGiven = (S.loansGiven || []).filter(g => g.id !== id);
    S.loansGivenPayments = (S.loansGivenPayments || []).filter(p => p.gId !== id);
    save(); render();
  }
};

// ----- Borrowed from friends -----
window.addBorrowed = () => {
  openForm('Borrow from friend', [
    { name: 'name', label: 'Borrowed from (name)', required: true, placeholder: 'e.g. Arun, George' },
    { name: 'total', label: 'Total amount (AED)', type: 'number', step: '0.01', required: true },
    { name: 'monthly', label: 'Monthly repayment (AED, 0 = one-shot)', type: 'number', step: '0.01', value: '0' },
    { name: 'months', label: 'Number of months (0 = one-shot)', type: 'number', step: '1', value: '0' },
    { name: 'dueDate', label: 'Repay by date (optional)', type: 'date' },
    { name: 'note', label: 'Note / purpose', placeholder: 'e.g. emergency, event expenses' },
  ], d => {
    S.borrowedFromFriends = S.borrowedFromFriends || [];
    S.borrowedFromFriends.push({ id: uid(), name: d.name, total: Number(d.total), monthly: Number(d.monthly) || 0, months: Number(d.months) || 0, dueDate: d.dueDate, note: d.note });
  });
};
window.editBorrowed = (id) => {
  const b = (S.borrowedFromFriends || []).find(x => x.id === id);
  if (!b) return;
  openForm('Edit borrowed', [
    { name: 'name', label: 'Borrowed from', required: true, value: b.name },
    { name: 'total', label: 'Total amount (AED)', type: 'number', step: '0.01', value: b.total },
    { name: 'monthly', label: 'Monthly repayment (AED, 0 = one-shot)', type: 'number', step: '0.01', value: b.monthly || 0 },
    { name: 'months', label: 'Number of months', type: 'number', step: '1', value: b.months || 0 },
    { name: 'dueDate', label: 'Repay by date', type: 'date', value: b.dueDate || '' },
    { name: 'note', label: 'Note', value: b.note || '' },
  ], d => {
    b.name = d.name; b.total = Number(d.total); b.monthly = Number(d.monthly) || 0;
    b.months = Number(d.months) || 0; b.dueDate = d.dueDate; b.note = d.note;
  });
};
window.logBorrowedPayment = (id) => {
  const b = (S.borrowedFromFriends || []).find(x => x.id === id);
  if (!b) return;
  const paid = (S.borrowedPayments || []).filter(p => p.bId === id).reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(b.total) - paid);
  openForm(`Repay — ${b.name}`, [
    { name: 'amount', label: 'Amount paid (AED)', type: 'number', step: '0.01', value: b.monthly || remaining, required: true },
    { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    { name: 'payMethod', label: 'Paid from', type: 'select', value: 'bank', options: PAY_METHODS },
    { name: 'note', label: 'Note', placeholder: 'optional' },
  ], d => {
    const amt = Number(d.amount);
    S.borrowedPayments = S.borrowedPayments || [];
    S.borrowedPayments.push({ id: uid(), bId: id, date: d.date, amount: amt, note: d.note });
    S.expenses.push({ id: uid(), date: d.date, cat: 'Repayment', amount: amt, note: `Repay ${b.name}`, payMethod: d.payMethod, createdAt: Date.now() });
    if (d.payMethod === 'enbd_cc' || d.payMethod === 'noon_cc') {
      S.accounts = S.accounts || {};
      const acc = S.accounts[d.payMethod] || { name: d.payMethod === 'enbd_cc' ? 'ENBD CC' : 'NOON CC', type: 'credit', balance: 0, balanceDate: '' };
      acc.balance = Number(acc.balance || 0) + amt;
      acc.balanceDate = d.date;
      S.accounts[d.payMethod] = acc;
    }
  }, 'Log repayment');
};
window.delBorrowedPayment = (pid) => {
  if (confirm('Remove this repayment record?')) {
    S.borrowedPayments = (S.borrowedPayments || []).filter(p => p.id !== pid);
    save(); render();
  }
};
window.delBorrowed = (id) => {
  if (confirm('Delete this entry and all its repayment records?')) {
    S.borrowedFromFriends = S.borrowedFromFriends.filter(b => b.id !== id);
    S.borrowedPayments = (S.borrowedPayments || []).filter(p => p.bId !== id);
    save(); render();
  }
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
      ? S.settings.notifyEnabled
        ? `<div class="row"><div class="grow"><div class="title">Overdue reminders are ON</div><div class="sub">You'll be alerted on app open when something is due or overdue</div></div><span class="badge ok">on</span></div>
           <div style="margin-top:10px"><button class="btn danger" onclick="disableNotifs()"><i class="ti ti-bell-off"></i> Turn off reminders</button></div>`
        : `<div class="row"><div class="grow"><div class="title">Overdue reminders are OFF</div><div class="sub">Permission is granted — tap to turn on</div></div><span class="badge">off</span></div>
           <div style="margin-top:10px"><button class="btn primary" onclick="enableNotifs()"><i class="ti ti-bell"></i> Turn on reminders</button></div>`
      : notifStatus === 'denied'
      ? `<div class="empty">Notifications blocked in your browser settings. On iPhone: Settings → Safari → Notifications → allow this site.</div>`
      : notifStatus === 'unsupported'
      ? `<div class="empty">Notifications not supported in this browser. Install the app from Safari to your home screen to enable them.</div>`
      : `<button class="btn primary" onclick="enableNotifs()">Enable reminders</button>
         <p class="hint" style="margin-top:8px">On iPhone: make sure you've added this app to your home screen first (share → Add to Home Screen), then tap Enable.</p>`
    }
  </div>
  <div class="panel">
    <h2>Export report</h2>
    <p class="hint">Download a comprehensive report of all your data — accounts, expenses, renewals, loans, car services, and leave.</p>
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn primary" onclick="exportPDF()">📄 PDF Report</button>
      <button class="btn" onclick="exportExcel()">📊 Excel (.xls)</button>
    </div>
    <p class="hint" style="margin-top:8px">PDF opens a print dialog — choose "Save as PDF". Excel downloads a multi-sheet .xls file.</p>
  </div>
  <div class="panel">
    <h2>Backup &amp; restore</h2>
    <p class="hint">Your data lives only in this browser. Export a backup regularly — especially before clearing browser data or switching devices.</p>
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn" onclick="exportData()">⬇ Export backup (JSON)</button>
      <label class="btn" style="display:inline-block;cursor:pointer">⬆ Import backup<input type="file" accept=".json" style="display:none" onchange="importData(event)"></label>
      <button class="btn danger" onclick="wipeData()">Erase all data</button>
    </div>
  </div>
  <div class="panel" id="accountPanel">
    <h2>Account</h2>
    ${currentUser
      ? `<div class="row"><div class="grow"><div class="title">${esc(currentUser.displayName || 'Signed in')}</div><div class="sub">${esc(currentUser.email || '')}</div></div></div>
         <div style="margin-top:10px"><button class="btn danger" onclick="signOut()"><i class="ti ti-logout"></i> Sign out</button></div>`
      : `<button class="btn primary" onclick="signIn()"><i class="ti ti-cloud"></i> Sign in with Google</button>`}
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
window.disableNotifs = () => {
  S.settings.notifyEnabled = false; save(); render();
};
function checkAndNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!S.settings.notifyEnabled) return;
  const urgent = allDueItems().filter(i => (i.st.cls === 'overdue' || i.st.cls === 'due') && i.ref.notify !== false);
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
// ---- PDF report helpers ----

function _buildReportOverlay(title, bodyHTML) {
  if (!document.getElementById('_pstyle')) {
    const st = document.createElement('style');
    st.id = '_pstyle';
    st.textContent = '@media print{body>*:not(#_preport){display:none!important}#_preport{position:static!important;overflow:visible!important;height:auto!important;background:#fff!important}.rpt-toolbar{display:none!important}}';
    document.head.appendChild(st);
  }
  const old = document.getElementById('_preport');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = '_preport';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#1a1a1a;line-height:1.6';
  overlay.innerHTML = `
    <div class="rpt-toolbar" style="position:sticky;top:0;background:#fff;border-bottom:2px solid #1a1a1a;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:1">
      <span style="font-size:12px;color:#555;letter-spacing:.02em">${esc(title)}</span>
      <div style="display:flex;gap:8px">
        <button onclick="window.print()" style="font:600 12px/1 system-ui;background:#1a1a1a;color:#fff;border:none;border-radius:4px;padding:8px 14px;cursor:pointer">Print / Save PDF</button>
        <button onclick="document.getElementById('_preport').remove()" style="font:600 12px/1 system-ui;background:#f0f0f0;color:#333;border:1px solid #ddd;border-radius:4px;padding:8px 12px;cursor:pointer">✕</button>
      </div>
    </div>
    <div style="max-width:640px;margin:0 auto;padding:32px 28px 64px">${bodyHTML}</div>`;
  document.body.appendChild(overlay);
}

function _rptMon(n) {
  return 'AED ' + Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _rptCard(label, val, sub, isPositive) {
  const valColor = isPositive === false ? '#b91c1c' : isPositive === true ? '#15803d' : '#1a1a1a';
  return `<div style="padding:14px 16px;border:1px solid #ddd;background:#fff">
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#999;margin-bottom:5px">${label}</div>
    <div style="font-size:17px;font-weight:700;color:${valColor}">${val}</div>
    ${sub ? `<div style="font-size:11px;color:#bbb;margin-top:2px">${sub}</div>` : ''}
  </div>`;
}

function _rptSection(title, content) {
  return `<div style="margin-bottom:28px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #e8e8e8">${title}</div>
    ${content}
  </div>`;
}

function _rptRow(l, r, bold, rColor) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid #f4f4f4;${bold ? 'font-weight:600' : ''}">
    <span style="color:#555;font-size:12px">${l}</span>
    <span style="font-size:12px;${rColor ? 'color:' + rColor : 'color:#1a1a1a'}">${r}</span>
  </div>`;
}

function _rptCatBars(items) {
  const max = items[0]?.[1] || 1;
  return `<table style="width:100%;border-collapse:collapse;font-size:12px">
    ${items.map(([cat, amt], i) => `
    <tr style="border-bottom:1px solid #f4f4f4">
      <td style="padding:7px 0;width:130px;color:#444">${esc(cat)}</td>
      <td style="padding:7px 12px;vertical-align:middle">
        <div style="height:6px;background:#f0f0f0;border-radius:1px">
          <div style="height:100%;width:${Math.round(amt / max * 100)}%;background:#1a1a1a;border-radius:1px;opacity:${Math.max(0.25, 1 - i * 0.07)}"></div>
        </div>
      </td>
      <td style="padding:7px 0;text-align:right;font-weight:600;color:#1a1a1a;white-space:nowrap;width:120px">${_rptMon(amt)}</td>
    </tr>`).join('')}
  </table>`;
}

function _genMonthlyPDF(ym) {
  const [yr, mo] = ym.split('-').map(Number);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleString('en-GB', { month: 'long' });
  const isBankPay = e => e.payMethod === 'bank' || e.payMethod === 'mashreq' || e.payMethod === 'cash' || !e.payMethod;
  const isCCPay   = e => e.payMethod === 'enbd_cc' || e.payMethod === 'noon_cc';

  const allExps = (S.expenses || []).filter(e => e.date && e.date.startsWith(ym) && e.payMethod !== 'cc_payment');
  const allIncs = (S.incomes || []).filter(i => i.date && i.date.startsWith(ym));
  const bankExps = allExps.filter(isBankPay);
  const ccExps   = allExps.filter(isCCPay);
  const totalIncome = allIncs.reduce((s, i) => s + Number(i.amount), 0);
  const totalBank   = bankExps.reduce((s, e) => s + Number(e.amount), 0);
  const totalCC     = ccExps.reduce((s, e) => s + Number(e.amount), 0);
  const net = totalIncome - totalBank;

  const catMap = {};
  allExps.forEach(e => { catMap[e.cat] = (catMap[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  const expList = allExps.sort((a, b) => b.date.localeCompare(a.date)).map(e => `
    <div style="display:flex;justify-content:space-between;padding:7px 14px;border-bottom:1px solid #f2f1ec;font-size:12px">
      <div>
        <span style="font-weight:600">${esc(e.cat)}</span>
        ${e.note ? `<span style="color:#888"> · ${esc(e.note)}</span>` : ''}
        <span style="color:#bbb;margin-left:6px">${e.date}</span>
      </div>
      <span style="${isCCPay(e) ? 'color:#7F77DD' : 'color:#111'};font-weight:700">${_rptMon(e.amount)}</span>
    </div>`).join('') || `<div style="padding:14px;color:#aaa">No expenses recorded</div>`;

  const incList = allIncs.map(i => _rptRow(
    `${esc(i.note || 'Salary')} <span style="color:#ccc;font-size:11px">${i.date}</span>`,
    `<span style="color:#1baf7a">+${_rptMon(i.amount)}</span>`
  )).join('') || `<div style="padding:14px;color:#aaa">No income recorded</div>`;

  const body = `
    <div style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.08em">${yr} · Monthly Report</div>
      <div style="font-size:32px;font-weight:800;color:#111;margin:2px 0">${monthLabel}</div>
      <div style="font-size:12px;color:#aaa">Generated ${iso(today())}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:24px">
      ${_rptCard('Income', _rptMon(totalIncome), `${allIncs.length} entr${allIncs.length===1?'y':'ies'}`, true)}
      ${_rptCard('Bank & Cash spent', _rptMon(totalBank), `${bankExps.length} transactions`, null)}
      ${_rptCard('CC spent', _rptMon(totalCC), 'ENBD + NOON', null)}
      ${_rptCard('Net (income − bank)', _rptMon(net), net >= 0 ? 'surplus' : 'deficit', net >= 0 ? true : false)}
    </div>
    ${cats.length ? _rptSection('Spending by category', _rptCatBars(cats)) : ''}
    ${_rptSection('All expenses', expList)}
    ${_rptSection('Income', incList)}`;

  _buildReportOverlay(`${monthLabel} ${yr} — Monthly Report`, body);
}

function _genYearlyPDF(year) {
  const isBankPay = e => e.payMethod === 'bank' || e.payMethod === 'mashreq' || e.payMethod === 'cash' || !e.payMethod;
  const isCCPay   = e => e.payMethod === 'enbd_cc' || e.payMethod === 'noon_cc';

  const allExps = (S.expenses || []).filter(e => e.date && e.date.startsWith(year + '-') && e.payMethod !== 'cc_payment');
  const allIncs = (S.incomes || []).filter(i => i.date && i.date.startsWith(year + '-'));
  const totalIncome = allIncs.reduce((s, i) => s + Number(i.amount), 0);
  const totalBank   = allExps.filter(isBankPay).reduce((s, e) => s + Number(e.amount), 0);
  const totalCC     = allExps.filter(isCCPay).reduce((s, e) => s + Number(e.amount), 0);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthData = MONTHS.map((name, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    const mE = allExps.filter(e => e.date.startsWith(ym));
    const mI = allIncs.filter(x => x.date.startsWith(ym));
    return { name, income: mI.reduce((s, x) => s + Number(x.amount), 0), bank: mE.filter(isBankPay).reduce((s, e) => s + Number(e.amount), 0), cc: mE.filter(isCCPay).reduce((s, e) => s + Number(e.amount), 0) };
  });

  const catMap = {};
  allExps.forEach(e => { catMap[e.cat] = (catMap[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  const monthTable = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:#f2f1ec">
      <th style="text-align:left;padding:8px 14px;font-weight:700;color:#555">Month</th>
      <th style="text-align:right;padding:8px 10px;font-weight:700;color:#1baf7a">Income</th>
      <th style="text-align:right;padding:8px 10px;font-weight:700;color:#2a78d6">Bank</th>
      <th style="text-align:right;padding:8px 10px;font-weight:700;color:#7F77DD">CC</th>
      <th style="text-align:right;padding:8px 14px;font-weight:700;color:#555">Net</th>
    </tr></thead>
    <tbody>
      ${monthData.map(m => {
        const net = m.income - m.bank;
        const has = m.income > 0 || m.bank > 0 || m.cc > 0;
        return `<tr style="border-bottom:1px solid #f2f1ec${!has ? ';opacity:.35' : ''}">
          <td style="padding:7px 14px;font-weight:600">${m.name}</td>
          <td style="padding:7px 10px;text-align:right;color:#1baf7a">${m.income > 0 ? _rptMon(m.income) : '—'}</td>
          <td style="padding:7px 10px;text-align:right;color:#2a78d6">${m.bank > 0 ? _rptMon(m.bank) : '—'}</td>
          <td style="padding:7px 10px;text-align:right;color:#7F77DD">${m.cc > 0 ? _rptMon(m.cc) : '—'}</td>
          <td style="padding:7px 14px;text-align:right;font-weight:700;color:${net >= 0 ? '#1baf7a' : '#d03b3b'}">${has ? (net >= 0 ? '+' : '') + _rptMon(net) : '—'}</td>
        </tr>`;
      }).join('')}
      <tr style="background:#111;color:#fff;font-weight:700">
        <td style="padding:9px 14px">Total</td>
        <td style="padding:9px 10px;text-align:right;color:#4de84d">${_rptMon(totalIncome)}</td>
        <td style="padding:9px 10px;text-align:right;color:#80b8f0">${_rptMon(totalBank)}</td>
        <td style="padding:9px 10px;text-align:right;color:#b0abee">${_rptMon(totalCC)}</td>
        <td style="padding:9px 14px;text-align:right;color:${totalIncome - totalBank >= 0 ? '#4de84d' : '#f29a9a'}">${(totalIncome - totalBank >= 0 ? '+' : '') + _rptMon(totalIncome - totalBank)}</td>
      </tr>
    </tbody></table>`;

  const body = `
    <div style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.08em">Annual Report</div>
      <div style="font-size:36px;font-weight:800;color:#111;margin:2px 0">${year}</div>
      <div style="font-size:12px;color:#aaa">Generated ${iso(today())}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:24px">
      ${_rptCard('Total income', _rptMon(totalIncome), `${allIncs.length} entries`, true)}
      ${_rptCard('Total bank/cash', _rptMon(totalBank), 'from Mashreq', null)}
      ${_rptCard('Total CC spent', _rptMon(totalCC), 'ENBD + NOON', null)}
      ${_rptCard('Net (income − bank)', _rptMon(totalIncome - totalBank), totalIncome - totalBank >= 0 ? 'surplus' : 'deficit', totalIncome - totalBank >= 0 ? true : false)}
    </div>
    ${_rptSection('Month by month', monthTable)}
    ${cats.length ? _rptSection('Top spending categories', _rptCatBars(cats)) : ''}`;

  _buildReportOverlay(`${year} — Annual Report`, body);
}

function _genFullPDF() {
  const d = iso(today());
  const accs = S.accounts || {};
  const enbd = Number((accs.enbd_cc || {}).balance || 0);
  const noon = Number((accs.noon_cc || {}).balance || 0);
  const enbdLim = Number((accs.enbd_cc || {}).limit || 0);
  const noonLim = Number((accs.noon_cc || {}).limit || 0);
  const mashreq = mashreqComputed();
  const p = periodOf(today());

  const isBankPay = e => e.payMethod === 'bank' || e.payMethod === 'mashreq' || e.payMethod === 'cash' || !e.payMethod;
  const isCCPay   = e => e.payMethod === 'enbd_cc' || e.payMethod === 'noon_cc';
  const periodExps = (S.expenses || []).filter(e => inPeriod(e.date, p) && e.payMethod !== 'cc_payment');
  const bankSpent  = periodExps.filter(isBankPay).reduce((s, e) => s + Number(e.amount), 0);
  const ccSpent    = periodExps.filter(isCCPay).reduce((s, e) => s + Number(e.amount), 0);

  const catMap = {};
  periodExps.forEach(e => { catMap[e.cat] = (catMap[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  const renewalRows = (S.renewals || []).map(r => {
    const st = r.expiry ? statusOf(daysUntil(r.expiry), r.remindDays) : { label: '—' };
    const stColor = { 'OK': '#1baf7a', 'Due soon': '#e08b17', 'Overdue': '#d03b3b' }[st.label] || '#888';
    return _rptRow(esc(r.title), r.expiry ? `${fmtDate(r.expiry)} <span style="color:${stColor};font-weight:700">${st.label}</span>` : '—');
  }).join('') || `<div style="padding:14px;color:#aaa">No renewals tracked</div>`;

  const svcRows = (S.serviceTypes || []).map(t => {
    const last = (S.serviceLog || []).filter(l => l.type === t.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    return _rptRow(esc(t.name), last ? `Last: ${fmtDate(last.date)}` : 'No record');
  }).join('') || `<div style="padding:14px;color:#aaa">No service types</div>`;

  const loanRows = (S.loans || []).filter(l => l.outstanding > 0).map(l =>
    _rptRow(esc(l.name), `${_rptMon(l.outstanding)} outstanding · EMI ${money(l.emi)}/mo`)
  ).join('') || `<div style="padding:14px;color:#aaa">No active loans</div>`;

  const givenRows = (S.loansGiven || []).map(g => {
    const paid = (S.loansGivenPayments || []).filter(p => p.gId === g.id).reduce((s, p) => s + Number(p.amount), 0);
    return _rptRow(esc(g.name), `${_rptMon(Math.max(0, g.total - paid))} remaining of ${money(g.total)}`);
  }).join('') || `<div style="padding:14px;color:#aaa">Nothing owed</div>`;

  const ly = currentLeaveYear();
  const leaveSettings = S.leaveSettings || {};
  const entitlement = Number(leaveSettings.entitlementDays || 23);
  const carry = Math.min(10, Number(leaveSettings.carryForward || 0));
  const totalLeave = entitlement + carry;
  const taken = (S.leaveLog || []).filter(l => l.date >= ly.start && l.date <= ly.end).reduce((s, l) => s + Number(l.days || 1), 0);

  const enbdPct = enbdLim > 0 ? Math.round(enbd / enbdLim * 100) : 0;
  const noonPct = noonLim > 0 ? Math.round(noon / noonLim * 100) : 0;
  const ccBarColor = pct => pct >= 80 ? '#d03b3b' : pct >= 50 ? '#e08b17' : '#2a78d6';

  const ccBar = (lbl, bal, lim, pct) => `<div style="padding:10px 14px;border-bottom:1px solid #f2f1ec">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px">
      <span style="font-weight:600">${lbl}</span>
      <span style="font-weight:700">${_rptMon(bal)} ${lim ? `<span style="font-weight:400;color:#888">/ ${_rptMon(lim)}</span>` : ''}</span>
    </div>
    ${lim ? `<div style="height:6px;background:#f2f1ec;border-radius:3px"><div style="height:100%;width:${pct}%;background:${ccBarColor(pct)};border-radius:3px"></div></div>` : ''}
  </div>`;

  const body = `
    <div style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.08em">Full Snapshot</div>
      <div style="font-size:28px;font-weight:800;color:#111;margin:2px 0">My Personal Logger</div>
      <div style="font-size:12px;color:#aaa">Generated ${d}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:24px">
      ${_rptCard('Mashreq Bank', mashreq !== null ? _rptMon(mashreq) : '—', 'computed balance', null)}
      ${_rptCard('Period bank spend', _rptMon(bankSpent), 'this pay cycle', null)}
      ${_rptCard('Period CC spend', _rptMon(ccSpent), 'ENBD + NOON', null)}
      ${_rptCard('Leave remaining', `${totalLeave - taken} days`, `${taken} taken of ${totalLeave}`, null)}
    </div>
    ${_rptSection('Credit cards',
      ccBar('ENBD CC', enbd, enbdLim, enbdPct) + ccBar('NOON CC', noon, noonLim, noonPct))}
    ${cats.length ? _rptSection('This period — by category', _rptCatBars(cats)) : ''}
    ${_rptSection('Renewals', renewalRows)}
    ${_rptSection('Car services', svcRows)}
    ${_rptSection('My loans & EMIs', loanRows)}
    ${_rptSection('Money owed to me', givenRows)}
    ${_rptSection('Vacation savings', (S.vacations || []).map(v => {
      const saved = (v.contribs || []).reduce((s, c) => s + Number(c.amount), 0);
      const pct = v.budget > 0 ? Math.min(100, Math.round(saved / v.budget * 100)) : 0;
      return `<div style="padding:10px 14px;border-bottom:1px solid #f2f1ec">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px">
          <span style="font-weight:600">${esc(v.name || '—')}</span>
          <span style="font-weight:700">${_rptMon(saved)} <span style="font-weight:400;color:#888">/ ${_rptMon(v.budget || 0)}</span></span>
        </div>
        <div style="height:6px;background:#f2f1ec;border-radius:3px"><div style="height:100%;width:${pct}%;background:#8c6aa0;border-radius:3px"></div></div>
      </div>`;
    }).join('') || `<div style="padding:14px;color:#aaa">No vacations planned</div>` )}`;

  _buildReportOverlay('Full Snapshot Report', body);
}

window.exportPDF = () => { try {
  const todayYM = iso(today()).slice(0, 7);
  const todayY  = iso(today()).slice(0, 4);
  openForm('Generate PDF Report', [
    { name: 'type', label: 'Report type', type: 'select', value: 'monthly', options: [
      { v: 'monthly', t: 'Monthly — one month in detail' },
      { v: 'yearly',  t: 'Yearly — month-by-month summary' },
      { v: 'full',    t: 'Full snapshot — everything' },
    ]},
    { name: 'period', label: 'Period: YYYY-MM for monthly, YYYY for yearly', value: todayYM, placeholder: 'e.g. 2026-07 or 2026' },
  ], d => { try {
    if (d.type === 'monthly')     _genMonthlyPDF(d.period.slice(0, 7));
    else if (d.type === 'yearly') _genYearlyPDF(d.period.slice(0, 4));
    else                          _genFullPDF();
  } catch(e) { alert('PDF error: ' + e.message); }}, 'Generate');
} catch(e) { alert('PDF error: ' + e.message); } };

window.exportExcel = () => { try {
  const d = iso(today());
  const accs = S.accounts || {};
  const enbd = Number((accs.enbd_cc || {}).balance || 0);
  const noon = Number((accs.noon_cc || {}).balance || 0);
  const mashreq = mashreqComputed();

  const sheet = (name, rows) => `<Worksheet ss:Name="${name}"><Table>${rows.join('')}</Table></Worksheet>`;
  const hrow = (...cols) => cols.map(c => `<Cell ss:StyleID="h"><Data ss:Type="String">${String(c ?? '').replace(/</g, '&lt;')}</Data></Cell>`).join('');
  const drow = (...cols) => '<Row>' + cols.map(c => `<Cell><Data ss:Type="${typeof c === 'number' ? 'Number' : 'String'}">${String(c ?? '').replace(/</g, '&lt;')}</Data></Cell>`).join('') + '</Row>';
  const hdr = (...cols) => '<Row>' + hrow(...cols) + '</Row>';

  // Expenses sheet
  const expRows = [hdr('Date', 'Category', 'Amount (AED)', 'Note', 'Pay Method'),
    ...(S.expenses || []).sort((a, b) => b.date.localeCompare(a.date)).map(e =>
      drow(e.date, e.cat, Number(e.amount), e.note || '', e.payMethod || ''))];

  // Renewals sheet
  const renRows = [hdr('Name', 'Expiry', 'Status', 'Remind Days', 'Notes'),
    ...(S.renewals || []).map(r => drow(r.title, r.expiry || '', r.expiry ? statusOf(daysUntil(r.expiry), r.remindDays).label : '—', r.remindDays || 60, r.note || ''))];

  // Loans sheet
  const loanRows = [hdr('Name', 'Total (AED)', 'Outstanding (AED)', 'EMI/month', 'Rate %', 'Note'),
    ...(S.loans || []).map(l => drow(l.name, Number(l.amount), Number(l.outstanding), Number(l.emi), Number(l.rate || 0), l.note || ''))];

  // Receivables sheet
  const givenRows = [hdr('Name', 'Total (AED)', 'Monthly (AED)', 'Months', 'Amount Received', 'Remaining', 'Note'),
    ...(S.loansGiven || []).map(g => {
      const paid = (S.loansGivenPayments || []).filter(p => p.gId === g.id).reduce((s, p) => s + Number(p.amount), 0);
      return drow(g.name, Number(g.total), Number(g.monthly || 0), Number(g.months || 0), paid, Math.max(0, g.total - paid), g.note || '');
    })];

  // Accounts summary sheet
  const accRows = [hdr('Account', 'Balance (AED)', 'Limit (AED)', 'As of'),
    drow('Mashreq Bank', mashreq ?? '', '', ''),
    drow('ENBD CC', enbd, Number((accs.enbd_cc || {}).limit || 0), (accs.enbd_cc || {}).balanceDate || ''),
    drow('NOON CC', noon, Number((accs.noon_cc || {}).limit || 0), (accs.noon_cc || {}).balanceDate || '')];

  // Car service log sheet
  const carRows = [hdr('Type', 'Date', 'Mileage', 'Note'),
    ...(S.serviceLog || []).sort((a, b) => b.date.localeCompare(a.date)).map(l => {
      const t = (S.serviceTypes || []).find(x => x.id === l.type);
      return drow(t ? t.name : l.type, l.date, l.mileage || '', l.note || '');
    })];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style>
</Styles>
${sheet('Accounts', accRows)}
${sheet('Expenses', expRows)}
${sheet('Renewals', renRows)}
${sheet('Loans', loanRows)}
${sheet('Receivables', givenRows)}
${sheet('Car Services', carRows)}
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `personal-logger-report-${d}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 200);
} catch(e) { alert('Excel error: ' + e.message); } };

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
let _syncDotTimer, _syncStatus = 'idle';
let _cloudReady = !!localStorage.getItem(LS_KEY);
function setSyncDot(status) {
  _syncStatus = status;
  _renderSyncBar();
  clearTimeout(_syncDotTimer);
  if (status === 'saved') _syncDotTimer = setTimeout(() => { _syncStatus = 'ok'; _renderSyncBar(); }, 2000);
}
function _renderSyncBar() {
  const bar = document.getElementById('syncBar');
  if (!bar) return;
  if (!currentUser) {
    bar.innerHTML = `<button class="btn small" onclick="signIn()"><i class="ti ti-cloud"></i> Sign in</button>`;
    return;
  }
  const name = esc(currentUser.displayName ? currentUser.displayName.split(' ')[0] : 'You');
  const ver = document.getElementById('appVersion')?.textContent?.trim() || '';
  const dot = _syncStatus === 'saving'
    ? `<span class="sync-pill syncing">↑ Syncing${ver ? ' · ' + ver : ''}</span>`
    : _syncStatus === 'error'
    ? `<span class="sync-pill error">⚠ Sync error${ver ? ' · ' + ver : ''}</span>`
    : `<span class="sync-pill ok">● ${name}${ver ? ' · ' + ver : ''}</span>`;
  bar.innerHTML = dot;
}
function updateSyncUI() { _renderSyncBar(); render(); }
window.signIn = () => {
  if (!auth) { alert('Sign-in unavailable — open the app at tijoeie.github.io/my-personal-logger/'); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(e => alert('Sign in failed: ' + e.message));
};
window.signOut = () => {
  if (!auth) return;
  if (confirm('Sign out of My Personal Logger?\n\nYour data stays safely in the cloud.')) auth.signOut();
};

// ---------- Auth state ----------
if (auth) auth.onAuthStateChanged((user) => {
  currentUser = user;
  if (unsubscribeSync) { unsubscribeSync(); unsubscribeSync = null; }
  if (user) {
    // Re-register push token on sign-in if notifications already granted
    if (Notification.permission === 'granted') registerPush();
    _cloudReady = !!localStorage.getItem(LS_KEY);
    unsubscribeSync = db.collection('users').doc(user.uid).onSnapshot((snap) => {
      if (snap.exists && snap.data().data) {
        // Only update if remote data differs from what's in memory
        if (snap.data().data !== JSON.stringify(S)) {
          S = Object.assign(emptyState(), JSON.parse(snap.data().data));
          localStorage.setItem(LS_KEY, JSON.stringify(S));
        }
        _cloudReady = true;
        render();
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
updateSyncUI();
checkAndNotify();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Re-check version when user switches back to the app from background
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const stored = localStorage.getItem('mpl_build');
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(({ version }) => {
        if (stored && stored !== version) {
          localStorage.setItem('mpl_build', version);
          location.reload(true);
        }
      }).catch(() => {});
  }
});
