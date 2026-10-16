// node n8n/test-federal-statement.js  (also run by npm test)
const fs = require('fs');
const assert = require('assert');
const code = fs.readFileSync(__dirname + '/parse-federal-statement.js', 'utf8');
const run = text => new Function('$input', code)({ item: { json: { text } } }).json;

// Layout as produced by `pdftotext -layout` on the real statement (personal details removed)
const layout = `
OVERVIEW OF ACCOUNTS/PRODUCTS AS ON 30-09-2026
   Account Type        Balance (₹)
   Savings                 30,139.90                                OD / CC          0
   Current                       0
   Term Deposits                 0
   TOTAL                   30,139.90                                TOTAL            0

 SUMMARY OF OPERATIVE ACCOUNTS AS ON 30-09-2026
    ACCOUNT
                         BRANCH NAME         RELATIONSHIP    STATUS   MODE OF OPERATION     BALANCE     NOMINEE
    NUMBER
      XX4872            CHANGANASSERY        MAIN HOLDER     ACTIVE            SG        11,395.01     REGISTERED
      XX9418                 PAIPAD          MAIN HOLDER     ACTIVE            SG        18,744.89     REGISTERED

 Disclaimer: Please note that the accounts shown here pertain only to those where you are the primary holder.
`;
// The same content with every cell on its own line, then fully flattened: other PDF readers do this
const cells = layout.replace(/ {2,}/g, '\n');
const flatText = layout.replace(/\s+/g, ' ');

for (const [name, t] of Object.entries({ layout, cells, flatText })) {
  const r = run(t);
  assert.equal(r.parsed, true, name);
  assert.equal(r.asOf, '2026-09-30', name);
  assert.deepEqual(r.accounts, [
    { last4: '4872', branch: 'CHANGANASSERY', balance: 11395.01 },
    { last4: '9418', branch: 'PAIPAD', balance: 18744.89 },
  ], name);
  assert.equal(r.savingsTotal, 30139.9, name);
  assert.equal(r.checkOk, true, name);
}

// a figure that does not add up is flagged, not hidden
const off = run(layout.replace('18,744.89', '18,000.00'));
assert.equal(off.parsed, true);
assert.equal(off.checkOk, false);

// FD / loan products appear in other sections and must not confuse the accounts table
const withFd = run(layout + '\n TERM DEPOSITS XX5555 KOCHI 1,00,000.00 MATURITY 01-01-2030');
assert.deepEqual(withFd.accounts.map(a => a.last4), ['4872', '9418'], 'text after the disclaimer is ignored');

// failure cases come back as parsed:false with a reason
assert.equal(run('hello').parsed, false);
assert.equal(run('').parsed, false);
assert.equal(run('SUMMARY OF OPERATIVE ACCOUNTS AS ON 30-09-2026 nothing here').parsed, false);

console.log('federal statement parser: all cases pass');
