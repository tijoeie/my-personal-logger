// Server sync: passphrase login, push on save (optimistic concurrency via rev),
// poll every 10 s while visible, three-way merge on conflict.
import { S, replaceState, hadLocalCache } from './state.js';
import { merge3, dedupeRecurring } from './merge.js';

const TOKEN_KEY = 'mpl_token';
const REV_KEY = 'mpl_rev';
const BASE_KEY = 'mpl_base';
const POLL_MS = 10000;

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota or private mode */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export const sync = {
  status: 'idle',          // idle | saving | saved | ok | error | offline
  ready: hadLocalCache,    // false until the first server state has loaded on a fresh device
  signedIn: !!ls.get(TOKEN_KEY),
};

let rev = Number(ls.get(REV_KEY) || 0);
let base = ls.get(BASE_KEY);      // JSON of the last state agreed with the server
let pushing = false, dirty = false, pushTimer = null, pollTimer = null;
let onChange = () => {};          // UI callback: (what) => void, what = 'status' | 'state' | 'auth'

export function onSyncChange(fn) { onChange = fn; }

function setStatus(s) {
  sync.status = s;
  onChange('status');
  if (s === 'saved') setTimeout(() => { if (sync.status === 'saved') { sync.status = 'ok'; onChange('status'); } }, 2000);
}
function setBase(json, r) {
  base = json; rev = r;
  ls.set(BASE_KEY, json); ls.set(REV_KEY, String(r));
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = ls.get(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (res.status === 401 && path !== '/api/login') { signedOut(); throw new Error('signed out'); }
  return res;
}

function signedOut() {
  ls.del(TOKEN_KEY);
  sync.signedIn = false;
  stopPolling();
  onChange('auth');
}

export async function login(passphrase) {
  const res = await api('POST', '/api/login', { passphrase });
  if (res.status === 429) throw new Error('Too many attempts. Wait a minute and try again.');
  if (!res.ok) throw new Error('Wrong passphrase');
  const { token } = await res.json();
  ls.set(TOKEN_KEY, token);
  sync.signedIn = true;
  onChange('auth');
  await pull();
  startPolling();
}

export async function logout() {
  try { await api('POST', '/api/logout'); } catch { /* already gone */ }
  signedOut();
}

const localDirty = () => JSON.stringify(S) !== base;

// Fetch server state and fold it in
export async function pull() {
  if (!sync.signedIn) return;
  let res;
  try { res = await api('GET', `/api/state?since=${base ? rev : -1}`); }
  catch (e) { if (sync.signedIn) setStatus('offline'); return; }
  if (res.status === 304) { if (sync.status === 'offline' || sync.status === 'error') setStatus('ok'); return; }
  if (!res.ok) { setStatus('error'); return; }
  const doc = await res.json();
  adopt(doc);
}

function adopt(doc) {
  if (doc.state === null) {
    // Empty server: this device's copy (or defaults) becomes the first version
    sync.ready = true;
    onChange('state');
    schedulePush(0);
    return;
  }
  const serverJSON = JSON.stringify(doc.state);
  if (!base || !localDirty()) {
    replaceState(doc.state);
    setBase(JSON.stringify(S), doc.rev);
  } else {
    // Unsynced local edits: merge, then push the result
    const merged = dedupeRecurring(merge3(JSON.parse(base), JSON.parse(JSON.stringify(S)), doc.state));
    replaceState(merged);
    setBase(serverJSON, doc.rev);
    schedulePush(0);
  }
  sync.ready = true;
  if (sync.status !== 'saving') setStatus('ok');
  onChange('state');
}

export function schedulePush(delay = 400) {
  if (!sync.signedIn) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, delay);
}

async function push() {
  if (pushing) { dirty = true; return; }
  if (!sync.ready) return;                // never overwrite the server before the first load
  if (base && !localDirty()) return;
  pushing = true; dirty = false;
  setStatus('saving');
  const sent = JSON.stringify(S);
  try {
    const res = await api('PUT', '/api/state', { baseRev: base ? rev : 0, state: JSON.parse(sent) });
    if (res.ok) {
      const { rev: r } = await res.json();
      setBase(sent, r);
      setStatus('saved');
    } else if (res.status === 409) {
      adopt(await res.json());            // merges and re-schedules a push
    } else {
      setStatus('error');
    }
  } catch {
    if (sync.signedIn) setStatus('offline');
  } finally {
    pushing = false;
    if (dirty) schedulePush(0);
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') pull().then(() => { if (localDirty()) schedulePush(0); }); }, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

export function startSync() {
  if (!sync.signedIn) return;
  pull();
  startPolling();
  const refresh = () => { if (document.visibilityState === 'visible') pull(); };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', () => schedulePush(0));
}

// Import / wipe replace everything: push it as the new truth against the current rev
export function forcePush() {
  sync.ready = true;
  schedulePush(0);
}
