// Settings: preferences, reminders, reports, backup/restore, account.
import { S, save, replaceState, emptyState } from '../core/state.js';
import { esc, today, iso, download } from '../core/util.js';
import { forcePush } from '../core/sync.js';
import { allDueItems } from '../domain/schedule.js';
import { openForm, expose } from '../ui/form.js';
import { render } from '../ui/shell.js';
import { genMonthlyReport, genYearlyReport, genFullReport } from '../reports/pdf.js';
import { buildExcel } from '../reports/excel.js';

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

export function vSettings() {
  return `
  <div class="panel">
    <h2>Settings</h2>
    <div class="field"><label>Currency</label><input id="setCur" value="${esc(S.settings.currency)}"></div>
    <div class="field"><label>Salary day of month</label><input id="setDay" type="number" min="1" max="28" value="${esc(S.settings.salaryDay)}"></div>
    <button class="btn primary" onclick="saveSettings()">Save settings</button>
  </div>
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
