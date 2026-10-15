// One-off maintenance for bank-feed entries. Run with the server STOPPED (it keeps state in memory):
//   docker compose stop logger
//   docker compose run --rm --no-deps logger node server/tools/fix-feed.js
//   docker compose start logger
// 1. Gives every bank-feed expense still on "Other" a category guessed from its shop name.
// 2. If DATA_DIR/fixes.json exists ({fixes:[{date,amount,note,createdAt}], anchorAt}), restores the real
//    email times on entries that were replayed later than they arrived, then deletes that file.
// A copy of the state is kept as backups/pre-fix-<epoch>.json, and rev is bumped so open devices reload.
'use strict';

const fs = require('fs');
const path = require('path');
const { categorize } = require('../categorize');

const dir = path.resolve(process.env.DATA_DIR || '/data');
const statePath = path.join(dir, 'state.json');
const fixesPath = path.join(dir, 'fixes.json');
const doc = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const S = doc.state;

fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
fs.writeFileSync(path.join(dir, 'backups', `pre-fix-${Date.now()}.json`), JSON.stringify(doc));

// 1. categories
const changed = {};
for (const e of S.expenses) {
  if (e.source !== 'n8n' || e.cat !== 'Other') continue;
  const cat = categorize(e.note);
  if (cat) { e.cat = cat; changed[cat] = (changed[cat] || 0) + 1; }
}

// 2. times
let retimed = 0;
if (fs.existsSync(fixesPath)) {
  const { fixes = [], anchorAt } = JSON.parse(fs.readFileSync(fixesPath, 'utf8'));
  const used = new Set();
  for (const f of fixes) {
    const list = f.type === 'credit' ? S.incomes : S.expenses;
    const hit = list.find((x, i) => !used.has(x) && x.source === 'n8n' && x.date === f.date && Number(x.amount) === Number(f.amount) && (x.note || '') === (f.note || ''));
    if (hit) { hit.createdAt = f.createdAt; used.add(hit); retimed++; }
  }
  if (anchorAt && S.accounts && S.accounts.mashreq) S.accounts.mashreq.balanceAt = anchorAt;
  fs.unlinkSync(fixesPath);
}

doc.rev += 1;
doc.updatedAt = new Date().toISOString();
fs.writeFileSync(statePath + '.tmp', JSON.stringify(doc));
fs.renameSync(statePath + '.tmp', statePath);
console.log('recategorized', JSON.stringify(changed), '| retimed', retimed, '| rev', doc.rev);
