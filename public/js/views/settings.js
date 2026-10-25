// Settings: preferences, reminders, reports, backup/restore, account.
import { S, save, replaceState, emptyState } from '../core/state.js';
import { esc, uid, money, today, iso, parseISO, download } from '../core/util.js';
import { INDIAN_BANKS, INDIA_TYPES, CARD_NETWORKS, cardLabel, indiaBalance, indiaLabel, maskIfsc, isValidIfsc } from '../domain/india.js';
import { fmtCur } from './india.js';
import { normalizeKey, bankTextOf } from '../domain/merchants.js';
import { forcePush } from '../core/sync.js';
import { allDueItems } from '../domain/schedule.js';
import { bankBalance, accountName, bankAccounts } from '../domain/finance.js';
import { accountList, displayName, isInUse, newAccountId, PRIMARY, TYPE_LABEL } from '../domain/accounts.js';
import { openForm, expose } from '../ui/form.js';
import { render } from '../ui/shell.js';
import { genMonthlyReport, genYearlyReport, genFullReport } from '../reports/pdf.js';
import { buildExcel } from '../reports/excel.js';

// ---- Accounts & cards ----
function accountsPanel() {
  const rows = accountList(S.accounts, { includeHidden: true }).map(a => {
    let sub = '';
    if (a.type === 'bank') { const b = bankBalance(a.id); sub = b !== null ? `balance ${money(b)}` : 'no balance set'; }
    else if (a.type === 'credit') sub = `outstanding ${money(a.balance || 0)}${a.limit ? ' · limit ' + money(a.limit) : ''}`;
    else sub = `draws from ${esc(accountName(a.linkedTo || PRIMARY))}`;
    if (a.id === PRIMARY) sub += ' · bank feed account';
    const inUse = isInUse(a.id, S);
    return `<div class="row">
      <div class="grow"><div class="title">${esc(displayName(a))} <span class="chip">${TYPE_LABEL[a.type]}</span>${a.hidden ? ' <span class="chip">hidden</span>' : ''}${a.dashboard === false && !a.hidden ? ' <span class="chip">not on dashboard</span>' : ''}</div><div class="sub">${sub}</div></div>
      <button class="btn small" onclick="editAccount('${a.id}')">Edit</button>
      ${a.id === PRIMARY ? '' : `<button class="btn small" onclick="toggleAccountHidden('${a.id}')">${a.hidden ? 'Unhide' : 'Hide'}</button>`}
      ${inUse ? '' : `<button class="btn small danger" onclick="deleteAccount('${a.id}')">Delete</button>`}
    </div>`;
  }).join('');
  return `<div class="panel">
    <h2>Accounts &amp; cards <small>— shown on the dashboard and in every "Paid with" list</small></h2>
    ${rows}
    <div class="toolbar" style="margin:10px 0 0">
      <button class="btn small" onclick="addAccount('bank')">+ Bank account</button>
      <button class="btn small" onclick="addAccount('debit')">+ Debit card</button>
      <button class="btn small" onclick="addAccount('credit')">+ Credit card</button>
    </div>
    <p class="hint" style="margin-top:8px">Only the last 4 digits are stored, never the full card number. Accounts that have transactions can be hidden but not deleted, so your history stays intact.</p>
  </div>`;
}

