// Backlog #120: actionable alerts for backup failures, email delivery
// failures, and payment failures -- before this, all three were console-only
// (systemd journal) or, at best, an audit_log row nobody proactively checks
// (see AUDIT_EVENTS.EMAIL_FAILURE's own comment in audit-log.js). This
// module is the one place that decides whether a failure is worth
// interrupting the owner about, and sends that interruption.
//
// Deliberately NOT wired into the Settings -> Communications wording system
// (server/email-template.js's settings.emailTemplates): these are urgent,
// technical, code-authored messages, not customer-facing copy -- the
// Settings -> Operational Alerts panel controls whether/how often they fire
// (enable toggles, thresholds), not their wording. Letting an alert's
// WORDING be edited risks an admin accidentally softening or losing the
// actual diagnostic detail; letting an alert be enabled/disabled/tuned does not.
import { getDb } from './db.js';
import { getSettings } from './settings.js';
import { AUDIT_EVENTS } from './audit-log.js';
import { sendOperationalAlertEmail } from './mailer.js';
import { sendWhatsAppTemplate, isWhatsAppConfigured } from './whatsapp.js';

// In-memory only (like the session stores elsewhere in this codebase) --
// resets on restart, which just means "the first occurrence after a deploy
// always alerts," an acceptable/desired default rather than a bug to fix.
const recentAlerts = new Map();
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

// Keyed (not global) so e.g. two DIFFERENT checkout error messages, or two
// DIFFERENT orders' payment failures, each still get their own alert --
// only a genuine repeat of the exact same failure is suppressed.
function shouldFire(key, cooldownMs = DEFAULT_COOLDOWN_MS) {
  const now = Date.now();
  const last = recentAlerts.get(key);
  if (last && now - last < cooldownMs) return false;
  recentAlerts.set(key, now);
  return true;
}

// Never let a failure to SEND the alert propagate -- the caller (a backup
// job, a webhook handler) must not fail because notifying about a problem
// itself had a problem. Console is the honest last resort.
async function fireEmailAlert(subject, message) {
  try {
    await sendOperationalAlertEmail(subject, message);
  } catch (err) {
    console.error('Failed to send operational alert email:', err.message);
  }
}

export async function alertBackupFailure(context, err, db = getDb()) {
  const settings = getSettings(db);
  if (!settings.alertBackupFailureEnabled) return;
  if (!shouldFire(`backup:${context}`)) return;
  await fireEmailAlert(
    `Backup failure: ${context}`,
    `${context} failed.\n\nError: ${err.message}\n\nCheck the server (systemd journal: sudo journalctl -u lapanza-admin) or the admin Backups view for detail.`,
  );
}

export async function alertPaymentFailure(context, detail, db = getDb()) {
  const settings = getSettings(db);
  if (!settings.alertPaymentFailureEnabled) return;
  if (!shouldFire(`payment:${context}`)) return;
  await fireEmailAlert(`Payment processing failure: ${context}`, `${context}\n\n${detail}\n\nCheck Invoice History and the admin Audit Logs (event type: payment_failure) for the affected order.`);
}

// Checkout can reject a request for entirely ordinary reasons (empty cart,
// out of stock, an invalid shipping/payment method the client sent) -- none
// of those are a system problem worth waking anyone up about. Only alert on
// an error that does NOT match one of createOrder()'s own known validation
// messages (server/orders.js) -- i.e. something unexpected actually broke.
const EXPECTED_CHECKOUT_ERROR_PATTERNS = [
  /^Invalid payment method$/,
  /^Invalid shipping method$/,
  /^Cash on Collection is only available/,
  /^Cart is empty$/,
  /^Product no longer available:/,
  /^Out of stock:/,
  /^Selected shipping option/,
  /^No shipping option available/,
];

export function isExpectedCheckoutValidationError(message) {
  return EXPECTED_CHECKOUT_ERROR_PATTERNS.some((re) => re.test(message || ''));
}

export async function alertCheckoutError(err, db = getDb()) {
  if (isExpectedCheckoutValidationError(err.message)) return;
  const settings = getSettings(db);
  if (!settings.alertCheckoutErrorEnabled) return;
  if (!shouldFire(`checkout:${err.message}`)) return;
  await fireEmailAlert(
    'Unexpected checkout error',
    `A checkout request failed with an error that isn't a normal validation rejection (out of stock, empty cart, etc).\n\nError: ${err.message}\n\nCheck the server logs -- this may mean checkout is broken for customers.`,
  );
}

