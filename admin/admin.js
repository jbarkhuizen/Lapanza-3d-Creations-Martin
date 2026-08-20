const API = '';

const state = {
  route: 'dashboard',
  authenticated: false,
  products: [],
  filters: { q: '', kind: '', status: '' },
  editingId: null,
  draft: null,
  dashboard: null,
  settings: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function uid() {
  return crypto.randomUUID();
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lapanza-admin-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#12100e' : '#f7f3eb';
}

function initTheme() {
  const saved = localStorage.getItem('lapanza-admin-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function show(el, on = true) {
  el.classList.toggle('hidden', !on);
}

let analyticsPollTimer = null;

function setRoute(route, { id } = {}) {
  state.route = route;
  state.editingId = id || null;
  // The Analytics view polls for live "active now" data while it's open --
  // stop that the moment the admin navigates elsewhere, same idea as
  // clearing any other page-scoped side effect on route change.
  if (route !== 'analytics' && analyticsPollTimer) {
    clearInterval(analyticsPollTimer);
    analyticsPollTimer = null;
  }
  $$('.nav-btn').forEach((btn) =>
    btn.classList.toggle(
      'active',
      btn.dataset.route === route ||
        (route === 'editor' && btn.dataset.route === 'catalog') ||
        (route === 'order-detail' && btn.dataset.route === 'orders'),
    ),
  );
  show($('#view-dashboard'), route === 'dashboard');
  show($('#view-analytics'), route === 'analytics');
  show($('#view-catalog'), route === 'catalog');
  show($('#view-editor'), route === 'editor');
  show($('#view-orders'), route === 'orders');
  show($('#view-order-detail'), route === 'order-detail');
  show($('#view-clients'), route === 'clients');
  show($('#view-registered-users'), route === 'registered-users');
  show($('#view-shipping'), route === 'shipping');
  show($('#view-stock'), route === 'stock');
  show($('#view-resources'), route === 'resources');
  show($('#view-design-requests'), route === 'design-requests');
  show($('#view-newsletter'), route === 'newsletter');
  show($('#view-whatsapp-updates'), route === 'whatsapp-updates');
  show($('#view-invoice-history'), route === 'invoice-history');
  show($('#view-new-order'), route === 'new-order');
  show($('#view-purchases'), route === 'purchases');
  show($('#view-print-jobs'), route === 'print-jobs');
  show($('#view-in-house-filament'), route === 'in-house-filament');
  show($('#view-backups'), route === 'backups');
  show($('#view-version-history'), route === 'version-history');
  show($('#view-settings'), route === 'settings');

  const titles = {
    dashboard: ['Client Side', 'Dashboard'],
    analytics: ['Client Side', 'Analytics'],
    catalog: ['Client Side', 'Product catalog'],
    editor: ['Client Side', 'Edit product'],
    orders: ['Client Side', 'Orders'],
    'order-detail': ['Client Side', 'Order detail'],
    clients: ['Client Side', 'Clients'],
    'registered-users': ['Client Side', 'Registered users'],
    shipping: ['Client Side', 'Shipping options'],
    resources: ['Client Side', '3D Resources'],
    'design-requests': ['Client Side', 'Design requests'],
    newsletter: ['Client Side', 'Newsletter'],
    'whatsapp-updates': ['Client Side', 'WhatsApp Updates'],
    'invoice-history': ['Client Side', 'Invoice History'],
    'new-order': ['Client Side', 'New order'],
    stock: ['Local Management', 'Stock management'],
    purchases: ['Local Management', 'Purchase History'],
    'print-jobs': ['Local Management', 'Print Job Costing'],
    'in-house-filament': ['Local Management', 'In-House Filament'],
    backups: ['Settings', 'Backups'],
    'version-history': ['Settings', 'Version History'],
    settings: ['Settings', 'Site settings'],
  };
  const [eyebrow, title] = titles[route] || titles.dashboard;
  $('#top-eyebrow').textContent = eyebrow;
  $('#top-title').textContent = title;
  show($('.topbar-actions'), route !== 'settings' && route !== 'editor' && route !== 'backups' && route !== 'analytics' && route !== 'version-history');
}

async function boot() {
  initTheme();
  bindChrome();

  let setupStatus;
  try {
    setupStatus = await api('/api/setup/status');
  } catch {
    setupStatus = { needsSetup: false };
  }
  if (setupStatus.needsSetup) {
    renderSetupScreen();
    return;
  }

  try {
    const me = await api('/api/auth/me');
    state.authenticated = me.authenticated;
  } catch {
    state.authenticated = false;
  }
  renderAuth();
  if (state.authenticated) await loadApp();
}

function renderAuth() {
  show($('#view-setup'), false);
  show($('#view-login'), !state.authenticated);
  show($('#shell'), state.authenticated);
}

// Builds a <label class="field"><span>...</span><input .../></label>, matching
// the markup pattern used throughout the static login form and the editor
// views (see admin.css .field / .login-card).
function buildFieldLabel(labelText, type, name, opts = {}) {
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  if (opts.autocomplete) input.autocomplete = opts.autocomplete;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.required) input.required = true;
  if (opts.minlength) input.minLength = opts.minlength;
  label.append(span, input);
  return label;
}

// The first-run "create your admin account" screen isn't part of the static
// index.html markup (only #view-login/#shell are) -- it's built here and
// inserted once, reusing the same login-screen/login-card/field/btn classes
// as the existing login form so it looks like it belongs. Built with DOM
// methods (not innerHTML) since all text here is static/trusted anyway.
function ensureSetupScreen() {
  if ($('#view-setup')) return;

  const section = document.createElement('section');
  section.id = 'view-setup';
  section.className = 'login-screen hidden';

  const card = document.createElement('div');
  card.className = 'login-card';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Lapanza 3D';

  const heading = document.createElement('h1');
  heading.textContent = 'Create your admin account';

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = "This is the first time the admin portal has run — set the username and password you'll use to sign in.";

  const form = document.createElement('form');
  form.id = 'setup-form';
  form.className = 'stack gap-3';

  const usernameLabel = buildFieldLabel('Username', 'text', 'username', {
    autocomplete: 'username',
    placeholder: 'Choose a username',
    required: true,
  });
  const passwordLabel = buildFieldLabel('Password', 'password', 'password', {
    autocomplete: 'new-password',
    placeholder: '8+ characters',
    required: true,
    minlength: 8,
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Create account';

  const errorEl = document.createElement('p');
  errorEl.id = 'setup-error';
  errorEl.className = 'error hidden';

  form.append(usernameLabel, passwordLabel, submitBtn, errorEl);
  card.append(eyebrow, heading, intro, form);
  section.append(card);
  $('#view-login').before(section);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      errorEl.classList.add('hidden');
      state.authenticated = true;
      renderAuth();
      await loadApp();
      toast('Admin account created');
    } catch (ex) {
      errorEl.textContent = ex.message;
      errorEl.classList.remove('hidden');
    }
  });
}

function renderSetupScreen() {
  ensureSetupScreen();
  show($('#view-login'), false);
  show($('#shell'), false);
  show($('#view-setup'), true);
}

// The static login form in index.html only has a password field (the old
// single-shared-password model). Task 10 switched auth to named accounts, so
// a username field is inserted here at runtime -- same reasoning as the setup
// screen above: only admin.js is in scope for this change.
function ensureLoginUsernameField() {
  const form = $('#login-form');
  if (!form || form.querySelector('[name="username"]')) return;
  const passwordLabel = form.querySelector('label.field');
  const usernameLabel = buildFieldLabel('Username', 'text', 'username', {
    autocomplete: 'username',
    placeholder: 'Enter username',
    required: true,
  });
  form.insertBefore(usernameLabel, passwordLabel);
  // The old "Default password: lapanza-admin" hint no longer applies now that
  // accounts are per-user with no shared default -- drop it rather than leave
  // stale, misleading text on the login screen.
  form.querySelector('.hint')?.remove();
}

function bindChrome() {
  ensureSetupScreen();
  ensureLoginUsernameField();

  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const username = String(data.get('username') || '').trim();
    const password = data.get('password');
    const err = $('#login-error');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      state.authenticated = true;
      err.classList.add('hidden');
      renderAuth();
      await loadApp();
      toast('Signed in');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.authenticated = false;
    renderAuth();
  });

  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.route === 'dashboard') {
        setRoute('dashboard');
        await renderDashboard();
      } else if (btn.dataset.route === 'analytics') {
        setRoute('analytics');
        await renderAnalytics();
      } else if (btn.dataset.route === 'catalog') {
        setRoute('catalog');
        await renderCatalog();
      } else if (btn.dataset.route === 'backups') {
        setRoute('backups');
        await renderBackups();
      } else if (btn.dataset.route === 'version-history') {
        setRoute('version-history');
        await renderVersionHistory();
      } else if (btn.dataset.route === 'settings') {
        setRoute('settings');
        await renderSettings();
      } else if (btn.dataset.route === 'orders') {
        setRoute('orders');
        await renderOrders();
      } else if (btn.dataset.route === 'clients') {
        setRoute('clients');
        await renderClients();
      } else if (btn.dataset.route === 'registered-users') {
        setRoute('registered-users');
        await renderRegisteredUsers();
      } else if (btn.dataset.route === 'shipping') {
        setRoute('shipping');
        await renderShipping();
      } else if (btn.dataset.route === 'stock') {
        setRoute('stock');
        await renderStock();
      } else if (btn.dataset.route === 'resources') {
        setRoute('resources');
        await renderResources();
      } else if (btn.dataset.route === 'design-requests') {
        setRoute('design-requests');
        await renderDesignRequests();
      } else if (btn.dataset.route === 'invoice-history') {
        setRoute('invoice-history');
        await renderInvoiceHistory();
      } else if (btn.dataset.route === 'newsletter') {
        setRoute('newsletter');
        await renderNewsletterCampaigns();
      } else if (btn.dataset.route === 'whatsapp-updates') {
        setRoute('whatsapp-updates');
        await renderWhatsAppCampaigns();
      } else if (btn.dataset.route === 'new-order') {
        setRoute('new-order');
        await renderNewOrder();
      } else if (btn.dataset.route === 'purchases') {
        setRoute('purchases');
        await renderPurchases();
      } else if (btn.dataset.route === 'print-jobs') {
        setRoute('print-jobs');
        await renderPrintJobs();
      } else if (btn.dataset.route === 'in-house-filament') {
        setRoute('in-house-filament');
        await renderInHouseFilament();
      }
    });
  });

  $('#btn-new-filament').addEventListener('click', () => openNew('filament'));
  $('#btn-new-category').addEventListener('click', () => openNew('category'));
  $('#btn-publish').addEventListener('click', async () => {
    try {
      const res = await api('/api/publish', { method: 'POST' });
      toast(res.message || 'Published');
    } catch (ex) {
      toast(ex.message);
    }
  });
}

async function loadApp() {
  setRoute('dashboard');
  await Promise.all([renderDashboard(), refreshProducts()]);
}

