import test from 'node:test';
import assert from 'node:assert';
import { goalStats } from '../../public/js/domain/goals.js';

const today = new Date(2026, 9, 25);
test('goal stats: progress, finish month at the monthly pace, needed amount for a deadline', () => {
  const g = { target: 10000, monthly: 1000, contribs: [{ amount: 2500 }, { amount: 500 }] };
  const s = goalStats(g, today);
  assert.deepEqual([s.saved, s.left, Math.round(s.pct), s.monthsToGo], [3000, 7000, 30, 7]);
  assert.equal(s.eta.getMonth(), 4);                                    // May 2027
  const d = goalStats({ ...g, targetDate: '2027-04-25' }, today);       // 6 months away
  assert.equal(d.neededMonthly, Math.ceil(7000 / 6));
  assert.equal(d.onTrack, false);
  assert.equal(goalStats({ target: 100, contribs: [{ amount: 100 }] }, today).done, true);
  assert.equal(goalStats({ target: 500, contribs: [] }, today).eta, null);
});