const YESNO = [{ v: 'yes', t: 'Yes' }, { v: 'no', t: 'No' }];
function accountFields(type, a = {}, isNew = false) {
  const banks = bankAccounts().map(b => ({ v: b.id, t: displayName(b) }));
  return [
    { name: 'name', label: 'Name', value: a.name, required: true, placeholder: type === 'bank' ? 'e.g. ADCB savings' : type === 'credit' ? 'e.g. FAB Cashback' : 'e.g. Mashreq Neo VISA' },
    { name: 'last4', label: 'Last 4 digits (optional)', value: a.last4 || '', placeholder: 'e.g. 2256 — lets bank alerts find this card' },
    ...(type === 'debit' ? [{ name: 'linkedTo', label: 'Draws money from', type: 'select', value: a.linkedTo || PRIMARY, options: banks }] : []),
    ...(type === 'credit' ? [
      { name: 'limit', label: 'Credit limit (AED)', type: 'number', step: '1', value: a.limit || '' },
      ...(isNew ? [{ name: 'balance', label: 'Amount owed right now (AED)', type: 'number', step: '0.01', value: 0 }] : []),
    ] : []),
    ...(type === 'bank' && isNew ? [
      { name: 'balance', label: 'Current balance (AED)', type: 'number', step: '0.01', placeholder: 'optional' },
      { name: 'balanceDate', label: 'As of', type: 'date', value: iso(today()) },
    ] : []),
    { name: 'dashboard', label: 'Show on dashboard', type: 'select', value: a.dashboard === false ? 'no' : 'yes', options: YESNO },
  ];
}
function applyAccount(target, type, d) {
  target.name = d.name.trim();
  target.type = type;
  const last4 = String(d.last4 || '').replace(/\D/g, '').slice(-4);
  if (last4) target.last4 = last4; else delete target.last4;
  if (type === 'debit') target.linkedTo = d.linkedTo || PRIMARY;
  if (type === 'credit') { if (d.limit) target.limit = Number(d.limit); else delete target.limit; }
  if (d.dashboard === 'no') target.dashboard = false; else delete target.dashboard;
  return target;
}

expose({
  addAccount(type) {
    openForm(`Add ${TYPE_LABEL[type].toLowerCase()}`, accountFields(type, {}, true), d => {
      const id = newAccountId(S.accounts, d.name, type);
      const a = applyAccount({}, type, d);
      if (type === 'credit') { a.balance = Number(d.balance) || 0; a.balanceDate = iso(today()); }
      if (type === 'bank' && d.balance !== '') { a.balance = Number(d.balance); a.balanceDate = d.balanceDate || iso(today()); }
      S.accounts[id] = a;
    }, 'Add');
  },
  editAccount(id) {
    const a = S.accounts[id];
    if (!a) return;
    openForm(`Edit ${a.name}`, accountFields(a.type || 'bank', a), d => { applyAccount(a, a.type || 'bank', d); });
  },
  toggleAccountHidden(id) {
    const a = S.accounts[id];
    if (!a || id === PRIMARY) return;
    a.hidden = !a.hidden;
    save(); render();
  },
  deleteAccount(id) {
    if (isInUse(id, S)) { alert('This account has transactions. Hide it instead.'); return; }
    if (!confirm(`Delete ${S.accounts[id].name}?`)) return;
    delete S.accounts[id];
    save(); render();
  },
});

