import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  createClient,
  findClientByEmail,
  registerClient,
  verifyClientEmail,
  loginClient,
  requestPasswordReset,
  resetClientPassword,
  setWhatsAppOptIn,
  manuallyVerifyClient,
  regenerateVerificationToken,
  deleteOrRevokeClient,
  setClientDisabled,
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

test('setClientDisabled blocks login before the verified check, is reversible, and never touches password_hash', () => {
  const db = openDb(':memory:');
  const { token } = registerClient({ email: 'disableme@example.com', password: 'correcthorse' }, db);
  verifyClientEmail(token, db);
  assert.strictEqual(loginClient('disableme@example.com', 'correcthorse', db).ok, true);

  const disabled = setClientDisabled(findClientByEmail('disableme@example.com', db).id, true, db);
  assert.strictEqual(disabled.disabled, true);

  const blocked = loginClient('disableme@example.com', 'correcthorse', db);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, 'disabled');

  const reenabled = setClientDisabled(disabled.id, false, db);
  assert.strictEqual(reenabled.disabled, false);
  assert.strictEqual(loginClient('disableme@example.com', 'correcthorse', db).ok, true);
  db.close();
});

test('setClientDisabled returns null for an unknown id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(setClientDisabled('bogus-id', true, db), null);
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

test('requestPasswordReset returns null for an unknown email and for a guest-only row', () => {
  const db = openDb(':memory:');
  assert.strictEqual(requestPasswordReset('nobody@example.com', db), null);
  createClient({ email: 'guestonly2@example.com' }, db);
  assert.strictEqual(requestPasswordReset('guestonly2@example.com', db), null);
  db.close();
});

test('requestPasswordReset issues a token for a registered account regardless of verification state', () => {
  const db = openDb(':memory:');
  registerClient({ email: 'forgot@example.com', password: 'correcthorse' }, db);
  const result = requestPasswordReset('forgot@example.com', db);
  assert.ok(result.token);
  assert.strictEqual(result.client.email, 'forgot@example.com');
  db.close();
});

test('resetClientPassword sets the new password, verifies the account, and consumes the token', () => {
  const db = openDb(':memory:');
  registerClient({ email: 'reset@example.com', password: 'oldpassword' }, db);
  const { token } = requestPasswordReset('reset@example.com', db);

  const updated = resetClientPassword(token, 'newpassword', db);
  assert.strictEqual(updated.emailVerified, true);

  const loginWithOld = loginClient('reset@example.com', 'oldpassword', db);
  assert.strictEqual(loginWithOld.ok, false);
  const loginWithNew = loginClient('reset@example.com', 'newpassword', db);
  assert.strictEqual(loginWithNew.ok, true);

  // token is single-use -- a second attempt with the same token must fail
  assert.strictEqual(resetClientPassword(token, 'anotherpassword', db), null);
  db.close();
});

test('resetClientPassword returns null for an unknown or expired token', () => {
  const db = openDb(':memory:');
  assert.strictEqual(resetClientPassword('not-a-real-token', 'newpassword', db), null);

  registerClient({ email: 'expired@example.com', password: 'correcthorse' }, db);
  const { token } = requestPasswordReset('expired@example.com', db);
  db.prepare('UPDATE clients SET reset_token_expires = ? WHERE reset_token = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    token,
  );
  assert.strictEqual(resetClientPassword(token, 'newpassword', db), null);
  db.close();
});

test('resetClientPassword rejects a password shorter than 8 characters', () => {
  const db = openDb(':memory:');
  registerClient({ email: 'shortreset@example.com', password: 'correcthorse' }, db);
  const { token } = requestPasswordReset('shortreset@example.com', db);
  assert.throws(() => resetClientPassword(token, 'short', db), /at least 8/);
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
