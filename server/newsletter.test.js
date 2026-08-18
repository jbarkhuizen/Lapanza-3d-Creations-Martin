import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { subscribe, confirm, unsubscribe, listSubscribers } from './newsletter.js';

test('subscribe creates a pending subscriber with a token', () => {
  const db = openDb(':memory:');
  const { subscriber, token, alreadyConfirmed } = subscribe('new@example.com', db);
  assert.strictEqual(subscriber.status, 'pending');
  assert.ok(token);
  assert.strictEqual(alreadyConfirmed, false);
  db.close();
});

test('confirm flips status to confirmed and is single-use', () => {
  const db = openDb(':memory:');
  const { token } = subscribe('confirmme@example.com', db);
  const confirmed = confirm(token, db);
  assert.strictEqual(confirmed.status, 'confirmed');
  // Re-confirming the same token should fail -- confirm() only matches rows
  // still in 'pending' status.
  assert.strictEqual(confirm(token, db), null);
  db.close();
});

test('confirm returns null for an unknown token', () => {
  const db = openDb(':memory:');
  assert.strictEqual(confirm('bogus-token', db), null);
  db.close();
});

test('subscribing an already-confirmed email is a no-op (idempotent, no new email)', () => {
  const db = openDb(':memory:');
  const { token } = subscribe('repeat@example.com', db);
  confirm(token, db);
  const second = subscribe('repeat@example.com', db);
  assert.strictEqual(second.alreadyConfirmed, true);
  assert.strictEqual(listSubscribers({}, db).length, 1);
  db.close();
});

test('unsubscribe works from confirmed status and the same token keeps working afterward for lookups', () => {
  const db = openDb(':memory:');
  const { token } = subscribe('byebye@example.com', db);
  confirm(token, db);
  const result = unsubscribe(token, db);
  assert.strictEqual(result.status, 'unsubscribed');
  db.close();
});

test('re-subscribing an unsubscribed email resets it to pending with a fresh token', () => {
  const db = openDb(':memory:');
  const { token: firstToken } = subscribe('rejoin@example.com', db);
  confirm(firstToken, db);
  unsubscribe(firstToken, db);
  const { subscriber, token: secondToken } = subscribe('rejoin@example.com', db);
  assert.strictEqual(subscriber.status, 'pending');
  assert.notStrictEqual(secondToken, firstToken);
  db.close();
});

test('subscribe rejects an empty email', () => {
  const db = openDb(':memory:');
  assert.throws(() => subscribe('', db), /required/);
  db.close();
});
