import test from 'node:test';
import assert from 'node:assert';
import { getRate, resetRateCache } from '../rate.mjs';

test('rate lookup parses the feed, caches for 30 minutes and rejects bad data', async () => {
  resetRateCache();
  let calls = 0;
  const ok = async () => { calls++; return { json: async () => ({ rates: { INR: 25.87 } }) }; };
  assert.equal((await getRate(ok, 1000)).rate, 25.87);
  await getRate(ok, 1000 + 60000);
  assert.equal(calls, 1);
  await getRate(ok, 1000 + 31 * 60000);
  assert.equal(calls, 2);
  resetRateCache();
  await assert.rejects(getRate(async () => ({ json: async () => ({}) }), 5));
});
