'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server');
const { applyIngest } = require('../ingest');
const { categorize } = require('../categorize');

const baseState = () => ({ settings: { currency: 'AED' }, expenses: [], incomes: [], accounts: {} });

test('ingest: debit adds a bank expense (Disney Plus is a subscription)', () => {
  const S = baseState();
  applyIngest(S, { amount: '49.99', date: '2026-09-20', description: 'Disney Plus', type: 'debit' }, 1000);
  assert.equal(S.expenses.length, 1);
  assert.deepEqual(S.expenses[0], { id: S.expenses[0].id, date: '2026-09-20', amount: 49.99, note: 'Disney Plus', bankText: 'Disney Plus', payMethod: 'bank', source: 'n8n', createdAt: 1000, cat: 'Subscriptions' });
});

test('ingest: debit tags a matching auto-logged recurring payment', () => {
  const S = baseState();
  S.expenses.push({ id: 'r1', date: '2026-09-25', amount: 2300, cat: 'Rent', recurringId: 'rent' });
  const id = applyIngest(S, { amount: 2300, date: '2026-09-23', description: 'RENT TRANSFER', type: 'debit' });
  assert.equal(id, 'r1');
  assert.equal(S.expenses.length, 1);
  assert.equal(S.expenses[0].source, 'n8n');
  assert.equal(S.expenses[0].date, '2026-09-23');
  assert.equal(S.expenses[0].bankNote, 'RENT TRANSFER');
});

test('ingest: no match beyond 7 days or different amount', () => {
  const S = baseState();
  S.expenses.push({ id: 'r1', date: '2026-09-01', amount: 2300, recurringId: 'rent' });
  applyIngest(S, { amount: 2300, date: '2026-09-20', type: 'debit' });
  applyIngest(S, { amount: 2299, date: '2026-09-02', type: 'debit' });
  assert.equal(S.expenses.length, 3);
});

test('ingest: credit tags a receivable repayment, else adds income', () => {
  const S = baseState();
  S.incomes.push({ id: 'i1', date: '2026-10-01', amount: 500, receivableId: 'p1' });
  assert.equal(applyIngest(S, { amount: 500, date: '2026-10-02', type: 'credit', description: 'FT IN' }), 'i1');
  applyIngest(S, { amount: 6685.1, date: '2026-09-25', type: 'credit', description: 'Salary' });
  assert.equal(S.incomes.length, 2);
  assert.equal(S.incomes[1].cat, undefined);
});

test('ingest: balance anchors Mashreq only when it is a real number', () => {
  for (const bad of [null, '', 'null', 'abc', undefined]) {
    const S = baseState();
    applyIngest(S, { amount: 1, date: '2026-09-20', type: 'debit', balance: bad });
    assert.equal(S.accounts.mashreq, undefined, String(bad));
  }
  const S = baseState();
  applyIngest(S, { amount: 1, date: '2026-09-20', type: 'debit', balance: '544.84' }, 77);
  assert.deepEqual(S.accounts.mashreq, { name: 'Mashreq', type: 'bank', balance: 544.84, balanceDate: '2026-09-20', balanceAt: 77 });
});

test('ingest: validation', () => {
  assert.throws(() => applyIngest(baseState(), { date: '2026-01-01', type: 'debit' }), /Missing/);
  assert.throws(() => applyIngest(baseState(), { amount: 1, date: '2026-01-01', type: 'x' }), /type must/);
});

// ---- HTTP ----
async function withServer(fn, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-'));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-pub-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>hi</h1>');
  const server = createServer({ passphrase: 'open sesame', ingestSecret: 'sec', dataDir, publicDir, ingestMaxAgeDays: 0, ...extra });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body, headers = {}) => fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  try { await fn({ call, dataDir }); } finally { server.close(); }
}

test('http: login, state round trip, conflict, ingest', () => withServer(async ({ call, dataDir }) => {
  assert.equal((await call('GET', '/')).status, 200);
  assert.equal((await call('GET', '/../etc/passwd')).status, 404);
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('POST', '/api/login', { passphrase: 'nope' })).status, 401);
  const { token } = await (await call('POST', '/api/login', { passphrase: 'open sesame' })).json();
  const auth = { Authorization: 'Bearer ' + token };

  const first = await (await call('GET', '/api/state', null, auth)).json();
  assert.equal(first.rev, 0);
  assert.equal(first.state, null);
  assert.equal((await call('GET', '/api/state?since=0', null, auth)).status, 304);

  const put = await call('PUT', '/api/state', { baseRev: 0, state: baseState() }, auth);
  assert.equal(put.status, 200);
  assert.equal((await put.json()).rev, 1);

  // stale base -> 409 with the current doc
  const stale = await call('PUT', '/api/state', { baseRev: 0, state: baseState() }, auth);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).rev, 1);

  assert.equal((await call('POST', '/api/ingest', { amount: 5, date: '2026-10-01', type: 'debit' }, { 'X-Ingest-Secret': 'bad' })).status, 401);
  const ing = await call('POST', '/api/ingest', { amount: 5, date: '2026-10-01', type: 'debit', description: 'Coffee' }, { 'X-Ingest-Secret': 'sec' });
  assert.equal(ing.status, 200);
  const after = await (await call('GET', '/api/state', null, auth)).json();
  assert.equal(after.rev, 2);
  assert.equal(after.state.expenses[0].note, 'Coffee');
  assert.equal((await call('POST', '/api/ingest', { amount: 5, type: 'debit', secret: 'sec' })).status, 400);

  assert.ok(fs.existsSync(path.join(dataDir, 'state.json')));
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1);

  assert.equal((await call('POST', '/api/logout', null, auth)).status, 204);
  assert.equal((await call('GET', '/api/state', null, auth)).status, 401);
}));

