/* My Personal Logger — UAE life assistant. Entry point. */
import { onSave } from './core/state.js';
import { sync, onSyncChange, schedulePush, startSync } from './core/sync.js';
import { render, renderSyncBar, installGestures } from './ui/shell.js';
import { checkAndNotify } from './views/settings.js';

// Reload when a new build is deployed (version.json is never cached)
function checkVersion(showLabel) {
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version }) => {
      if (showLabel) { document.getElementById('appVersion').textContent = version; renderSyncBar(); }
      const stored = localStorage.getItem('mpl_build');
      localStorage.setItem('mpl_build', version);
      if (stored && stored !== version) location.reload();
    }).catch(() => {});
}

onSave(() => { schedulePush(); renderSyncBar(); });

let notified = false;
onSyncChange(what => {
  if (what === 'status') { renderSyncBar(); return; }
  // Don't redraw under an open form; the next interaction picks the new state up
  if (what === 'state' && document.getElementById('dlg').open) return;
  render();
  if (sync.ready && !notified) { notified = true; checkAndNotify(); }
});

installGestures();
render();
startSync();
checkVersion(true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(false); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
