// App chrome: top nav, bottom tab bar, sync bar, login screen, tab switching.
import { TABS } from '../core/constants.js';
import { undo, redo, undoStack, redoStack } from '../core/state.js';
import { sync, login, logout } from '../core/sync.js';
import { expose } from './form.js';
import { openSheet, compactRows } from './mobile.js';
import { vDashboard } from '../views/dashboard.js';
import { vExpenses } from '../views/expenses.js';
import { vBankFeed } from '../views/bankfeed.js';
import { vRenewals } from '../views/renewals.js';
import { vCar } from '../views/car.js';
import { vVacation } from '../views/vacation.js';
import { vRemittance } from '../views/remittance.js';
import { vIndia } from '../views/india.js';
import { vLeave } from '../views/leave.js';
import { vLoans } from '../views/loans.js';
import { vGratuity } from '../views/gratuity.js';
import { vSettings } from '../views/settings.js';

const VIEWS = {
  dashboard: vDashboard, expenses: vExpenses, bankfeed: vBankFeed, renewals: vRenewals,
  car: vCar, vacation: vVacation, remittance: vRemittance, india: vIndia, leave: vLeave,
  loans: vLoans, gratuity: vGratuity, settings: vSettings,
};
let activeTab = 'dashboard';
const PRIMARY = ['dashboard', 'expenses', 'bankfeed', 'renewals'];

// Floating add button on phones for the most common action
function renderFab() {
  let fab = document.getElementById('fab');
  const show = sync.signedIn && sync.ready && (activeTab === 'dashboard' || activeTab === 'expenses');
  if (!show) { fab?.remove(); return; }
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'fab';
    fab.setAttribute('aria-label', 'Add expense');
    fab.innerHTML = '<i class="ti ti-plus" aria-hidden="true"></i>';
    fab.onclick = () => window.addExpense();
    document.body.appendChild(fab);
  }
}

const syncingScreen = `<div style="padding:40px;text-align:center;color:var(--muted)"><div style="font-size:28px;margin-bottom:12px">☁️</div><div>Syncing your data…</div></div>`;

function loginScreen() {
  return `<div class="panel login-panel">
    <h2>🔐 Sign in</h2>
    <p class="hint">Enter the passphrase for your logger server.</p>
    <form id="loginForm">
      <div class="field"><label>Passphrase</label><input id="loginPass" type="password" autocomplete="current-password" required autofocus></div>
      <div id="loginErr" class="hint neg" style="min-height:18px"></div>
      <button type="submit" class="btn primary">Sign in</button>
    </form>
  </div>`;
}
function wireLogin() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('loginErr');
    err.textContent = '';
    try { await login(document.getElementById('loginPass').value); }
    catch (ex) { err.textContent = ex.message; }
  };
}

export function render() {
  const nav = document.getElementById('nav');
  const bottom = document.getElementById('bottom-nav');
  const main = document.getElementById('main');
  if (!sync.signedIn) {
    nav.innerHTML = ''; bottom.innerHTML = '';
    main.innerHTML = loginScreen();
    wireLogin();
    renderSyncBar();
    return;
  }
  nav.innerHTML = TABS.map(([id, label, icon]) =>
    `<button class="${id === activeTab ? 'active' : ''}" onclick="switchTab('${id}')"><i class="ti ${icon}" aria-hidden="true"></i> ${label}</button>`).join('')
    + `<button class="nav-signout" onclick="signOut()" title="Sign out"><i class="ti ti-logout" aria-hidden="true"></i> Sign out</button>`;
  // Phone bar: the four most used tabs plus More (the rest open in a sheet)
  const inMore = !PRIMARY.includes(activeTab);
  bottom.innerHTML = PRIMARY.map(id => TABS.find(t => t[0] === id)).map(([id, label, icon]) =>
    `<button class="${id === activeTab ? 'active' : ''}" onclick="switchTab('${id}')"><i class="ti ${icon}" aria-hidden="true"></i><span>${label}</span></button>`).join('')
    + `<button class="${inMore ? 'active' : ''}" onclick="openMore()"><i class="ti ${inMore ? TABS.find(t => t[0] === activeTab)[2] : 'ti-dots-circle-horizontal'}" aria-hidden="true"></i><span>${inMore ? TABS.find(t => t[0] === activeTab)[1] : 'More'}</span></button>`;
  // Nothing renders from S until this device has seen the server's copy at least once
  main.innerHTML = sync.ready ? VIEWS[activeTab]() : syncingScreen;
  if (sync.ready) compactRows(main);
  renderFab();
  renderSyncBar();
}