function countRecentAuditEvents(eventTypes, sinceMs, db = getDb()) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const placeholders = eventTypes.map(() => '?').join(',');
  const row = db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE event_type IN (${placeholders}) AND created_at >= ?`).get(...eventTypes, since);
  return row.c;
}

// The one alert type that can't reliably reach the owner by email -- if
// Gmail itself is down/misconfigured, an email ABOUT email being down never
// arrives. Falls back to WhatsApp (already wired for campaigns, see
// server/whatsapp.js) once N consecutive-ish failures land in a 1-hour
// window. Requires BOTH a configured Meta WhatsApp Business Cloud API
// (WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID env vars) AND a Meta-
// approved template name (settings.alertEmailFallbackWhatsappTemplateName)
// -- WhatsApp's own rules require every business-initiated template to be
// pre-approved in Meta Business Manager; this can't provision one on its
// own. Degrades to a console.error until both exist, same as every other
// WhatsApp feature in this codebase.
const EMAIL_FALLBACK_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function checkEmailFallback(db = getDb()) {
  const settings = getSettings(db);
  if (!settings.alertEmailFallbackEnabled) return;
  const threshold = Number(settings.alertEmailFallbackThreshold) || 3;
  const count = countRecentAuditEvents([AUDIT_EVENTS.EMAIL_FAILURE], EMAIL_FALLBACK_WINDOW_MS, db);
  if (count < threshold) return;
  if (!shouldFire('email-fallback', EMAIL_FALLBACK_WINDOW_MS)) return;
  const to = settings.alertEmailFallbackWhatsappNumber;
  const templateName = settings.alertEmailFallbackWhatsappTemplateName;
  if (!to || !templateName || !isWhatsAppConfigured()) {
    console.error(
      `Email delivery looks broken (${count} failed sends in the last hour) but WhatsApp fallback isn't fully configured -- set a WhatsApp number + Meta-approved template name in Settings -> Operational Alerts, and WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID on the server.`,
    );
    return;
  }
  try {
    await sendWhatsAppTemplate({
      to,
      templateName,
      params: [`${count} emails failed to send in the last hour — check Audit Logs (email_failure) and Gmail app-password config.`],
    });
  } catch (err) {
    console.error('Email-fallback WhatsApp alert failed to send:', err.message);
  }
}

// Security/abuse signals (rate_limit_exceeded, unauthorized_access,
// client_login_failure -- see audit-log.js) were previously "visible when
// you look, not something that pages you." A single one of any of these is
// normal background noise (a bot, a mistyped password); a BURST across a
// short window is the actual signal worth a real alert.
const SECURITY_EVENT_TYPES = [AUDIT_EVENTS.RATE_LIMIT_EXCEEDED, AUDIT_EVENTS.UNAUTHORIZED_ACCESS, AUDIT_EVENTS.CLIENT_LOGIN_FAILURE];

export async function checkSecuritySpike(db = getDb()) {
  const settings = getSettings(db);
  if (!settings.alertSecuritySpikeEnabled) return;
  const threshold = Number(settings.alertSecuritySpikeThreshold) || 10;
  const windowMs = (Number(settings.alertSecuritySpikeWindowMinutes) || 15) * 60 * 1000;
  const count = countRecentAuditEvents(SECURITY_EVENT_TYPES, windowMs, db);
  if (count < threshold) return;
  if (!shouldFire('security-spike', windowMs)) return;
  await fireEmailAlert(
    'Security signal spike',
    `${count} rate-limit/unauthorized-access/login-failure events in the last ${settings.alertSecuritySpikeWindowMinutes || 15} minutes (threshold: ${threshold}).\n\nCheck the admin Audit Logs page (filter: Rate Limit Exceeded / Unauthorized Access / Client Login Failure) to see if this is a bot/abuse pattern worth blocking at the firewall level.`,
  );
}

// Test-only escape hatch -- the module-level cooldown map would otherwise
// leak state between unrelated test cases running in the same process.
export function _resetAlertCooldowns() {
  recentAlerts.clear();
}
