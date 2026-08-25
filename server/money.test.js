import { test } from 'node:test';
import assert from 'node:assert';
import { formatRand, parsePrice, formatItemPrice } from './money.js';

test('formatRand always shows two decimals, a space after R, and thousands separators', () => {
  assert.strictEqual(formatRand(350), 'R 350.00');
  assert.strictEqual(formatRand(299), 'R 299.00');
  assert.strictEqual(formatRand(0), 'R 0.00');
  assert.strictEqual(formatRand(1250.5), 'R 1,250.50');
  assert.strictEqual(formatRand(1234567.8), 'R 1,234,567.80');
});

test('formatRand rounds to cents rather than truncating', () => {
  assert.strictEqual(formatRand(19.999), 'R 20.00');
  assert.strictEqual(formatRand(19.994), 'R 19.99');
});

test('formatRand handles negative amounts (e.g. a discount line) with the sign before R', () => {
  assert.strictEqual(formatRand(-50), '-R 50.00');
});

test('formatRand treats missing/non-numeric input as R 0.00 rather than throwing or showing NaN', () => {
  assert.strictEqual(formatRand(undefined), 'R 0.00');
  assert.strictEqual(formatRand(null), 'R 0.00');
  assert.strictEqual(formatRand('not a number'), 'R 0.00');
});

test('parsePrice strips currency symbols/thousands separators and returns 0 for unparseable text', () => {
  assert.strictEqual(parsePrice('R450'), 450);
  assert.strictEqual(parsePrice('R 1,250.50'), 1250.5);
  assert.strictEqual(parsePrice('POA'), 0);
  assert.strictEqual(parsePrice(''), 0);
});

test('formatItemPrice formats a numeric-looking free-text price, but passes non-numeric text through unchanged', () => {
  // Category item prices are a plain admin-typed text field (not a number
  // column) -- see admin/admin.js's data-item="price" input -- so this must
  // never mangle a deliberate "POA"/"Contact us" into "R 0.00".
  assert.strictEqual(formatItemPrice('350'), 'R 350.00');
  assert.strictEqual(formatItemPrice('R450'), 'R 450.00');
  assert.strictEqual(formatItemPrice('POA'), 'POA');
  assert.strictEqual(formatItemPrice('Contact us'), 'Contact us');
  assert.strictEqual(formatItemPrice(''), '');
  assert.strictEqual(formatItemPrice(null), '');
});