// Filaments and category products now live behind separate endpoints
// (server/index.js Task 10 route rewrite: /api/filaments* vs /api/products*),
// neither of which supports the combined q/kind/status filtering the catalog
// view previously got from a single /api/products call. So both lists are
// fetched in full and merged + filtered here instead.
async function refreshProducts() {
  const [{ filaments }, { products }] = await Promise.all([
    api('/api/filaments'),
    api('/api/products'),
  ]);
  let list = [
    ...filaments.map((f) => ({ ...f, kind: 'filament' })),
    ...products, // already carry kind: 'category' (server/store.js upsertProduct)
  ];
  const { q, kind, status } = state.filters;
  if (kind) list = list.filter((p) => p.kind === kind);
  if (status) list = list.filter((p) => p.status === status);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((p) => {
      const hay = [
        p.name,
        p.slug,
        p.description,
        ...(p.colours || []).flatMap((c) => [c.name, c.sku]),
        ...(p.items || []).flatMap((i) => [i.name, i.sku, i.details]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  state.products = list;
  return { products: list, count: list.length };
}

// ---- Analytics (post-launch) ----
// First-party visitor tracking -- see src/js/analytics.js for the beacon
// this data comes from. "Active now" polls while this view stays open;
// historical totals (visits/unique visitors/top pages) don't need polling,
// they're refreshed each time the view is (re-)rendered.

function formatRelativeSeconds(isoString) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function renderActiveSection(active) {
  const activeClientRows = active.activeClients
    .map(
      (c) => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.email)}</td>
          <td><code>${escapeHtml(c.path)}</code></td>
          <td>${escapeHtml(formatRelativeSeconds(c.lastSeenAt))}</td>
        </tr>`,
    )
    .join('');

  $('#analytics-active-now').textContent = String(active.totalActive);
  $('#analytics-active-registered').textContent = String(active.registeredActive);
  $('#analytics-active-clients-body').innerHTML =
    activeClientRows || '<tr><td colspan="4"><div class="empty">No registered clients active right now</div></td></tr>';
}

async function renderAnalytics() {
  const [active, summary] = await Promise.all([api('/api/analytics/active'), api('/api/analytics/summary')]);

  const dailyRows = summary.dailyVisits
    .map((d) => `<tr><td>${escapeHtml(d.day)}</td><td>${escapeHtml(String(d.visits))}</td><td>${escapeHtml(String(d.uniqueVisitors))}</td></tr>`)
    .join('');

  const topPageRows = summary.topPages
    .map((p) => `<tr><td><code>${escapeHtml(p.path)}</code></td><td>${escapeHtml(String(p.visits))}</td></tr>`)
    .join('');

  $('#view-analytics').innerHTML = `
    <div class="stats">
      <div class="stat-card"><div class="label">Active now</div><div class="value" id="analytics-active-now">${escapeHtml(String(active.totalActive))}</div></div>
      <div class="stat-card"><div class="label">Registered clients active</div><div class="value" id="analytics-active-registered">${escapeHtml(String(active.registeredActive))}</div></div>
      <div class="stat-card"><div class="label">Visits today</div><div class="value">${escapeHtml(String(summary.todayVisits))}</div></div>
      <div class="stat-card"><div class="label">Total visits</div><div class="value">${escapeHtml(String(summary.totalVisits))}</div></div>
      <div class="stat-card"><div class="label">Unique visitors (all time)</div><div class="value">${escapeHtml(String(summary.uniqueVisitorsAllTime))}</div></div>
    </div>

    <div class="panel table-wrap">
      <div class="section-head"><h3>Active registered clients</h3></div>
      <table class="catalog">
        <thead><tr><th>Name</th><th>Email</th><th>Page</th><th>Last seen</th></tr></thead>
        <tbody id="analytics-active-clients-body"></tbody>
      </table>
    </div>

    <div class="grid-2" style="align-items:start; margin-top:1.5rem;">
      <div class="panel table-wrap">
        <div class="section-head"><h3>Last 30 days</h3></div>
        <table class="catalog">
          <thead><tr><th>Day</th><th>Visits</th><th>Unique visitors</th></tr></thead>
          <tbody>${dailyRows || '<tr><td colspan="3"><div class="empty">No visits recorded yet</div></td></tr>'}</tbody>
        </table>
      </div>
      <div class="panel table-wrap">
        <div class="section-head"><h3>Top pages (all time)</h3></div>
        <table class="catalog">
          <thead><tr><th>Page</th><th>Visits</th></tr></thead>
          <tbody>${topPageRows || '<tr><td colspan="2"><div class="empty">No visits recorded yet</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  renderActiveSection(active);

  clearInterval(analyticsPollTimer);
  analyticsPollTimer = setInterval(async () => {
    renderActiveSection(await api('/api/analytics/active'));
  }, 20000);
}

async function renderDashboard() {
  const data = await api('/api/dashboard');
  state.dashboard = data;
  const t = data.totals;
  $('#view-dashboard').innerHTML = `
    <div class="stats">
      <div class="stat-card"><div class="label">Products</div><div class="value">${t.products}</div></div>
      <div class="stat-card"><div class="label">Filaments</div><div class="value">${t.filaments}</div></div>
      <div class="stat-card"><div class="label">Colour SKUs</div><div class="value">${t.colours}</div></div>
      <div class="stat-card"><div class="label">Catalog items</div><div class="value">${t.catalogItems}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><h3>Publishing</h3><span class="badge ${t.drafts ? 'draft' : 'published'}">${t.published} live · ${t.drafts} draft</span></div>
        <p class="muted">Catalog last updated ${formatDate(data.updatedAt)}. Use <strong>Publish to site</strong> to regenerate public pages from this catalog.</p>
      </div>
      <div class="panel">
        <div class="section-head"><h3>Recently edited</h3></div>
        <div class="recent-list">
          ${data.recent.map((p) => `
            <div class="recent-item" data-id="${p.id}" data-kind="${p.kind}">
              <div>
                <strong>${escapeHtml(p.name)}</strong>
                <div class="muted" style="font-size:0.8rem">${p.kind} · ${p.status}</div>
              </div>
              <div class="muted" style="font-size:0.78rem">${formatDate(p.updatedAt)}</div>
            </div>
          `).join('') || '<div class="empty">No products yet</div>'}
        </div>
      </div>
    </div>
  `;
  $$('.recent-item', $('#view-dashboard')).forEach((row) => {
    row.addEventListener('click', () => openEditor(row.dataset.id, row.dataset.kind));
  });
}

async function renderCatalog() {
  await refreshProducts();
  const rows = state.products.map((p) => {
    const meta =
      p.kind === 'filament'
        ? `${p.colours?.length || 0} colours · ${p.specs?.length || 0} specs`
        : `${p.items?.length || 0} items${p.parent ? ` · ${p.parent}` : ''}`;
    return `
      <tr data-id="${p.id}" data-kind="${p.kind}">
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          <div class="muted" style="font-size:0.8rem">/${escapeHtml(p.slug)}</div>
        </td>
        <td><span class="badge ${p.kind}">${p.kind}</span></td>
        <td><span class="badge ${p.status}">${p.status}</span></td>
        <td class="muted">${meta}</td>
        <td class="muted">${formatDate(p.updatedAt)}</td>
        <td>
          <button class="btn small" data-action="edit" type="button">Edit</button>
        </td>
      </tr>`;
  }).join('');

  $('#view-catalog').innerHTML = `
    <div class="toolbar">
      <input id="filter-q" type="search" placeholder="Search name, SKU, colour…" value="${escapeAttr(state.filters.q)}" />
      <select id="filter-kind">
        <option value="">All kinds</option>
        <option value="filament" ${state.filters.kind === 'filament' ? 'selected' : ''}>Filament</option>
        <option value="category" ${state.filters.kind === 'category' ? 'selected' : ''}>Category pages</option>
      </select>
      <select id="filter-status">
        <option value="">All statuses</option>
        <option value="published" ${state.filters.status === 'published' ? 'selected' : ''}>Published</option>
        <option value="draft" ${state.filters.status === 'draft' ? 'selected' : ''}>Draft</option>
      </select>
      <span class="muted">${state.products.length} results</span>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead>
          <tr>
            <th>Product</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Details</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6"><div class="empty">No products match your filters</div></td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const applyFilters = async () => {
    state.filters.q = $('#filter-q').value.trim();
    state.filters.kind = $('#filter-kind').value;
    state.filters.status = $('#filter-status').value;
    await renderCatalog();
  };
  $('#filter-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilters();
  });
  $('#filter-kind').addEventListener('change', applyFilters);
  $('#filter-status').addEventListener('change', applyFilters);

  $$('#view-catalog tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openEditor(tr.dataset.id, tr.dataset.kind);
    });
    tr.querySelector('[data-action="edit"]')?.addEventListener('click', () => openEditor(tr.dataset.id, tr.dataset.kind));
  });
}

function blankProduct(kind) {
  return {
    id: uid(),
    kind,
    status: 'draft',
    featured: false,
    sortOrder: 0,
    slug: '',
    name: '',
    description: '',
    colourNote: '',
    crumbs: kind === 'category' ? 'Home / ' : '',
    parent: null,
    seoTitle: '',
    seoDescription: '',
    internalNotes: '',
    specs: [],
    colours: [],
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _isNew: true,
  };
}

async function openNew(kind) {
  state.draft = blankProduct(kind);
  state.editingId = state.draft.id;
  setRoute('editor', { id: state.draft.id });
  renderEditor();
}

async function openEditor(id, kind) {
  if (kind === 'filament') {
    const { filament } = await api(`/api/filaments/${id}`);
    state.draft = { ...structuredClone(filament), kind: 'filament' };
  } else {
    const { product } = await api(`/api/products/${id}`);
    state.draft = structuredClone(product);
  }
  state.editingId = id;
  setRoute('editor', { id });
  renderEditor();
}

function renderEditor() {
  const p = state.draft;
  if (!p) return;
  const isFilament = p.kind === 'filament';

  $('#view-editor').innerHTML = `
    <div class="editor-layout">
      <div class="stack gap-4">
        <div class="panel stack gap-3">
          <div class="section-head">
            <h3>Core details</h3>
            <span class="badge ${p.kind}">${p.kind}</span>
          </div>
          <div class="grid-2">
            <label class="field"><span>Name *</span><input data-field="name" value="${escapeAttr(p.name)}" /></label>
            <label class="field"><span>Slug *</span><input data-field="slug" value="${escapeAttr(p.slug)}" placeholder="auto-from-name" /></label>
          </div>
          <label class="field"><span>Description</span><textarea data-field="description">${escapeHtml(p.description)}</textarea></label>
          <div class="grid-3">
            <label class="field"><span>Status</span>
              <select data-field="status">
                <option value="published" ${p.status === 'published' ? 'selected' : ''}>Published</option>
                <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option>
              </select>
            </label>
            <label class="field"><span>Sort order</span><input data-field="sortOrder" type="number" value="${p.sortOrder ?? 0}" /></label>
            <label class="field checkbox" style="margin-top:1.5rem">
              <input data-field="featured" type="checkbox" ${p.featured ? 'checked' : ''} />
              <span>Featured on homepage cues</span>
            </label>
          </div>
        </div>

        ${isFilament ? renderFilamentSections(p) : renderCategorySections(p)}

        <div class="panel stack gap-3">
          <div class="section-head"><h3>SEO</h3></div>
          <label class="field"><span>SEO title</span><input data-field="seoTitle" value="${escapeAttr(p.seoTitle || '')}" /></label>
          <label class="field"><span>SEO description</span><textarea data-field="seoDescription">${escapeHtml(p.seoDescription || '')}</textarea></label>
          <label class="field"><span>Internal notes (admin only)</span><textarea data-field="internalNotes">${escapeHtml(p.internalNotes || '')}</textarea></label>
        </div>
      </div>

      <div class="stack gap-3">
        <div class="panel editor-actions">
          <button class="btn btn-primary" id="save-product" type="button">Save product</button>
          <button class="btn" id="back-catalog" type="button">Back to catalog</button>
          ${p._isNew ? '' : '<button class="btn btn-danger" id="delete-product" type="button">Delete</button>'}
        </div>
        <div class="panel">
          <div class="section-head"><h3>Field map</h3></div>
          <p class="muted" style="margin-top:0;font-size:0.88rem;line-height:1.5">
            These fields power the public site pages:
            ${isFilament
              ? '<strong>name, slug, description, specs[], colours[{name,sku,weightG,rollLengthM,priceRand,stockQty,imagePath}], colourNote</strong>.'
              : '<strong>name, slug, description, crumbs, parent, items[{name,details,material,size,finish,price,sku,imageUrl}]</strong>.'}
          </p>
          <div class="meta-list" style="margin-top:1rem">
            <div><span>ID</span><span>${p.id.slice(0, 8)}…</span></div>
            <div><span>Created</span><span>${formatDate(p.createdAt)}</span></div>
            <div><span>Updated</span><span>${formatDate(p.updatedAt)}</span></div>
            <div><span>Colours / items</span><span>${isFilament ? (p.colours?.length || 0) : (p.items?.length || 0)}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEditorEvents();
}

function renderFilamentSections(p) {
  return `
    <div class="panel">
      <div class="section-head">
        <h3>Specifications</h3>
        <button class="btn small" id="add-spec" type="button">+ Spec</button>
      </div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">Used on filament product pages (Print Temp, Bed Temp, Density, etc.).</p>
      <div id="specs-list">
        ${(p.specs || []).map((s, i) => `
          <div class="row-card" data-spec-index="${i}">
            <div class="grid-2">
              <label class="field"><span>Label</span><input data-spec="label" value="${escapeAttr(s.label)}" /></label>
              <label class="field"><span>Value</span><input data-spec="value" value="${escapeAttr(s.value)}" /></label>
            </div>
            <div class="row-card-actions">
              <span class="muted" style="font-size:0.75rem">#${i + 1}</span>
              <button class="btn small btn-danger" data-remove-spec type="button">Remove</button>
            </div>
          </div>
        `).join('') || '<div class="empty">No specs yet — add print guidance fields</div>'}
      </div>
    </div>

    <div class="panel">
      <div class="section-head">
        <h3>Colours & pricing</h3>
        <button class="btn small" id="add-colour" type="button">+ Colour</button>
      </div>
      <label class="field" style="margin-bottom:0.85rem">
        <span>Colour note (shown under swatches)</span>
        <textarea data-field="colourNote">${escapeHtml(p.colourNote || '')}</textarea>
      </label>
      <div id="colours-list">
        ${(p.colours || []).map((c, i) => `
          <div class="row-card" data-colour-index="${i}">
            <div class="row-card-actions">
              <div class="flex items-center gap-3">
                ${c.imagePath
                  ? `<img src="${escapeAttr(c.imagePath)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--line)" />`
                  : `<div class="swatch-preview" style="background:${escapeAttr(c.hex || guessHex(c.name))}"></div>`}
                ${c._isNew
                  ? '<span class="muted" style="font-size:0.78rem">Save to enable photo upload</span>'
                  : `<input type="file" accept="image/jpeg,image/png,image/webp" data-colour-image="${c.id}" style="max-width:200px" />`}
              </div>
              <button class="btn small btn-danger" data-remove-colour type="button">Remove</button>
            </div>
            <div class="grid-3">
              <label class="field"><span>Colour name</span><input data-colour="name" value="${escapeAttr(c.name)}" /></label>
              <label class="field"><span>SKU</span><input data-colour="sku" value="${escapeAttr(c.sku)}" /></label>
              <label class="field"><span>Hex override</span><input data-colour="hex" value="${escapeAttr(c.hex || '')}" placeholder="#c24b28" /></label>
            </div>
            <div class="grid-2">
              <label class="field"><span>Filament weight (g)</span><input data-colour="weightG" type="number" min="0" step="1" value="${c.weightG ?? 0}" /></label>
              <label class="field"><span>Shipping weight (g)</span><input data-colour="shippingWeightG" type="number" min="0" step="1" value="${c.shippingWeightG ?? c.weightG ?? 0}" /></label>
            </div>
            <div class="grid-2">
              <label class="field"><span>Roll length (m, optional)</span><input data-colour="rollLengthM" type="number" min="0" step="0.1" value="${c.rollLengthM ?? ''}" /></label>
              <label class="field"><span>Price per roll (R)</span><input data-colour="priceRand" type="number" min="0" step="1" value="${c.priceRand ?? 0}" /></label>
            </div>
            <div class="grid-2">
              <label class="field"><span>Stock quantity</span><input data-colour="stockQty" type="number" min="0" step="1" value="${c.stockQty ?? 0}" /></label>
              <label class="field"><span>Notes</span><input data-colour="notes" value="${escapeAttr(c.notes || '')}" /></label>
            </div>
          </div>
        `).join('') || '<div class="empty">No colours yet</div>'}
      </div>
    </div>
  `;
}

function renderCategorySections(p) {
  return `
    <div class="panel stack gap-3">
      <div class="section-head"><h3>Category page</h3></div>
      <div class="grid-2">
        <label class="field"><span>Breadcrumbs</span><input data-field="crumbs" value="${escapeAttr(p.crumbs || '')}" placeholder="Home / Toys" /></label>
        <label class="field"><span>Parent group</span>
          <select data-field="parent">
            <option value="" ${!p.parent ? 'selected' : ''}>None (top-level)</option>
            <option value="car-parts" ${p.parent === 'car-parts' ? 'selected' : ''}>car-parts</option>
          </select>
        </label>
      </div>
    </div>

    <div class="panel">
      <div class="section-head">
        <h3>Catalog items</h3>
        <button class="btn small" id="add-item" type="button">+ Item</button>
      </div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">Printed products shown on Toys / Homeware / Phones / Car Parts pages.</p>
      <div id="items-list">
        ${(p.items || []).map((item, i) => `
          <div class="row-card" data-item-index="${i}">
            <div class="row-card-actions">
              <strong>#${i + 1} ${escapeHtml(item.name || 'Untitled')}</strong>
              <button class="btn small btn-danger" data-remove-item type="button">Remove</button>
            </div>
            <div class="grid-2">
              <label class="field"><span>Item name</span><input data-item="name" value="${escapeAttr(item.name || '')}" /></label>
              <label class="field"><span>SKU</span><input data-item="sku" value="${escapeAttr(item.sku || '')}" /></label>
            </div>
            <label class="field"><span>Details</span><textarea data-item="details">${escapeHtml(item.details || '')}</textarea></label>
            <div class="grid-3">
              <label class="field"><span>Material</span><input data-item="material" value="${escapeAttr(item.material || '')}" /></label>
              <label class="field"><span>Size</span><input data-item="size" value="${escapeAttr(item.size || '')}" /></label>
              <label class="field"><span>Finish</span><input data-item="finish" value="${escapeAttr(item.finish || '')}" /></label>
            </div>
            <div class="grid-3">
              <label class="field"><span>Price</span><input data-item="price" value="${escapeAttr(item.price || '')}" placeholder="R450" /></label>
              <label class="field"><span>Weight (g)</span><input data-item="weight" type="number" min="0" step="1" value="${item.weight ?? 0}" /></label>
              <label class="field"><span>Shipping weight (g)</span><input data-item="shippingWeight" type="number" min="0" step="1" value="${item.shippingWeight ?? item.weight ?? 0}" /></label>
            </div>
            <div class="grid-3">
              <label class="field"><span>Stock quantity</span><input data-item="stockQty" type="number" min="0" step="1" value="${item.stockQty ?? 0}" /></label>
              <label class="field"><span>Image URL</span><input data-item="imageUrl" value="${escapeAttr(item.imageUrl || '')}" /></label>
              <label class="field checkbox" style="margin-top:1.5rem">
                <input data-item="available" type="checkbox" ${item.available !== false ? 'checked' : ''} />
                <span>Available</span>
              </label>
            </div>
          </div>
        `).join('') || '<div class="empty">No catalog items yet</div>'}
      </div>
    </div>
  `;
}

function bindEditorEvents() {
  const p = state.draft;

  $$('[data-field]').forEach((input) => {
    const apply = () => {
      const key = input.dataset.field;
      if (input.type === 'checkbox') p[key] = input.checked;
      else if (key === 'sortOrder') p[key] = Number(input.value) || 0;
      else if (key === 'parent') p[key] = input.value || null;
      else p[key] = input.value;
      if (key === 'name' && (!p.slug || p._isNew)) {
        const slugInput = $('[data-field="slug"]');
        if (slugInput && (!slugInput.dataset.touched || p._isNew)) {
          p.slug = slugify(p.name);
          slugInput.value = p.slug;
        }
      }
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
  });

  $('[data-field="slug"]')?.addEventListener('input', (e) => {
    e.target.dataset.touched = '1';
  });

  // Note: syncNestedFromDom() is deliberately NOT called here before render.
  // The [data-spec]/[data-colour] input listeners below already keep p.specs
  // /p.colours continuously in sync with the DOM on every keystroke, so by
  // the time this handler runs, the array already reflects any live edits.
  // Calling syncNestedFromDom() again here would rebuild the array from the
  // *pre-render* DOM (which doesn't have a row for the item just pushed) and
  // silently drop it before renderEditor() ever draws it.
  $('#add-spec')?.addEventListener('click', () => {
    p.specs = p.specs || [];
    p.specs.push({ id: uid(), label: '', value: '' });
    renderEditor();
  });
  $('#add-colour')?.addEventListener('click', () => {
    p.colours = p.colours || [];
    p.colours.push({
      id: uid(),
      name: '',
      sku: '',
      hex: '',
      notes: '',
      weightG: 0,
      shippingWeightG: 0,
      rollLengthM: null,
      priceRand: 0,
      stockQty: 0,
      imagePath: null,
      _isNew: true, // not yet persisted -- Save will POST this as a new colour, not PUT
    });
    renderEditor();
  });
  $('#add-item')?.addEventListener('click', () => {
    p.items = p.items || [];
    p.items.push({
      id: uid(),
      name: '',
      details: '',
      material: '',
      size: '',
      finish: '',
      price: '',
      sku: '',
      imageUrl: '',
      weight: 0,
      shippingWeight: 0,
      stockQty: 0,
      available: true,
      sortOrder: p.items.length,
    });
    renderEditor();
  });

  $$('[data-remove-spec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-spec-index]').dataset.specIndex);
      p.specs.splice(idx, 1);
      renderEditor();
    });
  });
  $$('[data-remove-colour]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-colour-index]').dataset.colourIndex);
      const colour = p.colours[idx];
      if (!colour) return;
      // Colours aren't part of the bulk product payload (server/filaments.js
      // has its own per-colour add/update/delete endpoints -- updateFilament
      // silently ignores a `colours` field), so a colour that's already been
      // saved needs its own immediate DELETE call. A colour added via
      // "+ Colour" but never saved (_isNew) only exists client-side, so it's
      // safe to just drop it from the array with no server round-trip.
      if (!colour._isNew) {
        if (!confirm(`Remove colour “${colour.name || 'Untitled'}”? This cannot be undone.`)) return;
        try {
          await api(`/api/filaments/${p.id}/colours/${colour.id}`, { method: 'DELETE' });
          toast('Colour removed');
        } catch (ex) {
          toast(ex.message);
          return;
        }
      }
      p.colours.splice(idx, 1);
      renderEditor();
    });
  });
  $$('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-item-index]').dataset.itemIndex);
      p.items.splice(idx, 1);
      renderEditor();
    });
  });

  // Live nested field binding
  $$('[data-spec]').forEach((input) => {
    input.addEventListener('input', () => syncNestedFromDom());
  });
  $$('[data-colour]').forEach((input) => {
    input.addEventListener('input', () => syncNestedFromDom());
    input.addEventListener('change', () => syncNestedFromDom());
  });
  $$('[data-item]').forEach((input) => {
    input.addEventListener('input', () => syncNestedFromDom());
    input.addEventListener('change', () => syncNestedFromDom());
  });

  // Colour photo upload -- fires immediately on file selection (simplest UX,
  // no separate "upload" button to forget to click). Only rendered for
  // already-persisted colours (see renderFilamentSections), so p.id here is
  // always the real, server-assigned filament id by the time this can fire.
  // Uses fetch() directly rather than the api() helper: api() always sets
  // Content-Type: application/json, which would stop the browser from
  // attaching its own multipart/form-data boundary header.
  $$('[data-colour-image]').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const colourId = input.dataset.colourImage;
      const formData = new FormData();
      formData.append('image', file);
      try {
        const res = await fetch(`/api/filaments/${p.id}/colours/${colourId}/image`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        state.draft = { ...data.filament, kind: 'filament' };
        toast('Photo uploaded');
        renderEditor();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  $('#back-catalog').addEventListener('click', async () => {
    setRoute('catalog');
    await renderCatalog();
  });

  $('#save-product').addEventListener('click', async () => {
    syncNestedFromDom();
    if (!p.name.trim()) return toast('Name is required');
    if (!p.slug.trim()) p.slug = slugify(p.name);
    try {
      if (p.kind === 'filament') {
        await saveFilament(p);
      } else if (p._isNew) {
        const { _isNew, ...payload } = p;
        const res = await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
        state.draft = res.product;
        toast('Product created');
        renderEditor();
      } else {
        const res = await api(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) });
        state.draft = res.product;
        toast('Product saved');
        renderEditor();
      }
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#delete-product')?.addEventListener('click', async () => {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    try {
      if (p.kind === 'filament') {
        await api(`/api/filaments/${p.id}`, { method: 'DELETE' });
      } else {
        await api(`/api/products/${p.id}`, { method: 'DELETE' });
      }
      toast('Product deleted');
      setRoute('catalog');
      await renderCatalog();
    } catch (ex) {
      toast(ex.message);
    }
  });
}

