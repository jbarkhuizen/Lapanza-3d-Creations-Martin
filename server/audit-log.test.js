import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { AUDIT_EVENTS, recordAuditEvent, listAuditLog } from './audit-log.js';

test('recordAuditEvent + listAuditLog round-trip, newest first', () => {
  const db = openDb(':memory:');
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, adminId: 'a1', username: 'johan', ip: '127.0.0.1', userAgent: 'curl/8', detail: '' }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGOUT, adminId: 'a1', username: 'johan', ip: '127.0.0.1' }, db);

  const entries = listAuditLog({}, db);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].eventType, AUDIT_EVENTS.LOGOUT);
  assert.strictEqual(entries[1].eventType, AUDIT_EVENTS.LOGIN_SUCCESS);
  assert.strictEqual(entries[1].username, 'johan');
  assert.strictEqual(entries[1].ipAddress, '127.0.0.1');
  db.close();
});

test('listAuditLog filters by eventType and by q across username/ip/detail', () => {
  const db = openDb(':memory:');
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_FAILURE, username: 'martin', ip: '10.0.0.5', detail: 'Invalid username or password' }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'johan', ip: '10.0.0.9' }, db);

  assert.strictEqual(listAuditLog({ eventType: AUDIT_EVENTS.LOGIN_FAILURE }, db).length, 1);
  assert.strictEqual(listAuditLog({ q: 'martin' }, db).length, 1);
  assert.strictEqual(listAuditLog({ q: '10.0.0' }, db).length, 2);
  assert.strictEqual(listAuditLog({ q: 'nobody' }, db).length, 0);
  db.close();
});

test('listAuditLog clamps limit into [1, 1000] instead of trusting caller input', () => {
  const db = openDb(':memory:');
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'a' }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'b' }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'c' }, db);

  assert.strictEqual(listAuditLog({ limit: 1 }, db).length, 1);
  assert.strictEqual(listAuditLog({ limit: 0 }, db).length, 1); // clamped up to the floor, not "no limit"
  assert.strictEqual(listAuditLog({ limit: -5 }, db).length, 1);
  assert.strictEqual(listAuditLog({ limit: 'not-a-number' }, db).length, 3); // falls back to the 500 default
  db.close();
});

test('recordAuditEvent does not throw when the database is closed', () => {
  const db = openDb(':memory:');
  db.close();
  // Simulates the DB-unreachable case this function is specifically written
  // not to propagate -- an audit-write failure must never surface as a
  // failure of the login/logout/admin action it's recording.
  assert.doesNotThrow(() => recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, username: 'x' }, db));
});
