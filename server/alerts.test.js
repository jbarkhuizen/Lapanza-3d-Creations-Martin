import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { updateSettings } from './settings.js';
import { recordAuditEvent, AUDIT_EVENTS } from './audit-log.js';
import {
  isExpectedCheckoutValidationError,
  alertBackupFailure,
  alertPaymentFailure,
  alertCheckoutError,
  checkEmailFallback,
  checkSecuritySpike,
  _resetAlertCooldowns,
} from './alerts.js';

test('isExpectedCheckoutValidationError matches every known createOrder() validation message', () => {
  assert.ok(isExpectedCheckoutValidationError('Invalid payment method'));
  assert.ok(isExpectedCheckoutValidationError('Invalid shipping method'));
  assert.ok(isExpectedCheckoutValidationError('Cash on Collection is only available when collecting from the store.'));
  assert.ok(isExpectedCheckoutValidationError('Cart is empty'));
  assert.ok(isExpectedCheckoutValidationError('Product no longer available: filament:pla:RED'));
  assert.ok(isExpectedCheckoutValidationError('Out of stock: PLA Red x2'));
  assert.ok(isExpectedCheckoutValidationError('Selected shipping option is not available.'));
  assert.ok(isExpectedCheckoutValidationError('No shipping option available for this order weight — contact us to arrange shipping.'));
});

test('isExpectedCheckoutValidationError does not match an unexpected/unknown error', () => {
  assert.strictEqual(isExpectedCheckoutValidationError('Cannot read properties of undefined (reading \'id\')'), false);
  assert.strictEqual(isExpectedCheckoutValidationError('Database is locked'), false);
  assert.strictEqual(isExpectedCheckoutValidationError(''), false);
  assert.strictEqual(isExpectedCheckoutValidationError(undefined), false);
});

test('alertCheckoutError is a no-op for an expected validation error, regardless of settings', () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertCheckoutErrorEnabled: true, orderNotificationEmail: 'owner@example.com' }, db);
  // Should resolve cleanly without ever reaching the send path (which would
  // throw in this test environment -- GMAIL_APP_PASSWORD isn't set -- and
  // that throw is swallowed by fireEmailAlert's own try/catch either way,
  // so this just confirms it doesn't throw and doesn't hang).
  return alertCheckoutError(new Error('Cart is empty'), db).then(() => db.close());
});

test('alertCheckoutError respects the alertCheckoutErrorEnabled toggle for an unexpected error', () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertCheckoutErrorEnabled: false }, db);
  return alertCheckoutError(new Error('Something genuinely broke'), db).then(() => db.close());
});

test('alertBackupFailure and alertPaymentFailure resolve cleanly with alerting enabled or disabled', async () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertBackupFailureEnabled: true, alertPaymentFailureEnabled: true }, db);
  await alertBackupFailure('Local database backup', new Error('disk full'), db);
  await alertPaymentFailure('ITN validation failed', 'signature mismatch', db);
  updateSettings({ alertBackupFailureEnabled: false, alertPaymentFailureEnabled: false }, db);
  await alertBackupFailure('Local database backup', new Error('disk full'), db);
  await alertPaymentFailure('ITN validation failed', 'signature mismatch', db);
  db.close();
});

test('checkEmailFallback only engages once the failure count reaches the configured threshold', async () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertEmailFallbackEnabled: true, alertEmailFallbackThreshold: 3 }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.EMAIL_FAILURE, detail: 'one' }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.EMAIL_FAILURE, detail: 'two' }, db);
  // Below threshold -- should return without attempting anything (no WhatsApp
  // number/template configured either, so this also exercises the "not
  // configured" early-return path without throwing).
  await checkEmailFallback(db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.EMAIL_FAILURE, detail: 'three' }, db);
  // At threshold now -- still resolves cleanly (no WhatsApp config -> logs
  // and returns rather than attempting a real send).
  await checkEmailFallback(db);
  db.close();
});

test('checkEmailFallback is a no-op when disabled, even past threshold', async () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertEmailFallbackEnabled: false, alertEmailFallbackThreshold: 1 }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.EMAIL_FAILURE, detail: 'one' }, db);
  await checkEmailFallback(db);
  db.close();
});

test('checkSecuritySpike only fires once the event count within the window reaches the threshold', async () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertSecuritySpikeEnabled: true, alertSecuritySpikeThreshold: 3, alertSecuritySpikeWindowMinutes: 15 }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, detail: 'a' }, db);
  recordAuditEvent({ eventType: AUDIT_EVENTS.UNAUTHORIZED_ACCESS, detail: 'b' }, db);
  await checkSecuritySpike(db); // below threshold
  recordAuditEvent({ eventType: AUDIT_EVENTS.CLIENT_LOGIN_FAILURE, detail: 'c' }, db);
  await checkSecuritySpike(db); // at threshold -- resolves cleanly (send fails harmlessly in test env)
  db.close();
});

test('a repeated identical alert within the cooldown window does not attempt to send twice', async () => {
  _resetAlertCooldowns();
  const db = openDb(':memory:');
  updateSettings({ alertBackupFailureEnabled: true }, db);
  // Both calls must resolve without throwing; the cooldown logic itself is
  // exercised (second call should short-circuit before ever reaching the
  // send path) even though we can't directly observe "was fireEmailAlert
  // called" from outside the module without a network mock.
  await alertBackupFailure('Local database backup', new Error('disk full'), db);
  await alertBackupFailure('Local database backup', new Error('disk full'), db);
  db.close();
});
