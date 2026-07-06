const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashSourceId, pickRotation, dayNumber } = require('../lib');

test('hashSourceId: stable for the same inputs, differs for different ones', () => {
  const a = hashSourceId('Joe Bakery', 'https://joebakery.com');
  const b = hashSourceId('Joe Bakery', 'https://joebakery.com');
  const c = hashSourceId('Jane Bakery', 'https://janebakery.com');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('pickRotation: returns `count` consecutive items starting from a day-derived offset', () => {
  const list = ['a', 'b', 'c', 'd'];
  const day0 = new Date(dayNumber(new Date(0)) * 86400000); // epoch day
  const picked = pickRotation(list, 2, day0);
  assert.equal(picked.length, 2);
  picked.forEach((item) => assert.ok(list.includes(item)));
});

test('pickRotation: wraps around the end of the list', () => {
  const list = ['a', 'b', 'c'];
  // Force an offset near the end of the list to exercise the wraparound.
  const dayForcingWrap = new Date((dayNumber(new Date()) + 1000) * 86400000);
  const picked = pickRotation(list, 3, dayForcingWrap);
  assert.equal(picked.length, 3);
  assert.deepEqual([...picked].sort(), ['a', 'b', 'c']);
});

test('pickRotation: same day always picks the same items (deterministic)', () => {
  const list = ['dentist', 'bakery', 'restaurant', 'plumber', 'therapist'];
  const date = new Date('2026-03-01T12:00:00Z');
  const first = pickRotation(list, 3, date);
  const second = pickRotation(list, 3, date);
  assert.deepEqual(first, second);
});

test('pickRotation: consecutive days pick different (rotating) items over time', () => {
  const list = ['dentist', 'bakery', 'restaurant', 'plumber', 'therapist', 'vet'];
  const day1 = new Date('2026-03-01T00:00:00Z');
  const day2 = new Date('2026-03-02T00:00:00Z');
  const picked1 = pickRotation(list, 2, day1);
  const picked2 = pickRotation(list, 2, day2);
  // Not asserting a specific pair, just that the rotation actually advances.
  assert.notDeepEqual(picked1, picked2);
});

test('pickRotation: empty list returns empty', () => {
  assert.deepEqual(pickRotation([], 3), []);
});