// ---- Indian bank accounts (NRE / NRO / FCNR / savings) ----
function indiaPanel() {
  const rows = (S.indiaAccounts || []).map(a => {
    const bal = indiaBalance(a, S.remittances, S.indiaTxns, parseISO);
    return `<div class="row">
      <div class="grow"><div class="title">${esc(indiaLabel(a))} <span class="chip">${INDIA_TYPES[a.type].label}</span>${a.hidden ? ' <span class="chip">hidden</span>' : ''}</div>
        <div class="sub">${bal !== null ? fmtCur(bal, a.currency) : 'no balance set'}${a.branch ? ' · ' + esc(a.branch) : ''}${a.ifsc ? ' · ' + esc(a.ifsc) : ''}</div></div>
      <button class="btn small" onclick="editIndiaAccount('${a.id}')">Edit</button>
      <button class="btn small" onclick="toggleIndiaHidden('${a.id}')">${a.hidden ? 'Unhide' : 'Hide'}</button>
      ${indiaInUse(a.id) ? '' : `<button class="btn small danger" onclick="deleteIndiaAccount('${a.id}')">Delete</button>`}
    </div>`;
  }).join('') || '<div class="empty">No Indian accounts yet.</div>';
  return `<div class="panel">
    <h2>Indian bank accounts <small>— NRE, NRO, FCNR</small></h2>
    ${rows}
    ${(S.indiaCards || []).length ? '<h2 style="margin-top:16px">Indian cards</h2>' + S.indiaCards.map(c => `<div class="row">
      <div class="grow"><div class="title">${esc(cardLabel(c))}</div><div class="sub">${c.kind === 'debit' ? 'draws from ' + esc(accountLabelFor(c.linkedTo)) : (c.limit ? 'limit ' + fmtCur(c.limit, 'INR') : 'credit card')}${c.note ? ' · ' + esc(c.note) : ''}</div></div>
      <button class="btn small" onclick="editIndiaCard('${c.id}')">Edit</button>
      <button class="btn small danger" onclick="deleteIndiaCard('${c.id}')">Delete</button>
    </div>`).join('') : ''}
    <div class="toolbar" style="margin:10px 0 0"><button class="btn small" onclick="addIndiaAccount()">+ Indian account</button><button class="btn small" onclick="addIndiaCard('debit')">+ Debit card</button><button class="btn small" onclick="addIndiaCard('credit')">+ Credit card</button></div>
    <p class="hint" style="margin-top:8px">Only the last 4 digits of the account number are stored. Balances update from transfers you log in Remittance and from deposits or withdrawals on the India tab.</p>
  </div>`;
}
const accountLabelFor = id => { const a = (S.indiaAccounts || []).find(x => x.id === id); return a ? indiaLabel(a) : 'no account'; };
function cardFields(kind, c = {}) {
  const known = INDIAN_BANKS.includes(c.bank);
  const accs = (S.indiaAccounts || []).map(a => ({ v: a.id, t: indiaLabel(a) }));
  return [
    { name: 'bank', label: 'Bank', type: 'select', value: c.bank ? (known ? c.bank : 'Other') : 'Federal Bank', options: INDIAN_BANKS.map(b => ({ v: b, t: b })) },
    { name: 'otherBank', label: 'Bank name (if Other)', value: c.bank && !known ? c.bank : '' },
    { name: 'last4', label: 'Card last 4 digits (optional)', value: c.last4 || '' },
    { name: 'network', label: 'Network', type: 'select', value: c.network || 'RuPay', options: CARD_NETWORKS.map(n => ({ v: n, t: n })) },
    ...(kind === 'debit' ? [{ name: 'linkedTo', label: 'Draws from account', type: 'select', value: c.linkedTo || (accs[0] || {}).v || '', options: accs.length ? accs : [{ v: '', t: 'Add an Indian account first' }] }]
      : [{ name: 'limit', label: 'Credit limit in ₹ (optional)', type: 'number', step: '1', value: c.limit || '' }]),
    { name: 'note', label: 'Note (optional)', value: c.note || '' },
  ];
}
function applyCard(c, kind, d) {
  c.kind = kind;
  c.bank = d.bank === 'Other' ? (d.otherBank.trim() || 'Other') : d.bank;
  const last4 = String(d.last4 || '').replace(/\D/g, '').slice(-4);
  if (last4) c.last4 = last4; else delete c.last4;
  c.network = d.network;
  if (kind === 'debit') c.linkedTo = d.linkedTo || ''; else if (d.limit) c.limit = Number(d.limit); else delete c.limit;
  c.note = (d.note || '').trim();
  return c;
}
expose({
  addIndiaCard(kind) { openForm(`Add Indian ${kind} card`, cardFields(kind), d => { (S.indiaCards = S.indiaCards || []).push(applyCard({ id: uid() }, kind, d)); }, 'Add'); },
  editIndiaCard(id) { const c = (S.indiaCards || []).find(x => x.id === id); if (c) openForm(`Edit ${cardLabel(c)}`, cardFields(c.kind, c), d => { applyCard(c, c.kind, d); }); },
  deleteIndiaCard(id) { if (confirm('Delete this card?')) { S.indiaCards = (S.indiaCards || []).filter(c => c.id !== id); save(); render(); } },
});

const indiaInUse = id => (S.remittances || []).some(r => r.toIndia === id) || (S.indiaTxns || []).some(t => t.accountId === id);

