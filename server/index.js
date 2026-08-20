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
import { FONT_OPTIONS } from './settings-defaults.js';
import { hasAnyAdmin, listAdmins, createAdmin, deleteAdmin, resetPassword, verifyLogin } from './admins.js';
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
} from './uploads.js';
import { syncPublicJson, readCategoryProducts } from './export.js';
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
  setWhatsAppOptIn,
  manuallyVerifyClient,
  regenerateVerificationToken,
  deleteOrRevokeClient,
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
  createOrder,
  createManualOrder,
  updateOrderStatus,
  updateOrderTracking,
  markOrderPaid,
  markConfirmationEmailSent,
  recordPaymentTransaction,
} from './orders.js';
import { buildPayfastRedirect, verifyItn, PAYFAST_URLS } from './payfast.js';
import {
  sendOrderConfirmationEmail,
  sendLowStockAlert,
  sendClientVerificationEmail,
  sendNewsletterConfirmationEmail,
  sendDesignRequestStatusEmail,
  sendNewOrderNotificationEmail,
  sendNewDesignRequestNotificationEmail,
} from './mailer.js';
import { subscribe as subscribeNewsletter, confirm as confirmNewsletter, unsubscribe as unsubscribeNewsletter } from './newsletter.js';
import {
  listCampaigns as listNewsletterCampaigns,
  createCampaign as createNewsletterCampaign,
  approveCampaign as approveNewsletterCampaign,
  sendCampaign as sendNewsletterCampaign,
} from './newsletter-campaigns.js';
import {
  listCampaigns as listWhatsAppCampaigns,
  createCampaign as createWhatsAppCampaign,
  approveCampaign as approveWhatsAppCampaign,
  sendCampaign as sendWhatsAppCampaign,
} from './whatsapp-campaigns.js';
import { isWhatsAppConfigured } from './whatsapp.js';
import { startAutoCancelJob, startAutoBackupJob } from './jobs.js';
import { createBackup, listBackups, deleteBackup, getBackupPath } from './backups.js';
import { listInventory, bulkUpdateInventory } from './inventory.js';
import { listResources, getResource, createResource, updateResource, deleteResource } from './resources.js';
import { listDesignRequests, getDesignRequest, createDesignRequest, updateDesignRequest, deleteDesignRequest } from './design-requests.js';
import { listPrintJobs, getPrintJob, createPrintJob, updatePrintJob, deletePrintJob, previewPrintJobCost, setPrintJobImage, setPrintJobFile } from './print-jobs.js';
import {
  listInHouseFilament,
  getInHouseFilament,
  createInHouseFilament,
  updateInHouseFilament,
  deleteInHouseFilament,
} from './in-house-filament.js';
import { listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase } from './purchases.js';

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
});
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions — please try again later.' },
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