// Filament type-level fields (name, slug, description, specs, colourNote,
// SEO, status, featured, sortOrder) live on POST/PUT /api/filaments[/:id].
// Colours do NOT travel with that payload -- server/filaments.js's
// updateFilament()/createFilament() never read a `colours` field at all;
// each colour has its own POST (add) / PUT (update) / DELETE endpoint. So
// saving a filament is: save the type-level row, then reconcile each colour
// row against its own endpoint (POST for a new, not-yet-persisted row --
// marked `_isNew` when pushed by "+ Colour" -- PUT for an existing one),
// then re-fetch the canonical filament so ids assigned by the server (new
// colours get a server-generated id, not the client-side uid() placeholder)
// and the freshly-computed timestamps land back in state.draft.
async function saveFilament(p) {
  const { _isNew, colours, items, ...payload } = p;
  let filamentId = p.id;
  if (p._isNew) {
    const res = await api('/api/filaments', { method: 'POST', body: JSON.stringify(payload) });
    filamentId = res.filament.id;
    toast('Filament created');
  } else {
    await api(`/api/filaments/${filamentId}`, { method: 'PUT', body: JSON.stringify(payload) });
    toast('Filament saved');
  }

  for (const c of p.colours || []) {
    const body = JSON.stringify({
      name: c.name,
      hex: c.hex,
      sku: c.sku,
      weightG: c.weightG,
      shippingWeightG: c.shippingWeightG,
      rollLengthM: c.rollLengthM,
      priceRand: c.priceRand,
      stockQty: c.stockQty,
      notes: c.notes,
    });
    if (c._isNew) {
      await api(`/api/filaments/${filamentId}/colours`, { method: 'POST', body });
    } else {
      await api(`/api/filaments/${filamentId}/colours/${c.id}`, { method: 'PUT', body });
    }
  }

  const { filament } = await api(`/api/filaments/${filamentId}`);
  state.draft = { ...filament, kind: 'filament' };
  state.editingId = filamentId;
  renderEditor();
}

function syncNestedFromDom() {
  const p = state.draft;
  if (!p) return;

  p.specs = $$('[data-spec-index]').map((row) => ({
    id: p.specs?.[Number(row.dataset.specIndex)]?.id || uid(),
    label: $('[data-spec="label"]', row)?.value || '',
    value: $('[data-spec="value"]', row)?.value || '',
  }));

  p.colours = $$('[data-colour-index]').map((row) => {
    const prev = p.colours?.[Number(row.dataset.colourIndex)] || {};
    const rollRaw = $('[data-colour="rollLengthM"]', row)?.value;
    return {
      id: prev.id || uid(),
      name: $('[data-colour="name"]', row)?.value || '',
      sku: $('[data-colour="sku"]', row)?.value || '',
      hex: $('[data-colour="hex"]', row)?.value || '',
      notes: $('[data-colour="notes"]', row)?.value || '',
      weightG: Number($('[data-colour="weightG"]', row)?.value) || 0,
      shippingWeightG: Number($('[data-colour="shippingWeightG"]', row)?.value) || 0,
      // Optional field -- blank must stay null (not fall through to 0),
      // matching server/filaments.js's rollLengthM != null && !== '' check.
      rollLengthM: rollRaw === '' || rollRaw == null ? null : Number(rollRaw),
      priceRand: Number($('[data-colour="priceRand"]', row)?.value) || 0,
      // Number('') is 0, so an explicit 0 and a blank field both save as 0
      // here -- matches the server's own toNumberOr()/`|| 0` fallback.
      stockQty: Number($('[data-colour="stockQty"]', row)?.value) || 0,
      imagePath: prev.imagePath ?? null,
      _isNew: prev._isNew ?? false,
    };
  });

  p.items = $$('[data-item-index]').map((row, i) => ({
    id: p.items?.[Number(row.dataset.itemIndex)]?.id || uid(),
    name: $('[data-item="name"]', row)?.value || '',
    details: $('[data-item="details"]', row)?.value || '',
    material: $('[data-item="material"]', row)?.value || '',
    size: $('[data-item="size"]', row)?.value || '',
    finish: $('[data-item="finish"]', row)?.value || '',
    price: $('[data-item="price"]', row)?.value || '',
    sku: $('[data-item="sku"]', row)?.value || '',
    imageUrl: $('[data-item="imageUrl"]', row)?.value || '',
    weight: Number($('[data-item="weight"]', row)?.value) || 0,
    shippingWeight: Number($('[data-item="shippingWeight"]', row)?.value) || 0,
    stockQty: Math.max(0, Number($('[data-item="stockQty"]', row)?.value) || 0),
    available: $('[data-item="available"]', row)?.checked !== false,
    sortOrder: i,
  }));
}

// ---- Database backups ----
// A daily backup already runs automatically (server/jobs.js) and keeps the
// most recent 30 -- this view is for visibility into what's actually been
// taken, plus an on-demand backup before something risky (a bulk import, a
// schema-affecting deploy).

