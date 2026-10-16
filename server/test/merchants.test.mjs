import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { normalizeKey, setRule, applyRule, findRule, bankTextOf } from '../../public/js/domain/merchants.js';
const require = createRequire(import.meta.url);
const server = require('../merchants.js');
const { applyIngest } = require('../ingest.js');

const texts = ['ADNOC AL DANA 966 ABUDHABI AE', 'adnoc al dana 973 abudhabi ae', 'Noon 80038888 AE', 'e& Digital App Abu Dhabi AE', 'ANTHROPIC* CLAUDE SUB +14152360599 US', '', null];

test('merchants: client and server normalise identically', () => {
  for (const t of texts) assert.equal(server.normalizeKey(t), normalizeKey(t), String(t));
});

test('merchants: shop key ignores branch numbers, keeps different shops apart', () => {
  assert.equal(normalizeKey(texts[0]), normalizeKey(texts[1]));
  assert.equal(normalizeKey('Noon 80038888 AE'), 'noon ae');
  assert.notEqual(normalizeKey('Noon Food 80038888 AE'), normalizeKey('Noon 80038888 AE'));
  assert.equal(normalizeKey('e& Digital App Abu Dhabi AE'), 'e& digital app abu dhabi ae');
  assert.equal(normalizeKey(''), '');
});

test('merchants: a rule re-categorises earlier bank-feed entries but never manual ones', () => {
  const S = { expenses: [
    { id: 1, source: 'n8n', note: 'Noon 80038888 AE', cat: 'Shopping' },
    { id: 2, source: 'n8n', note: 'Noon Food order', bankText: 'Noon 80038888 AE', cat: 'Shopping' },   // edited note, original kept
    { id: 3, source: 'n8n', note: 'Noon 80038888 AE', cat: 'Health', catManual: true },               // chosen by hand
    { id: 4, source: 'n8n', note: 'Noon Food 80038888 AE', cat: 'Dining out' },                       // different shop
    { id: 5, note: 'Noon 80038888 AE', cat: 'Shopping' },                                              // manual entry, not bank feed
  ] };
  const rule = setRule(S, bankTextOf(S.expenses[1]), 'Dining out');
  assert.deepEqual(S.merchantRules.map(r => [r.key, r.cat]), [['noon ae', 'Dining out']]);
  const changed = applyRule(S, rule);
  assert.deepEqual(changed.map(e => e.id), [1, 2]);
  assert.deepEqual(S.expenses.map(e => e.cat), ['Dining out', 'Dining out', 'Health', 'Dining out', 'Shopping']);
  // changing it again updates the same rule
  setRule(S, 'NOON 80038888 AE', 'Groceries');
  assert.equal(S.merchantRules.length, 1);
  assert.equal(findRule(S.merchantRules, 'Noon 12345 AE').cat, 'Groceries');
});

test('merchants: new bank alerts use the taught category over the built-in guess', () => {
  const S = { settings: {}, expenses: [], incomes: [], accounts: {}, merchantRules: [{ key: 'noon ae', cat: 'Dining out' }] };
  applyIngest(S, { amount: 28.8, date: '2026-10-16', description: 'Noon 80038888 AE', type: 'debit' }, 1);
  applyIngest(S, { amount: 10, date: '2026-10-16', description: 'Amazon.ae Dubai AE', type: 'debit' }, 2);
  assert.deepEqual(S.expenses.map(e => e.cat), ['Dining out', 'Shopping']);
  assert.equal(S.expenses[0].bankText, 'Noon 80038888 AE');
});
