// File-backed state store: state.json + sessions.json + daily backups.
// All writes go through one promise chain and land atomically (tmp + rename).
'use strict';

const fs = require('fs');
const path = require('path');

const BACKUPS_KEPT = 14;

function createStore(dataDir) {
  const statePath = path.join(dataDir, 'state.json');
  const sessionsPath = path.join(dataDir, 'sessions.json');
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const readJSON = (p, fallback) => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
  };
  const writeJSON = (p, obj) => {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, p);
  };

  // rev 0 + state null means "never written": the client then pushes its own copy
  let doc = readJSON(statePath, { rev: 0, updatedAt: null, state: null });
  let sessions = readJSON(sessionsPath, {});
  let queue = Promise.resolve();

  function backup() {
    if (!doc.state) return;
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const file = path.join(backupDir, `state-${d}.json`);
    if (!fs.existsSync(file)) writeJSON(file, doc);
    const all = fs.readdirSync(backupDir).filter(f => /^state-\d{8}\.json$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) fs.unlinkSync(path.join(backupDir, f));
  }

  // fn(currentDoc) returns the new state or throws; runs strictly one at a time
  function update(fn) {
    const run = queue.then(() => {
      const state = fn(doc);
      backup();
      doc = { rev: doc.rev + 1, updatedAt: new Date().toISOString(), state };
      writeJSON(statePath, doc);
      return doc;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    get: () => doc,
    update,
    sessions: {
      get: t => sessions[t],
      set(t, v) { sessions[t] = v; writeJSON(sessionsPath, sessions); },
      del(t) { delete sessions[t]; writeJSON(sessionsPath, sessions); },
      prune(maxAgeMs) {
        const cutoff = Date.now() - maxAgeMs;
        let changed = false;
        for (const [t, v] of Object.entries(sessions)) if (v.createdAt < cutoff) { delete sessions[t]; changed = true; }
        if (changed) writeJSON(sessionsPath, sessions);
      },
    },
  };
}

module.exports = { createStore };
