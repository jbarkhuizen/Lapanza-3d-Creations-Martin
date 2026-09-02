import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { updateSettings } from './settings.js';
import { createFilament, addColour } from './filaments.js';
import { createOrder } from './orders.js';
import { createShippingOption } from './shipping.js';
import { createPromoCode, updatePromoCode, getPromoByCode, validatePromo, computePromoDiscount, redeemPromo, listPromoCodes } from './promos.js';

function seedProduct(db) {
  createShippingOption({ name: 'Standard', minWeight: 0, maxWeight: 50000, price: 100 }, db);
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const withColour = addColour(filament.id, { name: 'Blue', sku: 'PLA-BLUE-1KG', priceRand: 100, weightG: 1000, stockQty: 50 }, db);
  return `filament:pla:${withColour.colours[0].sku}`;
}

function placeOrder(productId, db, { quantity = 2, promoCode } = {}) {
  return createOrder(
    {
      client: { name: 'Promo Tester', email: 'promo@example.com', phone: '0123456789' },
      items: [{ productId, quantity }],
      paymentMethod: 'payfast_card',
      promoCode,
    },
    db,
  );
}

test('promo CRUD: create, case-insensitive lookup, duplicate rejection, update', () => {
  const db = openDb(':memory:');
  const promo = createPromoCode({ code: 'Spring10', kind: 'percent', value: 10 }, db);
  assert.strictEqual(promo.code, 'Spring10');
  assert.strictEqual(getPromoByCode('SPRING10', db).id, promo.id);
  assert.throws(() => createPromoCode({ code: 'spring10', kind: 'fixed', value: 5 }, db), /already exists/);
  assert.throws(() => createPromoCode({ code: 'BAD', kind: 'percent', value: 95 }, db), /capped at 90/);
  const updated = updatePromoCode(promo.id, { active: false }, db);
  assert.strictEqual(updated.active, false);
  assert.strictEqual(listPromoCodes(db).length, 1);
  db.close();
});

test('validatePromo enforces active, expiry, max uses and minimum subtotal', () => {
  const db = openDb(':memory:');
  const promo = createPromoCode({ code: 'RULES', kind: 'fixed', value: 20, minSubtotal: 150, expiresAt: '2099-01-01T00:00:00.000Z', maxUses: 1 }, db);
  assert.strictEqual(validatePromo('RULES', 100, db).ok, false); // below min subtotal
  assert.strictEqual(validatePromo('RULES', 200, db).ok, true);
  redeemPromo(promo.id, db);
  assert.match(validatePromo('RULES', 200, db).reason, /fully redeemed/);
  updatePromoCode(promo.id, { maxUses: 5, expiresAt: '2000-01-01T00:00:00.000Z' }, db);
  assert.match(validatePromo('RULES', 200, db).reason, /expired/);
  updatePromoCode(promo.id, { expiresAt: null, active: false }, db);
  assert.match(validatePromo('RULES', 200, db).reason, /not valid/);
  assert.strictEqual(validatePromo('NOPE', 200, db).ok, false);
  db.close();
});

test('computePromoDiscount: percent, fixed, and never more than the subtotal', () => {
  assert.strictEqual(computePromoDiscount({ kind: 'percent', value: 10 }, 200), 20);
  assert.strictEqual(computePromoDiscount({ kind: 'fixed', value: 50 }, 200), 50);
  assert.strictEqual(computePromoDiscount({ kind: 'fixed', value: 500 }, 200), 200);
});

test('createOrder applies a promo code, records it on the order, and counts the use', () => {
  const db = openDb(':memory:');
  const productId = seedProduct(db);
  const promo = createPromoCode({ code: 'TAKE10', kind: 'percent', value: 10 }, db);
  const order = placeOrder(productId, db, { promoCode: 'take10' }); // case-insensitive entry
  assert.strictEqual(order.subtotal, 200);
  assert.strictEqual(order.promoCode, 'TAKE10');
  assert.strictEqual(order.promoDiscountAmount, 20);
  assert.strictEqual(order.total, 200 - 20 + 100); // subtotal - promo + shipping
  assert.strictEqual(getPromoByCode('TAKE10', db).usedCount, 1);
  // an order without a code doesn't touch the counter
  placeOrder(productId, db, {});
  assert.strictEqual(getPromoByCode('TAKE10', db).usedCount, 1);
  void promo;
  db.close();
});

test('createOrder rejects an invalid or exhausted code instead of silently dropping it', () => {
  const db = openDb(':memory:');
  const productId = seedProduct(db);
  assert.throws(() => placeOrder(productId, db, { promoCode: 'GHOST' }), /not valid/);
  createPromoCode({ code: 'ONCE', kind: 'fixed', value: 10, maxUses: 1 }, db);
  placeOrder(productId, db, { promoCode: 'ONCE' });
  assert.throws(() => placeOrder(productId, db, { promoCode: 'ONCE' }), /fully redeemed/);
  // the rejected order must not exist half-made: only the successful ones remain
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  db.close();
});

test('promo stacks AFTER the volume discount (applies to the discounted subtotal)', () => {
  const db = openDb(':memory:');
  const productId = seedProduct(db);
  updateSettings({ volumeDiscounts: [{ id: 'vd1', minQty: 2, pct: 10, active: true }] }, db);
  createPromoCode({ code: 'STACK', kind: 'percent', value: 10 }, db);
  const order = placeOrder(productId, db, { quantity: 2, promoCode: 'STACK' });
  assert.strictEqual(order.subtotal, 200);
  assert.strictEqual(order.discountAmount, 20); // volume: 10% of 200
  assert.strictEqual(order.promoDiscountAmount, 18); // promo: 10% of (200-20)
  assert.strictEqual(order.total, 200 - 20 - 18 + 100);
  db.close();
});

test('redeemPromo race guard: the last use can only be taken once', () => {
  const db = openDb(':memory:');
  const promo = createPromoCode({ code: 'LAST', kind: 'fixed', value: 5, maxUses: 1 }, db);
  redeemPromo(promo.id, db);
  assert.throws(() => redeemPromo(promo.id, db), /fully redeemed/);
  assert.strictEqual(getPromoByCode('LAST', db).usedCount, 1);
  db.close();
});

test('updatePromoCode can CLEAR an expiry with null (admin blanks the date field)', () => {
  const db = openDb(':memory:');
  const p = createPromoCode({ code: 'CLEARME', kind: 'fixed', value: 5, expiresAt: '2099-01-01T00:00:00.000Z' }, db);
  assert.ok(p.expiresAt);
  const cleared = updatePromoCode(p.id, { expiresAt: null }, db);
  assert.strictEqual(cleared.expiresAt, null);
  // and an update that doesn't mention expiresAt keeps whatever is there
  const untouched = updatePromoCode(p.id, { value: 6 }, db);
  assert.strictEqual(untouched.expiresAt, null);
  db.close();
});