export function renderSyncBar() {
  const bar = document.getElementById('syncBar');
  if (!bar) return;
  if (!sync.signedIn) { bar.innerHTML = ''; return; }
  // Only speak up when something needs attention; a healthy sync shows nothing
  const pill = {
    error: `<span class="sync-pill error">⚠ Sync error</span>`,
    offline: `<span class="sync-pill error">⚠ Offline</span>`,
  }[sync.status] || '';
  bar.innerHTML = `<span class="undo-btns">
    <button class="btn small" title="Undo" onclick="undoAction()" ${undoStack.length === 0 ? 'disabled' : ''}><i class="ti ti-arrow-back-up"></i></button>
    <button class="btn small" title="Redo" onclick="redoAction()" ${redoStack.length === 0 ? 'disabled' : ''}><i class="ti ti-arrow-forward-up"></i></button>
    <button class="btn small" title="Refresh" onclick="refreshApp()"><i class="ti ti-refresh"></i></button>
  </span>${pill}`;
}

export function switchTab(t, dir) {
  const fromIdx = TABS.findIndex(x => x[0] === activeTab);
  const toIdx = TABS.findIndex(x => x[0] === t);
  const direction = dir || (toIdx > fromIdx ? 'left' : 'right');
  activeTab = t;
  render();
  window.scrollTo(0, 0);
  const main = document.getElementById('main');
  main.classList.remove('slide-from-left', 'slide-from-right');
  void main.offsetWidth; // restart the animation
  main.classList.add(direction === 'left' ? 'slide-from-right' : 'slide-from-left');
}

export function installGestures() {
  // Horizontal swipe changes tabs
  let sx = 0, sy = 0, inScroller = false;
  // A swipe that starts on something that scrolls sideways (quick-add chips, wide tables)
  // belongs to that element, not to tab switching.
  const scrollsSideways = el => {
    for (; el && el !== document.body; el = el.parentElement) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  document.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    inScroller = scrollsSideways(e.target);
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!sync.signedIn || inScroller || document.getElementById('dlg').open || document.getElementById('sheet')) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
    const idx = TABS.findIndex(x => x[0] === activeTab);
    const next = dx < 0 ? idx + 1 : idx - 1;
    if (next >= 0 && next < TABS.length) switchTab(TABS[next][0], dx < 0 ? 'left' : 'right');
  }, { passive: true });

  // Prevent double-tap zoom on iOS (alongside touch-action: manipulation)
  let last = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - last < 300) e.preventDefault();
    last = now;
  }, { passive: false });

  window.addEventListener('scroll', () => {
    document.querySelector('header')?.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

expose({
  switchTab,
  openMore() {
    openSheet('', [
      ...TABS.filter(t => !PRIMARY.includes(t[0])).map(([id, label, icon]) => ({ label, icon, active: id === activeTab, onClick: () => switchTab(id) })),
      { label: 'Sign out', icon: 'ti-logout', danger: true, onClick: () => window.signOut() },
    ]);
  },
  undoAction: () => { if (undo()) render(); },
  redoAction: () => { if (redo()) render(); },
  refreshApp: () => location.reload(),
  signOut: () => { if (confirm('Sign out of My Personal Logger?\n\nYour data stays safely on your server.')) logout(); },
});
