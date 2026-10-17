'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyBalances } = require('../india-ingest');
const { createServer } = require('../server');

const mk = () => ({ indiaAccounts: [
  { id: 'nre', bank: 'Federal Bank', type: 'NRE', branch: 'Paipad', last4: '9418', balance: 100, balanceDate: '2026-09-01', currency: 'INR' },
  { id: 'nro', bank: 'Federal Bank', type: 'NRO', branch: 'Changanassery', balance: 50, balanceDate: '2026-09-01', currency: 'INR' },   // digits not entered yet
  { id: 'fc', bank: 'HDFC Bank', type: 'FCNR', last4: '7777', balance: 5, balanceDate: '2026-09-01', currency: 'USD' },
] });

test('india balances: match by last 4, or by branch while digits are missing', () => {
  const S = mk();
  const r = applyBalances(S, { source: 'federal-statement', asOf: '2026-09-30', accounts: [
    { last4: '9418', balance: 18744.89, branch: 'PAIPAD' },
    { last4: '4872', balance: 11395.01, branch: 'Changanassery' },
  ] });
  assert.deepEqual(r.updated.map(u => [u.last4, u.to]), [['9418', 18744.89], ['4872', 11395.01]]);
  assert.equal(S.indiaAccounts[0].balance, 18744.89);
  assert.equal(S.indiaAccounts[1].balance, 11395.01);
  assert.equal(S.indiaAccounts[1].balanceDate, '2026-09-30');
  assert.equal(S.indiaAccounts[0].balanceSource, 'federal-statement');
  assert.equal(S.indiaAccounts[1].last4, undefined);       // the statement never fills in digits for you
});

test('india balances: unknown accounts, foreign-currency accounts and older statements are reported, not applied', () => {
  const S = mk();
  S.indiaAccounts[0].balanceDate = '2026-10-31';           // newer than the statement
  const r = applyBalances(S, { asOf: '2026-09-30', accounts: [
    { last4: '9418', balance: 1 },
    { last4: '0001', balance: 2, branch: 'Nowhere' },
    { last4: '7777', balance: 3 },
    { last4: '', balance: 4 },
  ] });
  assert.equal(r.updated.length, 0);
  assert.match(r.skipped.map(x => x.reason).join('|'), /newer balance already on record/);
  assert.match(r.skipped.map(x => x.reason).join('|'), /USD account/);
  assert.equal(r.unmatched.length, 2);
  assert.equal(S.indiaAccounts[0].balance, 100);
});

test('india balances: validation', () => {
  assert.throws(() => applyBalances(mk(), { asOf: '30/09/2026', accounts: [{ last4: '1', balance: 1 }] }), /asOf/);
  assert.throws(() => applyBalances(mk(), { asOf: '2026-09-30', accounts: [] }), /accounts/);
});

test('http: /api/ingest-balance needs the secret and updates the stored account', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-ib-'));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpl-ibp-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), 'x');
  const server = createServer({ passphrase: 'pw', ingestSecret: 'sec', dataDir, publicDir, ingestMaxAgeDays: 0 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, h = {}) => fetch(base + '/api/ingest-balance', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
  try {
    const { token } = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: 'pw' }) })).json();
    const auth = { Authorization: 'Bearer ' + token };
    await fetch(base + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ baseRev: 0, state: { settings: {}, expenses: [], ...mk() } }) });
    const row = { asOf: '2026-09-30', accounts: [{ last4: '9418', balance: 777.5 }] };
    assert.equal((await post(row)).status, 401);
    assert.equal((await post(row, { 'X-Ingest-Secret': 'bad' })).status, 401);
    const ok = await (await post(row, { 'X-Ingest-Secret': 'sec' })).json();
    assert.equal(ok.updated.length, 1);
    const st = (await (await fetch(base + '/api/state', { headers: auth })).json());
    assert.equal(st.state.indiaAccounts[0].balance, 777.5);
    const rev = st.rev;
    const again = await (await post(row, { 'X-Ingest-Secret': 'sec' })).json();      // same statement again: nothing changes
    assert.equal(again.ok, true);
    assert.equal((await (await fetch(base + '/api/state', { headers: auth })).json()).rev, rev + 0);
    assert.equal((await post({ asOf: 'bad', accounts: [{ last4: '1', balance: 1 }] }, { 'X-Ingest-Secret': 'sec' })).status, 400);
  } finally { server.close(); }
});

test('statement transactions are added once and the balance follows the statement', () => {
  const { applyBalances } = require('../india-ingest');
  const S = { indiaAccounts: [{ id: 'n', bank: 'Federal Bank', type: 'NRE', currency: 'INR', last4: '9418', balance: 18744.89, balanceDate: '2026-09-30' }] };
  const body = { source: 'federal-account', asOf: '2026-10-16', accounts: [{ last4: '9418', balance: 18266.89, txns: [
    { id: 'S1', date: '2026-10-13', kind: 'out', amount: 179, note: 'UPI one' }, { id: 'S2', date: '2026-10-13', kind: 'out', amount: 299, note: 'UPI two' }] }] };
  const r = applyBalances(S, body);
  assert.deepEqual(r.added, [{ last4: '9418', count: 2 }]);
  assert.equal(S.indiaAccounts[0].balance, 18266.89);
  assert.equal(S.indiaTxns.length, 2);
  const again = applyBalances(S, body);
  assert.deepEqual(again.added, []);
  assert.equal(S.indiaTxns.length, 2);
  assert.equal(again.skipped[0].reason, 'already up to date');
});