test('http: login is rate limited', () => withServer(async ({ call }) => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/login', { passphrase: 'x' });
  assert.equal(last.status, 429);
}));

test('categorize: real shop names from the bank feed', () => {
  const cases = {
    'ADNOC AL DANA 966 ABUDHABI AE': 'Fuel',
    'Q MOBILITY LLC Abu Dhabi AE': 'Salik / Parking',
    'LULU HYPERMARKET- WTC ABUDHABI AE': 'Groceries',
    'AL WENASA BAQALA ABU DHABI AE': 'Groceries',
    'Noon Minutes 80038888 AE': 'Groceries',
    'Noon Food 80038888 AE': 'Dining out',
    'noon.com 80038888 AE': 'Shopping',
    'Amazon Prime Subscript Dubai AE': 'Subscriptions',
    'Amazon.ae Dubai AE': 'Shopping',
    'NETFLIX.COM Amsterdam NL': 'Subscriptions',
    'GOOGLE*YOUTUBE MOUNTAIN VIEW US': 'Subscriptions',
    'ANTHROPIC* CLAUDE SUB +14152360599 US': 'Subscriptions',
    'PROMINENT FOODS RESTA ABU DHABI AE': 'Dining out',
    'GREEN HUT CAFETERIA ABU DHABI AE': 'Dining out',
    'KEETA DB DELIVERY SERV DUBAI AE': 'Dining out',
    'CAREEM FOOD Abu Dhabi AE': 'Dining out',
    'e& Digital App Abu Dhabi AE': 'Telecom / Internet',
    'DU Apple Pay 800188 AE': 'Telecom / Internet',
    'AIR ARABIA AUH 3D ABU DHABI AE': 'Travel',
    'CARS TAXI ABU DHABI AE': 'Car',
    'FAMILY MED CENT PHARM ABU DHABI AE': 'Health',
    'QuickRemit Transaction': 'Family / Remittance',
  };
  for (const [name, cat] of Object.entries(cases)) assert.equal(categorize(name), cat, name);
  for (const name of ['Aani Instant Payments (Local IPP Transfer)', 'Smiles Abu Dhabi AE', 'Vox Cinemas Dubai AE', '', null]) {
    assert.equal(categorize(name), null, String(name));
  }
});

test('ingest: new debit gets a guessed category, unknown stays Other', () => {
  const S = baseState();
  applyIngest(S, { amount: 100, date: '2026-10-11', description: 'ADNOC AL DANA 966 ABUDHABI AE', type: 'debit' });
  applyIngest(S, { amount: 2.1, date: '2026-10-11', description: 'Vox Cinemas Dubai AE', type: 'debit' });
  assert.deepEqual(S.expenses.map(e => e.cat), ['Fuel', 'Other']);
});

test('http: ingest skips alerts older than the age limit', () => withServer(async ({ call }) => {
  const h = { 'X-Ingest-Secret': 'sec' };
  const old = await (await call('POST', '/api/ingest', { amount: 5, date: '2024-01-01', type: 'debit' }, h)).json();
  assert.equal(old.ok, true);
  assert.match(old.skipped, /older than 14 days/);
  const today = new Date().toISOString().slice(0, 10);
  const fresh = await (await call('POST', '/api/ingest', { amount: 5, date: today, type: 'debit' }, h)).json();
  assert.ok(fresh.id && !fresh.skipped);
}, { ingestMaxAgeDays: 14 }));

test('http: version.json and API responses carry the build fingerprint', () => withServer(async ({ call }) => {
  const v = await (await call('GET', '/version.json')).json();
  assert.match(v.build, /^[0-9a-f]{12}$/);
  const res = await call('POST', '/api/login', { passphrase: 'nope' });
  assert.equal(res.headers.get('x-build'), v.build);
}));

