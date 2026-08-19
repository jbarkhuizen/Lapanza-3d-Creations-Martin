import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  createClient,
  findClientByEmail,
  registerClient,
  verifyClientEmail,
  loginClient,
  setWhatsAppOptIn,
  manuallyVerifyClient,
  regenerateVerificationToken,
  deleteOrRevokeClient,
} from './clients.js';

test('registerClient creates an unverified account and returns a verification token', () => {
  const db = openDb(':memory:');
  const { client, token } = registerClient({ email: 'new@example.com', password: 'correcthorse', name: 'New Client' }, db);
  assert.strictEqual(client.hasAccount, true);
  assert.strictEqual(client.emailVerified, false);
  assert.ok(token);
  db.close();
});

test('registerClient upgrades an existing guest-checkout row instead of creating a duplicate', () => {
  const db = openDb(':memory:');
  const guest = createClient({ email: 'guest@example.com', name: 'Guest Person' }, db);
  const { client } = registerClient({ email: 'guest@example.com', password: 'correcthorse' }, db);
  assert.strictEqual(client.id, guest.id);
  assert.strictEqual(client.hasAccount, true);
  db.close();
});

test('registerClient rejects an email that already has a password set', () => {
  const db = openDb(':memory:');
  registerClient({ email: 'taken@example.com', password: 'correcthorse' }, db);
  assert.throws(() => registerClient({ email: 'taken@example.com', password: 'otherpassword' }, db), /already exists/);
  db.close();
});

test('registerClient rejects a password shorter than 8 characters', () => {
  const db = openDb(':memory:');
  assert.throws(() => registerClient({ email: 'short@example.com', password: 'short' }, db), /at least 8/);
  db.close();
});

test('loginClient rejects an unverified account even with the correct password', () => {
  const db = openDb(':memory:');
  registerClient({ email: 'unverified@example.com', password: 'correcthorse' }, db);
  const result = loginClient('unverified@example.com', 'correcthorse', db);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'unverified');
  db.close();
});

test('verifyClientEmail marks the account verified and consumes the token', () => {
  const db = openDb(':memory:');
  const { token } = registerClient({ email: 'verifyme@example.com', password: 'correcthorse' }, db);
  const verified = verifyClientEmail(token, db);
  assert.strictEqual(verified.emailVerified, true);
  // token is single-use -- a second attempt with the same token must fail
  assert.strictEqual(verifyClientEmail(token, db), null);
  db.close();
});

test('verifyClientEmail returns null for an unknown token', () => {
  const db = openDb(':memory:');
  assert.strictEqual(verifyClientEmail('not-a-real-token', db), null);
  db.close();
});

test('loginClient succeeds once verified, fails with the wrong password', () => {
  const db = openDb(':memory:');
  const { token } = registerClient({ email: 'loginflow@example.com', password: 'correcthorse' }, db);
  verifyClientEmail(token, db);

  const wrong = loginClient('loginflow@example.com', 'wrongpassword', db);
  assert.strictEqual(wrong.ok, false);
  assert.strictEqual(wrong.reason, 'invalid');

  const right = loginClient('loginflow@example.com', 'correcthorse', db);
  assert.strictEqual(right.ok, true);
  assert.strictEqual(right.client.email, 'loginflow@example.com');
  db.close();
});

test('loginClient stamps last_login_at on success, leaves it unset on failure (Phase 4)', () => {
  const db = openDb(':memory:');
  const { token } = registerClient({ email: 'lastlogin@example.com', password: 'correcthorse' }, db);
  verifyClientEmail(token, db);

  const failed = loginClient('lastlogin@example.com', 'wrongpassword', db);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(findClientByEmail('lastlogin@example.com', db).lastLoginAt, null);

  const succeeded = loginClient('lastlogin@example.com', 'correcthorse', db);
  assert.strictEqual(succeeded.ok, true);
  assert.ok(succeeded.client.lastLoginAt);
  assert.strictEqual(findClientByEmail('lastlogin@example.com', db).lastLoginAt, succeeded.client.lastLoginAt);
  db.close();
});

