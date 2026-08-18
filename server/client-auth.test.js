import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createClient, findClientByEmail, registerClient, verifyClientEmail, loginClient } from './clients.js';

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
