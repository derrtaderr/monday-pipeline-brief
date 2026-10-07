import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, shortDate, daysBetween } from '../src/format.mjs';

test('money formats millions with two decimals', () => {
  assert.equal(money(1250000), '$1.25M');
});

test('money formats thousands as rounded K with separators', () => {
  assert.equal(money(156000), '$156K');
  assert.equal(money(24000), '$24K');
  assert.equal(money(999499), '$999K');
});

test('money formats small amounts as whole dollars', () => {
  assert.equal(money(0), '$0');
  assert.equal(money(750), '$750');
});

test('shortDate renders month and day', () => {
  assert.equal(shortDate('2026-10-05'), 'Oct 5');
  assert.equal(shortDate('2027-01-15'), 'Jan 15');
});

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween('2026-10-19', '2027-01-15'), 88);
  assert.equal(daysBetween('2026-10-05', '2026-09-18'), -17);
});
