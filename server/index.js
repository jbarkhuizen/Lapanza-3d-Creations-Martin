import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
import { uploadFilamentImage } from './uploads.js';
import { syncPublicJson, readCategoryProducts } from './export.js';
import { saveCatalog, getProduct, upsertProduct, deleteProduct } from './store.js';
import { listClients, getClient, createClient, updateClient, listOrdersForClient } from './clients.js';
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
  updateOrderStatus,
  updateOrderTracking,
  markOrderPaid,
  markConfirmationEmailSent,
  recordPaymentTransaction,
} from './orders.js';
import { buildPayfastRedirect, verifyItn, PAYFAST_URLS } from './payfast.js';
import { sendOrderConfirmationEmail } from './mailer.js';
import { startAutoCancelJob } from './jobs.js';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
const PORT = Number(process.env.ADMIN_PORT || 8787);
const SESSION_COOKIE = 'lapanza_admin_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h -- shared between the cookie maxAge and the server-side expiry check

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(root, 'public', 'uploads')));

const sessions = new Map();

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lapanza-admin', time: new Date().toISOString() });
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

app.post('/api/auth/login', (req, res) => {
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
  res.json({ clients: listClients({ q: req.query.q }) });
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

// ---- Shipping options (C) ----

app.get('/api/shipping-options', requireAuth, (_req, res) => {
  res.json({ shippingOptions: listShippingOptions() });
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

// ---- Orders (D/E/F) ----

app.get('/api/orders', requireAuth, (req, res) => {
  res.json({ orders: listOrders({ status: req.query.status, q: req.query.q }) });
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

app.put('/api/orders/:id/status', requireAuth, (req, res) => {
  try {
    const order = updateOrderStatus(req.params.id, (req.body || {}).status);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
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

// ---- Checkout (D/E) -- public, no admin auth ----

app.post('/api/checkout', async (req, res) => {
  const body = req.body || {};
  try {
    const order = createOrder({
      client: body.client || {},
      items: body.items || [],
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

    if (body.paymentMethod === 'manual_eft') {
      return res.status(201).json({ order, emailSent, redirect: null });
    }

    const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const payfast = buildPayfastRedirect({ order, siteUrl, paymentMethod: body.paymentMethod });
    res.status(201).json({ order, emailSent, redirect: payfast });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Payfast ITN webhook ----

app.post('/api/payfast/itn', express.urlencoded({ extended: false }), async (req, res) => {
  // Payfast expects a bare 200 regardless of outcome -- it will retry on
  // anything else, which is not what we want once we've already decided a
  // payload is invalid/unverifiable.
  res.sendStatus(200);

  const order = getOrder(req.body.m_payment_id);
  if (!order) {
    console.error('Payfast ITN for unknown order:', req.body.m_payment_id);
    return;
  }

  const rawBody = new URLSearchParams(req.body).toString();
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
    markOrderPaid(order.id);
  }
});

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({ settings: publicSettings(getSettings()), fonts: FONT_OPTIONS });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const allowed = [
    'siteName', 'tagline', 'phoneDisplay', 'phoneTel', 'email', 'address', 'hours', 'whatsapp',
    'facebook', 'instagram', 'useUniversalFont', 'universalFont', 'fontSans', 'fontSerif',
    'defaultTheme', 'homeTiles',
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
  <p><strong>${escapeHtml(order.client?.name || '')}</strong><br>${escapeHtml(addr)}<br>${escapeHtml(order.client?.phone || '')}</p>
  <table>
    <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Weight</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="totals"><td>Total parcel weight</td><td></td><td style="text-align:right">${order.totalWeight}g</td></tr></tfoot>
  </table>
  <p>Shipping method: ${escapeHtml(order.shippingOption?.name || '—')}</p>
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
}

export default app;