async function renderBackups() {
  const { backups } = await api('/api/backups');
  const totalBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);

  const rows = backups
    .map(
      (b) => `
        <tr data-filename="${escapeAttr(b.filename)}">
          <td><code>${escapeHtml(b.filename)}</code></td>
          <td>${escapeHtml(formatDate(b.createdAt))}</td>
          <td>${escapeHtml(formatBytes(b.sizeBytes))}</td>
          <td>
            <a class="btn small" href="/api/backups/${encodeURIComponent(b.filename)}/download">Download</a>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  $('#view-backups').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="run-backup" type="button">Run backup now</button>
      <span class="muted">${escapeHtml(String(backups.length))} backup(s) &middot; ${escapeHtml(formatBytes(totalBytes))} total</span>
    </div>
    <p class="muted" style="margin: -0.5rem 0 1rem; font-size: 0.85rem;">
      A backup of the full database runs automatically once a day; the most recent 30 are kept and older ones are pruned automatically. Manual backups count toward that same limit.
    </p>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Filename</th><th>Created</th><th>Size</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4"><div class="empty">No backups yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#run-backup').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Backing up…';
    try {
      await api('/api/backups', { method: 'POST' });
      toast('Backup created');
      await renderBackups();
    } catch (ex) {
      toast(ex.message);
      btn.disabled = false;
      btn.textContent = 'Run backup now';
    }
  });

  $$('#view-backups tbody tr[data-filename]').forEach((tr) => {
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Delete backup ${tr.dataset.filename}? This cannot be undone.`)) return;
      try {
        await api(`/api/backups/${encodeURIComponent(tr.dataset.filename)}`, { method: 'DELETE' });
        toast('Backup deleted');
        await renderBackups();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

async function renderVersionHistory() {
  const { versions } = await api('/api/version-history');

  const rows = versions
    .map(
      (v) => `
        <tr>
          <td style="width: 80px; text-align: center;"><strong>V${v.version_label || v.version_number}</strong></td>
          <td>${escapeHtml(v.description)}</td>
          <td style="width: 180px;">${escapeHtml(formatDate(v.deployed_date))}</td>
        </tr>`,
    )
    .join('');

  $('#view-version-history').innerHTML = `
    <div class="toolbar">
      <span class="muted">${escapeHtml(String(versions.length))} version(s)</span>
    </div>
    <p class="muted" style="margin: -0.5rem 0 1rem; font-size: 0.85rem;">
      Recorded automatically on every deployment (see deploy/deploy-app.sh) -- nothing to do here.
    </p>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th style="width: 80px;">Version</th><th>Description</th><th style="width: 180px;">Deployed Date</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3"><div class="empty">No versions recorded yet</div></td></tr>'}</tbody>
      </table>
    </div>`;
}

async function renderSettings() {
  const data = await api('/api/settings');
  state.settings = data.settings;
  const fonts = (data.fonts && data.fonts.length ? data.fonts : [
    { id: 'dm-sans', label: 'DM Sans' },
    { id: 'fraunces', label: 'Fraunces' },
    { id: 'space-grotesk', label: 'Space Grotesk' },
    { id: 'outfit', label: 'Outfit' },
    { id: 'source-sans-3', label: 'Source Sans 3' },
    { id: 'libre-franklin', label: 'Libre Franklin' },
    { id: 'manrope', label: 'Manrope' },
    { id: 'instrument-serif', label: 'Instrument Serif' },
    { id: 'literata', label: 'Literata' },
    { id: 'playfair', label: 'Playfair Display' },
    { id: 'syne', label: 'Syne' },
    { id: 'ibm-plex-sans', label: 'IBM Plex Sans' },
  ]);
  const s = data.settings;
  const { admins } = await api('/api/admins');
  const fontOptions = fonts
    .map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`)
    .join('');

  $('#view-settings').innerHTML = `
    <div class="stack gap-4" style="max-width:820px">
      <div class="panel stack gap-3">
        <div class="section-head"><h3>Typography</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          Choose fonts for the public website. Enable <strong>universal font</strong> to use one typeface everywhere (body + headings).
        </p>
        <label class="field checkbox">
          <input data-setting="useUniversalFont" type="checkbox" ${s.useUniversalFont ? 'checked' : ''} />
          <span>Use a universal font across the whole site</span>
        </label>
        <label class="field" id="universal-font-field">
          <span>Universal font</span>
          <select data-setting="universalFont">${fontOptions}</select>
        </label>
        <div class="grid-2" id="split-font-fields">
          <label class="field">
            <span>Body / UI font</span>
            <select data-setting="fontSans">${fontOptions}</select>
          </label>
          <label class="field">
            <span>Display / heading font</span>
            <select data-setting="fontSerif">${fontOptions}</select>
          </label>
        </div>
        <p class="hint" id="font-preview" style="font-size:1.05rem;padding:0.85rem 0 0;border-top:1px dashed var(--line)">Preview updates after save + refresh of the public site.</p>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Appearance</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          Visitors can toggle light/dark on the website. This sets the default before they choose.
        </p>
        <label class="field">
          <span>Default theme</span>
          <select data-setting="defaultTheme">
            <option value="system" ${s.defaultTheme === 'system' ? 'selected' : ''}>Match visitor system</option>
            <option value="light" ${s.defaultTheme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.defaultTheme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Homepage tiles</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          The 3 "Shop the range" cards on the homepage. Colours, links and layout stay fixed — only the copy below is editable.
        </p>
        ${(s.homeTiles && s.homeTiles.length ? s.homeTiles : [{}, {}, {}]).map((t, i) => `
        <div class="stack gap-2" style="padding:0.75rem 0;border-top:1px dashed var(--line)">
          <strong style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">Tile ${i + 1}</strong>
          <div class="grid-2">
            <label class="field"><span>Eyebrow label</span><input data-tile-index="${i}" data-tile-field="eyebrow" value="${escapeAttr(t.eyebrow || '')}" /></label>
            <label class="field"><span>Title</span><input data-tile-index="${i}" data-tile-field="title" value="${escapeAttr(t.title || '')}" /></label>
          </div>
          <label class="field"><span>Description</span><input data-tile-index="${i}" data-tile-field="description" value="${escapeAttr(t.description || '')}" /></label>
        </div>`).join('')}
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Admin accounts</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          Everyone listed here has full access to this admin portal.
        </p>
        <div id="admins-list">
          ${admins.map((a) => `
          <div class="row-card" data-admin-id="${a.id}">
            <div class="row-card-actions">
              <strong>${escapeHtml(a.username)}</strong>
              <div style="display:flex;gap:0.5rem">
                <button class="btn small" data-reset-admin="${a.id}" type="button">Reset password</button>
                <button class="btn small btn-danger" data-remove-admin="${a.id}" type="button" ${admins.length <= 1 ? 'disabled' : ''}>Remove</button>
              </div>
            </div>
          </div>`).join('')}
        </div>
        <div class="grid-2">
          <label class="field"><span>New admin username</span><input id="new-admin-username" type="text" /></label>
          <label class="field"><span>New admin password</span><input id="new-admin-password" type="password" placeholder="8+ characters" /></label>
        </div>
        <div><button class="btn" id="add-admin" type="button">Add admin</button></div>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Public site contact</h3></div>
        <div class="grid-2">
          <label class="field"><span>Site name</span><input data-setting="siteName" value="${escapeAttr(s.siteName || '')}" /></label>
          <label class="field"><span>Tagline</span><input data-setting="tagline" value="${escapeAttr(s.tagline || '')}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Phone display</span><input data-setting="phoneDisplay" value="${escapeAttr(s.phoneDisplay || '')}" /></label>
          <label class="field"><span>Phone tel link</span><input data-setting="phoneTel" value="${escapeAttr(s.phoneTel || '')}" /></label>
        </div>
        <label class="field"><span>Email</span><input data-setting="email" value="${escapeAttr(s.email || '')}" /></label>
        <label class="field"><span>Address</span><input data-setting="address" value="${escapeAttr(s.address || '')}" /></label>
        <label class="field"><span>Hours</span><input data-setting="hours" value="${escapeAttr(s.hours || '')}" /></label>
        <label class="field"><span>WhatsApp link</span><input data-setting="whatsapp" value="${escapeAttr(s.whatsapp || '')}" /></label>
        <div class="grid-2">
          <label class="field"><span>Facebook</span><input data-setting="facebook" value="${escapeAttr(s.facebook || '')}" /></label>
          <label class="field"><span>Instagram</span><input data-setting="instagram" value="${escapeAttr(s.instagram || '')}" /></label>
        </div>
        <label class="field"><span>Change admin password</span><input data-setting="adminPassword" type="password" placeholder="Leave blank to keep current" /></label>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Invoicing &amp; bank details</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Shown on every printable invoice (Invoice History → Print).</p>
        <div class="grid-2">
          <label class="field"><span>Bank name</span><input data-setting="bankName" value="${escapeAttr(s.bankName || '')}" /></label>
          <label class="field"><span>Account name</span><input data-setting="bankAccountName" value="${escapeAttr(s.bankAccountName || '')}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Account number</span><input data-setting="bankAccountNumber" value="${escapeAttr(s.bankAccountNumber || '')}" /></label>
          <label class="field"><span>Branch code</span><input data-setting="bankBranchCode" value="${escapeAttr(s.bankBranchCode || '')}" /></label>
        </div>
        <label class="field" style="max-width:220px"><span>Next invoice number seed</span><input data-setting="invoiceNumberSeed" type="number" min="1" step="1" value="${escapeAttr(String(s.invoiceNumberSeed ?? 1))}" /></label>
        <label class="field" style="max-width:320px"><span>Order &amp; design-request notification email</span><input data-setting="orderNotificationEmail" type="email" value="${escapeAttr(s.orderNotificationEmail || '')}" /></label>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Print Job Costing rates</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Drives the internal-only cost calculator (Print Job Costing) — never affects storefront prices. Markup/Running costs are fractions (0.25 = 25%).</p>
        <div class="grid-3">
          <label class="field"><span>Markup (fraction)</span><input data-setting="markupPct" type="number" min="0" step="0.05" value="${escapeAttr(String(s.markupPct ?? 0))}" /></label>
          <label class="field"><span>Running costs (fraction)</span><input data-setting="runningCostsPct" type="number" min="0" step="0.05" value="${escapeAttr(String(s.runningCostsPct ?? 0))}" /></label>
          <label class="field"><span>Electricity rate (R/kWh)</span><input data-setting="electricityRate" type="number" min="0" step="0.01" value="${escapeAttr(String(s.electricityRate ?? 0))}" /></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Printer power draw (kWh/hr)</span><input data-setting="printerPowerDraw" type="number" min="0" step="0.01" value="${escapeAttr(String(s.printerPowerDraw ?? 0))}" /></label>
          <label class="field"><span>Design rate (R/hr)</span><input data-setting="designRate" type="number" min="0" step="1" value="${escapeAttr(String(s.designRate ?? 0))}" /></label>
          <label class="field"><span>Setup rate (R/hr)</span><input data-setting="setupRate" type="number" min="0" step="1" value="${escapeAttr(String(s.setupRate ?? 0))}" /></label>
        </div>
        <label class="field" style="max-width:220px"><span>Post-processing rate (R/hr)</span><input data-setting="postProcessingRate" type="number" min="0" step="1" value="${escapeAttr(String(s.postProcessingRate ?? 0))}" /></label>
        <div>
          <button class="btn btn-primary" id="save-settings" type="button">Save settings</button>
        </div>
      </div>
    </div>
  `;

  // Set select values after mount
  const setSelect = (key, value) => {
    const el = $(`[data-setting="${key}"]`);
    if (el && value) el.value = value;
  };
  setSelect('universalFont', s.universalFont || 'dm-sans');
  setSelect('fontSans', s.fontSans || 'dm-sans');
  setSelect('fontSerif', s.fontSerif || 'fraunces');

  const syncFontModeUI = () => {
    const universal = $('[data-setting="useUniversalFont"]')?.checked;
    show($('#universal-font-field'), universal);
    show($('#split-font-fields'), !universal);
  };
  $('[data-setting="useUniversalFont"]')?.addEventListener('change', syncFontModeUI);
  syncFontModeUI();

  $('#save-settings').addEventListener('click', async () => {
    const patch = {};
    $$('[data-setting]').forEach((input) => {
      if (input.dataset.setting === 'adminPassword' && !input.value) return;
      if (input.type === 'checkbox') patch[input.dataset.setting] = input.checked;
      else patch[input.dataset.setting] = input.value;
    });
    const tiles = [];
    $$('[data-tile-index]').forEach((input) => {
      const i = Number(input.dataset.tileIndex);
      tiles[i] = tiles[i] || {};
      tiles[i][input.dataset.tileField] = input.value;
    });
    if (tiles.length) patch.homeTiles = tiles;
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
      toast('Settings saved — refresh the public site to see fonts/theme defaults');
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#add-admin').addEventListener('click', async () => {
    const username = $('#new-admin-username').value.trim();
    const password = $('#new-admin-password').value;
    try {
      await api('/api/admins', { method: 'POST', body: JSON.stringify({ username, password }) });
      toast('Admin added');
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $$('[data-reset-admin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const password = prompt('New password for this admin (8+ characters):');
      if (!password) return;
      try {
        await api(`/api/admins/${btn.dataset.resetAdmin}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
        toast('Password reset');
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  $$('[data-remove-admin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      if (!confirm('Remove this admin account?')) return;
      try {
        await api(`/api/admins/${btn.dataset.removeAdmin}`, { method: 'DELETE' });
        toast('Admin removed');
        await renderSettings();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

// ---- Orders (F) ----

const SHIPPING_METHOD_LABELS = {
  courier: 'Our shipping',
  own_courier: "Customer's own courier",
  collect: 'Collect from store',
  fixed: 'Shipping',
};

function statusBadge(status) {
  const s = escapeHtml(status);
  return `<span class="badge ${s === 'paid' || s === 'completed' ? 'published' : s === 'cancelled' ? 'draft' : ''}">${s}</span>`;
}

async function renderOrders() {
  state.orderFilters = state.orderFilters || { status: '', q: '' };
  const { orders } = await api(
    `/api/orders?${new URLSearchParams({ status: state.orderFilters.status, q: state.orderFilters.q })}`,
  );
  const rows = orders
    .map(
      (o) => `
        <tr data-id="${escapeAttr(o.id)}">
          <td><code>${escapeHtml(o.id.slice(0, 8))}</code></td>
          <td>${statusBadge(o.status)}</td>
          <td>R${escapeHtml(String(o.total))}</td>
          <td>${escapeHtml(o.paymentMethod)}</td>
          <td>${escapeHtml(formatDate(o.createdAt))}</td>
          <td><button class="btn small" data-action="view" type="button">View</button></td>
        </tr>`,
    )
    .join('');

  $('#view-orders').innerHTML = `
    <div class="toolbar">
      <input id="order-filter-q" type="search" placeholder="Search order id, client name/email/code…" value="${escapeAttr(state.orderFilters.q)}" />
      <select id="order-filter-status">
        <option value="">All statuses</option>
        <option value="pending_payment" ${state.orderFilters.status === 'pending_payment' ? 'selected' : ''}>Pending payment</option>
        <option value="paid" ${state.orderFilters.status === 'paid' ? 'selected' : ''}>Paid</option>
        <option value="shipped" ${state.orderFilters.status === 'shipped' ? 'selected' : ''}>Shipped</option>
        <option value="completed" ${state.orderFilters.status === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="cancelled" ${state.orderFilters.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
      </select>
      <span class="muted">${escapeHtml(String(orders.length))} results</span>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Payment</th><th>Placed</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty">No orders match your filters</div></td></tr>'}</tbody>
      </table>
    </div>`;

  const applyFilters = async () => {
    state.orderFilters.q = $('#order-filter-q').value.trim();
    state.orderFilters.status = $('#order-filter-status').value;
    await renderOrders();
  };
  $('#order-filter-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
  $('#order-filter-status').addEventListener('change', applyFilters);

  $$('#view-orders tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => openOrderDetail(tr.dataset.id));
  });
}

async function openOrderDetail(id) {
  setRoute('order-detail');
  await renderOrderDetail(id);
}

async function renderOrderDetail(id) {
  const { order } = await api(`/api/orders/${id}`);
  const c = order.client || {};
  const addr = [c.street, c.suburb, c.city, c.province, c.postalCode, c.country].filter(Boolean).join(', ');

  const itemRows = order.items
    .map(
      (i) => `<tr><td>${escapeHtml(i.productName)}</td><td>${escapeHtml(String(i.quantity))}</td><td>R${escapeHtml(String(i.price))}</td><td>${escapeHtml(String(i.weight))}g</td><td>R${escapeHtml(String(i.price * i.quantity))}</td></tr>`,
    )
    .join('');

  const txRows = order.transactions.length
    ? order.transactions
        .map(
          (t) =>
            `<tr><td>${escapeHtml(t.gateway)}</td><td>${escapeHtml(t.gateway_reference || '—')}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(formatDate(t.created_at))}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4"><div class="empty">No payment transactions yet</div></td></tr>';

  $('#view-order-detail').innerHTML = `
    <button class="btn btn-ghost" id="back-to-orders" type="button">&larr; Back to orders</button>
    <div class="stack gap-4" style="max-width:900px">
      <div class="panel stack gap-3">
        <div class="section-head"><h3>${escapeHtml(order.invoiceNumber || order.id)}</h3>${statusBadge(order.status)}</div>
        <div class="grid-3">
          <label class="field"><span>Status</span>
            <select id="order-status">
              <option value="pending_payment" ${order.status === 'pending_payment' ? 'selected' : ''}>Pending payment</option>
              <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option>
              <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
              ${order.status === 'cancelled' ? '<option value="cancelled" selected>Cancelled</option>' : ''}
            </select>
          </label>
          <label class="field"><span>Tracking number</span><input id="order-tracking" value="${escapeAttr(order.trackingNumber || '')}" /></label>
          <div class="field"><span>&nbsp;</span><button class="btn btn-primary" id="save-order" type="button">Save</button></div>
        </div>
        <p class="muted" style="font-size:0.85rem">
          Confirmation email: ${order.confirmationEmailSentAt ? `sent ${escapeHtml(formatDate(order.confirmationEmailSentAt))}` : 'not sent'}
          &nbsp;·&nbsp; <button class="btn small" id="resend-email" type="button">${order.confirmationEmailSentAt ? 'Resend' : 'Send'} confirmation email</button>
          &nbsp;·&nbsp; <a href="/api/orders/${escapeAttr(order.id)}/packing-slip" target="_blank" rel="noopener">Print packing slip</a>
          &nbsp;·&nbsp; <a href="/api/orders/${escapeAttr(order.id)}/invoice" target="_blank" rel="noopener">Print invoice</a>
          ${order.status !== 'cancelled' ? '&nbsp;·&nbsp; <button class="btn small btn-danger" id="cancel-order" type="button">Cancel order</button>' : ''}
        </p>
      </div>

      <div class="panel stack gap-2">
        <div class="section-head"><h3>Client</h3></div>
        <p><strong>${escapeHtml(c.name || '')}</strong>${c.businessName ? ` &middot; ${escapeHtml(c.businessName)}` : ''} (${escapeHtml(c.clientCode || '')})<br>
           ${escapeHtml(c.email || '')} &middot; ${escapeHtml(c.phone || '')}<br>
           ${escapeHtml(addr)}</p>
      </div>

      <div class="panel table-wrap">
        <div class="section-head"><h3>Items</h3></div>
        <table class="catalog">
          <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Weight</th><th>Line total</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="text-align:right;margin-top:0.5rem">
          Subtotal: R${escapeHtml(String(order.subtotal))} &middot; Shipping (${escapeHtml(SHIPPING_METHOD_LABELS[order.shippingMethod] || order.shippingMethod || '—')}): R${escapeHtml(String(order.shippingPrice))} &middot;
          <strong>Total: R${escapeHtml(String(order.total))}</strong> &middot; Weight: ${escapeHtml(String(order.totalWeight))}g
        </p>
      </div>

      <div class="panel table-wrap">
        <div class="section-head"><h3>Payment transactions</h3></div>
        <table class="catalog">
          <thead><tr><th>Gateway</th><th>Reference</th><th>Status</th><th>Recorded</th></tr></thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>
    </div>`;

  $('#back-to-orders').addEventListener('click', async () => { setRoute('orders'); await renderOrders(); });

  $('#save-order').addEventListener('click', async () => {
    try {
      const status = $('#order-status').value;
      if (status !== order.status) await api(`/api/orders/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      const trackingNumber = $('#order-tracking').value;
      if (trackingNumber !== (order.trackingNumber || '')) {
        await api(`/api/orders/${order.id}/tracking`, { method: 'PUT', body: JSON.stringify({ trackingNumber }) });
      }
      toast('Order updated');
      await renderOrderDetail(order.id);
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#resend-email').addEventListener('click', async () => {
    try {
      await api(`/api/orders/${order.id}/send-confirmation`, { method: 'POST' });
      toast('Confirmation email sent');
      await renderOrderDetail(order.id);
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#cancel-order')?.addEventListener('click', async () => {
    if (!confirm('Cancel this order? This cannot be undone from here.')) return;
    try {
      await api(`/api/orders/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
      toast('Order cancelled');
      await renderOrderDetail(order.id);
    } catch (ex) {
      toast(ex.message);
    }
  });
}

// ---- Clients (B) ----

function blankClient() {
  return {
    id: null, name: '', firstName: '', lastName: '', businessName: '', email: '', phone: '',
    street: '', suburb: '', city: '', province: '', postalCode: '', country: 'South Africa',
    discountPct: 0, discountNote: '', source: '',
  };
}

const ORDER_STATUS_BADGE_CLASS = {
  paid: 'published',
  completed: 'published',
  cancelled: 'draft',
};

function ordersNestedRowHtml(clientId, colspan) {
  const orders = state.clientOrders[clientId];
  if (!orders) {
    return `<tr class="nested-row" data-nested-for="${escapeAttr(clientId)}"><td colspan="${colspan}">Loading orders…</td></tr>`;
  }
  if (!orders.length) {
    return `<tr class="nested-row" data-nested-for="${escapeAttr(clientId)}"><td colspan="${colspan}"><span class="muted">No orders yet</span></td></tr>`;
  }
  const orderRows = orders
    .map((o) => {
      const badgeClass = ORDER_STATUS_BADGE_CLASS[o.status] || '';
      return `<tr>
        <td><code>${escapeHtml(o.id.slice(0, 8))}</code></td>
        <td>${escapeHtml(formatDate(o.created_at))}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(o.status)}</span></td>
        <td>R${escapeHtml(String(o.total))}</td>
      </tr>`;
    })
    .join('');
  return `
    <tr class="nested-row" data-nested-for="${escapeAttr(clientId)}">
      <td colspan="${colspan}">
        <table class="catalog nested-orders">
          <thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>${orderRows}</tbody>
        </table>
      </td>
    </tr>`;
}

async function renderClients() {
  state.clientQ = state.clientQ || '';
  state.editingClient = state.editingClient || null;
  state.expandedClients = state.expandedClients || new Set();
  state.clientOrders = state.clientOrders || {};
  const { clients } = await api(`/api/clients?${new URLSearchParams({ q: state.clientQ })}`);

  const rows = clients
    .map((c) => {
      const expanded = state.expandedClients.has(c.id);
      const row = `
        <tr data-id="${escapeAttr(c.id)}">
          <td><button class="btn-expand" data-action="toggle-orders" type="button" aria-expanded="${expanded}" aria-label="Toggle orders">${expanded ? '▾' : '▸'}</button></td>
          <td><code>${escapeHtml(c.clientCode)}</code></td>
          <td>${escapeHtml(c.name || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml(c.phone || '—')}</td>
          <td><button class="btn small" data-action="edit" type="button">Edit</button></td>
        </tr>`;
      return expanded ? row + ordersNestedRowHtml(c.id, 6) : row;
    })
    .join('');

  const form = state.editingClient;
  $('#view-clients').innerHTML = `
    <div class="toolbar">
      <input id="client-q" type="search" placeholder="Search name, email, client code…" value="${escapeAttr(state.clientQ)}" />
      <button class="btn btn-primary" id="new-client" type="button">+ Client</button>
      <span class="muted">${escapeHtml(String(clients.length))} results</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:700px">
        <div class="section-head"><h3>${form.id ? `Edit client (${escapeHtml(form.clientCode || '')})` : 'New client'}</h3></div>
        <div class="grid-2">
          <label class="field"><span>First name</span><input id="cf-first-name" value="${escapeAttr(form.firstName || '')}" /></label>
          <label class="field"><span>Surname</span><input id="cf-last-name" value="${escapeAttr(form.lastName || '')}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Business name (optional)</span><input id="cf-business-name" value="${escapeAttr(form.businessName || '')}" /></label>
          <label class="field"><span>Email *</span><input id="cf-email" type="email" required value="${escapeAttr(form.email)}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Phone</span><input id="cf-phone" value="${escapeAttr(form.phone)}" /></label>
          <label class="field"><span>Country</span><input id="cf-country" value="${escapeAttr(form.country)}" /></label>
        </div>
        <label class="field"><span>Street</span><input id="cf-street" value="${escapeAttr(form.street)}" /></label>
        <div class="grid-3">
          <label class="field"><span>Suburb</span><input id="cf-suburb" value="${escapeAttr(form.suburb)}" /></label>
          <label class="field"><span>City</span><input id="cf-city" value="${escapeAttr(form.city)}" /></label>
          <label class="field"><span>Province</span><input id="cf-province" value="${escapeAttr(form.province)}" /></label>
        </div>
        <label class="field" style="max-width:200px"><span>Postal code</span><input id="cf-postal" value="${escapeAttr(form.postalCode)}" /></label>
        <div class="grid-3">
          <label class="field"><span>Discount %</span><input id="cf-discount-pct" type="number" min="0" max="100" step="0.5" value="${escapeAttr(String(form.discountPct ?? 0))}" /></label>
          <label class="field"><span>Discount note</span><input id="cf-discount-note" value="${escapeAttr(form.discountNote || '')}" placeholder="e.g. Family, Supplier" /></label>
          <label class="field"><span>Lead source</span><input id="cf-source" value="${escapeAttr(form.source || '')}" placeholder="e.g. Website, Facebook, WA Group" /></label>
        </div>
        <p class="muted" style="font-size:0.8rem">Discount only applies on manually-created orders (New Order) — never automatically at online checkout.</p>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-client" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-client" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th></th><th>Code</th><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty">No clients yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#client-q').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    state.clientQ = $('#client-q').value.trim();
    await renderClients();
  });
  $('#new-client').addEventListener('click', async () => { state.editingClient = blankClient(); await renderClients(); });
  $$('#view-clients tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { client } = await api(`/api/clients/${tr.dataset.id}`);
      state.editingClient = client;
      await renderClients();
    });
    tr.querySelector('[data-action="toggle-orders"]').addEventListener('click', async () => {
      const id = tr.dataset.id;
      if (state.expandedClients.has(id)) {
        state.expandedClients.delete(id);
        await renderClients();
        return;
      }
      state.expandedClients.add(id);
      if (!state.clientOrders[id]) {
        // Render immediately with a "Loading…" nested row, then fetch and
        // re-render once orders arrive, rather than blocking the toggle on
        // the network round-trip.
        await renderClients();
        const { orders } = await api(`/api/clients/${id}`);
        state.clientOrders[id] = orders;
      }
      await renderClients();
    });
  });

  if (form) {
    $('#cancel-client').addEventListener('click', async () => { state.editingClient = null; await renderClients(); });
    $('#save-client').addEventListener('click', async () => {
      const firstName = $('#cf-first-name').value;
      const lastName = $('#cf-last-name').value;
      const payload = {
        name: `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        businessName: $('#cf-business-name').value,
        email: $('#cf-email').value,
        phone: $('#cf-phone').value,
        street: $('#cf-street').value,
        suburb: $('#cf-suburb').value,
        city: $('#cf-city').value,
        province: $('#cf-province').value,
        postalCode: $('#cf-postal').value,
        country: $('#cf-country').value,
        discountPct: Number($('#cf-discount-pct').value) || 0,
        discountNote: $('#cf-discount-note').value,
        source: $('#cf-source').value,
      };
      try {
        if (form.id) await api(`/api/clients/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
        toast('Client saved');
        state.editingClient = null;
        await renderClients();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

// ---- Registered Users (Phase 2) ----
// Read-only: these are clients.js rows that have set a password (an
// "account"), filtered server-side via listClients({ registeredOnly }).
// Nested order-history expansion reuses ordersNestedRowHtml/state.clientOrders
// from the Clients view above, since the underlying id space is the same.

async function renderRegisteredUsers() {
  state.expandedRegisteredUsers = state.expandedRegisteredUsers || new Set();
  state.clientOrders = state.clientOrders || {};
  const { clients } = await api('/api/clients?registeredOnly=true');

  const rows = clients
    .map((c) => {
      const expanded = state.expandedRegisteredUsers.has(c.id);
      const row = `
        <tr data-id="${escapeAttr(c.id)}">
          <td><button class="btn-expand" data-action="toggle-orders" type="button" aria-expanded="${expanded}" aria-label="Toggle orders">${expanded ? '▾' : '▸'}</button></td>
          <td>${escapeHtml(c.name || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${c.emailVerified ? '<span class="badge published">verified</span>' : '<span class="badge draft">unverified</span>'}</td>
          <td>${escapeHtml(formatDate(c.createdAt))}</td>
          <td>${c.lastLoginAt ? escapeHtml(formatDate(c.lastLoginAt)) : '<span class="muted">Never</span>'}</td>
          <td>
            ${c.emailVerified ? '' : '<button class="btn small" data-action="verify" type="button">Verify</button>'}
            ${c.emailVerified ? '' : '<button class="btn small" data-action="resend" type="button">Resend email</button>'}
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`;
      return expanded ? row + ordersNestedRowHtml(c.id, 7) : row;
    })
    .join('');

  $('#view-registered-users').innerHTML = `
    <div class="toolbar">
      <span class="muted">${escapeHtml(String(clients.length))} registered accounts</span>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th></th><th>Name</th><th>Email</th><th>Status</th><th>Joined</th><th>Last logged on</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No registered accounts yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $$('#view-registered-users tbody tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('[data-action="toggle-orders"]').addEventListener('click', async () => {
      if (state.expandedRegisteredUsers.has(id)) {
        state.expandedRegisteredUsers.delete(id);
        await renderRegisteredUsers();
        return;
      }
      state.expandedRegisteredUsers.add(id);
      if (!state.clientOrders[id]) {
        await renderRegisteredUsers();
        const { orders } = await api(`/api/clients/${id}`);
        state.clientOrders[id] = orders;
      }
      await renderRegisteredUsers();
    });
    tr.querySelector('[data-action="verify"]')?.addEventListener('click', async () => {
      try {
        await api(`/api/clients/${id}/verify`, { method: 'PATCH' });
        toast('Marked as verified');
        await renderRegisteredUsers();
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="resend"]')?.addEventListener('click', async () => {
      try {
        await api(`/api/clients/${id}/resend-verification`, { method: 'POST' });
        toast('Verification email sent');
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this registered user? If they have order history, only their login/account is removed (orders are kept) — otherwise the record is deleted entirely.')) return;
      try {
        const result = await api(`/api/clients/${id}`, { method: 'DELETE' });
        toast(result.deleted ? 'Client deleted' : 'Account removed (order history kept)');
        await renderRegisteredUsers();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

// ---- Invoice History (Phase 3) ----
// A view over the same `orders` table as renderOrders() -- there is no
// separate invoices table (one order = one invoice, always).

async function renderInvoiceHistory() {
  state.invoiceFilters = state.invoiceFilters || { status: '', q: '' };
  const { orders } = await api(
    `/api/orders?${new URLSearchParams({ status: state.invoiceFilters.status, q: state.invoiceFilters.q })}`,
  );
  const rows = orders
    .map(
      (o) => `
        <tr data-id="${escapeAttr(o.id)}">
          <td>${escapeHtml(o.invoiceNumber || '—')}</td>
          <td>${escapeHtml(formatDate(o.createdAt))}</td>
          <td>${escapeHtml(o.client?.name || '')}</td>
          <td>R${escapeHtml(String(o.total))}</td>
          <td>${statusBadge(o.paymentStatus)}</td>
          <td>${escapeHtml(o.paymentMethod)}</td>
          <td><a href="/api/orders/${escapeAttr(o.id)}/invoice" target="_blank" rel="noopener">Print</a></td>
        </tr>`,
    )
    .join('');

  $('#view-invoice-history').innerHTML = `
    <div class="toolbar">
      <input id="invoice-filter-q" type="search" placeholder="Search order id, client name/email/code…" value="${escapeAttr(state.invoiceFilters.q)}" />
      <select id="invoice-filter-status">
        <option value="">All statuses</option>
        <option value="pending_payment" ${state.invoiceFilters.status === 'pending_payment' ? 'selected' : ''}>Outstanding</option>
        <option value="paid" ${state.invoiceFilters.status === 'paid' ? 'selected' : ''}>Paid</option>
      </select>
      <span class="muted">${escapeHtml(String(orders.length))} invoices</span>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th>Value</th><th>Status</th><th>Payment</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No invoices yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  const applyFilters = async () => {
    state.invoiceFilters.q = $('#invoice-filter-q').value.trim();
    state.invoiceFilters.status = $('#invoice-filter-status').value;
    await renderInvoiceHistory();
  };
  $('#invoice-filter-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
  $('#invoice-filter-status').addEventListener('change', applyFilters);

  $$('#view-invoice-history tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      openOrderDetail(tr.dataset.id);
    });
  });
}

// ---- New Order (Phase 3, manual/walk-in order entry) ----

function blankNewOrder() {
  return {
    clientMode: 'search',
    clientQuery: '',
    clientResults: [],
    selectedClient: null,
    newClient: { firstName: '', lastName: '', businessName: '', email: '', phone: '' },
    items: [{ description: '', quantity: 1, unitPrice: 0 }],
    shippingOptionId: '',
    manualShippingPrice: '',
    discountPct: 0,
    paymentMethod: 'manual_eft',
    alreadyPaid: false,
  };
}

function newOrderTotals(order, shippingOptions) {
  const subtotal = order.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const shippingOption = shippingOptions.find((o) => o.id === order.shippingOptionId);
  const shippingPrice = shippingOption ? shippingOption.price : (Number(order.manualShippingPrice) || 0);
  const discountAmount = Math.round(subtotal * ((Number(order.discountPct) || 0) / 100));
  const total = Math.max(0, subtotal - discountAmount + shippingPrice);
  return { subtotal, shippingPrice, discountAmount, total };
}

async function renderNewOrder() {
  state.newOrder = state.newOrder || blankNewOrder();
  const order = state.newOrder;
  const { shippingOptions } = await api('/api/shipping-options?activeOnly=true');
  const totals = newOrderTotals(order, shippingOptions);

  const clientResultsHtml = order.clientResults
    .map(
      (c) => `
        <div class="panel" style="padding:0.6rem 0.9rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem" data-client-id="${escapeAttr(c.id)}">
          <span>${escapeHtml(c.name || c.email)} <span class="muted">(${escapeHtml(c.email)}${c.discountPct ? ` — ${escapeHtml(String(c.discountPct))}% discount` : ''})</span></span>
          <button class="btn small" data-action="pick-client" type="button">Use</button>
        </div>`,
    )
    .join('');

  const itemRows = order.items
    .map(
      (item, idx) => `
        <div class="grid-4" data-item-idx="${idx}" style="align-items:end">
          <label class="field" style="grid-column:span 2"><span>Description</span><input class="ni-desc" value="${escapeAttr(item.description)}" placeholder="Product or custom job description" /></label>
          <label class="field"><span>Qty</span><input class="ni-qty" type="number" min="1" step="1" value="${escapeAttr(String(item.quantity))}" /></label>
          <label class="field"><span>Unit price (R)</span><input class="ni-price" type="number" min="0" step="1" value="${escapeAttr(String(item.unitPrice))}" /></label>
          <button class="btn small btn-danger" data-action="remove-item" type="button" ${order.items.length <= 1 ? 'disabled' : ''}>Remove</button>
        </div>`,
    )
    .join('');

  const shippingOptionsHtml = shippingOptions
    .map((o) => `<option value="${escapeAttr(o.id)}" ${order.shippingOptionId === o.id ? 'selected' : ''}>${escapeHtml(o.name)} — R${escapeHtml(String(o.price))}</option>`)
    .join('');

  $('#view-new-order').innerHTML = `
    <div class="stack gap-4" style="max-width:900px">
      <div class="panel stack gap-3">
        <div class="section-head"><h3>Client</h3></div>
        <div class="row-card-actions">
          <button class="btn small ${order.clientMode === 'search' ? 'btn-primary' : ''}" data-action="mode-search" type="button">Existing client</button>
          <button class="btn small ${order.clientMode === 'new' ? 'btn-primary' : ''}" data-action="mode-new" type="button">New client</button>
        </div>
        ${order.clientMode === 'search' ? `
          ${order.selectedClient ? `
            <div class="panel" style="padding:0.6rem 0.9rem;display:flex;justify-content:space-between;align-items:center">
              <span><strong>${escapeHtml(order.selectedClient.name || order.selectedClient.email)}</strong> — ${escapeHtml(order.selectedClient.email)}${order.selectedClient.discountPct ? ` <span class="muted">(${escapeHtml(String(order.selectedClient.discountPct))}% discount)</span>` : ''}</span>
              <button class="btn small btn-ghost" data-action="clear-client" type="button">Change</button>
            </div>` : `
            <input id="no-client-q" type="search" placeholder="Search name, email, client code…" value="${escapeAttr(order.clientQuery)}" />
            <div class="stack gap-2">${clientResultsHtml}</div>`}
        ` : `
          <div class="grid-2">
            <label class="field"><span>First name</span><input id="no-new-first" value="${escapeAttr(order.newClient.firstName)}" /></label>
            <label class="field"><span>Surname</span><input id="no-new-last" value="${escapeAttr(order.newClient.lastName)}" /></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Business name (optional)</span><input id="no-new-business" value="${escapeAttr(order.newClient.businessName)}" /></label>
            <label class="field"><span>Email *</span><input id="no-new-email" type="email" value="${escapeAttr(order.newClient.email)}" /></label>
          </div>
          <label class="field"><span>Phone</span><input id="no-new-phone" value="${escapeAttr(order.newClient.phone)}" /></label>
        `}
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Line items</h3><button class="btn small" id="add-item" type="button">+ Add line</button></div>
        <div class="stack gap-2">${itemRows}</div>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Shipping &amp; discount</h3></div>
        <div class="grid-3">
          <label class="field"><span>Shipping option</span>
            <select id="no-shipping-option">
              <option value="">None / manual</option>
              ${shippingOptionsHtml}
            </select>
          </label>
          <label class="field"><span>Manual shipping price (R, used if no option picked)</span><input id="no-shipping-manual" type="number" min="0" step="1" value="${escapeAttr(String(order.manualShippingPrice))}" ${order.shippingOptionId ? 'disabled' : ''} /></label>
          <label class="field"><span>Discount %</span><input id="no-discount" type="number" min="0" max="100" step="0.5" value="${escapeAttr(String(order.discountPct))}" /></label>
        </div>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Payment</h3></div>
        <div class="grid-3">
          <label class="field"><span>Payment method</span>
            <select id="no-payment-method">
              <option value="manual_eft" ${order.paymentMethod === 'manual_eft' ? 'selected' : ''}>Manual EFT</option>
              <option value="cash_on_collection" ${order.paymentMethod === 'cash_on_collection' ? 'selected' : ''}>Cash</option>
              <option value="payfast_card" ${order.paymentMethod === 'payfast_card' ? 'selected' : ''}>Payfast (Card)</option>
              <option value="payfast_eft" ${order.paymentMethod === 'payfast_eft' ? 'selected' : ''}>Payfast (Instant EFT)</option>
            </select>
          </label>
          <label class="field checkbox" style="align-self:end"><input id="no-already-paid" type="checkbox" ${order.alreadyPaid ? 'checked' : ''} /><span>Already paid</span></label>
        </div>
      </div>

      <div class="panel stack gap-2">
        <div class="section-head"><h3>Total</h3></div>
        <p>Subtotal: R${escapeHtml(String(totals.subtotal))}</p>
        ${totals.discountAmount ? `<p>Discount: -R${escapeHtml(String(totals.discountAmount))}</p>` : ''}
        <p>Shipping: R${escapeHtml(String(totals.shippingPrice))}</p>
        <p><strong>Total due: R${escapeHtml(String(totals.total))}</strong></p>
        <button class="btn btn-primary" id="create-order" type="button">Create order</button>
      </div>
    </div>`;

  $('[data-action="mode-search"]')?.addEventListener('click', async () => { order.clientMode = 'search'; await renderNewOrder(); });
  $('[data-action="mode-new"]')?.addEventListener('click', async () => { order.clientMode = 'new'; await renderNewOrder(); });
  $('[data-action="clear-client"]')?.addEventListener('click', async () => { order.selectedClient = null; order.clientResults = []; await renderNewOrder(); });

  $('#no-client-q')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    order.clientQuery = $('#no-client-q').value.trim();
    if (!order.clientQuery) { order.clientResults = []; return renderNewOrder(); }
    const { clients } = await api(`/api/clients?${new URLSearchParams({ q: order.clientQuery })}`);
    order.clientResults = clients;
    await renderNewOrder();
  });
  $$('[data-client-id]').forEach((row) => {
    row.querySelector('[data-action="pick-client"]').addEventListener('click', async () => {
      order.selectedClient = order.clientResults.find((c) => c.id === row.dataset.clientId);
      order.discountPct = order.selectedClient?.discountPct || 0;
      await renderNewOrder();
    });
  });

  $('#add-item')?.addEventListener('click', async () => {
    order.items.push({ description: '', quantity: 1, unitPrice: 0 });
    await renderNewOrder();
  });
  $$('[data-item-idx]').forEach((row) => {
    const idx = Number(row.dataset.itemIdx);
    row.querySelector('.ni-desc').addEventListener('input', (e) => { order.items[idx].description = e.target.value; });
    row.querySelector('.ni-qty').addEventListener('input', (e) => { order.items[idx].quantity = e.target.value; });
    row.querySelector('.ni-price').addEventListener('input', (e) => { order.items[idx].unitPrice = e.target.value; });
    row.querySelector('[data-action="remove-item"]')?.addEventListener('click', async () => {
      order.items.splice(idx, 1);
      await renderNewOrder();
    });
  });

  $('#no-shipping-option')?.addEventListener('change', async () => {
    order.shippingOptionId = $('#no-shipping-option').value;
    await renderNewOrder();
  });
  $('#no-shipping-manual')?.addEventListener('input', (e) => { order.manualShippingPrice = e.target.value; });
  $('#no-discount')?.addEventListener('input', (e) => { order.discountPct = e.target.value; });
  $('#no-payment-method')?.addEventListener('change', (e) => { order.paymentMethod = e.target.value; });
  $('#no-already-paid')?.addEventListener('change', (e) => { order.alreadyPaid = e.target.checked; });

  $('#create-order').addEventListener('click', async () => {
    const items = order.items
      .filter((i) => i.description.trim())
      .map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0 }));
    if (!items.length) return toast('Add at least one line item');

    const payload = {
      items,
      shippingOptionId: order.shippingOptionId || null,
      shippingPrice: order.shippingOptionId ? null : (Number(order.manualShippingPrice) || 0),
      discountPct: Number(order.discountPct) || 0,
      paymentMethod: order.paymentMethod,
      alreadyPaid: order.alreadyPaid,
    };
    if (order.clientMode === 'search') {
      if (!order.selectedClient) return toast('Pick a client first');
      payload.clientId = order.selectedClient.id;
    } else {
      if (!$('#no-new-email').value.trim()) return toast('Client email is required');
      payload.client = {
        firstName: $('#no-new-first').value,
        lastName: $('#no-new-last').value,
        businessName: $('#no-new-business').value,
        email: $('#no-new-email').value,
        phone: $('#no-new-phone').value,
      };
    }

    try {
      const { order: created } = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      toast(`Order created — ${created.invoiceNumber}`);
      state.newOrder = blankNewOrder();
      openOrderDetail(created.id);
    } catch (ex) {
      toast(ex.message);
    }
  });
}

// ---- Print Job Costing (Phase 3, internal-only) ----
// Never touches storefront pricing -- purely a production-cost log mirroring
// the spreadsheet's Cost Calculator, computed server-side in print-jobs.js.

const MAX_PRINT_JOB_FILAMENT_SLOTS = 4;

function blankPrintJob() {
  return {
    itemName: '',
    slots: Array.from({ length: MAX_PRINT_JOB_FILAMENT_SLOTS }, () => ({ inHouseFilamentId: '', grams: '', meters: '' })),
    printTimeMinutes: 0, designHours: 0, setupHours: 0, postProcessingHours: 0, markupPct: '',
    modelFile: null, modelImage: null,
    preview: null,
  };
}

function printJobFilamentOptions(filaments, selectedId) {
  return filaments
    .map((f) => `<option value="${escapeAttr(f.id)}" ${selectedId === f.id ? 'selected' : ''}>${escapeHtml(f.filamentType)} — ${escapeHtml(f.colorName)} (${escapeHtml(f.remainingG.toFixed(0))}g left)</option>`)
    .join('');
}

function readPrintJobPayload(draft) {
  const filaments = draft.slots
    .filter((s) => s.inHouseFilamentId)
    .map((s) => ({ inHouseFilamentId: s.inHouseFilamentId, grams: Number(s.grams) || 0, meters: Number(s.meters) || 0 }));
  return {
    itemName: draft.itemName.trim(),
    filaments,
    printTimeMinutes: Number(draft.printTimeMinutes) || 0,
    designHours: Number(draft.designHours) || 0,
    setupHours: Number(draft.setupHours) || 0,
    postProcessingHours: Number(draft.postProcessingHours) || 0,
    markupPct: draft.markupPct === '' ? undefined : Number(draft.markupPct),
  };
}

async function renderPrintJobs() {
  state.newPrintJob = state.newPrintJob || blankPrintJob();
  const draft = state.newPrintJob;
  const [{ printJobs }, { filaments }] = await Promise.all([api('/api/print-jobs'), api('/api/in-house-filament')]);

  const slotRows = draft.slots
    .map((slot, idx) => `
        <div class="grid-4" data-slot-idx="${idx}" style="align-items:end">
          <label class="field" style="grid-column:span 2"><span>Filament ${idx + 1}${idx === 0 ? '' : ' (optional)'}</span>
            <select class="pjs-filament">
              <option value="">${idx === 0 ? '— Choose —' : '— None —'}</option>
              ${printJobFilamentOptions(filaments, slot.inHouseFilamentId)}
            </select>
          </label>
          <label class="field"><span>Grams</span><input class="pjs-grams" type="number" min="0" step="0.01" value="${escapeAttr(String(slot.grams))}" /></label>
          <label class="field"><span>Meters</span><input class="pjs-meters" type="number" min="0" step="0.01" value="${escapeAttr(String(slot.meters))}" /></label>
        </div>`)
    .join('');

  const totalGrams = draft.slots.reduce((sum, s) => sum + (Number(s.grams) || 0), 0);
  const totalMeters = draft.slots.reduce((sum, s) => sum + (Number(s.meters) || 0), 0);

  const preview = draft.preview;
  const previewHtml = preview ? `
      <div class="panel stack gap-2" style="background:var(--panel-2, transparent)">
        <div class="section-head"><h3>Validation result</h3></div>
        <p>Filament cost: R${escapeHtml(String(preview.filamentCost))} · Power: R${escapeHtml(String(preview.powerCost))} · Labour: R${escapeHtml(String(preview.labourCost))} · Running: R${escapeHtml(String(preview.runningCost))}</p>
        <p><strong>Total cost: R${escapeHtml(String(preview.totalCost))} — Markup: R${escapeHtml(String(preview.markupAmount))} — Selling price: R${escapeHtml(String(preview.sellingPrice))}</strong></p>
      </div>` : '';

  const rows = printJobs
    .map(
      (j) => `
        <tr>
          <td>${j.referenceImagePath ? `<img src="${escapeAttr(j.referenceImagePath)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:0.5rem" />` : ''}${escapeHtml(j.itemName)}</td>
          <td>${escapeHtml(j.totalGrams.toFixed(1))}g / ${escapeHtml(j.totalMeters.toFixed(2))}m</td>
          <td>R${escapeHtml(String(j.totalCost))}</td>
          <td>R${escapeHtml(String(j.sellingPrice))}</td>
          <td>${escapeHtml(j.status)}</td>
          <td>${escapeHtml(formatDate(j.datePrinted || j.createdAt))}</td>
          <td><button class="btn small btn-danger" data-action="delete-job" data-id="${escapeAttr(j.id)}" type="button">Delete</button></td>
        </tr>`,
    )
    .join('');

  $('#view-print-jobs').innerHTML = `
    <div class="stack gap-4" style="max-width:900px">
      <div class="panel stack gap-3">
        <div class="section-head"><h3>Log a print job</h3></div>
        <label class="field"><span>Item / file name</span><input id="pj-name" value="${escapeAttr(draft.itemName)}" /></label>

        <div class="stack gap-2">${slotRows}</div>
        <p class="muted" style="font-size:0.85rem">Totals: <strong>${escapeHtml(totalGrams.toFixed(1))}g</strong> · <strong>${escapeHtml(totalMeters.toFixed(2))}m</strong> across ${escapeHtml(String(draft.slots.filter((s) => s.inHouseFilamentId).length))} filament(s)</p>

        <div class="grid-4">
          <label class="field"><span>Print time (min)</span><input id="pj-time" type="number" min="0" step="1" value="${escapeAttr(String(draft.printTimeMinutes))}" /></label>
          <label class="field"><span>Design (hrs)</span><input id="pj-design-hrs" type="number" min="0" step="0.25" value="${escapeAttr(String(draft.designHours))}" /></label>
          <label class="field"><span>Setup (hrs)</span><input id="pj-setup-hrs" type="number" min="0" step="0.25" value="${escapeAttr(String(draft.setupHours))}" /></label>
          <label class="field"><span>Post-processing (hrs)</span><input id="pj-post-hrs" type="number" min="0" step="0.25" value="${escapeAttr(String(draft.postProcessingHours))}" /></label>
        </div>
        <label class="field" style="max-width:220px"><span>Markup override (fraction, blank = Settings default)</span><input id="pj-markup" type="number" min="0" step="0.05" value="${escapeAttr(String(draft.markupPct))}" placeholder="e.g. 0.25 = 25%" /></label>

        <div class="grid-2">
          <label class="field"><span>Model file (optional) — STL/3MF/OBJ/gcode/zip/PDF</span><input type="file" id="pj-model-file" accept=".stl,.3mf,.obj,.gcode,.zip,.pdf" /></label>
          <label class="field"><span>Reference photo (optional)</span><input type="file" id="pj-model-image" accept="image/jpeg,image/png,image/webp" /></label>
        </div>

        ${previewHtml}

        <div class="row-card-actions">
          <button class="btn" id="validate-job" type="button">Validate</button>
          <button class="btn btn-primary" id="log-job" type="button">Log job &amp; compute cost</button>
        </div>
      </div>
      <div class="panel table-wrap">
        <table class="catalog">
          <thead><tr><th>Item</th><th>Filament used</th><th>Cost</th><th>Selling price</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7"><div class="empty">No print jobs logged yet</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $$('[data-slot-idx]').forEach((row) => {
    const idx = Number(row.dataset.slotIdx);
    row.querySelector('.pjs-filament').addEventListener('change', (e) => {
      // Picking a filament re-renders the whole view (to refresh the other
      // slots' "grams left" labels), so every other field's current value
      // must be pulled back into draft first -- otherwise this re-render
      // would wipe out whatever the admin already typed elsewhere.
      syncFormIntoDraft();
      draft.slots[idx].inHouseFilamentId = e.target.value;
      draft.preview = null;
      renderPrintJobs();
    });
    row.querySelector('.pjs-grams').addEventListener('input', (e) => { draft.slots[idx].grams = e.target.value; renderTotalsOnly(); });
    row.querySelector('.pjs-meters').addEventListener('input', (e) => { draft.slots[idx].meters = e.target.value; renderTotalsOnly(); });
  });

  function renderTotalsOnly() {
    // Cheap live-total update without a full re-render on every keystroke;
    // a full renderPrintJobs() still happens on blur-triggering actions
    // (filament pick, validate, log) so the totals never drift stale.
    const g = draft.slots.reduce((sum, s) => sum + (Number(s.grams) || 0), 0);
    const m = draft.slots.reduce((sum, s) => sum + (Number(s.meters) || 0), 0);
    const el = document.querySelector('#view-print-jobs .muted');
    if (el) el.innerHTML = `Totals: <strong>${escapeHtml(g.toFixed(1))}g</strong> · <strong>${escapeHtml(m.toFixed(2))}m</strong> across ${escapeHtml(String(draft.slots.filter((s) => s.inHouseFilamentId).length))} filament(s)`;
  }

  function syncFormIntoDraft() {
    draft.itemName = $('#pj-name').value;
    draft.printTimeMinutes = $('#pj-time').value;
    draft.designHours = $('#pj-design-hrs').value;
    draft.setupHours = $('#pj-setup-hrs').value;
    draft.postProcessingHours = $('#pj-post-hrs').value;
    draft.markupPct = $('#pj-markup').value;
  }

  $('#validate-job').addEventListener('click', async () => {
    syncFormIntoDraft();
    if (!draft.itemName.trim()) return toast('Item name is required');
    try {
      const { preview } = await api('/api/print-jobs/validate', { method: 'POST', body: JSON.stringify(readPrintJobPayload(draft)) });
      draft.preview = preview;
      await renderPrintJobs();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#log-job').addEventListener('click', async () => {
    syncFormIntoDraft();
    if (!draft.itemName.trim()) return toast('Item name is required');
    try {
      const { printJob } = await api('/api/print-jobs', { method: 'POST', body: JSON.stringify(readPrintJobPayload(draft)) });
      toast(`Cost: R${printJob.totalCost} — Selling price: R${printJob.sellingPrice}`);

      const fileInput = $('#pj-model-file');
      const imageInput = $('#pj-model-image');
      if (fileInput.files[0]) await uploadPrintJobAsset(printJob.id, 'file', fileInput.files[0]);
      if (imageInput.files[0]) await uploadPrintJobAsset(printJob.id, 'image', imageInput.files[0]);

      state.newPrintJob = blankPrintJob();
      await renderPrintJobs();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $$('[data-action="delete-job"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this print job?')) return;
      await api(`/api/print-jobs/${btn.dataset.id}`, { method: 'DELETE' });
      await renderPrintJobs();
    });
  });
}

async function uploadPrintJobAsset(jobId, field, file) {
  const formData = new FormData();
  formData.append(field, file);
  const endpoint = field === 'image' ? 'image' : 'file';
  try {
    const res = await fetch(`/api/print-jobs/${jobId}/${endpoint}`, { method: 'POST', credentials: 'include', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
  } catch (ex) {
    toast(ex.message);
  }
}

// ---- In-House Filament ----

function blankInHouseFilament() {
  return { id: null, filamentType: '', colorName: '', rollsAvailable: 0, weightG: 1000, rollLengthM: 335, costPerRollRand: 0 };
}

async function renderInHouseFilament() {
  state.editingInHouseFilament = state.editingInHouseFilament || null;
  const { filaments } = await api('/api/in-house-filament');

  const rows = filaments
    .map(
      (f) => `
        <tr data-id="${escapeAttr(f.id)}">
          <td>${escapeHtml(f.filamentType)}</td>
          <td>${escapeHtml(f.colorName)}</td>
          <td>${escapeHtml(String(f.rollsAvailable))}</td>
          <td>${escapeHtml(String(f.weightG))}g / ${escapeHtml(String(f.rollLengthM))}m</td>
          <td>R${escapeHtml(String(f.costPerRollRand))}</td>
          <td>${escapeHtml(f.remainingG.toFixed(0))}g / ${escapeHtml(f.percentLeft != null ? Math.round(f.percentLeft * 100) : '—')}%</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const form = state.editingInHouseFilament;
  $('#view-in-house-filament').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-in-house-filament" type="button">+ Filament</button>
      <span class="muted">${escapeHtml(String(filaments.length))} filaments</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:600px">
        <div class="section-head"><h3>${form.id ? 'Edit filament' : 'New filament'}</h3></div>
        <div class="grid-2">
          <label class="field"><span>Filament type</span><input id="ihf-type" value="${escapeAttr(form.filamentType)}" placeholder="PLA" /></label>
          <label class="field"><span>Color name</span><input id="ihf-color" value="${escapeAttr(form.colorName)}" placeholder="Black" /></label>
        </div>
        <div class="grid-4">
          <label class="field"><span>Rolls available</span><input id="ihf-rolls" type="number" min="0" step="1" value="${escapeAttr(String(form.rollsAvailable))}" /></label>
          <label class="field"><span>Weight per roll (g)</span><input id="ihf-weight" type="number" min="0" step="1" value="${escapeAttr(String(form.weightG))}" /></label>
          <label class="field"><span>Length per roll (m)</span><input id="ihf-length" type="number" min="0" step="1" value="${escapeAttr(String(form.rollLengthM))}" /></label>
          <label class="field"><span>Cost per roll (R)</span><input id="ihf-cost" type="number" min="0" step="1" value="${escapeAttr(String(form.costPerRollRand))}" /></label>
        </div>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-in-house-filament" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-in-house-filament" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Type</th><th>Color</th><th>Rolls</th><th>Per-roll spec</th><th>Cost/roll</th><th>Remaining</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No in-house filament logged yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#new-in-house-filament').addEventListener('click', async () => { state.editingInHouseFilament = blankInHouseFilament(); await renderInHouseFilament(); });
  $$('#view-in-house-filament tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { filament } = await api(`/api/in-house-filament/${tr.dataset.id}`);
      state.editingInHouseFilament = filament;
      await renderInHouseFilament();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this in-house filament?')) return;
      try {
        await api(`/api/in-house-filament/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderInHouseFilament();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (form) {
    $('#cancel-in-house-filament').addEventListener('click', async () => { state.editingInHouseFilament = null; await renderInHouseFilament(); });
    $('#save-in-house-filament').addEventListener('click', async () => {
      const payload = {
        filamentType: $('#ihf-type').value,
        colorName: $('#ihf-color').value,
        rollsAvailable: Number($('#ihf-rolls').value) || 0,
        weightG: Number($('#ihf-weight').value) || 0,
        rollLengthM: Number($('#ihf-length').value) || 0,
        costPerRollRand: Number($('#ihf-cost').value) || 0,
      };
      try {
        if (form.id) await api(`/api/in-house-filament/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/in-house-filament', { method: 'POST', body: JSON.stringify(payload) });
        toast('Filament saved');
        state.editingInHouseFilament = null;
        await renderInHouseFilament();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

// ---- Purchase History (Phase 3, supplier expenses) ----

function blankPurchase() {
  return { id: null, supplier: '', goods: '', totalValue: 0, status: 'outstanding', paymentType: '', purchaseDate: '' };
}

async function renderPurchases() {
  state.editingPurchase = state.editingPurchase || null;
  const { purchases } = await api('/api/purchases');

  const rows = purchases
    .map(
      (p) => `
        <tr data-id="${escapeAttr(p.id)}">
          <td>${escapeHtml(p.supplier)}</td>
          <td>${escapeHtml(p.goods || '—')}</td>
          <td>R${escapeHtml(String(p.totalValue))}</td>
          <td>${statusBadge(p.status)}</td>
          <td>${escapeHtml(p.paymentType || '—')}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const form = state.editingPurchase;
  $('#view-purchases').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-purchase" type="button">+ Purchase</button>
      <span class="muted">${escapeHtml(String(purchases.length))} purchases</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:600px">
        <div class="section-head"><h3>${form.id ? 'Edit purchase' : 'New purchase'}</h3></div>
        <label class="field"><span>Supplier</span><input id="pu-supplier" value="${escapeAttr(form.supplier)}" /></label>
        <label class="field"><span>Goods</span><input id="pu-goods" value="${escapeAttr(form.goods)}" /></label>
        <div class="grid-3">
          <label class="field"><span>Total value (R)</span><input id="pu-value" type="number" min="0" step="1" value="${escapeAttr(String(form.totalValue))}" /></label>
          <label class="field"><span>Status</span>
            <select id="pu-status">
              <option value="outstanding" ${form.status === 'outstanding' ? 'selected' : ''}>Outstanding</option>
              <option value="paid" ${form.status === 'paid' ? 'selected' : ''}>Paid</option>
            </select>
          </label>
          <label class="field"><span>Payment type</span><input id="pu-payment-type" value="${escapeAttr(form.paymentType)}" placeholder="e.g. Card, EFT" /></label>
        </div>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-purchase" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-purchase" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Supplier</th><th>Goods</th><th>Value</th><th>Status</th><th>Payment</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty">No purchases logged yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#new-purchase').addEventListener('click', async () => { state.editingPurchase = blankPurchase(); await renderPurchases(); });
  $$('#view-purchases tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { purchase } = await api(`/api/purchases/${tr.dataset.id}`);
      state.editingPurchase = purchase;
      await renderPurchases();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this purchase?')) return;
      try {
        await api(`/api/purchases/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderPurchases();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (form) {
    $('#cancel-purchase').addEventListener('click', async () => { state.editingPurchase = null; await renderPurchases(); });
    $('#save-purchase').addEventListener('click', async () => {
      const payload = {
        supplier: $('#pu-supplier').value,
        goods: $('#pu-goods').value,
        totalValue: Number($('#pu-value').value) || 0,
        status: $('#pu-status').value,
        paymentType: $('#pu-payment-type').value,
      };
      try {
        if (form.id) await api(`/api/purchases/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/purchases', { method: 'POST', body: JSON.stringify(payload) });
        toast('Purchase saved');
        state.editingPurchase = null;
        await renderPurchases();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

// ---- Newsletter campaigns: compose -> approve -> send (Phase 4) ----

function campaignStatusBadge(status) {
  const cls = status === 'sent' ? 'published' : status === 'draft' ? 'draft' : '';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

async function renderNewsletterCampaigns() {
  const { campaigns } = await api('/api/newsletter-campaigns');

  const rows = campaigns
    .map(
      (c) => `
        <tr data-id="${escapeAttr(c.id)}">
          <td>${escapeHtml(c.subject)}</td>
          <td>${campaignStatusBadge(c.status)}</td>
          <td>${formatDate(c.createdAt)}</td>
          <td>${c.status === 'sent' ? `${escapeHtml(String(c.sentCount))} sent${c.failedCount ? `, ${escapeHtml(String(c.failedCount))} failed` : ''}` : '—'}</td>
          <td>
            ${c.status === 'draft' ? '<button class="btn small" data-action="approve" type="button">Approve</button>' : ''}
            ${c.status === 'approved' ? '<button class="btn small btn-primary" data-action="send" type="button">Send</button>' : ''}
          </td>
        </tr>`,
    )
    .join('');

  $('#view-newsletter').innerHTML = `
    <div class="panel stack gap-3" style="max-width:600px">
      <div class="section-head"><h3>Compose newsletter</h3></div>
      <label class="field"><span>Subject</span><input id="nc-subject" /></label>
      <label class="field"><span>Body</span><textarea id="nc-body" rows="6"></textarea></label>
      <div class="row-card-actions">
        <button class="btn btn-primary" id="save-campaign" type="button">Save as draft</button>
      </div>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Subject</th><th>Status</th><th>Created</th><th>Sent</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><div class="empty">No campaigns yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#save-campaign').addEventListener('click', async () => {
    const subject = $('#nc-subject').value;
    const bodyText = $('#nc-body').value;
    try {
      await api('/api/newsletter-campaigns', { method: 'POST', body: JSON.stringify({ subject, bodyText }) });
      toast('Campaign saved as draft');
      await renderNewsletterCampaigns();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $$('#view-newsletter tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="approve"]')?.addEventListener('click', async () => {
      try {
        await api(`/api/newsletter-campaigns/${tr.dataset.id}/approve`, { method: 'PATCH' });
        toast('Campaign approved');
        await renderNewsletterCampaigns();
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="send"]')?.addEventListener('click', async () => {
      if (!confirm('Send this campaign to every confirmed newsletter subscriber now?')) return;
      try {
        const { campaign } = await api(`/api/newsletter-campaigns/${tr.dataset.id}/send`, { method: 'POST' });
        toast(`Sent to ${campaign.sentCount} subscriber(s)${campaign.failedCount ? `, ${campaign.failedCount} failed` : ''}`);
        await renderNewsletterCampaigns();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

// ---- WhatsApp campaigns: compose -> approve -> send (Phase 4) ----
// Sends a Meta-approved template (name + up to 4 {{1}}..{{4}} parameters),
// never free text -- see server/whatsapp.js for why.

async function renderWhatsAppCampaigns() {
  const { campaigns, configured } = await api('/api/whatsapp-campaigns');

  const rows = campaigns
    .map(
      (c) => `
        <tr data-id="${escapeAttr(c.id)}">
          <td>${escapeHtml(c.templateName)}</td>
          <td>${campaignStatusBadge(c.status)}</td>
          <td>${formatDate(c.createdAt)}</td>
          <td>${c.status === 'sent' ? `${escapeHtml(String(c.sentCount))} sent${c.failedCount ? `, ${escapeHtml(String(c.failedCount))} failed` : ''}` : '—'}</td>
          <td>
            ${c.status === 'draft' ? '<button class="btn small" data-action="approve" type="button">Approve</button>' : ''}
            ${c.status === 'approved' ? '<button class="btn small btn-primary" data-action="send" type="button">Send</button>' : ''}
          </td>
        </tr>`,
    )
    .join('');

  $('#view-whatsapp-updates').innerHTML = `
    <div class="panel stack gap-3" style="max-width:600px">
      <div class="section-head">
        <h3>Compose WhatsApp update</h3>
        ${configured ? '' : '<span class="badge draft">Not configured</span>'}
      </div>
      ${configured ? '' : '<p class="muted">Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env to enable sending -- see .env.example.</p>'}
      <label class="field"><span>Template name (Meta-approved)</span><input id="wc-template" /></label>
      <div class="grid-4">
        <label class="field"><span>{{1}}</span><input id="wc-param-1" /></label>
        <label class="field"><span>{{2}}</span><input id="wc-param-2" /></label>
        <label class="field"><span>{{3}}</span><input id="wc-param-3" /></label>
        <label class="field"><span>{{4}}</span><input id="wc-param-4" /></label>
      </div>
      <div class="row-card-actions">
        <button class="btn btn-primary" id="save-wa-campaign" type="button">Save as draft</button>
      </div>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Template</th><th>Status</th><th>Created</th><th>Sent</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><div class="empty">No campaigns yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#save-wa-campaign').addEventListener('click', async () => {
    const templateName = $('#wc-template').value;
    const templateParams = ['1', '2', '3', '4'].map((n) => $(`#wc-param-${n}`).value).filter((v) => v !== '');
    try {
      await api('/api/whatsapp-campaigns', { method: 'POST', body: JSON.stringify({ templateName, templateParams }) });
      toast('Campaign saved as draft');
      await renderWhatsAppCampaigns();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $$('#view-whatsapp-updates tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="approve"]')?.addEventListener('click', async () => {
      try {
        await api(`/api/whatsapp-campaigns/${tr.dataset.id}/approve`, { method: 'PATCH' });
        toast('Campaign approved');
        await renderWhatsAppCampaigns();
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="send"]')?.addEventListener('click', async () => {
      if (!confirm('Send this WhatsApp update to every opted-in client now?')) return;
      try {
        const { campaign } = await api(`/api/whatsapp-campaigns/${tr.dataset.id}/send`, { method: 'POST' });
        toast(`Sent to ${campaign.sentCount} recipient(s)${campaign.failedCount ? `, ${campaign.failedCount} failed` : ''}`);
        await renderWhatsAppCampaigns();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

// ---- Shipping options (C) ----

function blankShippingOption() {
  return { id: null, name: '', optionType: 'fixed', minWeight: 0, maxWeight: '', price: 0, active: true };
}

async function renderShipping() {
  state.editingShipping = state.editingShipping || null;
  const { shippingOptions } = await api('/api/shipping-options');

  const rows = shippingOptions
    .map(
      (o) => `
        <tr data-id="${escapeAttr(o.id)}">
          <td>${escapeHtml(o.name)}</td>
          <td>${o.optionType === 'fixed' ? '<span class="badge">flat rate</span>' : `${escapeHtml(String(o.minWeight))}g – ${o.maxWeight == null ? '∞' : `${escapeHtml(String(o.maxWeight))}g`}`}</td>
          <td>R${escapeHtml(String(o.price))}</td>
          <td>${o.active ? '<span class="badge published">active</span>' : '<span class="badge draft">inactive</span>'}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const form = state.editingShipping;
  const isFixed = form?.optionType !== 'auto_weight';
  $('#view-shipping').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-shipping" type="button">+ Shipping option</button>
      <span class="muted">${escapeHtml(String(shippingOptions.length))} options</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:600px">
        <div class="section-head"><h3>${form.id ? 'Edit shipping option' : 'New shipping option'}</h3></div>
        <label class="field"><span>Name</span><input id="sf-name" value="${escapeAttr(form.name)}" placeholder="e.g. PUDO Locker to Locker (Small)" /></label>
        <label class="field"><span>Type</span>
          <select id="sf-type">
            <option value="fixed" ${isFixed ? 'selected' : ''}>Flat rate — customer/admin picks by name (PUDO, local delivery)</option>
            <option value="auto_weight" ${!isFixed ? 'selected' : ''}>Weight bracket — auto-matched to cart weight (courier)</option>
          </select>
        </label>
        <div class="grid-3" id="sf-weight-fields" style="${isFixed ? 'display:none' : ''}">
          <label class="field"><span>Min weight (g)</span><input id="sf-min" type="number" min="0" step="1" value="${escapeAttr(String(form.minWeight))}" /></label>
          <label class="field"><span>Max weight (g, blank = no limit)</span><input id="sf-max" type="number" min="0" step="1" value="${escapeAttr(String(form.maxWeight ?? ''))}" /></label>
          <label class="field"><span>Price (R)</span><input id="sf-price-weight" type="number" min="0" step="1" value="${escapeAttr(String(form.price))}" /></label>
        </div>
        <label class="field" id="sf-price-fixed-field" style="${isFixed ? '' : 'display:none'}"><span>Price (R)</span><input id="sf-price-fixed" type="number" min="0" step="1" value="${escapeAttr(String(form.price))}" /></label>
        <label class="field checkbox"><input id="sf-active" type="checkbox" ${form.active ? 'checked' : ''} /><span>Active</span></label>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-shipping" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-shipping" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Name</th><th>Weight bracket / Type</th><th>Price</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><div class="empty">No shipping options yet — checkout can\'t complete until at least one active bracket exists</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#new-shipping').addEventListener('click', async () => { state.editingShipping = blankShippingOption(); await renderShipping(); });
  $$('#view-shipping tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', () => {
      const o = shippingOptions.find((x) => x.id === tr.dataset.id);
      state.editingShipping = { ...o, maxWeight: o.maxWeight ?? '' };
      renderShipping();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this shipping option?')) return;
      try {
        await api(`/api/shipping-options/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderShipping();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (form) {
    $('#sf-type').addEventListener('change', () => {
      state.editingShipping = { ...form, optionType: $('#sf-type').value };
      renderShipping();
    });
    $('#cancel-shipping').addEventListener('click', async () => { state.editingShipping = null; await renderShipping(); });
    $('#save-shipping').addEventListener('click', async () => {
      const optionType = $('#sf-type').value;
      const payload = {
        name: $('#sf-name').value,
        optionType,
        minWeight: optionType === 'fixed' ? 0 : Number($('#sf-min').value) || 0,
        maxWeight: optionType === 'fixed' ? null : ($('#sf-max').value === '' ? null : Number($('#sf-max').value)),
        price: Number((optionType === 'fixed' ? $('#sf-price-fixed').value : $('#sf-price-weight').value)) || 0,
        active: $('#sf-active').checked,
      };
      try {
        if (form.id) await api(`/api/shipping-options/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/shipping-options', { method: 'POST', body: JSON.stringify(payload) });
        toast('Shipping option saved');
        state.editingShipping = null;
        await renderShipping();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

// ---- Stock management (unified bulk-edit grid) ----

async function renderStock() {
  state.stockQ = state.stockQ || '';
  state.stockEdits = state.stockEdits || {}; // id -> { stockQty?, price? }
  const { items } = await api('/api/inventory');
  state.stockItems = items;

  const needle = state.stockQ.trim().toLowerCase();
  const filtered = needle
    ? items.filter((i) => [i.sku, i.name, i.category].filter(Boolean).some((v) => v.toLowerCase().includes(needle)))
    : items;

  const rows = filtered
    .map((item) => {
      const edit = state.stockEdits[item.id] || {};
      const stockVal = edit.stockQty ?? item.stockQty;
      const priceVal = edit.price ?? item.price;
      const dirty = edit.stockQty !== undefined || edit.price !== undefined;
      // Phase 3: spool-level fields only exist for filament rows -- read-only
      // here, written only by logging a print job (see renderPrintJobs()).
      const spoolCell = item.kind === 'filament'
        ? `${escapeHtml(item.remainingG != null ? item.remainingG.toFixed(0) : '—')}g / ${escapeHtml(item.percentLeft != null ? Math.round(item.percentLeft * 100) : '—')}%`
        : '—';
      return `
        <tr data-id="${escapeAttr(item.id)}" class="${dirty ? 'row-dirty' : ''}">
          <td><code>${escapeHtml(item.sku || '—')}</code></td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td><input type="number" min="0" step="1" class="stock-input" data-field="stockQty" value="${escapeAttr(String(stockVal))}" style="width:5rem" /></td>
          <td><input type="number" min="0" step="1" class="stock-input" data-field="price" value="${escapeAttr(String(priceVal))}" style="width:6rem" /></td>
          <td class="muted" style="font-size:0.85rem">${spoolCell}</td>
          <td class="muted" data-status style="font-size:0.8rem">${dirty ? 'Edited' : ''}</td>
        </tr>`;
    })
    .join('');

  const dirtyCount = Object.keys(state.stockEdits).length;

  $('#view-stock').innerHTML = `
    <div class="toolbar">
      <input id="stock-q" type="search" placeholder="Search SKU, name, category…" value="${escapeAttr(state.stockQ)}" />
      <span class="muted">${escapeHtml(String(filtered.length))} items</span>
      <button class="btn btn-primary" id="save-stock" type="button" ${dirtyCount ? '' : 'disabled'}>Save Changes${dirtyCount ? ` (${escapeHtml(String(dirtyCount))})` : ''}</button>
    </div>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Stock</th><th>Price (R)</th><th>Remaining (filament)</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No inventory items</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#stock-q').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    state.stockQ = $('#stock-q').value.trim();
    await renderStock();
  });

  $$('#view-stock .stock-input').forEach((input) => {
    input.addEventListener('input', () => {
      const tr = input.closest('tr');
      const id = tr.dataset.id;
      const field = input.dataset.field;
      const num = Number(input.value);
      const statusEl = tr.querySelector('[data-status]');
      if (input.value === '' || Number.isNaN(num) || num < 0) {
        statusEl.textContent = 'Invalid — must be 0 or more';
        statusEl.className = 'error-text';
        $('#save-stock').disabled = true;
        return;
      }
      state.stockEdits[id] = state.stockEdits[id] || {};
      state.stockEdits[id][field] = num;
      tr.classList.add('row-dirty');
      statusEl.textContent = 'Edited';
      statusEl.className = 'muted';
      statusEl.style.fontSize = '0.8rem';
      const saveBtn = $('#save-stock');
      saveBtn.disabled = false;
      saveBtn.textContent = `Save Changes (${Object.keys(state.stockEdits).length})`;
    });
  });

  $('#save-stock').addEventListener('click', async () => {
    const ids = Object.keys(state.stockEdits);
    if (!ids.length) return;
    const updates = ids.map((id) => {
      const item = state.stockItems.find((i) => i.id === id);
      return { kind: item.kind, id: item.id, parentId: item.parentId, ...state.stockEdits[id] };
    });
    const saveBtn = $('#save-stock');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const { results } = await api('/api/inventory', { method: 'PUT', body: JSON.stringify({ updates }) });
      const failed = results.filter((r) => !r.ok);
      toast(failed.length ? `${failed.length} item(s) failed to save` : 'Stock updated');
      for (const r of results) {
        if (r.ok) delete state.stockEdits[r.id];
      }
      await renderStock();
    } catch (ex) {
      toast(ex.message);
      saveBtn.disabled = false;
    }
  });
}

// ---- 3D Resources ----

function blankResource() {
  return { id: null, title: '', description: '', printSettings: '', filamentType: '', dimensions: '', active: true, imagePath: null, filePath: null };
}

async function renderResources() {
  state.editingResource = state.editingResource || null;
  const { resources } = await api('/api/resources');

  const rows = resources
    .map(
      (r) => `
        <tr data-id="${escapeAttr(r.id)}">
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.filamentType || '—')}</td>
          <td>${escapeHtml(r.dimensions || '—')}</td>
          <td>${r.active ? '<span class="badge published">active</span>' : '<span class="badge draft">hidden</span>'}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const form = state.editingResource;
  $('#view-resources').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-resource" type="button">+ Resource</button>
      <span class="muted">${escapeHtml(String(resources.length))} resources</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:700px">
        <div class="section-head"><h3>${form.id ? 'Edit resource' : 'New resource'}</h3></div>
        <label class="field"><span>Title</span><input id="rf-title" value="${escapeAttr(form.title)}" /></label>
        <label class="field"><span>Description</span><textarea id="rf-description">${escapeHtml(form.description || '')}</textarea></label>
        <div class="grid-3">
          <label class="field"><span>Print settings</span><input id="rf-print-settings" value="${escapeAttr(form.printSettings || '')}" placeholder="0.2mm layer, 20% infill" /></label>
          <label class="field"><span>Filament type</span><input id="rf-filament-type" value="${escapeAttr(form.filamentType || '')}" placeholder="PLA" /></label>
          <label class="field"><span>Dimensions</span><input id="rf-dimensions" value="${escapeAttr(form.dimensions || '')}" placeholder="120 x 80 x 40mm" /></label>
        </div>
        <label class="field checkbox"><input id="rf-active" type="checkbox" ${form.active ? 'checked' : ''} /><span>Visible in public gallery</span></label>
        ${form.id ? `
          <div class="grid-2">
            <label class="field">
              <span>Cover image ${form.imagePath ? '(replace)' : ''}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" id="rf-image-upload" />
              ${form.imagePath ? `<img src="${escapeAttr(form.imagePath)}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:4px;margin-top:0.5rem" />` : ''}
            </label>
            <label class="field">
              <span>Downloadable file ${form.filePath ? '(replace)' : ''}</span>
              <input type="file" accept=".stl,.3mf,.obj,.gcode,.zip,.pdf" id="rf-file-upload" />
              ${form.filePath ? `<p class="muted" style="font-size:0.8rem;margin-top:0.5rem">Current: ${escapeHtml(form.filePath.split('/').pop())}</p>` : ''}
            </label>
          </div>` : '<p class="muted" style="font-size:0.85rem">Save the resource first to enable image/file upload.</p>'}
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-resource" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-resource" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Title</th><th>Filament</th><th>Dimensions</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><div class="empty">No resources yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#new-resource').addEventListener('click', async () => { state.editingResource = blankResource(); await renderResources(); });
  $$('#view-resources tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { resource } = await api(`/api/resources/${tr.dataset.id}`);
      state.editingResource = resource;
      await renderResources();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this resource?')) return;
      try {
        await api(`/api/resources/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderResources();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (!form) return;

  $('#cancel-resource').addEventListener('click', async () => { state.editingResource = null; await renderResources(); });
  $('#save-resource').addEventListener('click', async () => {
    const payload = {
      title: $('#rf-title').value,
      description: $('#rf-description').value,
      printSettings: $('#rf-print-settings').value,
      filamentType: $('#rf-filament-type').value,
      dimensions: $('#rf-dimensions').value,
      active: $('#rf-active').checked,
    };
    try {
      if (form.id) await api(`/api/resources/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/resources', { method: 'POST', body: JSON.stringify(payload) });
      toast('Resource saved');
      state.editingResource = null;
      await renderResources();
    } catch (ex) {
      toast(ex.message);
    }
  });

  async function uploadResourceAsset(inputId, field, endpoint) {
    const input = $(`#${inputId}`);
    input?.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append(field, file);
      try {
        const res = await fetch(`/api/resources/${form.id}/${endpoint}`, { method: 'POST', credentials: 'include', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        state.editingResource = data.resource;
        toast('Uploaded');
        await renderResources();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
  await uploadResourceAsset('rf-image-upload', 'image', 'image');
  await uploadResourceAsset('rf-file-upload', 'file', 'file');
}

// ---- Custom 3D design requests (Phase 2) ----

const DESIGN_REQUEST_STATUSES = ['new', 'in_review', 'quoted', 'accepted', 'rejected', 'completed'];
const DESIGN_REQUEST_STATUS_LABEL = {
  new: 'New',
  in_review: 'In review',
  quoted: 'Quoted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  completed: 'Completed',
};

async function renderDesignRequests() {
  state.editingDesignRequest = state.editingDesignRequest || null;
  const { designRequests } = await api('/api/design-requests');

  const rows = designRequests
    .map(
      (r) => `
        <tr data-id="${escapeAttr(r.id)}">
          <td>${escapeHtml(r.name || '—')}</td>
          <td>${escapeHtml(r.email)}</td>
          <td><span class="badge">${escapeHtml(DESIGN_REQUEST_STATUS_LABEL[r.status] || r.status)}</span></td>
          <td>${escapeHtml(formatDate(r.createdAt))}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">View</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const form = state.editingDesignRequest;
  const statusOptions = form
    ? DESIGN_REQUEST_STATUSES.map((s) => `<option value="${s}" ${form.status === s ? 'selected' : ''}>${DESIGN_REQUEST_STATUS_LABEL[s]}</option>`).join('')
    : '';

  $('#view-design-requests').innerHTML = `
    <div class="toolbar">
      <span class="muted">${escapeHtml(String(designRequests.length))} requests</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:700px">
        <div class="section-head"><h3>Request from ${escapeHtml(form.name || form.email)}</h3></div>
        <p class="muted" style="font-size:0.85rem">${escapeHtml(form.email)} ${form.phone ? `· ${escapeHtml(form.phone)}` : ''}</p>
        <label class="field"><span>Description</span><textarea readonly>${escapeHtml(form.description)}</textarea></label>
        ${form.budgetNote ? `<p class="muted" style="font-size:0.85rem">Budget: ${escapeHtml(form.budgetNote)}</p>` : ''}
        <div class="grid-2">
          ${form.referenceImagePath ? `<img src="${escapeAttr(form.referenceImagePath)}" alt="Reference image" style="width:120px;height:120px;object-fit:cover;border-radius:4px" />` : ''}
          ${form.referenceFilePath ? `<a class="btn small" href="${escapeAttr(form.referenceFilePath)}" target="_blank" rel="noopener">Reference file</a>` : ''}
        </div>
        <label class="field"><span>Status</span><select id="dr-status">${statusOptions}</select></label>
        <label class="field"><span>Admin notes</span><textarea id="dr-notes">${escapeHtml(form.adminNotes || '')}</textarea></label>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-design-request" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-design-request" type="button">Close</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Received</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5"><div class="empty">No design requests yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $$('#view-design-requests tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { designRequest } = await api(`/api/design-requests/${tr.dataset.id}`);
      state.editingDesignRequest = designRequest;
      await renderDesignRequests();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this design request?')) return;
      try {
        await api(`/api/design-requests/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderDesignRequests();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (!form) return;

  $('#cancel-design-request').addEventListener('click', async () => { state.editingDesignRequest = null; await renderDesignRequests(); });
  $('#save-design-request').addEventListener('click', async () => {
    const payload = { status: $('#dr-status').value, adminNotes: $('#dr-notes').value };
    try {
      const { designRequest } = await api(`/api/design-requests/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('Saved — client notified if status changed');
      state.editingDesignRequest = designRequest;
      await renderDesignRequests();
    } catch (ex) {
      toast(ex.message);
    }
  });
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

function guessHex(name) {
  const map = {
    white: '#f4f1ea',
    black: '#1a1714',
    grey: '#8a8680',
    gray: '#8a8680',
    blue: '#2f5f9e',
    red: '#b53a2e',
    yellow: '#e6c84a',
    green: '#4f7a45',
    orange: '#d97a2e',
    purple: '#6b4d8a',
    pink: '#d4849a',
    silver: '#c5c8cc',
    clear: '#e8e4d8',
    natural: '#e8e4d8',
  };
  const key = String(name || '').toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k)) return v;
  }
  return '#d6d0c4';
}

boot();
