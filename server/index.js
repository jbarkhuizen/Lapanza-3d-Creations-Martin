import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import {
  loadCatalog,
  saveCatalog,
  getProduct,
  upsertProduct,
  deleteProduct,
  updateSettings,
  randomUUID,
  now,
} from './store.js';
import { FONT_OPTIONS } from './settings-defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.ADMIN_PORT || 8787);
const SESSION_COOKIE = 'lapanza_admin_session';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

const sessions = new Map();

function checkPassword(candidate) {
  if (!candidate) return false;
  if (process.env.ADMIN_PASSWORD) return candidate === process.env.ADMIN_PASSWORD;
  const catalog = loadCatalog();
  return bcrypt.compareSync(candidate, catalog.settings.adminPasswordHash || '');
}

function requireAuth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lapanza-admin', time: now() });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = randomUUID();
  sessions.set(token, { createdAt: Date.now() });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12,
  });
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

app.get('/api/dashboard', requireAuth, (_req, res) => {
  const catalog = loadCatalog();
  const products = catalog.products;
  const filaments = products.filter((p) => p.kind === 'filament');
  const categories = products.filter((p) => p.kind === 'category');
  const colourCount = filaments.reduce((n, p) => n + (p.colours?.length || 0), 0);
  const itemCount = categories.reduce((n, p) => n + (p.items?.length || 0), 0);
  const draftCount = products.filter((p) => p.status === 'draft').length;
  const publishedCount = products.filter((p) => p.status === 'published').length;

  res.json({
    updatedAt: catalog.updatedAt,
    totals: {
      products: products.length,
      filaments: filaments.length,
      categories: categories.length,
      colours: colourCount,
      catalogItems: itemCount,
      published: publishedCount,
      drafts: draftCount,
    },
    recent: [...products]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 8)
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        status: p.status,
        updatedAt: p.updatedAt,
        slug: p.slug,
      })),
  });
});

app.get('/api/products', requireAuth, (req, res) => {
  const catalog = loadCatalog();
  let list = [...catalog.products];
  const { kind, status, q, parent } = req.query;

  if (kind) list = list.filter((p) => p.kind === kind);
  if (status) list = list.filter((p) => p.status === status);
  if (parent) list = list.filter((p) => p.parent === parent);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => {
      const hay = [
        p.name,
        p.slug,
        p.description,
        ...(p.colours || []).flatMap((c) => [c.name, c.sku, c.price]),
        ...(p.items || []).flatMap((i) => [i.name, i.sku, i.details]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
  });

  res.json({
    products: list,
    count: list.length,
  });
});

app.get('/api/products/:id', requireAuth, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

app.post('/api/products', requireAuth, (req, res) => {
  const body = req.body || {};
  const kind = body.kind === 'category' ? 'category' : 'filament';
  const product = {
    id: randomUUID(),
    kind,
    status: body.status === 'draft' ? 'draft' : 'published',
    featured: Boolean(body.featured),
    sortOrder: Number(body.sortOrder) || 0,
    slug: slugify(body.slug || body.name || 'product'),
    name: body.name || 'Untitled product',
    description: body.description || '',
    colourNote: body.colourNote || '',
    crumbs: body.crumbs || '',
    parent: body.parent || null,
    seoTitle: body.seoTitle || '',
    seoDescription: body.seoDescription || '',
    internalNotes: body.internalNotes || '',
    specs: normalizeSpecs(body.specs),
    colours: normalizeColours(body.colours),
    items: normalizeItems(body.items),
    createdAt: now(),
    updatedAt: now(),
  };
  upsertProduct(product);
  res.status(201).json({ product });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const body = req.body || {};
  const product = {
    ...existing,
    ...body,
    id: existing.id,
    kind: body.kind === 'category' || body.kind === 'filament' ? body.kind : existing.kind,
    slug: slugify(body.slug || existing.slug),
    name: body.name ?? existing.name,
    specs: normalizeSpecs(body.specs ?? existing.specs),
    colours: normalizeColours(body.colours ?? existing.colours),
    items: normalizeItems(body.items ?? existing.items),
  };
  upsertProduct(product);
  res.json({ product });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const ok = deleteProduct(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

app.post('/api/products/:id/duplicate', requireAuth, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const copy = structuredClone(existing);
  copy.id = randomUUID();
  copy.name = `${existing.name} (copy)`;
  copy.slug = slugify(`${existing.slug}-copy`);
  copy.status = 'draft';
  copy.createdAt = now();
  copy.updatedAt = now();
  copy.specs = (copy.specs || []).map((s) => ({ ...s, id: randomUUID() }));
  copy.colours = (copy.colours || []).map((c) => ({ ...c, id: randomUUID() }));
  copy.items = (copy.items || []).map((i) => ({ ...i, id: randomUUID() }));
  upsertProduct(copy);
  res.status(201).json({ product: copy });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  const { adminPassword, adminPasswordHash, ...safe } = loadCatalog().settings;
  res.json({ settings: safe, fonts: FONT_OPTIONS });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const allowed = [
    'siteName',
    'tagline',
    'phoneDisplay',
    'phoneTel',
    'email',
    'address',
    'hours',
    'whatsapp',
    'facebook',
    'instagram',
    'adminPassword',
    'useUniversalFont',
    'universalFont',
    'fontSans',
    'fontSerif',
    'defaultTheme',
  ];
  const patch = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (typeof patch.useUniversalFont === 'string') {
    patch.useUniversalFont = patch.useUniversalFont === 'true' || patch.useUniversalFont === true;
  }
  if (patch.adminPassword) {
    patch.adminPasswordHash = bcrypt.hashSync(patch.adminPassword, 10);
  }
  delete patch.adminPassword;
  const settings = updateSettings(patch);
  const { adminPassword, adminPasswordHash, ...safe } = settings;
  res.json({ settings: safe });
});

app.post('/api/publish', requireAuth, async (_req, res) => {
  const catalog = loadCatalog();
  saveCatalog(catalog); // re-sync site data
  try {
    await runGenerate();
    res.json({ ok: true, message: 'Site pages regenerated from catalog.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Generate failed' });
  }
});

app.use('/admin', express.static(path.join(root, 'admin')));
app.get(/^\/admin(\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(root, 'admin', 'index.html'));
});

app.get('/', (_req, res) => {
  res.redirect('/admin/');
});

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'product';
}

function normalizeSpecs(list) {
  if (!Array.isArray(list)) return [];
  return list.map((s, i) => ({
    id: s.id || randomUUID(),
    label: s.label || `Spec ${i + 1}`,
    value: s.value || '',
  }));
}

function normalizeColours(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({
    id: c.id || randomUUID(),
    name: c.name || '',
    sku: c.sku || '',
    price: c.price || '',
    hex: c.hex || '',
    inStock: c.inStock !== false,
    notes: c.notes || '',
  }));
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

// Ensure catalog exists on boot
loadCatalog();

app.listen(PORT, () => {
  console.log(`\n▸ Lapanza Admin API  http://localhost:${PORT}/admin/`);
  console.log(`  Default password: lapanza-admin\n`);
});
