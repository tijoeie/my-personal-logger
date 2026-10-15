/* My Personal Logger — UAE life assistant. Entry point. */
import { onSave } from './core/state.js';
import { sync, onSyncChange, schedulePush, startSync, onServerBuild, flushSync } from './core/sync.js';
import { render, renderSyncBar, installGestures } from './ui/shell.js';
import { checkAndNotify } from './views/settings.js';

// Auto-update: the server fingerprints the app files on every start (deploy). Every API reply
// and version.json carry it; when it changes, finish any pending save, wait until no form is
// open, clear the offline cache and reload, so every device runs the new build.
let knownBuild = null, reloading = false, waiting = false;
async function hardReload() {
  if (reloading) return;
  const dlg = document.getElementById('dlg');
  if (dlg.open || document.getElementById('sheet')) {
    // don't interrupt someone mid-entry; reload right after the form closes (or re-check in a minute)
    if (waiting) return;
    waiting = true;
    const retry = () => { waiting = false; hardReload(); };
    dlg.addEventListener('close', () => setTimeout(retry, 300), { once: true });
    setTimeout(retry, 60000);
    return;
  }
  reloading = true;
  try { await flushSync(); } catch { /* reload anyway; local copy is kept */ }
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* no Cache API */ }
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.update(); } catch { /* no SW */ }
  location.reload();
}
function seenBuild(b) {
  if (!b) return;
  if (!knownBuild) { knownBuild = b; return; }
  if (b !== knownBuild) hardReload();
}
onServerBuild(seenBuild);

function checkVersion() {
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version, build }) => {
      const el = document.getElementById('appVersion');
      if (el && version) { el.textContent = version; renderSyncBar(); }
      seenBuild(build);
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
checkVersion();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