test('buildId changes when an app file changes', () => {
  const { buildId } = require('../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-build-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'one');
  const first = buildId(dir);
  assert.equal(buildId(dir), first);
  fs.writeFileSync(path.join(dir, 'a.js'), 'two');
  assert.notEqual(buildId(dir), first);
});

test('ingest: routes alerts by last 4 digits', () => {
  const S = { ...baseState(), accounts: {
    mashreq: { name: 'Mashreq', type: 'bank', last4: '7776', balance: 100, balanceDate: '2026-10-01' },
    neo: { name: 'Neo VISA', type: 'debit', last4: '2256', linkedTo: 'mashreq' },
    fab_cc: { name: 'FAB', type: 'credit', last4: '9911', limit: 10000, balance: 500 },
    adcb: { name: 'ADCB', type: 'bank', last4: '4400', balance: 50, balanceDate: '2026-10-01' },
  } };
  // debit card purchase: tagged to the card, balance anchors the linked bank (Mashreq), fields kept
  applyIngest(S, { amount: 20, date: '2026-10-11', description: 'ADNOC', type: 'debit', card: '2256', balance: 980 }, 1);
  assert.equal(S.expenses[0].payMethod, 'neo');
  assert.deepEqual([S.accounts.mashreq.balance, S.accounts.mashreq.last4, S.accounts.mashreq.name], [980, '7776', 'Mashreq']);
  // credit card purchase: raises outstanding; available limit sets it exactly; Mashreq untouched
  applyIngest(S, { amount: 50, date: '2026-10-12', description: 'NOON', type: 'debit', card: '9911', balance: 9400 }, 2);
  assert.equal(S.expenses[1].payMethod, 'fab_cc');
  assert.equal(S.accounts.fab_cc.balance, 600);
  assert.equal(S.accounts.mashreq.balance, 980);
  // other bank account: income goes to that account, its anchor moves
  applyIngest(S, { amount: 300, date: '2026-10-13', description: 'FT IN', type: 'credit', card: '4400', balance: 350 }, 3);
  assert.equal(S.incomes[0].account, 'adcb');
  assert.equal(S.accounts.adcb.balance, 350);
  // unknown digits or none: primary bank as before
  applyIngest(S, { amount: 5, date: '2026-10-14', description: 'X', type: 'debit', card: '0000' }, 4);
  assert.equal(S.expenses[2].payMethod, 'bank');
});

test('ATM and bank charges are filed under Bank charges', () => {
  const { categorize } = require('../categorize');
  assert.equal(categorize('ATM withdrawal charges (Incl. VAT as applicable)'), 'Bank charges');
  assert.equal(categorize('Aani Instant Payments (Local IPP Transfer)'), null);
});

test('ingest: a hand-logged repayment awaiting its bank alert is completed, not duplicated', () => {
  const S = baseState();
  S.expenses.push({ id: 'm1', date: '2026-10-25', cat: 'Repayment', amount: 500, note: 'Repay Rinu', payMethod: 'bank', awaitBank: true, createdAt: 1 });
  S.expenses.push({ id: 'm2', date: '2026-10-25', cat: 'Dining out', amount: 500, note: 'dinner', payMethod: 'bank', createdAt: 1 });
  const id = applyIngest(S, { amount: 501, date: '2026-10-25', description: 'Aani Instant Payments (Local IPP Transfer)', type: 'debit' });
  assert.equal(id, 'm1');
  assert.equal(S.expenses.length, 2);
  const m = S.expenses.find(e => e.id === 'm1');
  assert.deepEqual([m.amount, m.cat, m.note, m.source, m.awaitBank], [501, 'Repayment', 'Repay Rinu', 'n8n', false]);
  applyIngest(S, { amount: 501, date: '2026-10-25', description: 'Aani Instant Payments (Local IPP Transfer)', type: 'debit' });
  assert.equal(S.expenses.length, 3);      // a second, unrelated transfer is still its own entry
});

test('http: receipts upload, fetch and delete need a signed-in session and a real JPEG', () => withServer(async ({ call, dataDir }) => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
  assert.equal((await call('POST', '/api/receipts', { data: jpeg })).status, 401);
  const { token } = await (await call('POST', '/api/login', { passphrase: 'open sesame' })).json();
  const auth = { Authorization: 'Bearer ' + token };
  assert.equal((await call('POST', '/api/receipts', { data: Buffer.alloc(300, 1).toString('base64') }, auth)).status, 400);   // not a JPEG
  const { id } = await (await call('POST', '/api/receipts', { data: jpeg }, auth)).json();
  assert.match(id, /^[a-f0-9]{16}$/);
  const got = await call('GET', '/api/receipts/' + id, null, auth);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.equal((await got.arrayBuffer()).byteLength, 304);
  assert.equal((await call('GET', '/api/receipts/' + id)).status, 401);
  assert.equal((await call('GET', '/api/receipts/../state.json', null, auth)).status === 200, false);
  await call('DELETE', '/api/receipts/' + id, null, auth);
  assert.equal((await call('GET', '/api/receipts/' + id, null, auth)).status, 404);
}));
