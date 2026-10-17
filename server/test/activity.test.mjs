import test from 'node:test';
import assert from 'node:assert';
import { newActivity } from '../../public/js/domain/activity.js';

test('new activity lists automatic entries newer than the last "seen" mark', () => {
  const now = 1_000_000_000_000;
  const S = {
    activitySeenAt: now - 1000,
    expenses: [{ source: 'n8n', createdAt: now - 500, amount: 12, note: 'Noon', cat: 'Dining out' }, { source: 'n8n', createdAt: now - 5000, amount: 9 }, { createdAt: now, amount: 5 }],
    incomes: [{ source: 'n8n', createdAt: now - 100, amount: 700, note: 'Transfer in' }],
    indiaAccounts: [{ id: 'a', type: 'NRE', last4: '9418' }],
    indiaTxns: [{ tranId: 'S1', createdAt: now - 200, accountId: 'a', kind: 'out', amount: 179, note: 'UPI' }, { createdAt: now, amount: 1 }],
  };
  const rows = newActivity(S, now);
  assert.deepEqual(rows.map(r => [r.cur, r.kind, r.amount]), [['AED', 'in', 700], ['INR', 'out', 179], ['AED', 'out', 12]]);
  assert.equal(rows[1].sub, 'NRE ••9418');
  assert.equal(newActivity({ ...S, activitySeenAt: now }, now).length, 0);
});
