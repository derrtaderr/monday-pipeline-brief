import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, exactMoney, shortDate, daysBetween } from '../src/format.mjs';

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

test('exactMoney writes cents as exact dollars, with cents only when there are some', () => {
  assert.equal(exactMoney(109400000), '$1,094,000');
  assert.equal(exactMoney(0), '$0');
  assert.equal(exactMoney(30), '$0.30');
  assert.equal(exactMoney(2400050), '$24,000.50');
});

test('negative amounts put the minus sign before the dollar sign', () => {
  assert.equal(exactMoney(-550), '-$5.50');
  assert.equal(exactMoney(-109400000), '-$1,094,000');
  assert.equal(money(-700), '-$700');
  assert.equal(money(-24000), '-$24K');
  assert.equal(money(-1250000), '-$1.25M');
});

// Each unit takes over where the smaller one would round up to 1,000 of itself, and anything that
// rounds to zero prints $0 (never -$0).
test('money switches unit where rounding would print 1,000 of the smaller one, and never prints -$0', () => {
  assert.equal(money(999.5), '$1K');
  assert.equal(money(999499), '$999K');
  assert.equal(money(999500), '$1.00M');
  assert.equal(money(999994999), '$999.99M');
  assert.equal(money(999995000), '$1.00B');
  assert.equal(money(1e9), '$1.00B');
  assert.equal(money(2.5e9), '$2.50B');
  assert.equal(money(-999500), '-$1.00M');
  assert.equal(money(-0), '$0');
  assert.equal(money(-0.4), '$0');
  assert.equal(money(0.4), '$0');
});