function indiaFields(a = {}, isNew = false) {
  const known = INDIAN_BANKS.includes(a.bank);
  return [
    { name: 'bank', label: 'Bank', type: 'select', value: a.bank ? (known ? a.bank : 'Other') : 'Federal Bank', options: INDIAN_BANKS.map(b => ({ v: b, t: b })) },
    { name: 'otherBank', label: 'Bank name (if Other)', value: a.bank && !known ? a.bank : '', placeholder: 'e.g. Saraswat Bank' },
    { name: 'type', label: 'Account type', type: 'select', value: a.type || 'NRE', options: Object.entries(INDIA_TYPES).map(([v, x]) => ({ v, t: x.label })) },
    { name: 'currency', label: 'Currency', type: 'select', value: a.currency || 'INR', options: ['INR', 'USD', 'EUR', 'GBP'].map(c => ({ v: c, t: c })) },
    { name: 'last4', label: 'Account no. last 4 digits (optional)', value: a.last4 || '' },
    { name: 'branch', label: 'Branch (optional)', value: a.branch || '', placeholder: 'e.g. Kochi MG Road' },
    { name: 'ifsc', label: 'IFSC (optional)', value: a.ifsc || '', placeholder: 'e.g. FDRL0001234' },
    { name: 'interestRate', label: 'Interest rate % p.a. (optional)', type: 'number', step: '0.01', value: a.interestRate || '' },
    ...(isNew ? [
      { name: 'balance', label: 'Current balance (optional)', type: 'number', step: '0.01' },
      { name: 'balanceDate', label: 'As of', type: 'date', value: iso(today()) },
    ] : []),
    { name: 'dashboard', label: 'Show on dashboard', type: 'select', value: a.dashboard === false ? 'no' : 'yes', options: YESNO },
  ];
}
function applyIndia(a, d) {
  a.bank = d.bank === 'Other' ? (d.otherBank.trim() || 'Other') : d.bank;
  a.type = d.type;
  // FCNR is held in foreign currency; the others are rupee accounts
  a.currency = d.type === 'FCNR' ? (d.currency === 'INR' ? 'USD' : d.currency) : 'INR';
  const last4 = String(d.last4 || '').replace(/\D/g, '').slice(-4);
  if (last4) a.last4 = last4; else delete a.last4;
  a.branch = (d.branch || '').trim();
  const ifsc = maskIfsc(d.ifsc);
  if (ifsc && !isValidIfsc(ifsc)) alert(`IFSC "${ifsc}" doesn't look right (4 letters, 0, then 6 letters or digits). Saved anyway; you can fix it later.`);
  a.ifsc = ifsc;
  if (d.interestRate) a.interestRate = Number(d.interestRate); else delete a.interestRate;
  if (d.dashboard === 'no') a.dashboard = false; else delete a.dashboard;
  return a;
}

expose({
  addIndiaAccount() {
    openForm('Add Indian bank account', indiaFields({}, true), d => {
      const a = applyIndia({ id: uid() }, d);
      if (d.balance !== '' && d.balance != null) { a.balance = Number(d.balance); a.balanceDate = d.balanceDate || iso(today()); }
      (S.indiaAccounts = S.indiaAccounts || []).push(a);
    }, 'Add');
  },
  editIndiaAccount(id) {
    const a = (S.indiaAccounts || []).find(x => x.id === id);
    if (a) openForm(`Edit ${indiaLabel(a)}`, indiaFields(a), d => { applyIndia(a, d); });
  },
  toggleIndiaHidden(id) {
    const a = (S.indiaAccounts || []).find(x => x.id === id);
    if (a) { a.hidden = !a.hidden; save(); render(); }
  },
  deleteIndiaAccount(id) {
    if (indiaInUse(id)) { alert('This account has activity. Hide it instead.'); return; }
    if (!confirm('Delete this account?')) return;
    S.indiaAccounts = (S.indiaAccounts || []).filter(a => a.id !== id);
    save(); render();
  },
});

// Categories the app learned from your corrections (Expenses > Category > Remember this shop)
function shopRulesPanel() {
  const rules = S.merchantRules || [];
  if (!rules.length) return '';
  const count = r => S.expenses.filter(e => e.source === 'n8n' && normalizeKey(bankTextOf(e)) === r.key).length;
  return `<div class="panel">
    <h2>Shop categories <small>— learned from your corrections</small></h2>
    ${rules.map((r, i) => `<div class="row">
      <div class="grow"><div class="title">${esc(r.label || r.key)}</div><div class="sub">always ${esc(r.cat)} · ${count(r)} bank-feed entr${count(r) === 1 ? 'y' : 'ies'}</div></div>
      <button class="btn small danger" onclick="forgetShopRule(${i})">Forget</button>
    </div>`).join('')}
    <p class="hint" style="margin-top:8px">Forgetting a rule keeps today's categories; new alerts from that shop go back to the app's own guess.</p>
  </div>`;
}
expose({
  forgetShopRule(i) {
    const r = (S.merchantRules || [])[i];
    if (!r || !confirm(`Forget the rule for "${r.label || r.key}"?`)) return;
    S.merchantRules.splice(i, 1);
    save(); render();
  },
});

