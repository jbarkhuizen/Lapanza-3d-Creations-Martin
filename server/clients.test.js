import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createClient, mergeClients, getClient, updateClient, findOrCreateClientForCheckout } from './clients.js';
import { createDesignRequest } from './design-requests.js';

test('findOrCreateClientForCheckout never lets a name match overwrite an existing client\'s email (account-takeover guard)', () => {
  const db = openDb(':memory:');
  const victim = createClient({ email: 'victim@example.com', name: 'Sam Ndlovu', firstName: 'Sam', lastName: 'Ndlovu', phone: '0821112222' }, db);

  // An attacker who only knows the victim's name checks out with their own
  // email address. This must NOT match/merge into the victim's record --
  // it must create a brand-new guest client instead.
  const result = findOrCreateClientForCheckout(
    { email: 'attacker@evil.example', firstName: 'Sam', lastName: 'Ndlovu', phone: '0000000000' },
    db,
  );
  assert.notStrictEqual(result.id, victim.id, 'attacker submission must not resolve to the victim\'s client id');

  const victimAfter = getClient(victim.id, db);
  assert.strictEqual(victimAfter.email, 'victim@example.com', 'victim\'s email must be untouched');
  assert.strictEqual(victimAfter.phone, '0821112222', 'victim\'s other details must be untouched by an unrelated name match');

  // The genuine repeat-customer case -- same email, same name -- still
  // reconciles in place as before (e.g. an updated phone number).
  const again = findOrCreateClientForCheckout(
    { email: 'victim@example.com', firstName: 'Sam', lastName: 'Ndlovu', phone: '0823334444' },
    db,
  );
  assert.strictEqual(again.id, victim.id);
  assert.strictEqual(again.phone, '0823334444');
  db.close();
});

test('updateClient round-trips PUDO locker fields; untouched updates preserve them (#24)', () => {
  const db = openDb(':memory:');
  const c = createClient({ email: 'pudo@example.com', name: 'Pudo Client' }, db);
  assert.strictEqual(c.pudoRelevant, false);
  const updated = updateClient(c.id, {
    pudoRelevant: true,
    pudoLockerName: 'PUDO — Spar PvR',
    pudoLockerAddress: '12 Main Rd',
    pudoLockerSuburb: 'Pierre van Ryneveld',
    pudoLockerCity: 'Centurion',
    pudoLockerPostalCode: '0157',
  }, db);
  assert.strictEqual(updated.pudoRelevant, true);
  assert.strictEqual(updated.pudoLockerName, 'PUDO — Spar PvR');
  assert.strictEqual(updated.pudoLockerPostalCode, '0157');
  // An unrelated update must not clobber the locker record.
  const after = updateClient(c.id, { phone: '0820000000' }, db);
  assert.strictEqual(after.pudoRelevant, true);
  assert.strictEqual(after.pudoLockerSuburb, 'Pierre van Ryneveld');
  db.close();
});

test('mergeClients moves order and design-request history from source to target, then deletes the source', () => {
  const db = openDb(':memory:');
  const source = createClient({ email: 'duplicate@example.com', name: 'Dup Client' }, db);
  const target = createClient({ email: 'real@example.com', name: 'Real Client' }, db);

  // Attach an order directly to the source via client_id (mirrors an admin
  // manual order or a guest checkout that later turned out to be a dupe).
  const orderId = 'order-1';
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO orders (id, invoice_number, client_id, status, subtotal, shipping_price, shipping_method, total, total_weight, payment_method, payment_status, tracking_number, created_at, updated_at)
     VALUES (@id, 'INV-0001', @client_id, 'pending_payment', 100, 0, 'courier', 100, 0, 'manual_eft', 'pending', '', @now, @now)`,
  ).run({ id: orderId, client_id: source.id, now });

  const designRequest = createDesignRequest(
    { name: source.name, email: source.email, phone: '0123456789', description: 'x', clientId: source.id },
    db,
  );

  const merged = mergeClients(source.id, target.id, db);
  assert.strictEqual(merged.id, target.id);

  const order = db.prepare('SELECT client_id FROM orders WHERE id = ?').get(orderId);
  assert.strictEqual(order.client_id, target.id);

  const dr = db.prepare('SELECT client_id FROM design_requests WHERE id = ?').get(designRequest.id);
  assert.strictEqual(dr.client_id, target.id);

  assert.strictEqual(getClient(source.id, db), null);
  db.close();
});

test('mergeClients rejects merging a client into itself', () => {
  const db = openDb(':memory:');
  const client = createClient({ email: 'solo@example.com' }, db);
  assert.throws(() => mergeClients(client.id, client.id, db), /itself/);
  db.close();
});

test('mergeClients rejects an unknown source or target id', () => {
  const db = openDb(':memory:');
  const client = createClient({ email: 'real@example.com' }, db);
  assert.throws(() => mergeClients('does-not-exist', client.id, db), /Client not found/);
  assert.throws(() => mergeClients(client.id, 'does-not-exist', db), /Client not found/);
  db.close();
});
