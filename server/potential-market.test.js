import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  listPotentialMarketContacts,
  getPotentialMarketContact,
  createPotentialMarketContact,
  updatePotentialMarketContact,
  deletePotentialMarketContact,
  POTENTIAL_MARKET_STATUSES,
} from './potential-market.js';

function basePayload(overrides = {}) {
  return { name: 'Jane', surname: 'Doe', email: 'jane@example.com', mobileNumber: '0821234567', ...overrides };
}

test('createPotentialMarketContact defaults status to Initial Load and requires name + surname', () => {
  const db = openDb(':memory:');
  const c = createPotentialMarketContact(basePayload(), db);
  assert.strictEqual(c.status, 'Initial Load');
  assert.strictEqual(c.name, 'Jane');
  assert.strictEqual(c.surname, 'Doe');
  assert.throws(() => createPotentialMarketContact(basePayload({ name: '' }), db), /Name is required/);
  assert.throws(() => createPotentialMarketContact(basePayload({ surname: '' }), db), /Surname is required/);
  db.close();
});

test('createPotentialMarketContact falls back to Initial Load for a status outside the managed list', () => {
  const db = openDb(':memory:');
  const c = createPotentialMarketContact(basePayload({ status: 'Not A Real Status' }), db);
  assert.strictEqual(c.status, 'Initial Load');
  db.close();
});

test('every managed status is accepted on create', () => {
  const db = openDb(':memory:');
  for (const status of POTENTIAL_MARKET_STATUSES) {
    const c = createPotentialMarketContact(basePayload({ email: `${status}@example.com`, status }), db);
    assert.strictEqual(c.status, status);
  }
  db.close();
});

test('listPotentialMarketContacts filters by status and orders newest first', () => {
  const db = openDb(':memory:');
  createPotentialMarketContact(basePayload({ email: 'a@example.com' }), db);
  const b = createPotentialMarketContact(basePayload({ email: 'b@example.com' }), db);
  updatePotentialMarketContact(b.id, { status: 'Active' }, db);
  const active = listPotentialMarketContacts({ status: 'Active' }, db);
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, b.id);
  db.close();
});

test('updatePotentialMarketContact edits fields and rejects an outside-the-list status by keeping the existing one', () => {
  const db = openDb(':memory:');
  const c = createPotentialMarketContact(basePayload(), db);
  const updated = updatePotentialMarketContact(c.id, { mobileNumber: '0839999999', status: 'bogus' }, db);
  assert.strictEqual(updated.mobileNumber, '0839999999');
  assert.strictEqual(updated.status, 'Initial Load');
  db.close();
});

test('updatePotentialMarketContact returns null for an unknown id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(updatePotentialMarketContact('nonexistent', { status: 'Active' }, db), null);
  db.close();
});

test('deletePotentialMarketContact removes the row and getPotentialMarketContact returns null afterward', () => {
  const db = openDb(':memory:');
  const c = createPotentialMarketContact(basePayload(), db);
  assert.strictEqual(deletePotentialMarketContact(c.id, db), true);
  assert.strictEqual(getPotentialMarketContact(c.id, db), null);
  assert.strictEqual(deletePotentialMarketContact(c.id, db), false);
  db.close();
});
