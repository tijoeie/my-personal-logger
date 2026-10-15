// Three-way merge used when the server moved on (e.g. a bank-feed ingest) while
// this device had unsynced edits. base = last state both sides agreed on.
//  - arrays of {id}: merged per item; local adds/edits/deletes win, server adds are kept
//  - plain objects: merged per key, recursively
//  - anything else: local wins if it changed since base, otherwise server
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdArray = v => Array.isArray(v) && v.every(x => isObj(x) && typeof x.id === 'string');

export function merge3(base, local, server) {
  if (same(local, base)) return server;
  if (same(server, base)) return local;
  if (isIdArray(local) && isIdArray(server) && (base === undefined || isIdArray(base))) {
    return mergeIdArrays(base || [], local, server);
  }
  if (isObj(local) && isObj(server)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(server), ...Object.keys(local)])) {
      const inL = k in local, inS = k in server, inB = k in b;
      if (inL && inS) out[k] = merge3(b[k], local[k], server[k]);
      else if (inL && !(inB && same(local[k], b[k]))) out[k] = local[k];          // added or edited locally
      else if (inS && !(inB && same(server[k], b[k]))) out[k] = server[k];        // added or edited on server
      // otherwise: deleted on one side and untouched on the other -> stays deleted
    }
    return out;
  }
  return local;
}

// Two devices can each auto-log the same recurring payment for a cycle before they
// sync; after a merge keep one entry per (recurringId, recurringMonth), preferring
// the one the bank feed already tagged.
export function dedupeRecurring(state) {
  const keep = new Map();
  for (const e of state.expenses || []) {
    if (!e.recurringId || !e.recurringMonth) continue;
    const k = e.recurringId + '|' + e.recurringMonth;
    const cur = keep.get(k);
    if (!cur || (e.source === 'n8n' && cur.source !== 'n8n')) keep.set(k, e);
  }
  state.expenses = (state.expenses || []).filter(e =>
    !e.recurringId || !e.recurringMonth || keep.get(e.recurringId + '|' + e.recurringMonth) === e);
  return state;
}

function mergeIdArrays(base, local, server) {
  const byId = arr => new Map(arr.map(x => [x.id, x]));
  const B = byId(base), L = byId(local);
  const out = [];
  const seen = new Set();
  for (const s of server) {
    seen.add(s.id);
    const l = L.get(s.id), b = B.get(s.id);
    if (l) out.push(b ? merge3(b, l, s) : l);
    else if (!b) out.push(s);                       // new on server
    else if (!same(s, b)) out.push(s);              // deleted locally but edited on server: keep
    // else deleted locally -> drop
  }
  for (const l of local) {
    if (seen.has(l.id)) continue;
    const b = B.get(l.id);
    if (!b) out.push(l);                            // new locally
    else if (!same(l, b)) out.push(l);              // edited locally, deleted on server: keep
  }
  return out;
}
