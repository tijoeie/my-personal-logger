import test from 'node:test';
import assert from 'node:assert';
import { dmy, parseDmy, fmtDate, fmtDateObj } from '../../public/js/core/util.js';

test('dates: ISO to DD/MM/YYYY and back, rejecting impossible dates', () => {
  assert.equal(dmy('2026-10-25'), '25/10/2026');
  assert.equal(fmtDate('2026-01-05'), '05/01/2026');
  assert.equal(fmtDate(''), '—');
  assert.equal(fmtDateObj(new Date(2026, 10, 7)), '07/11/2026');
  assert.equal(parseDmy('25/10/2026'), '2026-10-25');
  assert.equal(parseDmy('5/1/2026'), '2026-01-05');
  assert.equal(parseDmy('05-01-2026'), '2026-01-05');
  assert.equal(parseDmy(''), '');
  assert.equal(parseDmy('31/02/2026'), null);
  assert.equal(parseDmy('2026-10-25'), null);
  assert.equal(parseDmy('25/13/2026'), null);
});