function remindersPanel() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  if (perm === 'granted') {
    return S.settings.notifyEnabled
      ? `<div class="row"><div class="grow"><div class="title">Overdue reminders are ON</div><div class="sub">You'll be alerted on app open when something is due or overdue</div></div><span class="badge ok">on</span></div>
         <div style="margin-top:10px"><button class="btn danger" onclick="disableNotifs()"><i class="ti ti-bell-off"></i> Turn off reminders</button></div>`
      : `<div class="row"><div class="grow"><div class="title">Overdue reminders are OFF</div><div class="sub">Permission is granted — tap to turn on</div></div><span class="badge">off</span></div>
         <div style="margin-top:10px"><button class="btn primary" onclick="enableNotifs()"><i class="ti ti-bell"></i> Turn on reminders</button></div>`;
  }
  if (perm === 'denied') return `<div class="empty">Notifications blocked in your browser settings. On iPhone: Settings → Safari → Notifications → allow this site.</div>`;
  if (perm === 'unsupported') return `<div class="empty">Notifications not supported in this browser. Install the app from Safari to your home screen to enable them.</div>`;
  return `<button class="btn primary" onclick="enableNotifs()">Enable reminders</button>
    <p class="hint" style="margin-top:8px">On iPhone: make sure you've added this app to your home screen first (share → Add to Home Screen), then tap Enable.</p>`;
}

// Today's AED -> INR rate, shown under the rate-alert field once the page is on screen
function showRate() {
  setTimeout(() => {
    const el = document.getElementById('rateNow');
    if (!el) return;
    fetch('/api/rate', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('mpl_token') || '') } }).then(r => r.json())
      .then(j => { el.textContent = j.rate ? `Today: 1 AED = ₹${j.rate.toFixed(2)}` : 'Rate unavailable right now.'; }).catch(() => { el.textContent = 'Rate unavailable right now.'; });
  }, 50);
}

export function vSettings() {
  showRate();
  return `
  <div class="panel">
    <h2>Settings</h2>
    <div class="field"><label>Currency</label><input id="setCur" value="${esc(S.settings.currency)}"></div>
    <div class="field"><label>Salary day of month (a credit that lands a few days early starts the period automatically)</label><input id="setDay" type="number" min="1" max="28" value="${esc(S.settings.salaryDay)}"></div>
    <div class="field"><label>Tell me on Telegram when 1 AED reaches (₹, blank = off)</label><input id="setRate" type="number" step="0.01" min="0" value="${esc(S.settings.rateAlert || '')}"></div>
    <p class="hint" id="rateNow">Checking today's rate…</p>
    <button class="btn primary" onclick="saveSettings()">Save settings</button>
  </div>
  <div class="panel">
    <h2>Glance screen</h2>
    <p class="hint">A small, fast screen with your balance, today's spending, this cycle and days to salary. Open it, then add it to your home screen as its own icon (iPhone: Share → Add to Home Screen).</p>
    <a class="btn primary" href="glance.html" target="_blank" rel="noopener">Open Glance</a>
  </div>
  ${accountsPanel()}
  ${indiaPanel()}
  ${shopRulesPanel()}
  <div class="panel">
    <h2>Reminders</h2>
    <p class="hint">When enabled, the app shows a notification each time you open it if anything is overdue or due within 30 days.</p>
    ${remindersPanel()}
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
    <p class="hint">Your data lives on your own server (with a daily copy kept for 14 days). Export a JSON backup now and then for safekeeping. Importing a backup replaces everything on every device.</p>
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn" onclick="exportData()">⬇ Export backup (JSON)</button>
      <label class="btn" style="display:inline-block;cursor:pointer">⬆ Import backup<input type="file" accept=".json,application/json" style="display:none" onchange="importData(event)"></label>
      <button class="btn danger" onclick="wipeData()">Erase all data</button>
    </div>
  </div>
  <div class="panel">
    <h2>Account</h2>
    <div class="row"><div class="grow"><div class="title">Signed in</div><div class="sub">${esc(location.host)}</div></div></div>
    <div class="field" style="margin-top:10px"><label>Bank feed endpoint <small>— for n8n</small></label>
      <div style="display:flex;gap:6px">
        <input id="ingestField" readonly value="${esc(location.origin + '/api/ingest')}" style="flex:1;font-family:monospace;font-size:12px">
        <button class="btn small" onclick="copyIngest()">Copy</button>
      </div>
    </div>
    <div style="margin-top:10px"><button class="btn danger" onclick="signOut()"><i class="ti ti-logout"></i> Sign out</button></div>
  </div>`;
}

