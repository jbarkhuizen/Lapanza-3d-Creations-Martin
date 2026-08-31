import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { getSettings, updateSettings, publicSettings } from './settings.js';
import { FONT_OPTIONS, DEFAULT_SETTINGS } from './settings-defaults.js';
import { hasAnyAdmin, listAdmins, createAdmin, deleteAdmin, resetPassword, verifyLogin } from './admins.js';
import { AUDIT_EVENTS, recordAuditEvent, listAuditLog } from './audit-log.js';
import {
  listFilaments,
  getFilament,
  createFilament,
  updateFilament,
  deleteFilament,
  addColour,
  updateColour,
  deleteColour,
  setColourImage,
} from './filaments.js';
import multer from 'multer';
import {
  uploadFilamentImage,
  uploadResourceImage,
  uploadResourceFile,
  deleteResourceFile,
  uploadDesignRequestAssets,
  deleteDesignRequestFile,
  uploadPrintJobImage,
  uploadPrintJobFile,
  uploadCategoryItemImage,
  deleteCategoryItemImage,
  uploadTestimonialImage,
  deleteTestimonialImage,
} from './uploads.js';
import { syncPublicJson, readCategoryProducts } from './export.js';
import { formatRand } from './money.js';
import { renderInvoiceHtml } from './invoice.js';
import { saveCatalog, getProduct, upsertProduct, deleteProduct } from './store.js';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  listOrdersForClient,
  registerClient,
  verifyClientEmail,
  loginClient,
  requestPasswordReset,
  resetClientPassword,
  setWhatsAppOptIn,
  manuallyVerifyClient,
  setClientDisabled,
  regenerateVerificationToken,
  deleteOrRevokeClient,
  mergeClients,
} from './clients.js';
import {
  listShippingOptions,
  getShippingOption,
  createShippingOption,
  updateShippingOption,
  deleteShippingOption,
  matchShippingForWeight,
} from './shipping.js';
import {
  listOrders,
  getOrder,
  resolveProductSnapshot,
  createOrder,
  createManualOrder,
  updateOrderStatus,
  updateOrderTracking,
  markOrderPaid,
  markConfirmationEmailSent,
  recordPaymentTransaction,
  cancelOrderByClient,
  deleteOrder,
} from './orders.js';
import { buildPayfastRedirect, verifyItn, PAYFAST_URLS } from './payfast.js';
import {
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
  sendRestockEmail,
  sendInvoiceEmail,
  sendLowStockAlert,
  sendClientVerificationEmail,
  sendClientPasswordResetEmail,
  sendNewsletterConfirmationEmail,
  sendDesignRequestStatusEmail,
  sendNewOrderNotificationEmail,
  sendNewDesignRequestNotificationEmail,
  sendOrderCancelledNotificationEmail,
} from './mailer.js';
import { alertPaymentFailure, alertCheckoutError, checkEmailFallback, checkSecuritySpike } from './alerts.js';
import { subscribe as subscribeNewsletter, confirm as confirmNewsletter, unsubscribeMarketing } from './newsletter.js';
import {
  listCampaigns as listNewsletterCampaigns,
  createCampaign as createNewsletterCampaign,
  listEligibleRecipients as listNewsletterRecipients,
  listCampaignRecipients as listNewsletterCampaignRecipients,
  getCampaignAnalytics as getNewsletterCampaignAnalytics,
  approveCampaign as approveNewsletterCampaign,
  sendTestCampaign,
  queueCampaign as queueNewsletterCampaign,
} from './newsletter-campaigns.js';
import {
  listCampaigns as listWhatsAppCampaigns,
  createCampaign as createWhatsAppCampaign,
  approveCampaign as approveWhatsAppCampaign,
  sendCampaign as sendWhatsAppCampaign,
} from './whatsapp-campaigns.js';
import { isWhatsAppConfigured } from './whatsapp.js';
import { startAutoCancelJob, startAutoBackupJob, startAuditLogPruneJob, startPageViewsPruneJob } from './jobs.js';
import { createBackup, listBackups, deleteBackup, getBackupPath, syncOffsite } from './backups.js';
import { recordPageView, touchActiveVisitor, getActiveVisitors, getVisitSummary, recordEvent, getEventSummary } from './analytics.js';
import { listInventory, bulkUpdateInventory } from './inventory.js';
import { listResources, getResource, createResource, updateResource, deleteResource } from './resources.js';
import { listTestimonials, getTestimonial, createTestimonial, updateTestimonial, deleteTestimonial } from './testimonials.js';
import { listDesignRequests, getDesignRequest, createDesignRequest, updateDesignRequest, deleteDesignRequest } from './design-requests.js';
import {
  listPrintJobs,
  getPrintJob,
  createPrintJob,
  updatePrintJob,
  deletePrintJob,
  previewPrintJobCost,
  setPrintJobImage,
  setPrintJobFile,
  listPrintJobForSale,
  updatePrintJobListing,
} from './print-jobs.js';
import {
  listInHouseFilament,
  getInHouseFilament,
  createInHouseFilament,
  updateInHouseFilament,
  deleteInHouseFilament,
  transferStockRoll,
} from './in-house-filament.js';
import { listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase } from './purchases.js';
import { getVersion, listVersions } from './version-history.js';
import { getReleaseDetails } from './release-details.js';
import { listTodos, createTodo, updateTodo } from './todos.js';
import { getDocumentation, listDocumentation } from './documentation.js';
import { getTestRun, listTestCases, listTestRuns, startTestRun } from './test-runs.js';
import { getSiteOverview, listSiteDirectory } from './site-overview.js';
import { createImportedTemplate, createTemplate, listTemplates } from './newsletter-content.js';
import { generateImageVariants } from './images.js';
import { itemAnchorId, filamentPagePath, categoryPagePath } from './item-anchor.js';
import { subscribeRestock, unsubscribeRestock, listPendingRestockSubscriptions, processRestockNotifications } from './restock.js';

// Loads .env into process.env for local dev (real Payfast/Gmail secrets
// never get committed -- see .env.example). Silently no-ops if the file
// doesn't exist (production hosts set real env vars directly, not via a
// file) or if this Node version predates loadEnvFile (added Node 20.6).
// Doesn't need to run before the imports above: payfast.js/mailer.js read
// process.env lazily inside their functions, not into module-load-time
// constants, specifically so nothing reads env vars until an actual
// request comes in -- well after this line and after app.listen() below.
try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env file -- fine, env vars may be set directly by the host */
}

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
const newsletterAssetDir = path.join(root, 'public', 'uploads', 'newsletters');
const newsletterAssetUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(newsletterAssetDir, { recursive: true }); cb(null, newsletterAssetDir); },
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.bin')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});
const newsletterTemplateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 } });
// Render (and most PaaS hosts) inject PORT and require the app to bind to
// it -- ADMIN_PORT is this project's own local-dev override, checked second.
const PORT = Number(process.env.PORT || process.env.ADMIN_PORT || 8787);
const SESSION_COOKIE = 'lapanza_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h -- shared between the cookie maxAge and the server-side expiry check

const app = express();
// Behind nginx in production (single hop) -- without this, express-rate-limit
// throws on the X-Forwarded-For header nginx sets, since Express doesn't yet
// know it's safe to trust it for req.ip. Harmless locally (no proxy in front).
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(root, 'public', 'uploads')));

const sessions = new Map();

// Shared by every security-relevant limiter below (not analyticsLimiter --
// tripping that one is heavy legitimate traffic, not an abuse signal). Kept
// as a plain function (not an arrow const) so it's hoisted -- it references
// recordAuditEvent/requestMeta/AUDIT_EVENTS, which are declared further down
// this file; that's fine since this only ever *runs* at request time, well
// after the whole module has finished loading.
function rateLimitHandler(limiterName) {
  return (req, res, _next, options) => {
    recordAuditEvent({
      eventType: AUDIT_EVENTS.RATE_LIMIT_EXCEEDED,
      detail: `${limiterName}: ${req.method} ${req.originalUrl}`,
      ...requestMeta(req),
    });
    checkSecuritySpike().catch(() => {});
    res.status(options.statusCode).json(options.message);
  };
}

// In-memory, per-process limiters -- consistent with the rest of the app's
// single-process assumption (sessions Maps above have the same limitation).
// authLimiter guards brute-force login/registration attempts; publicFormLimiter
// guards unauthenticated public-write endpoints (newsletter signup, design
// request submission) against spam.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a few minutes and try again.' },
  handler: rateLimitHandler('authLimiter'),
});
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions — please try again later.' },
  handler: rateLimitHandler('publicFormLimiter'),
});
// Every other public-write endpoint (register, login, newsletter, design
// requests) is rate-limited except this one -- checkout was the gap. Looser
// than publicFormLimiter (a real shopper can plausibly retry a failed
// payment or fix a validation error a few times in one session) but still
// low enough to stop a script from hammering it -- each hit creates a real
// order row, reserves stock, and fires an owner-notification email.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checkout attempts — please wait a few minutes and try again.' },
  handler: rateLimitHandler('checkoutLimiter'),
});
// Much more permissive than the two above -- legitimate traffic hits this
// on every page load plus a ~45s heartbeat while a tab stays open (see
// src/js/analytics.js), so a form-submission-style 5-per-hour limit would
// break real visitor tracking, not just abuse.
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

// better-sqlite3 throws a raw SqliteError (not something route handlers can
// turn into clean JSON on their own) when a duplicate slug or SKU hits a
// UNIQUE column. Without catching this, Express's default handler returns a
// raw 500 HTML page instead of a usable error message.
function isUniqueConstraintError(err) {
  return Boolean(err) && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(err.message || ''));
}

function uniqueConstraintMessage(err) {
  const msg = err.message || '';
  if (msg.includes('.slug')) return 'That slug is already in use';
  if (msg.includes('.sku')) return 'That SKU is already in use';
  return 'That value is already in use';
}

// req.ip reflects the real client address, not nginx's -- see the `trust
// proxy` setting above.
function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || null };
}

// Every outbound-email call site in this file used to just console.error on
// failure -- meaning a broken Gmail app password (the actual cause behind
// one real "verify email not working" report) was invisible outside SSH/
// server logs. `req` is optional since a couple of call sites (the low-stock
// alert loop) run outside any request.
function logEmailFailure(context, err, req = null) {
  console.error(`${context} failed to send:`, err.message);
  recordAuditEvent({
    eventType: AUDIT_EVENTS.EMAIL_FAILURE,
    detail: `${context}: ${err.message}`,
    ...(req ? requestMeta(req) : {}),
  });
  // Fire-and-forget: logEmailFailure is called from many sync call sites
  // that don't await it. checkEmailFallback() (server/alerts.js) counts
  // recent failures and, past a threshold, falls back to WhatsApp -- since
  // email itself may be the thing that's broken, this can't be an emailed
  // alert. Swallow any error here; it already logs its own failure internally.
  checkEmailFallback().catch(() => {});
}