test('setWhatsAppOptIn requires the id and email to match, toggles the flag idempotently', () => {
  const db = openDb(':memory:');
  const client = createClient({ email: 'wa-consent@example.com' }, db);
  assert.strictEqual(findClientByEmail('wa-consent@example.com', db).whatsappOptIn, false);

  assert.strictEqual(setWhatsAppOptIn(client.id, 'wrong@example.com', true, db), false);
  assert.strictEqual(findClientByEmail('wa-consent@example.com', db).whatsappOptIn, false);

  assert.strictEqual(setWhatsAppOptIn(client.id, 'wa-consent@example.com', true, db), true);
  assert.strictEqual(findClientByEmail('wa-consent@example.com', db).whatsappOptIn, true);

  assert.strictEqual(setWhatsAppOptIn(client.id, 'wa-consent@example.com', false, db), true);
  assert.strictEqual(findClientByEmail('wa-consent@example.com', db).whatsappOptIn, false);
  db.close();
});

test('loginClient rejects a guest-only email that has never registered a password', () => {
  const db = openDb(':memory:');
  createClient({ email: 'guestonly@example.com', name: 'Guest Only' }, db);
  const result = loginClient('guestonly@example.com', 'anything', db);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'invalid');
  db.close();
});

test('findClientByEmail keeps working unchanged for guest-checkout lookups', () => {
  const db = openDb(':memory:');
  createClient({ email: 'stillguest@example.com', name: 'Still Guest' }, db);
  const found = findClientByEmail('stillguest@example.com', db);
  assert.ok(found);
  assert.strictEqual(found.hasAccount, false);
  db.close();
});

test('manuallyVerifyClient verifies without a token, rejects a guest with no account', () => {
  const db = openDb(':memory:');
  const { client } = registerClient({ email: 'needsverify@example.com', password: 'correcthorse' }, db);
  const verified = manuallyVerifyClient(client.id, db);
  assert.strictEqual(verified.emailVerified, true);

  const guest = createClient({ email: 'noaccount@example.com' }, db);
  assert.throws(() => manuallyVerifyClient(guest.id, db), /no account/);
  assert.strictEqual(manuallyVerifyClient('bogus-id', db), null);
  db.close();
});

test('regenerateVerificationToken issues a fresh usable token, rejects already-verified or guest', () => {
  const db = openDb(':memory:');
  const { client, token: firstToken } = registerClient({ email: 'resend@example.com', password: 'correcthorse' }, db);
  const { token: secondToken } = regenerateVerificationToken(client.id, db);
  assert.notStrictEqual(secondToken, firstToken);
  // the old token must no longer work -- only the freshly issued one does
  assert.strictEqual(verifyClientEmail(firstToken, db), null);
  assert.strictEqual(verifyClientEmail(secondToken, db).emailVerified, true);

  assert.throws(() => regenerateVerificationToken(client.id, db), /already verified/);
  const guest = createClient({ email: 'noaccount2@example.com' }, db);
  assert.throws(() => regenerateVerificationToken(guest.id, db), /no account/);
  assert.strictEqual(regenerateVerificationToken('bogus-id', db), null);
  db.close();
});

test('deleteOrRevokeClient deletes a client with no orders, revokes login for one with orders', () => {
  const db = openDb(':memory:');
  const { client: noOrders } = registerClient({ email: 'noorders@example.com', password: 'correcthorse' }, db);
  const result1 = deleteOrRevokeClient(noOrders.id, db);
  assert.deepStrictEqual(result1, { deleted: true, revoked: false });
  assert.strictEqual(findClientByEmail('noorders@example.com', db), null);

  const { client: withOrders } = registerClient({ email: 'hasorders@example.com', password: 'correcthorse' }, db);
  db.prepare(
    `INSERT INTO orders (id, client_id, status, subtotal, total, payment_method, payment_status, shipping_method, created_at, updated_at)
     VALUES ('order-1', ?, 'paid', 100, 100, 'manual_eft', 'paid', 'fixed', datetime('now'), datetime('now'))`,
  ).run(withOrders.id);
  const result2 = deleteOrRevokeClient(withOrders.id, db);
  assert.deepStrictEqual(result2, { deleted: false, revoked: true });
  const revoked = findClientByEmail('hasorders@example.com', db);
  assert.strictEqual(revoked.hasAccount, false);

  assert.strictEqual(deleteOrRevokeClient('bogus-id', db), null);
  db.close();
});