// On-open reminder for anything overdue or due within 30 days
export function checkAndNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !S.settings.notifyEnabled) return;
  const urgent = allDueItems().filter(i => (i.st.cls === 'overdue' || i.st.cls === 'due') && i.ref.notify !== false);
  if (!urgent.length) return;
  const title = urgent.length === 1 ? urgent[0].label : `${urgent.length} items need attention`;
  const body = urgent.slice(0, 3).map(i => `${i.label}: ${i.st.label}`).join('\n');
  try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch { /* iOS needs the SW route; ignore */ }
}

expose({
  saveSettings() {
    S.settings.currency = document.getElementById('setCur').value || 'AED';
    S.settings.salaryDay = Number(document.getElementById('setDay').value) || 25;
    S.settings.rateAlert = Number(document.getElementById('setRate').value) || 0;
    save(); render();
  },
  copyIngest() {
    const el = document.getElementById('ingestField');
    el.select();
    navigator.clipboard?.writeText(el.value).then(() => alert('Endpoint copied')).catch(() => document.execCommand('copy'));
  },
  async enableNotifs() {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') { S.settings.notifyEnabled = true; save(); render(); checkAndNotify(); }
    else render();
  },
  disableNotifs() { S.settings.notifyEnabled = false; save(); render(); },

  exportData() {
    download(`personal-logger-backup-${iso(today())}.json`, new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  },
  importData(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.settings || !Array.isArray(data.expenses)) throw new Error('not a valid backup');
        if (!confirm(`Replace ALL data with this backup?\n\n${data.expenses.length} expenses, ${(data.incomes || []).length} incomes, ${(data.renewals || []).length} renewals.`)) return;
        replaceState(data);
        save();
        forcePush();
        render();
        alert('Backup restored.');
      } catch (e) { alert('Could not import: ' + e.message); }
      finally { ev.target.value = ''; }
    };
    reader.readAsText(f);
  },
  wipeData() {
    if (confirm('Erase ALL data? This cannot be undone.') && confirm('Really sure? Export a backup first if in doubt.')) {
      replaceState(emptyState());
      save();
      forcePush();
      render();
    }
  },

  exportPDF() {
    const ym = iso(today()).slice(0, 7);
    openForm('Generate PDF Report', [
      { name: 'type', label: 'Report type', type: 'select', value: 'monthly', options: [
        { v: 'monthly', t: 'Monthly — one month in detail' },
        { v: 'yearly',  t: 'Yearly — month-by-month summary' },
        { v: 'full',    t: 'Full snapshot — everything' },
      ] },
      { name: 'period', label: 'Period: YYYY-MM for monthly, YYYY for yearly', value: ym, placeholder: 'e.g. 2026-07 or 2026' },
    ], d => {
      try {
        if (d.type === 'monthly') genMonthlyReport(d.period.slice(0, 7));
        else if (d.type === 'yearly') genYearlyReport(d.period.slice(0, 4));
        else genFullReport();
      } catch (e) { alert('PDF error: ' + e.message); }
    }, 'Generate');
  },
  exportExcel() {
    try {
      download(`personal-logger-report-${iso(today())}.xls`, new Blob([buildExcel()], { type: 'application/vnd.ms-excel;charset=utf-8' }));
    } catch (e) { alert('Excel error: ' + e.message); }
  },
});