function requireAuth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  const session = token && sessions.get(token);
  if (!session) {
    // Only when there's no cookie at all -- a probe/bot hitting an admin API
    // path directly, never having been through login. A cookie that exists
    // but points at nothing (e.g. every admin's first request after a
    // routine restart wipes the in-memory sessions Map -- Won't Fix #4) is
    // NOT logged here; that's expected, not a security signal.
    if (!token) {
      recordAuditEvent({ eventType: AUDIT_EVENTS.UNAUTHORIZED_ACCESS, detail: `${req.method} ${req.originalUrl}`, ...requestMeta(req) });
      checkSecuritySpike().catch(() => {});
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (Date.now() - session.createdAt >= SESSION_TTL_MS) {
    sessions.delete(token); // stale -- treat exactly like a missing session
    recordAuditEvent({ eventType: AUDIT_EVENTS.SESSION_EXPIRED, adminId: session.adminId, username: session.username, ...requestMeta(req) });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Downstream handlers (admin management routes) use this to attribute the
  // action to the admin who performed it, separate from the admin id the
  // action itself targets.
  req.adminId = session.adminId;
  req.adminUsername = session.username;
  next();
}

function startSession(res, adminId, username) {
  const token = randomUUID();
  sessions.set(token, { createdAt: Date.now(), adminId, username });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
}

// Revokes every live session belonging to a given admin -- used when that
// admin is removed or has their password reset, so a stolen/stale cookie
// can't keep working for up to SESSION_TTL_MS afterward.
function revokeSessionsForAdmin(adminId) {
  for (const [token, session] of sessions) {
    if (session.adminId === adminId) sessions.delete(token);
  }
}

// ---- Client accounts (Phase 2) ----
// Parallel to, but entirely separate from, the admin session system above:
// own cookie, own in-memory session store, own TTL constant kept in sync by
// value only. Deliberately not unified into one sessions Map/role column --
// keeps the admin portal's security model (and its requireAuth checks)
// unchanged while giving customers their own login.
const CLIENT_SESSION_COOKIE = 'lapanza_client_session';
const clientSessions = new Map();

function requireClientAuth(req, res, next) {
  const token = req.cookies[CLIENT_SESSION_COOKIE];
  const session = token && clientSessions.get(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (Date.now() - session.createdAt >= SESSION_TTL_MS) {
    clientSessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.clientId = session.clientId;
  next();
}

function startClientSession(res, clientId) {
  const token = randomUUID();
  clientSessions.set(token, { createdAt: Date.now(), clientId });
  res.cookie(CLIENT_SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
}

// Password reset proves the requester currently controls the mailbox, but
// says nothing about any session opened before that -- e.g. on a device
// that had the account logged in without permission. Mirrors
// revokeSessionsForAdmin above.
function revokeSessionsForClient(clientId) {
  for (const [token, session] of clientSessions) {
    if (session.clientId === clientId) clientSessions.delete(token);
  }
}

function siteUrlFor(req) {
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  return process.env.SITE_URL || requestOrigin;
}

app.post('/api/client/register', authLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    // First/last name mandatory for a real customer signing up through the
    // public form -- registerClient() itself stays lenient (many other call
    // sites, and most of client-auth.test.js, create a minimal test account
    // with just email+password as a fixture unrelated to what they're
    // actually testing), so this validates at the route, not the shared fn.
    if (!String(body.firstName || '').trim()) return res.status(400).json({ error: 'First name is required' });
    if (!String(body.lastName || '').trim()) return res.status(400).json({ error: 'Surname is required' });
    const { client, token } = registerClient(body);
    const verifyUrl = `${req.protocol}://${req.get('host')}/api/client/verify?token=${token}`;
    try {
      await sendClientVerificationEmail(client, verifyUrl);
    } catch (err) {
      logEmailFailure('Verification email', err, req);
    }
    res.status(201).json({ ok: true, message: 'Account created — check your email to verify it before logging in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/client/verify', (req, res) => {
  const client = verifyClientEmail(req.query.token);
  const siteUrl = siteUrlFor(req);
  if (!client) return res.redirect(`${siteUrl}/index.html?verified=0`);
  res.redirect(`${siteUrl}/index.html?verified=1`);
});

app.post('/api/client/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
    recordAuditEvent({ eventType: AUDIT_EVENTS.CLIENT_LOGIN_FAILURE, username: typeof email === 'string' ? email : null, ...requestMeta(req), detail: 'Missing or malformed credentials' });
    checkSecuritySpike().catch(() => {});
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const result = loginClient(email, password);
  if (!result.ok && result.reason === 'disabled') {
    return res.status(403).json({ error: 'This account has been disabled. Contact us if you believe this is a mistake.' });
  }
  if (!result.ok && result.reason === 'unverified') {
    return res.status(403).json({ error: 'Please verify your email before logging in — check your inbox for the verification link.' });
  }
  if (!result.ok) {
    recordAuditEvent({ eventType: AUDIT_EVENTS.CLIENT_LOGIN_FAILURE, username: email, ...requestMeta(req), detail: 'Invalid email or password' });
    checkSecuritySpike().catch(() => {});
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  startClientSession(res, result.client.id);
  res.json({ ok: true, client: result.client });
});

// Always returns the same generic message regardless of whether the email
// has an account -- same email-enumeration guard as loginClient's 'invalid'
// reason. The actual reset link only ever goes out over email, never in
// this response.
app.post('/api/client/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  const GENERIC_MESSAGE = "If an account exists for that email, we've sent a link to reset the password.";
  if (typeof email !== 'string' || !email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  try {
    const result = requestPasswordReset(email);
    if (result) {
      const resetUrl = `${siteUrlFor(req)}/account.html?reset_token=${result.token}`;
      try {
        await sendClientPasswordResetEmail(result.client, resetUrl);
      } catch (err) {
        logEmailFailure('Password reset email', err, req);
      }
    }
  } catch (err) {
    console.error('Password reset request failed:', err.message);
  }
  res.json({ ok: true, message: GENERIC_MESSAGE });
});

app.post('/api/client/reset-password', authLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'Reset link is missing its token' });
  }
  try {
    const client = resetClientPassword(token, password);
    if (!client) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired — request a new one.' });
    }
    revokeSessionsForClient(client.id);
    startClientSession(res, client.id);
    res.json({ ok: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/client/logout', (req, res) => {
  const token = req.cookies[CLIENT_SESSION_COOKIE];
  if (token) clientSessions.delete(token);
  res.clearCookie(CLIENT_SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/client/me', (req, res) => {
  const token = req.cookies[CLIENT_SESSION_COOKIE];
  const session = token && clientSessions.get(token);
  if (!session) return res.json({ authenticated: false });
  const client = getClient(session.clientId);
  res.json({ authenticated: true, client });
});

app.get('/api/client/orders', requireClientAuth, (req, res) => {
  res.json({ orders: listOrdersForClient(req.clientId) });
});

// Self-service cancel, mirrored from the account page's "Cancel" button --
// only reachable for the caller's own order, and only while it's still
// pending_payment (see cancelOrderByClient). Same owner-notification email
// as the 7-day auto-cancel job, just a different `reason` string.
app.post('/api/client/orders/:id/cancel', requireClientAuth, async (req, res) => {
  try {
    const order = cancelOrderByClient(req.params.id, req.clientId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
    try {
      await sendOrderCancelledNotificationEmail(order, 'Cancelled by customer');
    } catch (err) {
      logEmailFailure('Order cancelled owner-notification email', err, req);
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Self-service equivalent of the admin PUT /api/clients/:id below, but
// explicitly allowlisted -- discountPct/discountNote/source are admin-only
// business fields (set from manual orders / the admin Clients view) and
// must never be reachable from a logged-in customer's own session.
app.patch('/api/client/me', requireClientAuth, (req, res) => {
  const body = req.body || {};
  try {
    const client = updateClient(req.clientId, {
      name: body.name,
      firstName: body.firstName,
      lastName: body.lastName,
      businessName: body.businessName,
      email: body.email,
      phone: body.phone,
      street: body.street,
      suburb: body.suburb,
      city: body.city,
      province: body.province,
      postalCode: body.postalCode,
      country: body.country,
      whatsappOptIn: body.whatsappOptIn,
      emailMarketingOptIn: body.emailMarketingOptIn,
      emailMarketingConsentSource: body.emailMarketingConsentSource,
    });
    res.json({ client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Visitor analytics (post-launch) ----
// Public beacon fired by src/js/analytics.js on every public page load
// (type: 'pageview') and roughly every 45s while a tab stays open and
// visible (type: 'heartbeat'). Never blocks or errors visibly to the
// visitor -- the client-side beacon call is fire-and-forget.

app.post('/api/analytics/beacon', analyticsLimiter, (req, res) => {
  // Owner exclusion: a browser holding a valid ADMIN session is the owner
  // (or this project's AI assistant) working on the site, not a visitor --
  // drop the beacon entirely. Complements the client-side ?analytics=off
  // opt-out for owner browsing that isn't admin-logged-in.
  const adminToken = req.cookies[SESSION_COOKIE];
  if (adminToken && sessions.get(adminToken)) return res.status(204).end();
  const { visitorId, path: pagePath, referrer, type } = req.body || {};
  // Opportunistic, non-blocking: attach the client if a valid session
  // cookie is present, same lookup requireClientAuth uses, but this route
  // works fine for anonymous visitors too -- it just never gets a clientId.
  const token = req.cookies[CLIENT_SESSION_COOKIE];
  const session = token && clientSessions.get(token);
  const clientId = session && Date.now() - session.createdAt < SESSION_TTL_MS ? session.clientId : null;

  try {
    if (type === 'heartbeat') {
      touchActiveVisitor({ visitorId, clientId, path: pagePath });
    } else if (type === 'event') {
      // Backlog #113: eventType validated against the fixed server-side
      // vocabulary inside recordEvent -- unknown types are dropped, and
      // payment_complete only ever comes from the ITN handler, not here.
      const { eventType, detail } = req.body || {};
      if (eventType !== 'payment_complete') recordEvent({ visitorId, clientId, eventType, path: pagePath, detail });
    } else {
      recordPageView({ visitorId, clientId, path: pagePath, referrer });
    }
    res.status(204).end();
  } catch {
    // Malformed beacon (missing visitorId/path) -- not worth a 400 that the
    // fire-and-forget client-side call will never look at anyway.
    res.status(204).end();
  }
});

app.get('/api/analytics/active', requireAuth, (_req, res) => {
  res.json(getActiveVisitors());
});

app.get('/api/analytics/summary', requireAuth, (_req, res) => {
  res.json({ ...getVisitSummary(), events: getEventSummary() });
});

// Phase 4: the post-checkout opt-in prompt toggles this without requiring a
// login -- email-matched as a lightweight guard (it only flips a consent
// flag, not real auth) rather than gated behind requireClientAuth.
app.patch('/api/client/:id/marketing-preferences', publicFormLimiter, (req, res) => {
  const { email, whatsappOptIn } = req.body || {};
  if (typeof email !== 'string' || !email) return res.status(400).json({ error: 'Email is required' });
  const updated = setWhatsAppOptIn(req.params.id, email, Boolean(whatsappOptIn));
  if (!updated) return res.status(404).json({ error: 'Client not found' });
  res.json({ ok: true });
});

// ---- Newsletter double opt-in (Phase 2) ----

app.post('/api/newsletter/subscribe', publicFormLimiter, async (req, res) => {
  try {
    const { token, alreadyConfirmed } = subscribeNewsletter((req.body || {}).email);
    if (!alreadyConfirmed) {
      const base = `${req.protocol}://${req.get('host')}/api/newsletter`;
      try {
        await sendNewsletterConfirmationEmail((req.body || {}).email, `${base}/confirm?token=${token}`, `${base}/unsubscribe?token=${token}`);
      } catch (err) {
        logEmailFailure('Newsletter confirmation email', err, req);
      }
    }
    res.status(201).json({ ok: true, message: alreadyConfirmed ? "You're already subscribed." : 'Check your email to confirm your subscription.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/newsletter/confirm', (req, res) => {
  const subscriber = confirmNewsletter(req.query.token);
  const siteUrl = siteUrlFor(req);
  res.redirect(`${siteUrl}/index.html?newsletter=${subscriber ? 'confirmed' : 'invalid'}`);
});

app.get('/api/newsletter/unsubscribe', (req, res) => {
  const subscriber = unsubscribeMarketing(req.query.token);
  const siteUrl = siteUrlFor(req);
  res.redirect(`${siteUrl}/index.html?newsletter=${subscriber ? 'unsubscribed' : 'invalid'}`);
});

// ---- Back-in-stock notifications (#43 / SITE-009) ----

app.post('/api/restock-subscriptions', publicFormLimiter, (req, res) => {
  try {
    subscribeRestock((req.body || {}).productId, (req.body || {}).email);
    // Same-shape response whether new or duplicate -- no enumeration of
    // who's already subscribed to what.
    res.status(201).json({ message: "Done — we'll email you the moment it's back." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/restock/unsubscribe', (req, res) => {
  const ok = unsubscribeRestock(req.query.token);
  const siteUrl = siteUrlFor(req);
  res.redirect(`${siteUrl}/index.html?restock=${ok ? 'unsubscribed' : 'invalid'}`);
});

app.get('/api/restock-subscriptions', requireAuth, (_req, res) => {
  res.json({ subscriptions: listPendingRestockSubscriptions() });
});

// ---- Newsletter campaigns: compose -> approve -> send (Phase 4) ----

app.get('/api/newsletter-campaigns', requireAuth, (_req, res) => {
  res.json({ campaigns: listNewsletterCampaigns() });
});

app.get('/api/newsletter-campaigns/analytics', requireAuth, (_req, res) => {
  res.json({ analytics: getNewsletterCampaignAnalytics() });
});

app.get('/api/newsletter-recipients', requireAuth, (_req, res) => {
  res.json({ recipients: listNewsletterRecipients() });
});

app.get('/api/newsletter-templates', requireAuth, (_req, res) => {
  res.json({ templates: listTemplates() });
});

app.post('/api/newsletter-templates', requireAuth, (req, res) => {
  try {
    const template = createTemplate(req.body || {});
    recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Saved newsletter template "${template.name}"` });
    res.status(201).json({ template });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/newsletter-templates/import', requireAuth, newsletterTemplateUpload.single('template'), (req, res) => {
  try {
    if (!req.file || !/\.html?$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Upload an HTML template under 500KB' });
    const template = createImportedTemplate({ name: req.body.name || req.file.originalname, subject: req.body.subject, html: req.file.buffer.toString('utf8') });
    recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Imported newsletter HTML template "${template.name}"` });
    res.status(201).json({ template });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/newsletter-assets', requireAuth, (_req, res) => {
  const assets = getDb().prepare('SELECT id, filename, url, alt_text AS altText, created_at AS createdAt FROM newsletter_assets ORDER BY created_at DESC').all();
  res.json({ assets });
});

app.post('/api/newsletter-assets', requireAuth, newsletterAssetUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a JPEG, PNG, or WebP image under 5MB' });
  const asset = { id: randomUUID(), filename: req.file.originalname, url: `/uploads/newsletters/${req.file.filename}`, altText: String(req.body.altText || '').trim(), createdAt: new Date().toISOString() };
  getDb().prepare('INSERT INTO newsletter_assets (id, filename, url, alt_text, created_at) VALUES (?, ?, ?, ?, ?)').run(asset.id, asset.filename, asset.url, asset.altText, asset.createdAt);
  recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Uploaded newsletter image "${asset.filename}"` });
  res.status(201).json({ asset });
});

app.get('/api/newsletter-campaigns/:id/recipients', requireAuth, (req, res) => {
  const campaign = listNewsletterCampaigns().find((item) => item.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ recipients: listNewsletterCampaignRecipients(req.params.id) });
});

app.post('/api/newsletter-campaigns', requireAuth, (req, res) => {
  try {
    const campaign = createNewsletterCampaign(req.body || {});
    recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Created newsletter draft "${campaign.subject}" for ${campaign.selectedCount} recipient(s)` });
    res.status(201).json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/newsletter-campaigns/:id/approve', requireAuth, (req, res) => {
  try {
    const campaign = approveNewsletterCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Approved newsletter campaign "${campaign.subject}"` });
    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/newsletter-campaigns/:id/send', requireAuth, async (req, res) => {
  try {
    const campaign = queueNewsletterCampaign(req.params.id, { siteUrl: siteUrlFor(req) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Queued newsletter campaign "${campaign.subject}" for ${campaign.selectedCount} recipient(s)` });
    res.status(202).json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/newsletter-campaigns/:id/test', requireAuth, async (req, res) => {
  try {
    const campaign = await sendTestCampaign(req.params.id, (req.body || {}).email, { siteUrl: siteUrlFor(req) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.MARKETING_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Sent newsletter test for "${campaign.subject}"` });
    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- WhatsApp campaigns: compose -> approve -> send (Phase 4) ----

app.get('/api/whatsapp-campaigns', requireAuth, (_req, res) => {
  res.json({ campaigns: listWhatsAppCampaigns(), configured: isWhatsAppConfigured() });
});

app.post('/api/whatsapp-campaigns', requireAuth, (req, res) => {
  try {
    res.status(201).json({ campaign: createWhatsAppCampaign(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/whatsapp-campaigns/:id/approve', requireAuth, (req, res) => {
  try {
    const campaign = approveWhatsAppCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/whatsapp-campaigns/:id/send', requireAuth, async (req, res) => {
  try {
    const campaign = await sendWhatsAppCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Verifies the database is actually reachable, not just that the Node
// process is alive -- a stuck/corrupted/locked DB is a far more likely
// real-world failure than the process itself dying, and a pure liveness
// check would report "ok" straight through that. Cheap enough (a single
// literal SELECT, no table access) to poll every few minutes from an
// external uptime monitor without adding real load.
app.get('/api/health', (_req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ ok: true, service: 'lapanza-admin', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'lapanza-admin', time: new Date().toISOString(), error: 'Database unreachable' });
  }
});

// Backlog #120, item 2: an external heartbeat for backup health, deliberately
// SEPARATE from /api/health above and unauthenticated for the same reason --
// meant to be polled by an external monitor (e.g. a second UptimeRobot
// check) so backup staleness is caught even if this site's OWN email
// alerting (alertBackupFailure, server/alerts.js) is what's broken. Flags
// stale at 30h, not 24h -- startAutoBackupJob (server/jobs.js) runs daily,
// so 30h gives a buffer for job-timing jitter before a monitor cries wolf.
const BACKUP_STALE_MS = 30 * 60 * 60 * 1000;

app.get('/api/health/backups', (_req, res) => {
  try {
    const backups = listBackups();
    const newest = backups[0];
    if (!newest) {
      return res.status(503).json({ ok: false, error: 'No backups exist yet' });
    }
    const ageMs = Date.now() - new Date(newest.createdAt).getTime();
    if (ageMs > BACKUP_STALE_MS) {
      return res.status(503).json({ ok: false, error: `Newest backup is stale (${Math.round(ageMs / (60 * 60 * 1000))}h old)`, newestBackupAt: newest.createdAt });
    }
    res.json({ ok: true, newestBackupAt: newest.createdAt });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.get('/api/setup/status', (_req, res) => {
  res.json({ needsSetup: !hasAnyAdmin() });
});

app.post('/api/setup', (req, res) => {
  if (hasAnyAdmin()) return res.status(409).json({ error: 'Setup already completed' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and an 8+ character password are required' });
  }
  try {
    const admin = createAdmin({ username, password });
    startSession(res, admin.id, admin.username);
    recordAuditEvent({ eventType: AUDIT_EVENTS.SETUP, adminId: admin.id, username: admin.username, ...requestMeta(req), detail: 'Initial admin account created' });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  // bcryptjs throws (not rejects) when compareSync gets a non-string, so a
  // missing/malformed password must be rejected before it ever reaches
  // verifyLogin -- otherwise the thrown error becomes an unhandled 500.
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_FAILURE, username: typeof username === 'string' ? username : null, ...requestMeta(req), detail: 'Missing or malformed credentials' });
    checkSecuritySpike().catch(() => {});
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const admin = verifyLogin(username, password);
  if (!admin) {
    recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_FAILURE, username, ...requestMeta(req), detail: 'Invalid username or password' });
    checkSecuritySpike().catch(() => {});
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  startSession(res, admin.id, admin.username);
  recordAuditEvent({ eventType: AUDIT_EVENTS.LOGIN_SUCCESS, adminId: admin.id, username: admin.username, ...requestMeta(req) });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  const session = token && sessions.get(token);
  if (token) sessions.delete(token);
  if (session) {
    recordAuditEvent({ eventType: AUDIT_EVENTS.LOGOUT, adminId: session.adminId, username: session.username, ...requestMeta(req) });
  }
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  res.json({ authenticated: Boolean(token && sessions.has(token)) });
});

app.get('/api/admins', requireAuth, (_req, res) => {
  res.json({ admins: listAdmins() });
});

app.post('/api/admins', requireAuth, (req, res) => {
  try {
    const admin = createAdmin(req.body || {});
    recordAuditEvent({ eventType: AUDIT_EVENTS.ADMIN_CREATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Created admin "${admin.username}"` });
    res.status(201).json({ admin });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admins/:id', requireAuth, (req, res) => {
  try {
    // Looked up before deleteAdmin() removes the row -- audit_log stores the
    // target's username as a plain string precisely so this event still
    // reads correctly after the account it refers to no longer exists.
    const target = listAdmins().find((a) => a.id === req.params.id);
    const ok = deleteAdmin(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Admin not found' });
    revokeSessionsForAdmin(req.params.id);
    recordAuditEvent({ eventType: AUDIT_EVENTS.ADMIN_DELETED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted admin "${target?.username || req.params.id}"` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admins/:id/reset-password', requireAuth, (req, res) => {
  try {
    const target = listAdmins().find((a) => a.id === req.params.id);
    const ok = resetPassword(req.params.id, (req.body || {}).password);
    if (!ok) return res.status(404).json({ error: 'Admin not found' });
    revokeSessionsForAdmin(req.params.id);
    recordAuditEvent({ eventType: AUDIT_EVENTS.PASSWORD_RESET, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Reset password for admin "${target?.username || req.params.id}"` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/audit-log', requireAuth, (req, res) => {
  const { eventType, q, limit } = req.query;
  res.json({ entries: listAuditLog({ eventType, q, limit }) });
});

app.get('/api/dashboard', requireAuth, (_req, res) => {
  const filaments = listFilaments();
  const categories = readCategoryProducts();
  const colourCount = filaments.reduce((n, f) => n + f.colours.length, 0);
  const itemCount = categories.reduce((n, c) => n + (c.items?.length || 0), 0);
  const draftCount = filaments.filter((f) => f.status === 'draft').length;
  const publishedCount = filaments.filter((f) => f.status === 'published').length;
  const recent = [...filaments]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 8)
    .map((f) => ({ id: f.id, name: f.name, kind: 'filament', status: f.status, updatedAt: f.updatedAt, slug: f.slug }));

  res.json({
    updatedAt: new Date().toISOString(),
    totals: {
      products: filaments.length + categories.length,
      filaments: filaments.length,
      categories: categories.length,
      colours: colourCount,
      catalogItems: itemCount,
      published: publishedCount,
      drafts: draftCount,
    },
    recent,
  });
});

app.get('/api/filaments', requireAuth, (_req, res) => {
  res.json({ filaments: listFilaments() });
});

app.get('/api/filaments/:id', requireAuth, (req, res) => {
  const filament = getFilament(req.params.id);
  if (!filament) return res.status(404).json({ error: 'Filament not found' });
  res.json({ filament });
});

app.post('/api/filaments', requireAuth, async (req, res) => {
  try {
    const filament = createFilament(req.body || {});
    const publishWarning = await publishCatalog();
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Created filament type "${filament.name}"` });
    res.status(201).json({ filament, ...(publishWarning ? { publishWarning } : {}) });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.put('/api/filaments/:id', requireAuth, async (req, res) => {
  try {
    const filament = updateFilament(req.params.id, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Filament not found' });
    const publishWarning = await publishCatalog();
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated filament type "${filament.name}"` });
    res.json({ filament, ...(publishWarning ? { publishWarning } : {}) });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.delete('/api/filaments/:id', requireAuth, async (req, res) => {
  const existing = getFilament(req.params.id);
  const ok = deleteFilament(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Filament not found' });
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted filament type "${existing?.name || req.params.id}"` });
  res.json({ ok: true, ...(publishWarning ? { publishWarning } : {}) });
});

app.post('/api/filaments/:id/colours', requireAuth, async (req, res) => {
  try {
    const filament = addColour(req.params.id, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Filament not found' });
    const publishWarning = await publishCatalog();
    const added = filament.colours[filament.colours.length - 1];
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Added colour "${added?.name}" to "${filament.name}"` });
    res.status(201).json({ filament, ...(publishWarning ? { publishWarning } : {}) });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.put('/api/filaments/:filamentId/colours/:colourId', requireAuth, async (req, res) => {
  try {
    const filament = updateColour(req.params.filamentId, req.params.colourId, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Colour not found' });
    const publishWarning = await publishCatalog();
    const colour = filament.colours.find((c) => c.id === req.params.colourId);
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated colour "${colour?.name}" on "${filament.name}"` });
    res.json({ filament, ...(publishWarning ? { publishWarning } : {}) });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.delete('/api/filaments/:filamentId/colours/:colourId', requireAuth, async (req, res) => {
  const existing = getFilament(req.params.filamentId);
  const colour = existing?.colours.find((c) => c.id === req.params.colourId);
  const ok = deleteColour(req.params.filamentId, req.params.colourId);
  if (!ok) return res.status(404).json({ error: 'Colour not found' });
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted colour "${colour?.name || req.params.colourId}" from "${existing?.name || req.params.filamentId}"` });
  res.json({ ok: true, ...(publishWarning ? { publishWarning } : {}) });
});

app.post(
  '/api/filaments/:filamentId/colours/:colourId/image',
  requireAuth,
  // Looks up the colour's sku BEFORE multer runs, so uploadFilamentImage's
  // storage.filename callback can build a SKU-traceable filename instead of
  // falling back to the colour's opaque UUID (Task 6 review finding).
  (req, res, next) => {
    const filament = getFilament(req.params.filamentId);
    const colour = filament?.colours.find((c) => c.id === req.params.colourId);
    if (!colour) return res.status(404).json({ error: 'Colour not found' });
    req.colourSku = colour.sku;
    next();
  },
  uploadFilamentImage.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const imagePath = `/uploads/filaments/${req.file.filename}`;
    const filament = setColourImage(req.params.filamentId, req.params.colourId, imagePath);
    if (!filament) return res.status(404).json({ error: 'Colour not found' });
    // #106: responsive variants BEFORE publish, so the regenerated pages
    // can already reference them.
    await generateImageVariants(req.file.path).catch(() => {});
    const publishWarning = await publishCatalog();
    res.json({ filament, ...(publishWarning ? { publishWarning } : {}) });
  },
  // Multer errors (e.g. exceeding uploads.js's 5MB limit) are passed to
  // next(err) by the multer middleware above, not thrown, so without this
  // handler Express's default error handler would return a raw 500 HTML
  // page instead of clean JSON.
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: 'Image must be under 5MB' });
    }
    next(err);
  },
);

app.get('/api/products', requireAuth, (req, res) => {
  // Sourced from readCategoryProducts() (not loadCatalog()) so this route
  // can never surface a stray filament-kind row -- the write path already
  // forces kind:'category', but that's only a write-time guarantee; the
  // read path needs its own filter in case a non-category row ever ends up
  // in catalog.json (e.g. an interrupted/failed migration).
  let list = readCategoryProducts();
  const { q, parent } = req.query;
  if (parent) list = list.filter((p) => p.parent === parent);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => {
      const hay = [p.name, p.slug, p.description, ...(p.items || []).flatMap((i) => [i.name, i.sku, i.details])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  res.json({ products: list, count: list.length });
});

app.get('/api/products/:id', requireAuth, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product || product.kind !== 'category') return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

// Every route below that mutates a category product (create/update/delete,
// item photo upload/delete) must publish the same way /api/settings does --
// syncPublicJson() alone only refreshes public/*.json; nginx serves dist/,
// which vite build produces, and generate-pages.mjs is what actually bakes
// GWM/Landrover items (e.g. the model-filter dropdown, whose options are
// only emitted for models present in the *generated* HTML) into the static
// pages. Without this, a catalog save looked live in the admin but the
// public page stayed stale until someone ran "Publish to site" or a code
// deploy. Non-fatal: the save itself already succeeded above, so a publish
// hiccup here is surfaced as a warning, not a failed save.
// Backlog #43: absolute product URL for restock emails -- same anchor scheme
// the cards render with. sendRestockNotification is what restock.js's
// processor actually calls per pending subscription.
function restockProductHref(productId) {
  const parts = String(productId || '').split(':');
  if (parts[0] === 'filament' && parts.length === 3) return `https://www.lapanza3d.co.za/${filamentPagePath(parts[1])}#${itemAnchorId(parts[2], parts[2])}`;
  if (parts[0] === 'category' && parts.length === 3) return `https://www.lapanza3d.co.za/${categoryPagePath(parts[1])}#${itemAnchorId(parts[2], parts[2])}`;
  return 'https://www.lapanza3d.co.za/';
}
const sendRestockNotification = (sub, snapshot) => sendRestockEmail(sub, snapshot, restockProductHref(sub.productId));

async function publishCatalog() {
  syncPublicJson(getDb());
  try {
    await runGenerate();
    await runBuild();
    // #43: a catalog publish is exactly when stock may have come back --
    // fire-and-forget; failures log inside the processor and stay pending.
    processRestockNotifications(sendRestockNotification).catch(() => {});
    return undefined;
  } catch (err) {
    return `Saved, but publishing to the live site failed: ${err.message}. Try "Publish to site" from the dashboard.`;
  }
}

app.post('/api/products', requireAuth, async (req, res) => {
  const body = req.body || {};
  const product = {
    id: randomUUID(),
    kind: 'category',
    slug: slugify(body.slug || body.name || 'product'),
    name: body.name || 'Untitled product',
    description: body.description || '',
    crumbs: body.crumbs || '',
    parent: body.parent || null,
    items: normalizeItems(body.items),
  };
  upsertProduct(product);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Created category product "${product.name}"` });
  res.status(201).json({ product, ...(publishWarning ? { publishWarning } : {}) });
});

app.put('/api/products/:id', requireAuth, async (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const body = req.body || {};
  const product = {
    id: existing.id,
    kind: 'category',
    slug: slugify(body.slug || existing.slug),
    name: body.name ?? existing.name,
    description: body.description ?? existing.description,
    crumbs: body.crumbs ?? existing.crumbs,
    parent: body.parent ?? existing.parent,
    items: normalizeItems(body.items ?? existing.items),
    // upsertProduct() does a full-record replacement (not a merge), so any
    // field left out here is silently deleted from the stored record on
    // every save -- not just ignored. status/featured/sortOrder/seoTitle/
    // seoDescription/internalNotes are real, editable fields on category
    // products (see admin/admin.js's category editor) and must be carried
    // forward the same way the fields above are, or a PUT that only
    // touches e.g. description would wipe all of them.
    status: body.status ?? existing.status,
    featured: body.featured ?? existing.featured,
    sortOrder: body.sortOrder ?? existing.sortOrder,
    seoTitle: body.seoTitle ?? existing.seoTitle,
    seoDescription: body.seoDescription ?? existing.seoDescription,
    internalNotes: body.internalNotes ?? existing.internalNotes,
  };
  upsertProduct(product);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated category product "${product.name}"` });
  res.json({ product, ...(publishWarning ? { publishWarning } : {}) });
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  const existing = getProduct(req.params.id);
  const ok = deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Product not found' });
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted category product "${existing?.name || req.params.id}"` });
  res.json({ ok: true, ...(publishWarning ? { publishWarning } : {}) });
});

app.post(
  '/api/products/:productId/items/:itemId/image',
  requireAuth,
  uploadCategoryItemImage.single('image'),
  async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const product = getProduct(req.params.productId);
    if (!product || product.kind !== 'category') return res.status(404).json({ error: 'Product not found' });
    const item = (product.items || []).find((i) => i.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    // Only ever delete a file we ourselves stored under /uploads/category-items/
    // -- item.imageUrl may still be an admin-typed external URL from before
    // this upload flow existed.
    if (item.imageUrl && item.imageUrl.startsWith('/uploads/category-items/')) deleteCategoryItemImage(item.imageUrl);
    item.imageUrl = `/uploads/category-items/${req.file.filename}`;
    upsertProduct(product);
    await generateImageVariants(req.file.path).catch(() => {}); // #106
    const publishWarning = await publishCatalog();
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated photo for "${item.name}" on "${product.name}"` });
    res.json({ product, ...(publishWarning ? { publishWarning } : {}) });
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Image must be under 5MB' });
    next(err);
  },
);

// Per-item save/remove for category products (GWM/Landrover/Toys/Homeware/
// Phones etc), mirroring the filament colour endpoints above: lets the
// admin's "Save item" / "Remove" buttons on a single row persist
// immediately instead of only ever being able to save via the whole-product
// PUT (which previously meant a stray edit to one item, or the "Fits
// models" checkboxes GWM parts use for their model filter, only actually
// reached the DB and the published site once the admin remembered to also
// click the separate top-level "Save product" button).
app.post('/api/products/:productId/items', requireAuth, async (req, res) => {
  const product = getProduct(req.params.productId);
  if (!product || product.kind !== 'category') return res.status(404).json({ error: 'Product not found' });
  product.items = product.items || [];
  const item = normalizeItem({ ...(req.body || {}), id: undefined, imageUrl: '' }, product.items.length);
  product.items.push(item);
  upsertProduct(product);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Added item "${item.name}" to "${product.name}"` });
  res.status(201).json({ product, item, ...(publishWarning ? { publishWarning } : {}) });
});

app.put('/api/products/:productId/items/:itemId', requireAuth, async (req, res) => {
  const product = getProduct(req.params.productId);
  if (!product || product.kind !== 'category') return res.status(404).json({ error: 'Product not found' });
  const idx = (product.items || []).findIndex((i) => i.id === req.params.itemId);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  const existing = product.items[idx];
  // imageUrl is deliberately never accepted from the body here -- same as
  // the whole-product PUT, it's only ever set by the dedicated
  // upload/remove-photo routes above.
  const merged = normalizeItem({ ...existing, ...(req.body || {}), id: existing.id, imageUrl: existing.imageUrl }, idx);
  product.items[idx] = merged;
  upsertProduct(product);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated item "${merged.name}" on "${product.name}"` });
  res.json({ product, item: merged, ...(publishWarning ? { publishWarning } : {}) });
});

app.delete('/api/products/:productId/items/:itemId', requireAuth, async (req, res) => {
  const product = getProduct(req.params.productId);
  if (!product || product.kind !== 'category') return res.status(404).json({ error: 'Product not found' });
  const item = (product.items || []).find((i) => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.imageUrl && item.imageUrl.startsWith('/uploads/category-items/')) deleteCategoryItemImage(item.imageUrl);
  product.items = product.items.filter((i) => i.id !== req.params.itemId);
  upsertProduct(product);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Removed item "${item.name}" from "${product.name}"` });
  res.json({ ok: true, ...(publishWarning ? { publishWarning } : {}) });
});

app.delete('/api/products/:productId/items/:itemId/image', requireAuth, async (req, res) => {
  const product = getProduct(req.params.productId);
  if (!product || product.kind !== 'category') return res.status(404).json({ error: 'Product not found' });
  const item = (product.items || []).find((i) => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.imageUrl && item.imageUrl.startsWith('/uploads/category-items/')) deleteCategoryItemImage(item.imageUrl);
  item.imageUrl = '';
  upsertProduct(product);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Removed photo for "${item.name}" on "${product.name}"` });
  res.json({ product, ...(publishWarning ? { publishWarning } : {}) });
});

// ---- Clients (B) ----

app.get('/api/clients', requireAuth, (req, res) => {
  res.json({ clients: listClients({ q: req.query.q, registeredOnly: req.query.registeredOnly === 'true' }) });
});

app.get('/api/clients/:id', requireAuth, (req, res) => {
  const client = getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client, orders: listOrdersForClient(req.params.id) });
});

app.post('/api/clients', requireAuth, (req, res) => {
  try {
    res.status(201).json({ client: createClient(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  try {
    const client = updateClient(req.params.id, req.body || {});
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/clients/:id/verify', requireAuth, (req, res) => {
  try {
    const client = manuallyVerifyClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/clients/:id/resend-verification', requireAuth, async (req, res) => {
  try {
    const result = regenerateVerificationToken(req.params.id);
    if (!result) return res.status(404).json({ error: 'Client not found' });
    const verifyUrl = `${req.protocol}://${req.get('host')}/api/client/verify?token=${result.token}`;
    await sendClientVerificationEmail(result.client, verifyUrl);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Registered Users' Disable/Enable toggle -- see setClientDisabled's own
// comment (clients.js) for why this is deliberately separate from Delete.
app.patch('/api/clients/:id/disabled', requireAuth, (req, res) => {
  const client = setClientDisabled(req.params.id, Boolean((req.body || {}).disabled));
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client });
});

// Admin-triggered password reset -- same requestPasswordReset()/email as
// the customer's own "Forgot password?" flow, just initiated from
// Registered Users instead of the customer requesting it themselves.
app.post('/api/clients/:id/send-password-reset', requireAuth, async (req, res) => {
  try {
    const client = getClient(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.hasAccount) return res.status(400).json({ error: 'This client has no account to reset a password for' });
    const result = requestPasswordReset(client.email);
    if (!result) return res.status(404).json({ error: 'Client not found' });
    const resetUrl = `${siteUrlFor(req)}/account.html?reset_token=${result.token}`;
    await sendClientPasswordResetEmail(result.client, resetUrl);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const result = deleteOrRevokeClient(req.params.id);
  if (!result) return res.status(404).json({ error: 'Client not found' });
  res.json(result);
});

// Folds a duplicate client record into another -- every order and design
// request the source (:id) ever placed moves to the target (intoClientId),
// then the source is deleted outright (see mergeClients in clients.js for
// why this never needs the revoke-only fallback deleteOrRevokeClient has).
app.post('/api/clients/:id/merge', requireAuth, (req, res) => {
  try {
    const client = mergeClients(req.params.id, (req.body || {}).intoClientId);
    res.json({ client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Shipping options (C) ----

app.get('/api/shipping-options', requireAuth, (req, res) => {
  res.json({ shippingOptions: listShippingOptions({ activeOnly: req.query.activeOnly === 'true' }) });
});

app.post('/api/shipping-options', requireAuth, (req, res) => {
  try {
    const shippingOption = createShippingOption(req.body || {});
    recordAuditEvent({ eventType: AUDIT_EVENTS.SETTINGS_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Created shipping option "${shippingOption.name}"` });
    res.status(201).json({ shippingOption });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/shipping-options/:id', requireAuth, (req, res) => {
  try {
    const option = updateShippingOption(req.params.id, req.body || {});
    if (!option) return res.status(404).json({ error: 'Shipping option not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.SETTINGS_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated shipping option "${option.name}"` });
    res.json({ shippingOption: option });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/shipping-options/:id', requireAuth, (req, res) => {
  const existing = getShippingOption(req.params.id);
  const ok = deleteShippingOption(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Shipping option not found' });
  recordAuditEvent({ eventType: AUDIT_EVENTS.SETTINGS_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted shipping option "${existing?.name || req.params.id}"` });
  res.json({ ok: true });
});

// Public (no auth) -- checkout page needs this before the customer is an
// authenticated admin, obviously. Only returns the matched bracket's public
// fields (name/price), never anything else in the shipping_options table.
app.get('/api/shipping-match', (req, res) => {
  const weight = Number(req.query.weight);
  if (!Number.isFinite(weight) || weight < 0) return res.status(400).json({ error: 'Invalid weight' });
  const match = matchShippingForWeight(weight);
  if (!match) return res.status(404).json({ error: 'No shipping option available for this order weight — please contact us.' });
  res.json({ shippingOption: { id: match.id, name: match.name, price: match.price } });
});

// Phase 3: public (no auth) -- checkout's picker for named flat-price
// options (PUDO lockers, local delivery). Only exposes id/name/price, same
// as /api/shipping-match above.
app.get('/api/shipping-options/public/fixed', (_req, res) => {
  const options = listShippingOptions({ activeOnly: true, optionType: 'fixed' });
  res.json({ shippingOptions: options.map((o) => ({ id: o.id, name: o.name, price: o.price, category: o.category })) });
});

// ---- Inventory / Stock Management ----

app.get('/api/inventory', requireAuth, (_req, res) => {
  res.json({ items: listInventory() });
});

app.put('/api/inventory', requireAuth, async (req, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  const results = bulkUpdateInventory(updates);
  await alertOnLowStock(updates.filter((u, i) => results[i]?.ok && u.stockQty !== undefined).map((u) => u.id));
  const okCount = results.filter((r) => r.ok).length;
  if (okCount > 0) {
    // Capped to keep `detail` readable for a genuinely bulk save (e.g. a
    // 50-row Stock Management edit) -- the exact ids are still in the raw
    // request if ever needed, this is a scan-friendly summary, not a log.
    const ids = results.filter((r) => r.ok).map((r) => r.id).slice(0, 10);
    recordAuditEvent({
      eventType: AUDIT_EVENTS.STOCK_UPDATED,
      adminId: req.adminId,
      username: req.adminUsername,
      ...requestMeta(req),
      detail: `Updated ${okCount} inventory item(s): ${ids.join(', ')}${okCount > ids.length ? `, +${okCount - ids.length} more` : ''}`,
    });
  }
  res.json({ results });
});

// #3: fires whenever ANY of these ids' stock is now <=1, regardless of why
// (manual bulk edit here, or an order-driven decrement elsewhere) -- one
// shared check so the alert can't be triggered by one path and missed by
// the other. Re-reads fresh from listInventory() rather than trusting the
// caller's own numbers, since a bulk request only carries {id, stockQty},
// not the name/sku the email needs.
async function alertOnLowStock(changedIds) {
  if (!changedIds.length) return;
  const current = listInventory();
  const rows = changedIds.map((id) => current.find((i) => i.id === id)).filter((item) => item && item.stockQty <= 1);
  await sendLowStockAlerts(rows);
}

// Order-driven decrements (decrementStockForOrder in orders.js) already
// know the name/sku/resulting quantity, so this skips the listInventory()
// re-fetch alertOnLowStock needs when it's only handed bare ids.
async function sendLowStockAlerts(rows) {
  for (const item of rows) {
    try {
      await sendLowStockAlert(item, '/admin/');
    } catch (err) {
      logEmailFailure(`Low-stock alert for ${item.name}`, err);
    }
  }
}

// ---- 3D Resources ----

app.get('/api/resources', requireAuth, (_req, res) => {
  res.json({ resources: listResources() });
});

app.get('/api/resources/:id', requireAuth, (req, res) => {
  const resource = getResource(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Resource not found' });
  res.json({ resource });
});

app.post('/api/resources', requireAuth, (req, res) => {
  res.status(201).json({ resource: createResource(req.body || {}) });
});

app.put('/api/resources/:id', requireAuth, (req, res) => {
  const resource = updateResource(req.params.id, req.body || {});
  if (!resource) return res.status(404).json({ error: 'Resource not found' });
  res.json({ resource });
});

app.delete('/api/resources/:id', requireAuth, (req, res) => {
  const existing = getResource(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Resource not found' });
  deleteResourceFile(existing.imagePath);
  deleteResourceFile(existing.filePath);
  deleteResource(req.params.id);
  res.json({ ok: true });
});

app.post(
  '/api/resources/:id/image',
  requireAuth,
  uploadResourceImage.single('image'),
  (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const resource = updateResource(req.params.id, { imagePath: `/uploads/resources/${req.file.filename}`, imageOriginalName: req.file.originalname });
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    res.json({ resource });
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Image must be under 5MB' });
    next(err);
  },
);

app.post(
  '/api/resources/:id/file',
  requireAuth,
  uploadResourceFile.single('file'),
  (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded, or file type not allowed (stl/3mf/obj/gcode/zip/pdf only)' });
    const resource = updateResource(req.params.id, { filePath: `/uploads/resources/${req.file.filename}`, fileOriginalName: req.file.originalname });
    if (!resource) return res.status(404).json({ error: 'Resource not found' });
    res.json({ resource });
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'File must be under 50MB' });
    next(err);
  },
);

// Public (no auth) -- the gallery customers browse.
app.get('/api/resources/public/list', (_req, res) => {
  res.json({ resources: listResources({ activeOnly: true }) });
});

// Forces a real download (Content-Disposition: attachment + a generic
// Content-Type) regardless of the file's extension -- see uploads.js's
// RESOURCE_FILE_EXTENSIONS comment for why that matters: express.static
// would otherwise serve these inline based on extension/mimetype guessing.
app.get('/api/resources/:id/download', (req, res) => {
  const resource = getResource(req.params.id);
  if (!resource?.filePath) return res.status(404).send('File not found');
  const abs = path.join(root, 'public', resource.filePath.replace(/^\//, ''));
  if (!fs.existsSync(abs)) return res.status(404).send('File not found');
  const downloadName = `${slugify(resource.title)}${path.extname(abs)}`;
  res.download(abs, downloadName);
});

// ---- Testimonials (backlog #51) ----
// Fully admin-managed -- no public submission form, no public detail route.
// The live site only ever sees the published subset via site-settings.json
// (server/export.js's syncPublicJson -> settings.testimonials), same as
// featuredProducts. Every mutating route republishes so a save reaches the
// live site (see publishCatalog()'s own comment -- syncPublicJson() alone
// only updates public/site-settings.json, nginx serves dist/, only
// runBuild() copies it there).

app.get('/api/testimonials', requireAuth, (req, res) => {
  res.json({ testimonials: listTestimonials(req.query.status ? { status: req.query.status } : {}) });
});

app.get('/api/testimonials/:id', requireAuth, (req, res) => {
  const testimonial = getTestimonial(req.params.id);
  if (!testimonial) return res.status(404).json({ error: 'Testimonial not found' });
  res.json({ testimonial });
});

app.post('/api/testimonials', requireAuth, async (req, res) => {
  try {
    const testimonial = createTestimonial(req.body || {});
    const publishWarning = await publishCatalog();
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Testimonial created: ${testimonial.displayName} (${testimonial.status})` });
    res.status(201).json({ testimonial, publishWarning });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/testimonials/:id', requireAuth, async (req, res) => {
  try {
    const testimonial = updateTestimonial(req.params.id, req.body || {});
    if (!testimonial) return res.status(404).json({ error: 'Testimonial not found' });
    const publishWarning = await publishCatalog();
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Testimonial updated: ${testimonial.displayName} (${testimonial.status})` });
    res.json({ testimonial, publishWarning });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/testimonials/:id', requireAuth, async (req, res) => {
  const existing = getTestimonial(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Testimonial not found' });
  deleteTestimonialImage(existing.imagePath);
  deleteTestimonial(req.params.id);
  const publishWarning = await publishCatalog();
  recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Testimonial deleted: ${existing.displayName}` });
  res.json({ ok: true, publishWarning });
});

app.post(
  '/api/testimonials/:id/image',
  requireAuth,
  uploadTestimonialImage.single('image'),
  async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const existing = getTestimonial(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Testimonial not found' });
    deleteTestimonialImage(existing.imagePath); // replace, don't orphan the old file
    const testimonial = updateTestimonial(req.params.id, { imagePath: `/uploads/testimonials/${req.file.filename}` });
    const publishWarning = await publishCatalog();
    res.json({ testimonial, publishWarning });
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Image must be under 5MB' });
    next(err);
  },
);

// ---- Custom 3D design requests (Phase 2) ----

// Public intake -- accepts an optional reference image and/or reference
// file (STL etc) in the same submission, reusing the resources upload
// allowlists (see uploads.js's uploadDesignRequestAssets).
app.post(
  '/api/design-requests',
  publicFormLimiter,
  uploadDesignRequestAssets.fields([
    { name: 'referenceImage', maxCount: 1 },
    { name: 'referenceFile', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const imageFile = req.files?.referenceImage?.[0];
      const fileFile = req.files?.referenceFile?.[0];
      const request = createDesignRequest({
        ...(req.body || {}),
        referenceImagePath: imageFile ? `/uploads/design-requests/${imageFile.filename}` : undefined,
        referenceImageOriginalName: imageFile ? imageFile.originalname : undefined,
        referenceFilePath: fileFile ? `/uploads/design-requests/${fileFile.filename}` : undefined,
        referenceFileOriginalName: fileFile ? fileFile.originalname : undefined,
      });
      res.status(201).json({ ok: true, designRequest: request });
      try {
        await sendNewDesignRequestNotificationEmail(request);
      } catch (err) {
        logEmailFailure('New design request owner-notification email', err, req);
      }
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload failed — image must be under 5MB, file under 50MB' });
    next(err);
  },
);

app.get('/api/design-requests', requireAuth, (req, res) => {
  res.json({ designRequests: listDesignRequests({ status: req.query.status }) });
});

app.get('/api/design-requests/:id', requireAuth, (req, res) => {
  const request = getDesignRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Design request not found' });
  res.json({ designRequest: request });
});

app.patch('/api/design-requests/:id', requireAuth, async (req, res) => {
  try {
    const before = getDesignRequest(req.params.id);
    if (!before) return res.status(404).json({ error: 'Design request not found' });
    const updated = updateDesignRequest(req.params.id, req.body || {});
    if (req.body?.status && req.body.status !== before.status) {
      try {
        await sendDesignRequestStatusEmail(updated, updated.status);
      } catch (err) {
        logEmailFailure('Design request status email', err, req);
      }
    }
    res.json({ designRequest: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/design-requests/:id', requireAuth, (req, res) => {
  const existing = getDesignRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Design request not found' });
  deleteDesignRequestFile(existing.referenceImagePath);
  deleteDesignRequestFile(existing.referenceFilePath);
  deleteDesignRequest(req.params.id);
  res.json({ ok: true });
});

// ---- Print Job Costing (Phase 3) ----
// Costing itself stays internal-only. The two /list-for-sale and /listing
// routes below are the sole, explicit bridge to the storefront -- see
// print-jobs.js's listPrintJobForSale/updatePrintJobListing.

app.get('/api/print-jobs', requireAuth, (req, res) => {
  res.json({ printJobs: listPrintJobs({ status: req.query.status }) });
});

app.get('/api/print-jobs/:id', requireAuth, (req, res) => {
  const job = getPrintJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Print job not found' });
  res.json({ printJob: job });
});

// Computes the cost breakdown without saving anything -- the admin form's
// "Validate" button, so usage/costs can be checked before Log Job commits
// (creates the row and decrements in-house filament stock).
app.post('/api/print-jobs/validate', requireAuth, (req, res) => {
  try {
    res.json({ preview: previewPrintJobCost(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/print-jobs', requireAuth, (req, res) => {
  try {
    res.status(201).json({ printJob: createPrintJob(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/print-jobs/:id', requireAuth, (req, res) => {
  const job = updatePrintJob(req.params.id, req.body || {});
  if (!job) return res.status(404).json({ error: 'Print job not found' });
  recordAuditEvent({ eventType: AUDIT_EVENTS.STOCK_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Print job "${job.itemName}": status=${job.status}, finalSellingPrice=${formatRand(job.finalSellingPrice)}` });
  res.json({ printJob: job });
});

// Publishes this job as a new category product (body: { categorySlug, stockQty }).
app.post('/api/print-jobs/:id/list-for-sale', requireAuth, (req, res) => {
  try {
    const job = listPrintJobForSale(req.params.id, req.body || {});
    if (!job) return res.status(404).json({ error: 'Print job not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Listed print job "${job.itemName}" for sale` });
    res.status(201).json({ printJob: job });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Updates the already-linked listing's stock/price (body: { stockQty, price }).
app.put('/api/print-jobs/:id/listing', requireAuth, (req, res) => {
  try {
    const job = updatePrintJobListing(req.params.id, req.body || {});
    if (!job) return res.status(404).json({ error: 'Print job not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.CATALOG_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated listing for print job "${job.itemName}"` });
    res.json({ printJob: job });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/print-jobs/:id', requireAuth, (req, res) => {
  const existing = getPrintJob(req.params.id);
  const ok = deletePrintJob(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Print job not found' });
  recordAuditEvent({ eventType: AUDIT_EVENTS.STOCK_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted print job "${existing?.itemName || req.params.id}"` });
  res.json({ ok: true });
});

app.post(
  '/api/print-jobs/:id/image',
  requireAuth,
  uploadPrintJobImage.single('image'),
  (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const job = setPrintJobImage(req.params.id, `/uploads/print-jobs/${req.file.filename}`, req.file.originalname);
    if (!job) return res.status(404).json({ error: 'Print job not found' });
    res.json({ printJob: job });
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Image must be under 5MB' });
    next(err);
  },
);

app.post(
  '/api/print-jobs/:id/file',
  requireAuth,
  uploadPrintJobFile.single('file'),
  (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded, or file type not allowed (stl/3mf/obj/gcode/zip/pdf only)' });
    const job = setPrintJobFile(req.params.id, `/uploads/print-jobs/${req.file.filename}`, req.file.originalname);
    if (!job) return res.status(404).json({ error: 'Print job not found' });
    res.json({ printJob: job });
  },
  (err, _req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'File must be under 50MB' });
    next(err);
  },
);

// ---- In-House Filament (Phase 3+, local-printing stock) ----

app.get('/api/in-house-filament', requireAuth, (_req, res) => {
  res.json({ filaments: listInHouseFilament() });
});

app.get('/api/in-house-filament/:id', requireAuth, (req, res) => {
  const filament = getInHouseFilament(req.params.id);
  if (!filament) return res.status(404).json({ error: 'Filament not found' });
  res.json({ filament });
});

app.post('/api/in-house-filament', requireAuth, (req, res) => {
  try {
    const filament = createInHouseFilament(req.body || {});
    recordAuditEvent({ eventType: AUDIT_EVENTS.STOCK_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Added in-house filament "${filament.filamentType} — ${filament.colorName}"` });
    res.status(201).json({ filament });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/in-house-filament/:id', requireAuth, (req, res) => {
  try {
    const filament = updateInHouseFilament(req.params.id, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Filament not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.STOCK_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Updated in-house filament "${filament.filamentType} — ${filament.colorName}"` });
    res.json({ filament });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/in-house-filament/:id/transfer-roll', requireAuth, (req, res) => {
  try {
    const filament = transferStockRoll(req.params.id, (req.body || {}).stockItemId);
    recordAuditEvent({ eventType: AUDIT_EVENTS.STOCK_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Transferred one Stock Management roll to in-house "${filament.brand} — ${filament.filamentType} — ${filament.colorName}"` });
    res.json({ filament });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/in-house-filament/:id', requireAuth, (req, res) => {
  try {
    const existing = getInHouseFilament(req.params.id);
    const ok = deleteInHouseFilament(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Filament not found' });
    recordAuditEvent({ eventType: AUDIT_EVENTS.STOCK_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted in-house filament "${existing ? `${existing.filamentType} — ${existing.colorName}` : req.params.id}"` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Purchase History (Phase 3, supplier expenses) ----

app.get('/api/purchases', requireAuth, (req, res) => {
  res.json({ purchases: listPurchases({ status: req.query.status }) });
});

app.get('/api/purchases/:id', requireAuth, (req, res) => {
  const purchase = getPurchase(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  res.json({ purchase });
});

app.post('/api/purchases', requireAuth, (req, res) => {
  try {
    res.status(201).json({ purchase: createPurchase(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/purchases/:id', requireAuth, (req, res) => {
  const purchase = updatePurchase(req.params.id, req.body || {});
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  res.json({ purchase });
});

app.delete('/api/purchases/:id', requireAuth, (req, res) => {
  const ok = deletePurchase(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Purchase not found' });
  res.json({ ok: true });
});

// ---- Orders (D/E/F) ----

app.get('/api/orders', requireAuth, (req, res) => {
  res.json({ orders: listOrders({ status: req.query.status, q: req.query.q }) });
});

// Phase 3: admin-only manual order entry (walk-in/WhatsApp/etc). See
// orders.js's createManualOrder for why this is a separate function from
// the public checkout's createOrder rather than a shared code path.
app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const order = createManualOrder(req.body || {});
    const lowStock = order._lowStock;
    delete order._lowStock;
    const clientDataUpdated = Boolean(order._clientDataUpdated);
    delete order._clientDataUpdated;
    recordAuditEvent({ eventType: AUDIT_EVENTS.ORDER_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Created manual order ${order.id} (${formatRand(order.total)})` });
    res.status(201).json({ order, clientDataUpdated });
    if (lowStock?.length) await sendLowStockAlerts(lowStock);
    try {
      await sendNewOrderNotificationEmail(order);
    } catch (err) {
      logEmailFailure('New order owner-notification email', err, req);
    }
    // "Already paid" (walk-in/WhatsApp sale settled on the spot) creates the
    // order already in 'paid' status -- send the paid-in-full invoice
    // straight away rather than an unpaid one that would be inaccurate.
    try {
      await sendInvoiceEmail(order, { paid: order.status === 'paid' });
    } catch (err) {
      logEmailFailure(`Order ${order.id} invoice email`, err, req);
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

app.put('/api/orders/:id/status', requireAuth, async (req, res) => {
  try {
    const before = getOrder(req.params.id);
    const order = updateOrderStatus(req.params.id, (req.body || {}).status);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const lowStock = order._lowStock;
    delete order._lowStock;
    recordAuditEvent({ eventType: AUDIT_EVENTS.ORDER_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Order ${order.id}: status ${before?.status} → ${order.status}` });
    res.json({ order });
    if (lowStock?.length) await sendLowStockAlerts(lowStock);
    // #43: cancelling restores stock -- one of the moments an item can
    // come back into stock without a catalog publish.
    if (order.status === 'cancelled') processRestockNotifications(sendRestockNotification).catch(() => {});
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/orders/:id/tracking', requireAuth, async (req, res) => {
  // Backlog #97: read the previous value BEFORE updating -- the shipped
  // email fires only on the empty -> non-empty transition, so editing or
  // re-saving an existing number never re-mails the customer.
  const previous = getOrder(req.params.id);
  const order = updateOrderTracking(req.params.id, (req.body || {}).trackingNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  recordAuditEvent({ eventType: AUDIT_EVENTS.ORDER_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Order ${order.id}: tracking number set to "${order.trackingNumber}"` });
  if (!previous?.trackingNumber && order.trackingNumber && order.client?.email) {
    try {
      await sendOrderShippedEmail(order);
    } catch (err) {
      logEmailFailure(`Order ${order.id} shipped email`, err, req);
    }
  }
  res.json({ order });
});

// Backlog #97: customer's own invoice, on demand -- same renderer as the
// admin route and the emailed copy, gated on ownership of the order.
app.get('/api/client/orders/:id/invoice', requireClientAuth, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order || order.clientId !== req.clientId) return res.status(404).send('Order not found');
  res.send(renderInvoiceHtml(order, getSettings()));
});

// Backlog #96 (SITE-062): "Buy again" -- re-resolves a past order's lines
// against the CURRENT catalog (same resolver checkout itself prices with),
// returning add-to-cart-ready lines at today's prices plus the names of
// anything discontinued/out of stock, so the client-side can say exactly
// what changed instead of silently dropping items.
app.get('/api/client/orders/:id/buy-again', requireClientAuth, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order || order.clientId !== req.clientId) return res.status(404).json({ error: 'Order not found' });
  const items = [];
  const unavailable = [];
  for (const line of order.items || []) {
    const snapshot = line.productId ? resolveProductSnapshot(line.productId) : null;
    if (!snapshot || snapshot.stockQty <= 0) {
      unavailable.push(line.productName || line.productId || 'Unknown item');
      continue;
    }
    items.push({
      productId: line.productId,
      name: snapshot.name,
      price: snapshot.price,
      weight: snapshot.weight,
      quantity: Math.min(line.quantity || 1, snapshot.stockQty),
    });
  }
  res.json({ items, unavailable });
});

// Invoice History's delete action -- a genuine hard delete, unlike cancel
// (see deleteOrder in orders.js for why restoring stock is conditional on
// status). No route currently allows removing an order at all otherwise.
app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const existing = getOrder(req.params.id);
  const ok = deleteOrder(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Order not found' });
  recordAuditEvent({ eventType: AUDIT_EVENTS.ORDER_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Deleted order ${existing?.invoiceNumber || req.params.id}` });
  res.json({ ok: true });
});

// F.4/H.2: (re)send is the same helper for both the automatic send at
// checkout and this manual admin action -- one code path, no drift between
// what the automatic email looks like and what "resend" produces.
app.post('/api/orders/:id/send-confirmation', requireAuth, async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  try {
    await sendOrderConfirmationEmail(order);
    markConfirmationEmailSent(order.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('send-confirmation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to send email' });
  }
});

// F.3: print-friendly packing slip. Deliberately not JSON -- this is a
// browser-rendered page an admin opens and prints/screenshots, matching
// "A print-friendly HTML view is enough" from the spec.
app.get('/api/orders/:id/packing-slip', requireAuth, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).send('Order not found');
  res.send(renderPackingSlipHtml(order));
});

// Phase 3: formal numbered invoice, same "print-friendly HTML, no PDF
// dependency" pattern as the packing slip above.
app.get('/api/orders/:id/invoice', requireAuth, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).send('Order not found');
  res.send(renderInvoiceHtml(order, getSettings()));
});

// ---- Checkout (D/E) -- public, no admin auth ----

app.post('/api/checkout', checkoutLimiter, async (req, res) => {
  const body = req.body || {};
  try {
    const order = createOrder({
      client: body.client || {},
      items: body.items || [],
      shippingMethod: body.shippingMethod,
      shippingOptionId: body.shippingOptionId,
      paymentMethod: body.paymentMethod,
    });
    const lowStock = order._lowStock;
    delete order._lowStock;
    const clientDataUpdated = Boolean(order._clientDataUpdated);
    delete order._clientDataUpdated;
    if (lowStock?.length) await sendLowStockAlerts(lowStock);

    // The invoice itself (unlike the "your order is confirmed" email below)
    // is never a lie to send immediately -- it's a bill for what's owed,
    // true whether or not Payfast has cleared yet -- so it goes out for
    // every payment method as soon as the order exists. A second, distinct
    // "paid in full" invoice follows later for Payfast once the ITN webhook
    // actually confirms payment (see markOrderPaid's call site below).
    try {
      await sendInvoiceEmail(order);
    } catch (err) {
      logEmailFailure(`Order ${order.id} invoice email`, err, req);
    }

    // For Payfast (card/EFT), the order isn't actually paid yet at this
    // point -- it's just been created as pending_payment and the customer
    // is about to be redirected to Payfast's hosted page. Sending "order
    // confirmed" here would be a lie if they abandon/decline payment.
    // The confirmation only goes out once the ITN webhook below confirms
    // COMPLETE. Manual EFT / Cash on Collection have no online payment gate
    // to wait for, so they still confirm immediately.
    const isOnlinePayment = body.paymentMethod === 'payfast_card' || body.paymentMethod === 'payfast_eft';
    let emailSent = false;
    if (!isOnlinePayment) {
      try {
        await sendOrderConfirmationEmail(order);
        emailSent = true;
        markConfirmationEmailSent(order.id);
      } catch (err) {
        // A failed confirmation email must not fail the checkout -- the
        // order is already placed. The admin "resend" action (H.2) exists
        // specifically to recover from this.
        logEmailFailure(`Order ${order.id} confirmation email`, err, req);
      }
    }

    try {
      await sendNewOrderNotificationEmail(order);
    } catch (err) {
      logEmailFailure('New order owner-notification email', err, req);
    }

    if (body.paymentMethod === 'manual_eft' || body.paymentMethod === 'cash_on_collection') {
      return res.status(201).json({ order, emailSent, redirect: null, clientDataUpdated });
    }

    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const siteUrl = process.env.SITE_URL || requestOrigin;
    // apiUrl defaults to this request's own origin (correct for local dev,
    // and for any single-host deploy) -- API_URL only needs to be set if
    // this backend sits behind another proxy hop that also mangles
    // req.get('host'), the same class of problem SITE_URL solves for the
    // static site.
    const apiUrl = process.env.API_URL || requestOrigin;
    const payfast = buildPayfastRedirect({ order, siteUrl, apiUrl, paymentMethod: body.paymentMethod });
    res.status(201).json({ order, emailSent, redirect: payfast, clientDataUpdated });
  } catch (err) {
    // Every checkout error is recorded for visibility (previously nothing
    // was, not even console.error) -- but only alerted on if it's NOT one of
    // createOrder()'s own known validation rejections (out of stock, empty
    // cart, etc), which are normal customer-facing outcomes, not a system
    // problem. See server/alerts.js's isExpectedCheckoutValidationError().
    recordAuditEvent({ eventType: AUDIT_EVENTS.CHECKOUT_ERROR, detail: err.message, ...requestMeta(req) });
    alertCheckoutError(err).catch(() => {});
    res.status(400).json({ error: err.message });
  }
});

// ---- Payfast ITN webhook ----

app.post(
  '/api/payfast/itn',
  // `verify` captures the exact bytes Payfast POSTed before Express parses
  // them into req.body. Payfast's server-to-server /validate call needs
  // those original bytes back verbatim -- reconstructing a body string from
  // the *parsed* req.body (e.g. via `new URLSearchParams(req.body)`) risks
  // re-encoding some value differently than Payfast sent it, which would
  // make a legitimate ITN's validate call falsely come back INVALID.
  express.urlencoded({ extended: false, verify: (req, _res, buf) => { req.rawBody = buf; } }),
  async (req, res) => {
    // Payfast expects a bare 200 regardless of outcome -- it will retry on
    // anything else, which is not what we want once we've already decided a
    // payload is invalid/unverifiable.
    res.sendStatus(200);

    const order = getOrder(req.body.m_payment_id);
    if (!order) {
      console.error('Payfast ITN for unknown order:', req.body.m_payment_id);
      recordAuditEvent({ eventType: AUDIT_EVENTS.PAYMENT_FAILURE, detail: `Unknown order: ${req.body.m_payment_id}` });
      alertPaymentFailure('Unknown order', `Payfast ITN referenced an order id that doesn't exist: ${req.body.m_payment_id}`).catch(() => {});
      return;
    }

    const rawBody = req.rawBody.toString('utf8');
    const result = await verifyItn(rawBody, req.body, order.total, req.ip);
    if (!result.valid) {
      console.error('Payfast ITN failed validation:', result);
      // The one failure class this project has already been bitten by for
      // real (SYSTEM_DOCUMENTATION.md §2 -- a genuine paid order sat stuck
      // at pending_payment for days, discovered only by manual audit, not
      // any alert). Highest-value alert of this whole batch.
      recordAuditEvent({ eventType: AUDIT_EVENTS.PAYMENT_FAILURE, detail: `ITN validation failed for order ${order.id}: ${JSON.stringify(result)}` });
      alertPaymentFailure(`ITN validation failed (order ${order.invoiceNumber || order.id.slice(0, 8)})`, `Payfast's ITN for this order failed signature/amount/server validation.\n\nDetail: ${JSON.stringify(result)}\n\nThis order may be paid on Payfast's side but stuck at pending_payment here -- check Payfast's merchant dashboard against Invoice History.`).catch(() => {});
      return;
    }

    recordPaymentTransaction({
      orderId: order.id,
      gateway: 'payfast',
      gatewayReference: result.pfPaymentId,
      rawPayload: JSON.stringify(req.body),
      status: result.paymentStatus,
    });

    if (result.paymentStatus === 'COMPLETE') {
      // changed is false on a duplicate ITN redelivery for an order already
      // marked paid (markOrderPaid's UPDATE only matches status =
      // 'pending_payment') -- gate the confirmation email on it too, or a
      // Payfast retry would resend "your order is confirmed" every time.
      const { changed, lowStock } = markOrderPaid(order.id);
      if (changed) {
        // Backlog #113: payment_complete rides the changed flag, which is
        // exactly the ITN-redelivery dedupe -- a Payfast retry for an
        // already-paid order records nothing.
        recordEvent({ clientId: order.clientId || null, eventType: 'payment_complete', detail: `order:${order.id}` });
        if (lowStock.length) await sendLowStockAlerts(lowStock);
        try {
          await sendOrderConfirmationEmail(order);
          markConfirmationEmailSent(order.id);
        } catch (err) {
          logEmailFailure(`Order ${order.id} confirmation email (Payfast ITN)`, err, req);
        }
        try {
          await sendInvoiceEmail(order, { paid: true });
        } catch (err) {
          logEmailFailure(`Order ${order.id} invoice email (Payfast ITN, paid in full)`, err, req);
        }
      }
    }
  },
);

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: publicSettings(getSettings()), fonts: FONT_OPTIONS });
});

app.put('/api/settings', requireAuth, async (req, res) => {
  const body = req.body || {};
  const allowed = [
    'siteName', 'tagline', 'phoneDisplay', 'phoneTel', 'email', 'address', 'hours', 'whatsapp',
    // Backlog #78
    'whatsappResponseNote', 'escalationContactsNote',
    'facebook', 'instagram', 'useUniversalFont', 'universalFont', 'fontSans', 'fontSerif',
    'defaultTheme', 'homeTiles',
    // Phase 3
    'bankName', 'bankAccountName', 'bankAccountNumber', 'bankBranchCode', 'invoiceNumberSeed',
    'markupPct', 'electricityRate', 'printerPowerDraw', 'runningCostsPct',
    'designRate', 'setupRate', 'postProcessingRate',
    // Phase 4
    'orderNotificationEmail',
    // SITE-027
    'lowStockThreshold',
    // SITE-026 / #60 -- volume price breaks (shape-guarded below)
    'volumeDiscounts',
    // SITE-010
    'printLeadTimeDays', 'filamentDispatchDays',
    // Configurable lists -- inHouseFilamentBrands existed before this (a
    // textarea in the admin UI) but was never actually in this allow-list,
    // so every save of it was silently discarded. Fixed here as part of
    // upgrading it to the same {id,name,active} shape as the two new ones.
    'inHouseFilamentBrands', 'todoCategories', 'todoPriorities',
    // Same class of bug caught here on first real add-flow test
    // (2026-08-27): these were added to settings.js's LIST_SETTING_KEYS
    // (read side) and the admin UI, but not here -- every save silently
    // discarded, identical to the inHouseFilamentBrands bug above.
    'carPartModelsLandrover', 'carPartModelsGwm',
    // Homepage featured products -- {id,productId,active}[], resolved to
    // display data by syncPublicJson() below, NOT the {id,name,active}
    // configurable-list shape, so it gets its own guard further down
    // rather than reusing the loop those four share.
    'featuredProducts',
    // Communications: { templateKey: {subject, message} }, admin-editable
    // wording for every branded transactional email (server/mailer.js).
    // Gets its own guard further down -- same class of bug as the four
    // above if forgotten here (this codebase has now hit it three times).
    'emailTemplates',
    // Backlog #120: operational alerts (server/alerts.js) -- all plain
    // scalars, no shape guard needed (unlike emailTemplates/homeTiles/the
    // configurable lists above).
    'alertBackupFailureEnabled', 'alertPaymentFailureEnabled', 'alertCheckoutErrorEnabled',
    'alertEmailFallbackEnabled', 'alertEmailFallbackThreshold', 'alertEmailFallbackWhatsappNumber',
    'alertEmailFallbackWhatsappTemplateName',
    'alertSecuritySpikeEnabled', 'alertSecuritySpikeThreshold', 'alertSecuritySpikeWindowMinutes',
  ];
  const patch = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (typeof patch.useUniversalFont === 'string') {
    patch.useUniversalFont = patch.useUniversalFont === 'true';
  }
  if (Array.isArray(patch.homeTiles)) {
    // Guard each element too, not just the array itself -- a malformed
    // entry (e.g. null, or a non-object) must be defaulted rather than
    // crashing the whole request when read as `t.eyebrow`/`t.title`/
    // `t.description`.
    patch.homeTiles = patch.homeTiles.slice(0, 3).map((t) => {
      const tile = t && typeof t === 'object' ? t : {};
      return {
        eyebrow: tile.eyebrow || '',
        title: tile.title || '',
        description: tile.description || '',
      };
    });
  } else {
    delete patch.homeTiles;
  }
  // Same shape guard as homeTiles above -- a malformed entry must be
  // dropped rather than crash the request when read as `.id`/`.name`/
  // `.active`. Entries with no usable name are dropped outright (unlike
  // homeTiles' blank-default placeholders) since a nameless list item has
  // nothing to show in a picker.
  for (const key of ['inHouseFilamentBrands', 'todoCategories', 'todoPriorities', 'carPartModelsLandrover', 'carPartModelsGwm']) {
    if (!Array.isArray(patch[key])) {
      delete patch[key];
      continue;
    }
    patch[key] = patch[key]
      .map((entry) => (entry && typeof entry === 'object' ? entry : {}))
      .map((entry, i) => ({
        id: String(entry.id || '').trim() || `item-${i}-${Date.now()}`,
        name: String(entry.name || '').trim(),
        active: entry.active !== false,
      }))
      .filter((entry) => entry.name);
  }

  // #60: volumeDiscounts shape guard -- numeric tiers only, clamped sane.
  if (patch.volumeDiscounts !== undefined) {
    patch.volumeDiscounts = (Array.isArray(patch.volumeDiscounts) ? patch.volumeDiscounts : [])
      .map((t, i) => ({
        id: String(t?.id || '').trim() || `vd-${i}-${Date.now()}`,
        minQty: Math.max(2, Math.round(Number(t?.minQty) || 0)),
        pct: Math.min(90, Math.max(0, Number(t?.pct) || 0)),
        active: t?.active !== false,
      }))
      .filter((t) => t.minQty >= 2 && t.pct > 0);
  }
  // Same shape-guard reasoning as the configurable lists above, but its own
  // block: a featured-product entry has no `name` field to require (the
  // display name is resolved from productId at publish time, see
  // syncPublicJson()) -- what it must have is a non-empty productId string.
  if (Array.isArray(patch.featuredProducts)) {
    patch.featuredProducts = patch.featuredProducts
      .map((entry) => (entry && typeof entry === 'object' ? entry : {}))
      .map((entry, i) => ({
        id: String(entry.id || '').trim() || `featured-${i}-${Date.now()}`,
        productId: String(entry.productId || '').trim(),
        active: entry.active !== false,
      }))
      .filter((entry) => entry.productId);
  } else {
    delete patch.featuredProducts;
  }
  // Same shape-guard reasoning as above: rebuild from the known template
  // keys (DEFAULT_SETTINGS.emailTemplates) rather than trusting whatever
  // keys the request happens to send, so a malformed/missing entry falls
  // back to its default subject/message instead of a sender crashing later
  // on `undefined.subject`, and an unrecognized key can't be smuggled in.
  if (patch.emailTemplates && typeof patch.emailTemplates === 'object') {
    const incoming = patch.emailTemplates;
    patch.emailTemplates = {};
    for (const key of Object.keys(DEFAULT_SETTINGS.emailTemplates)) {
      const entry = incoming[key] && typeof incoming[key] === 'object' ? incoming[key] : {};
      patch.emailTemplates[key] = {
        subject: String(entry.subject ?? '').trim() || DEFAULT_SETTINGS.emailTemplates[key].subject,
        message: String(entry.message ?? '').trim() || DEFAULT_SETTINGS.emailTemplates[key].message,
      };
    }
  } else {
    delete patch.emailTemplates;
  }
  const settings = updateSettings(patch);
  syncPublicJson(getDb());
  // Field names only, never values -- several of these (bankAccountNumber
  // etc) shouldn't end up sitting in plaintext inside an audit-log detail
  // string just because they happened to change.
  const changedKeys = Object.keys(patch);
  if (changedKeys.length) {
    recordAuditEvent({ eventType: AUDIT_EVENTS.SETTINGS_UPDATED, adminId: req.adminId, username: req.adminUsername, ...requestMeta(req), detail: `Settings updated: ${changedKeys.join(', ')}` });
  }
  // Same reasoning as runBuild()'s own comment: syncPublicJson() alone only
  // refreshes public/site-settings.json -- nginx serves dist/, which is only
  // ever produced by `vite build`, and several settings (lowStockThreshold,
  // printLeadTimeDays/filamentDispatchDays) are also baked into the
  // generated HTML itself by generate-pages.mjs, not just read at runtime.
  // Without this, a settings save (e.g. featuredProducts, homeTiles) looked
  // saved in the admin but silently never appeared on the live site until
  // someone happened to click "Publish to site" or a code deploy ran the
  // build anyway -- caught for real 2026-08-27 when featured products
  // didn't show up live after being saved. Non-fatal: the setting is
  // already persisted in the DB above regardless of whether this succeeds,
  // so a publish hiccup here is surfaced as a warning, not a failed save.
  let publishWarning;
  try {
    await runGenerate();
    await runBuild();
  } catch (err) {
    publishWarning = `Saved, but publishing to the live site failed: ${err.message}. Try "Publish to site" from the dashboard.`;
  }
  res.json({ settings: publicSettings(settings), ...(publishWarning ? { publishWarning } : {}) });
});

app.post('/api/publish', requireAuth, async (_req, res) => {
  syncPublicJson(getDb());
  try {
    await runGenerate();
    await runBuild();
    const warnings = readPublishWarnings();
    const message = warnings.length
      ? `Site pages regenerated and published, but ${warnings.length} category page(s) were skipped: ${warnings.join(', ')}. Check that these categories still exist in the catalog.`
      : 'Site pages regenerated and published live.';
    res.json({ ok: true, message, skippedCategories: warnings });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Publish failed' });
  }
});

// ---- Database backups ----
// A daily backup already runs automatically (server/jobs.js's
// startAutoBackupJob) -- these routes are for the admin "Backups" view:
// see what's been taken, trigger one on demand, download or delete one.

app.get('/api/backups', requireAuth, (_req, res) => {
  res.json({ backups: listBackups() });
});

app.post('/api/backups', requireAuth, async (_req, res) => {
  try {
    const backup = await createBackup();
    res.status(201).json({ backup });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

app.get('/api/backups/:filename/download', requireAuth, (req, res) => {
  let filePath;
  try {
    filePath = getBackupPath(req.params.filename);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!filePath) return res.status(404).json({ error: 'Backup not found' });
  res.download(filePath, req.params.filename);
});

// Manual trigger for the same offsite sync startAutoBackupJob runs daily --
// lets an admin confirm the rclone remote is actually configured/working
// right after setting it up, without waiting up to 24h for the next
// automatic run.
app.post('/api/backups/sync-offsite', requireAuth, async (_req, res) => {
  try {
    await syncOffsite();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/backups/:filename', requireAuth, (req, res) => {
  try {
    const deleted = deleteBackup(req.params.filename);
    if (!deleted) return res.status(404).json({ error: 'Backup not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// generate-pages.mjs runs as a spawned child (stdio: 'inherit'), so its
// console.warn output reaches this process's own stdout, not the client —
// it writes this sidecar file so we can report skipped categories back to
// the admin instead of a silent 200.
function readPublishWarnings() {
  const warningsPath = path.join(root, 'data', 'publish-warnings.json');
  if (!fs.existsSync(warningsPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));
    return Array.isArray(data.skippedCategories) ? data.skippedCategories : [];
  } catch {
    return [];
  }
}

// V1.01: recorded only by scripts/record-deploy-version.mjs (run
// automatically from deploy/deploy-app.sh after every deploy) -- no manual
// "add version" route. This is a read-only view onto that history.
app.get('/api/version-history', requireAuth, (req, res) => {
  res.json({ versions: listVersions() });
});

app.get('/api/version-history/:id', requireAuth, (req, res) => {
  const version = getVersion(req.params.id);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  res.json({ version, releaseDetails: getReleaseDetails(version.id) });
});

app.get('/api/documentation', requireAuth, (_req, res) => {
  res.json({ documents: listDocumentation(root) });
});

app.get('/api/documentation/:id', requireAuth, (req, res) => {
  const document = getDocumentation(req.params.id, root);
  if (!document) return res.status(404).json({ error: 'Documentation not found' });
  res.type('text/markdown').set('Content-Disposition', `inline; filename="${path.basename(document.path)}"`).send(document.content);
});

app.get('/api/test-cases', requireAuth, (_req, res) => {
  res.json({ cases: listTestCases(root), runs: listTestRuns() });
});

app.get('/api/test-runs/:id', requireAuth, (req, res) => {
  const run = getTestRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Test run not found' });
  res.json({ run });
});

app.post('/api/test-runs', requireAuth, (req, res) => {
  try {
    const run = startTestRun({ ...(req.body || {}), requestedBy: req.adminUsername }, root);
    res.status(202).json({ run });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/site-overview', requireAuth, (_req, res) => {
  try {
    res.json(getSiteOverview({ appRoot: root }));
  } catch (err) {
    res.status(500).json({ error: `Unable to collect site overview: ${err.message}` });
  }
});

app.get('/api/site-overview/directory', requireAuth, (req, res) => {
  try {
    res.json(listSiteDirectory(typeof req.query.path === 'string' ? req.query.path : undefined));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Todo / Backlog (Settings) ----
// Append-only: any admin (or this assistant, through the same session) can
// add or edit an item and change its status -- there is no delete route,
// same philosophy as version_history. See server/todos.js's updateTodo for
// why "Won't Fix" exists instead.
app.get('/api/todos', requireAuth, (_req, res) => {
  res.json({ todos: listTodos() });
});

app.post('/api/todos', requireAuth, (req, res) => {
  try {
    // Explicit createdBy in the body wins (Claude passes 'Claude' when
    // logging one on the owner's behalf through this same authenticated
    // route -- see server/todos.js's note); otherwise it's whichever admin
    // is actually logged in, same as every other admin-attributed write.
    const todo = createTodo({ ...req.body, createdBy: req.body?.createdBy || req.adminUsername });
    res.status(201).json({ todo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/todos/:id', requireAuth, (req, res) => {
  try {
    const todo = updateTodo(req.params.id, req.body || {});
    if (!todo) return res.status(404).json({ error: 'Todo not found' });
    res.json({ todo });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/admin', express.static(path.join(root, 'admin')));
app.get(/^\/admin(\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(root, 'admin', 'index.html'));
});

app.get('/', (_req, res) => {
  res.redirect('/admin/');
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// F.3: a minimal print-friendly page, not a PDF -- "A print-friendly HTML
// view is enough" per spec. Uses the browser's own print dialog (window.print()).
function renderPackingSlipHtml(order) {
  const rows = order.items
    .map((i) => `<tr><td>${escapeHtml(i.productName)}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${i.weight * i.quantity}g</td></tr>`)
    .join('');
  const addr = order.client
    ? [order.client.street, order.client.suburb, order.client.city, order.client.province, order.client.postalCode, order.client.country]
        .filter(Boolean)
        .join(', ')
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Packing slip — ${escapeHtml(order.id)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 2rem auto; color: #1a1612; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
  .muted { color: #666; font-size: 0.9rem; }
  .totals { font-weight: 600; }
  @media print { button { display: none; } }
</style></head>
<body>
  <button onclick="window.print()">Print</button>
  <h1>Packing slip</h1>
  <p class="muted">Order ${escapeHtml(order.id)} — ${escapeHtml(order.createdAt)}</p>
  <p><strong>${escapeHtml(order.client?.name || '')}</strong>${order.client?.businessName ? ` (${escapeHtml(order.client.businessName)})` : ''}<br>${escapeHtml(addr)}<br>${escapeHtml(order.client?.phone || '')}</p>
  <table>
    <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Weight</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="totals"><td>Total parcel weight</td><td></td><td style="text-align:right">${order.totalWeight}g</td></tr></tfoot>
  </table>
  <p>Shipping method: ${escapeHtml(SHIPPING_METHOD_LABELS[order.shippingMethod] || order.shippingMethod || '—')}</p>
</body></html>`;
}

const SHIPPING_METHOD_LABELS = {
  courier: 'Our shipping',
  own_courier: "Customer's own courier",
  collect: 'Collect from store',
  fixed: 'Shipping',
};

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'product'
  );
}

// Single-item shape, shared by the bulk normalizeItems() below and the
// per-item POST/PUT routes (so "Save item" on one GWM/Landrover/Toys/etc
// row produces byte-identical output to what the old full-array
// "Save product" always did -- no separate, driftable validation path).
function normalizeItem(item, i) {
  return {
    id: item.id || randomUUID(),
    name: item.name || `Item ${i + 1}`,
    details: item.details || '',
    material: item.material || '',
    size: item.size || '',
    finish: item.finish || '',
    price: item.price || '',
    sku: item.sku || '',
    imageUrl: item.imageUrl || '',
    // Car-parts only (GWM/Landrover) -- who designed the printable part, and
    // which vehicle model(s) it fits. Stored as plain name strings (not ids
    // into settings.carPartModelsLandrover/carPartModelsGwm), same
    // convention as in_house_filament.brand/todo_items.category: renaming a
    // list entry later must not retroactively change what's already saved
    // on an item.
    creator: item.creator || '',
    models: Array.isArray(item.models) ? item.models.filter(Boolean) : [],
    // Admin-only reference back to the original design's source page --
    // never sent to the public categories.json export (see export.js).
    sourceUrl: item.sourceUrl || '',
    // Grams -- matches filament_colours.weight_g and every other weight
    // field end to end (order_items.weight, cart.js, data-weight attrs).
    weight: Number(item.weight) || 0,
    // Separate from weight -- what actually drives shipping-bracket
    // matching, so packaging etc can differ from the item's own weight.
    shippingWeight: item.shippingWeight != null && item.shippingWeight !== '' ? Number(item.shippingWeight) : undefined,
    // Unified with filament_colours.stock_qty for the Stock Management grid
    // and inventory decrement -- category items had no numeric stock count
    // before, only the `available` boolean.
    stockQty: Math.max(0, Number(item.stockQty) || 0),
    available: item.available !== false,
    // Whether this item shows on its category page at all -- separate from
    // `available` (which only controls whether the Add to Cart button shows;
    // an unavailable-but-listed item still displays with an Enquire link).
    // scripts/generate-pages.mjs and export.js's syncPublicJson() already
    // filter/pass this through; it was just never settable from the admin UI.
    listed: item.listed !== false,
    sortOrder: item.sortOrder ?? i,
  };
}

function normalizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, i) => normalizeItem(item, i));
}

function runGenerate() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`generate-pages exited with code ${code}`));
    });
  });
}

// nginx serves the static site from dist/ (see deploy/nginx-lapanza.conf), which
// is only ever produced by `vite build` -- generate-pages.mjs above rewrites the
// *source* html at repo root, which vite build then bundles into dist/. Without
// this second step, "Publish to site" updated the source pages but never the
// live served output -- catalog edits (a photo, a price, anything) looked
// published in the admin but silently never appeared on the real site until
// the next full code deploy happened to run `npm run build` too.
function runBuild() {
  return new Promise((resolve, reject) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCmd, ['run', 'build'], { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vite build exited with code ${code}`));
    });
  });
}

getDb();

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`\n> Lapanza Admin API  http://localhost:${PORT}/admin/\n`);
  });
  startAutoCancelJob();
  startAutoBackupJob();
  startAuditLogPruneJob();
  startPageViewsPruneJob();
  // #43 safety net: catches restocks whose trigger path was missed (e.g.
  // auto-cancel job restores, direct DB edits) -- daily, same idiom as the
  // other in-process jobs.
  setInterval(() => processRestockNotifications(sendRestockNotification).catch(() => {}), 24 * 60 * 60 * 1000);
  processRestockNotifications(sendRestockNotification).catch(() => {});
}

export default app;
