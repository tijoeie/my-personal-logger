import test from 'node:test';
import assert from 'node:assert';
import { matchCharge, groupCharges, paidThisCycle, nextChargeDate, guessName } from '../../public/js/domain/subscriptions.js';

const subs = [
  { id: 'n', name: 'Netflix', amount: 71, cycle: 'monthly' },
  { id: 'y', name: 'YouTube Premium', amount: 26.99, cycle: 'monthly' },
  { id: 'c', name: 'Claude Pro', amount: 77.13, cycle: 'monthly' },
  { id: 'a', name: 'Amazon Prime', amount: 16, cycle: 'monthly' },
  { id: 'm', name: 'Apple Music', amount: 21.99, cycle: 'monthly' },
  { id: 'i', name: 'iCloud+', amount: 3.67, cycle: 'monthly' },
];

test('subscriptions: real bank descriptors match the right service', () => {
  const m = note => (matchCharge({ note, amount: 0 }, subs) || {}).id;
  assert.equal(m('NETFLIX.COM Amsterdam NL'), 'n');
  assert.equal(m('GOOGLE*YOUTUBE MOUNTAIN VIEW US'), 'y');
  assert.equal(m('ANTHROPIC* CLAUDE SUB +14152360599 US'), 'c');
  assert.equal(m('Amazon Prime Subscript Dubai AE'), 'a');
  assert.equal(m('Netflix'), 'n');            // manual log uses the subscription name
  assert.equal(m('claude 2'), 'c');
  assert.equal(m('Amazon.ae Dubai AE'), undefined); // shopping, not Prime
});

test('subscriptions: two Apple services are told apart by amount', () => {
  assert.equal(matchCharge({ note: 'APPLE.COM/BILL ITUNES.COM IE', amount: 3.67 }, subs).id, 'i');
  assert.equal(matchCharge({ note: 'APPLE.COM/BILL ITUNES.COM IE', amount: 21.99 }, subs).id, 'm');
});

test('subscriptions: custom bank text and explicit link win', () => {
  const custom = [{ id: 'g', name: 'Gym', matchText: 'fitness first, ff dubai', amount: 200 }];
  assert.equal(matchCharge({ note: 'FITNESS FIRST JLT AE', amount: 200 }, custom).id, 'g');
  assert.equal(matchCharge({ note: 'anything', subscriptionId: 'a' }, subs).id, 'a');
});

test('subscriptions: grouping, untracked, cycle status, next date', () => {
  const ex = [
    { date: '2026-09-25', amount: 29.99, note: 'GOOGLE*YOUTUBE MOUNTAIN VIEW US', cat: 'Subscriptions' },
    { date: '2026-08-25', amount: 26.99, note: 'GOOGLE*YOUTUBE MOUNTAIN VIEW US', cat: 'Subscriptions' },
    { date: '2026-10-02', amount: 59, note: 'SPOTIFY P1 STOCKHOLM SE', cat: 'Subscriptions' },
    { date: '2026-10-03', amount: 12, note: 'LULU HYPERMARKET', cat: 'Groceries' },
  ];
  const { bySub, untracked } = groupCharges(ex, subs);
  assert.deepEqual(bySub.y.map(e => e.date), ['2026-09-25', '2026-08-25']);
  assert.deepEqual(untracked.map(e => e.note), ['SPOTIFY P1 STOCKHOLM SE']);
  assert.equal(paidThisCycle(subs[1], bySub.y, '2026-10-10'), true);
  assert.equal(paidThisCycle(subs[1], bySub.y, '2026-10-25'), false);
  assert.equal(nextChargeDate(subs[1], bySub.y), '2026-10-25');
  assert.equal(guessName('SPOTIFY P1 STOCKHOLM SE'), 'Spotify');
  assert.equal(guessName('FITNESS FIRST JLT'), 'Fitness');
});