function requireAuth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  const session = token && sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (Date.now() - session.createdAt >= SESSION_TTL_MS) {
    sessions.delete(token); // stale -- treat exactly like a missing session
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function startSession(res, adminId) {
  const token = randomUUID();
  sessions.set(token, { createdAt: Date.now(), adminId });
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

function siteUrlFor(req) {
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  return process.env.SITE_URL || requestOrigin;
}

app.post('/api/client/register', authLimiter, async (req, res) => {
  try {
    const { client, token } = registerClient(req.body || {});
    const verifyUrl = `${req.protocol}://${req.get('host')}/api/client/verify?token=${token}`;
    try {
      await sendClientVerificationEmail(client, verifyUrl);
    } catch (err) {
      console.error('Verification email failed to send:', err.message);
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
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const result = loginClient(email, password);
  if (!result.ok && result.reason === 'unverified') {
    return res.status(403).json({ error: 'Please verify your email before logging in — check your inbox for the verification link.' });
  }
  if (!result.ok) return res.status(401).json({ error: 'Invalid email or password' });
  startClientSession(res, result.client.id);
  res.json({ ok: true, client: result.client });
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
        console.error('Newsletter confirmation email failed to send:', err.message);
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
  const subscriber = unsubscribeNewsletter(req.query.token);
  const siteUrl = siteUrlFor(req);
  res.redirect(`${siteUrl}/index.html?newsletter=${subscriber ? 'unsubscribed' : 'invalid'}`);
});

// ---- Newsletter campaigns: compose -> approve -> send (Phase 4) ----

app.get('/api/newsletter-campaigns', requireAuth, (_req, res) => {
  res.json({ campaigns: listNewsletterCampaigns() });
});

app.post('/api/newsletter-campaigns', requireAuth, (req, res) => {
  try {
    res.status(201).json({ campaign: createNewsletterCampaign(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/newsletter-campaigns/:id/approve', requireAuth, (req, res) => {
  try {
    const campaign = approveNewsletterCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/newsletter-campaigns/:id/send', requireAuth, async (req, res) => {
  try {
    const campaign = await sendNewsletterCampaign(req.params.id, { siteUrl: siteUrlFor(req) });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
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
    startSession(res, admin.id);
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
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const admin = verifyLogin(username, password);
  if (!admin) return res.status(401).json({ error: 'Invalid username or password' });
  startSession(res, admin.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
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
    res.status(201).json({ admin: createAdmin(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admins/:id', requireAuth, (req, res) => {
  try {
    const ok = deleteAdmin(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Admin not found' });
    revokeSessionsForAdmin(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admins/:id/reset-password', requireAuth, (req, res) => {
  try {
    const ok = resetPassword(req.params.id, (req.body || {}).password);
    if (!ok) return res.status(404).json({ error: 'Admin not found' });
    revokeSessionsForAdmin(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

app.post('/api/filaments', requireAuth, (req, res) => {
  try {
    const filament = createFilament(req.body || {});
    syncPublicJson(getDb());
    res.status(201).json({ filament });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.put('/api/filaments/:id', requireAuth, (req, res) => {
  try {
    const filament = updateFilament(req.params.id, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Filament not found' });
    syncPublicJson(getDb());
    res.json({ filament });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.delete('/api/filaments/:id', requireAuth, (req, res) => {
  const ok = deleteFilament(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Filament not found' });
  syncPublicJson(getDb());
  res.json({ ok: true });
});

app.post('/api/filaments/:id/colours', requireAuth, (req, res) => {
  try {
    const filament = addColour(req.params.id, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Filament not found' });
    syncPublicJson(getDb());
    res.status(201).json({ filament });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.put('/api/filaments/:filamentId/colours/:colourId', requireAuth, (req, res) => {
  try {
    const filament = updateColour(req.params.filamentId, req.params.colourId, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Colour not found' });
    syncPublicJson(getDb());
    res.json({ filament });
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(400).json({ error: uniqueConstraintMessage(err) });
    throw err;
  }
});

app.delete('/api/filaments/:filamentId/colours/:colourId', requireAuth, (req, res) => {
  const ok = deleteColour(req.params.filamentId, req.params.colourId);
  if (!ok) return res.status(404).json({ error: 'Colour not found' });
  syncPublicJson(getDb());
  res.json({ ok: true });
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
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const imagePath = `/uploads/filaments/${req.file.filename}`;
    const filament = setColourImage(req.params.filamentId, req.params.colourId, imagePath);
    if (!filament) return res.status(404).json({ error: 'Colour not found' });
    syncPublicJson(getDb());
    res.json({ filament });
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

app.post('/api/products', requireAuth, (req, res) => {
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
  res.status(201).json({ product });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
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
  res.json({ product });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const ok = deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
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

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const result = deleteOrRevokeClient(req.params.id);
  if (!result) return res.status(404).json({ error: 'Client not found' });
  res.json(result);
});

// ---- Shipping options (C) ----

app.get('/api/shipping-options', requireAuth, (req, res) => {
  res.json({ shippingOptions: listShippingOptions({ activeOnly: req.query.activeOnly === 'true' }) });
});

app.post('/api/shipping-options', requireAuth, (req, res) => {
  try {
    res.status(201).json({ shippingOption: createShippingOption(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/shipping-options/:id', requireAuth, (req, res) => {
  try {
    const option = updateShippingOption(req.params.id, req.body || {});
    if (!option) return res.status(404).json({ error: 'Shipping option not found' });
    res.json({ shippingOption: option });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/shipping-options/:id', requireAuth, (req, res) => {
  const ok = deleteShippingOption(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Shipping option not found' });
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
  res.json({ shippingOptions: options.map((o) => ({ id: o.id, name: o.name, price: o.price })) });
});

// ---- Inventory / Stock Management ----

app.get('/api/inventory', requireAuth, (_req, res) => {
  res.json({ items: listInventory() });
});

app.put('/api/inventory', requireAuth, async (req, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  const results = bulkUpdateInventory(updates);
  await alertOnLowStock(updates.filter((u, i) => results[i]?.ok && u.stockQty !== undefined).map((u) => u.id));
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
      console.error(`Low-stock alert failed for ${item.name}:`, err.message);
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
    const resource = updateResource(req.params.id, { imagePath: `/uploads/resources/${req.file.filename}` });
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
    const resource = updateResource(req.params.id, { filePath: `/uploads/resources/${req.file.filename}` });
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
        referenceFilePath: fileFile ? `/uploads/design-requests/${fileFile.filename}` : undefined,
      });
      res.status(201).json({ ok: true, designRequest: request });
      try {
        await sendNewDesignRequestNotificationEmail(request);
      } catch (err) {
        console.error('New design request owner-notification email failed:', err.message);
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
        console.error('Design request status email failed to send:', err.message);
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

// ---- Print Job Costing (Phase 3, internal-only) ----

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
  res.json({ printJob: job });
});

app.delete('/api/print-jobs/:id', requireAuth, (req, res) => {
  const ok = deletePrintJob(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Print job not found' });
  res.json({ ok: true });
});

app.post(
  '/api/print-jobs/:id/image',
  requireAuth,
  uploadPrintJobImage.single('image'),
  (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const job = setPrintJobImage(req.params.id, `/uploads/print-jobs/${req.file.filename}`);
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
    const job = setPrintJobFile(req.params.id, `/uploads/print-jobs/${req.file.filename}`);
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
    res.status(201).json({ filament: createInHouseFilament(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/in-house-filament/:id', requireAuth, (req, res) => {
  try {
    const filament = updateInHouseFilament(req.params.id, req.body || {});
    if (!filament) return res.status(404).json({ error: 'Filament not found' });
    res.json({ filament });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/in-house-filament/:id', requireAuth, (req, res) => {
  try {
    const ok = deleteInHouseFilament(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Filament not found' });
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
    res.status(201).json({ order });
    if (lowStock?.length) await sendLowStockAlerts(lowStock);
    try {
      await sendNewOrderNotificationEmail(order);
    } catch (err) {
      console.error('New order owner-notification email failed:', err.message);
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
    const order = updateOrderStatus(req.params.id, (req.body || {}).status);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const lowStock = order._lowStock;
    delete order._lowStock;
    res.json({ order });
    if (lowStock?.length) await sendLowStockAlerts(lowStock);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/orders/:id/tracking', requireAuth, (req, res) => {
  const order = updateOrderTracking(req.params.id, (req.body || {}).trackingNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
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

app.post('/api/checkout', async (req, res) => {
  const body = req.body || {};
  try {
    const order = createOrder({
      client: body.client || {},
      items: body.items || [],
      shippingMethod: body.shippingMethod,
      shippingOptionId: body.shippingOptionId,
      paymentMethod: body.paymentMethod,
    });

    let emailSent = false;
    try {
      await sendOrderConfirmationEmail(order);
      emailSent = true;
      markConfirmationEmailSent(order.id);
    } catch (err) {
      // A failed confirmation email must not fail the checkout -- the order
      // is already placed and (for Payfast) about to redirect to payment.
      // The admin "resend" action (H.2) exists specifically to recover
      // from this.
      console.error(`Order ${order.id} confirmation email failed to send:`, err.message);
    }

    try {
      await sendNewOrderNotificationEmail(order);
    } catch (err) {
      console.error('New order owner-notification email failed:', err.message);
    }

    if (body.paymentMethod === 'manual_eft' || body.paymentMethod === 'cash_on_collection') {
      return res.status(201).json({ order, emailSent, redirect: null });
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
    res.status(201).json({ order, emailSent, redirect: payfast });
  } catch (err) {
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
      return;
    }

    const rawBody = req.rawBody.toString('utf8');
    const result = await verifyItn(rawBody, req.body, order.total, req.ip);
    if (!result.valid) {
      console.error('Payfast ITN failed validation:', result);
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
      const { lowStock } = markOrderPaid(order.id);
      if (lowStock.length) await sendLowStockAlerts(lowStock);
    }
  },
);

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: publicSettings(getSettings()), fonts: FONT_OPTIONS });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const allowed = [
    'siteName', 'tagline', 'phoneDisplay', 'phoneTel', 'email', 'address', 'hours', 'whatsapp',
    'facebook', 'instagram', 'useUniversalFont', 'universalFont', 'fontSans', 'fontSerif',
    'defaultTheme', 'homeTiles',
    // Phase 3
    'bankName', 'bankAccountName', 'bankAccountNumber', 'bankBranchCode', 'invoiceNumberSeed',
    'markupPct', 'electricityRate', 'printerPowerDraw', 'runningCostsPct',
    'designRate', 'setupRate', 'postProcessingRate',
    // Phase 4
    'orderNotificationEmail',
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
  const settings = updateSettings(patch);
  syncPublicJson(getDb());
  res.json({ settings: publicSettings(settings) });
});

app.post('/api/publish', requireAuth, async (_req, res) => {
  syncPublicJson(getDb());
  try {
    await runGenerate();
    const warnings = readPublishWarnings();
    const message = warnings.length
      ? `Site pages regenerated, but ${warnings.length} category page(s) were skipped: ${warnings.join(', ')}. Check that these categories still exist in the catalog.`
      : 'Site pages regenerated from catalog.';
    res.json({ ok: true, message, skippedCategories: warnings });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Generate failed' });
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

function formatRand(value) {
  return `R${Number(value || 0).toFixed(2).replace(/\.00$/, '')}`;
}

// Phase 3: formal numbered invoice -- same "print-friendly HTML, no PDF
// dependency" approach as renderPackingSlipHtml above, laid out to match
// the business's existing spreadsheet invoice (header, bill-to, line items,
// subtotal/shipping/discount/total, bank details).
function renderInvoiceHtml(order, settings) {
  const rows = order.items
    .map(
      (i, idx) =>
        `<tr><td>${idx + 1}</td><td>${escapeHtml(i.productName)}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${formatRand(i.price)}</td><td style="text-align:right">${formatRand(i.price * i.quantity)}</td></tr>`,
    )
    .join('');
  const addr = order.client
    ? [order.client.street, order.client.suburb, order.client.city, order.client.province, order.client.postalCode, order.client.country]
        .filter(Boolean)
        .join(', ')
    : '';
  const createdDate = order.createdAt ? new Date(order.createdAt) : new Date();
  const dueDate = new Date(createdDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const discountRow = order.discountAmount
    ? `<tr><td colspan="4" style="text-align:right">Discount${order.discountPct ? ` (${order.discountPct}%)` : ''}</td><td style="text-align:right">-${formatRand(order.discountAmount)}</td></tr>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Invoice ${escapeHtml(order.invoiceNumber || order.id)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 2rem auto; color: #1a1612; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
  .muted { color: #666; font-size: 0.9rem; }
  .totals td { font-weight: 600; }
  .header-flex { display: flex; justify-content: space-between; align-items: flex-start; }
  @media print { button { display: none; } }
</style></head>
<body>
  <button onclick="window.print()">Print</button>
  <div class="header-flex">
    <div>
      <h1>${escapeHtml(settings.siteName || 'Lapanza')}</h1>
      <p class="muted">${escapeHtml(settings.address || '')}<br>${escapeHtml(settings.phoneDisplay || '')}<br>${escapeHtml(settings.email || '')}</p>
    </div>
    <div style="text-align:right">
      <h1>INVOICE</h1>
      <p class="muted">Invoice No: ${escapeHtml(order.invoiceNumber || '—')}<br>
      Invoice Date: ${escapeHtml(createdDate.toLocaleDateString())}<br>
      Due Date: ${escapeHtml(dueDate.toLocaleDateString())}</p>
    </div>
  </div>
  <p><strong>BILL TO</strong><br>
  ${escapeHtml(order.client?.name || '')}${order.client?.businessName ? ` (${escapeHtml(order.client.businessName)})` : ''}<br>
  ${escapeHtml(order.client?.email || '')}<br>
  ${escapeHtml(addr)}<br>
  ${escapeHtml(order.client?.phone || '')}</p>
  <table>
    <thead><tr><th>#</th><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="4" style="text-align:right">Subtotal</td><td style="text-align:right">${formatRand(order.subtotal)}</td></tr>
      ${discountRow}
      <tr><td colspan="4" style="text-align:right">Shipping</td><td style="text-align:right">${formatRand(order.shippingPrice)}</td></tr>
      <tr class="totals"><td colspan="4" style="text-align:right">TOTAL DUE</td><td style="text-align:right">${formatRand(order.total)}</td></tr>
    </tfoot>
  </table>
  <p><strong>PAYMENT DETAILS</strong><br>
  Bank: ${escapeHtml(settings.bankName || '')}<br>
  Account Name: ${escapeHtml(settings.bankAccountName || '')}<br>
  Account No: ${escapeHtml(settings.bankAccountNumber || '')}<br>
  Branch Code: ${escapeHtml(settings.bankBranchCode || '')}<br>
  Reference: ${escapeHtml(order.invoiceNumber || order.id)}</p>
  <p class="muted">Thank you for your support.</p>
</body></html>`;
}

function slugify(value) {
  return (
    String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'product'
  );
}

function normalizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, i) => ({
    id: item.id || randomUUID(),
    name: item.name || `Item ${i + 1}`,
    details: item.details || '',
    material: item.material || '',
    size: item.size || '',
    finish: item.finish || '',
    price: item.price || '',
    sku: item.sku || '',
    imageUrl: item.imageUrl || '',
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
    sortOrder: item.sortOrder ?? i,
  }));
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

getDb();

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`\n> Lapanza Admin API  http://localhost:${PORT}/admin/\n`);
  });
  startAutoCancelJob();
  startAutoBackupJob();
}

export default app;
