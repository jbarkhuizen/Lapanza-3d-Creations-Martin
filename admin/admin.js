import { formatRand } from './money.js';

const API = '';

const state = {
  route: 'dashboard',
  authenticated: false,
  products: [],
  filters: { q: '', kind: '', status: '' },
  todoFilters: { q: '', category: '', status: '', plannedFixDate: '' },
  // key 'status' is the default (not a plain field) so In Progress/Backlog
  // land on top via TODO_STATUS_RANK rather than alphabetically -- see
  // sortTodos(). Survives re-renders the same way todoFilters does.
  todoSort: { key: 'status', dir: 'asc' },
  // Which row IDs have their Description cell expanded -- a plain Set, not
  // per-row DOM state, so it survives the full re-render that every other
  // todo action (status change, sort click, filter change) already
  // triggers via renderTodos().
  todoExpandedIds: new Set(),
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

// Sessions are in-memory server-side, so EVERY deploy/restart signs all
// admins out and the 12h TTL expires them daily. This is the one place all
// panels' requests pass through, so the 401 handling lives here: return the
// UI to the login screen instead of leaving whatever panel was open to fail
// blank. /api/auth/* is exempt -- a failed login must show its own message
// on the login form, not bounce through the session-expired path.
function handleSessionExpired() {
  if (analyticsPollTimer) { clearInterval(analyticsPollTimer); analyticsPollTimer = null; }
  if (testRunPollTimer) { clearInterval(testRunPollTimer); testRunPollTimer = null; }
  if (!state.authenticated) return;
  state.authenticated = false;
  renderAuth();
  toast('Your session has ended — please sign in again');
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  } catch {
    throw new Error('Could not reach the server — check the connection and try again');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    handleSessionExpired();
    throw new Error('Your session has ended — please sign in again');
  }
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
let testRunPollTimer = null;

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
  if (route !== 'test-cases' && testRunPollTimer) {
    clearInterval(testRunPollTimer);
    testRunPollTimer = null;
  }
  $$('.nav-btn').forEach((btn) =>
    btn.classList.toggle(
      'active',
      btn.dataset.route === route ||
        (route === 'editor' && btn.dataset.route === 'catalog') ||
        (route === 'version-detail' && btn.dataset.route === 'version-history') ||
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
  show($('#view-promos'), route === 'promos');
  show($('#view-stock'), route === 'stock');
  show($('#view-resources'), route === 'resources');
  show($('#view-testimonials'), route === 'testimonials');
  show($('#view-design-requests'), route === 'design-requests');
  show($('#view-newsletter'), route === 'newsletter');
  show($('#view-potential-market'), route === 'potential-market');
  show($('#view-whatsapp-updates'), route === 'whatsapp-updates');
  show($('#view-invoice-history'), route === 'invoice-history');
  show($('#view-new-order'), route === 'new-order');
  show($('#view-purchases'), route === 'purchases');
  show($('#view-print-jobs'), route === 'print-jobs');
  show($('#view-in-house-filament'), route === 'in-house-filament');
  show($('#view-backups'), route === 'backups');
  show($('#view-version-history'), route === 'version-history');
  show($('#view-version-detail'), route === 'version-detail');
  show($('#view-documentation'), route === 'documentation');
  show($('#view-test-cases'), route === 'test-cases');
  show($('#view-site-overview'), route === 'site-overview');
  show($('#view-todos'), route === 'todos');
  show($('#view-audit-log'), route === 'audit-log');
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
    promos: ['Client Side', 'Promo codes'],
    resources: ['Client Side', '3D Resources'],
    testimonials: ['Client Side', 'Testimonials'],
    'design-requests': ['Client Side', 'Design requests'],
    newsletter: ['Client Side', 'Newsletter'],
    'potential-market': ['Client Side', 'Potential Market'],
    'whatsapp-updates': ['Client Side', 'WhatsApp Updates'],
    'invoice-history': ['Client Side', 'Invoice History'],
    'new-order': ['Client Side', 'New order'],
    stock: ['Local Management', 'Stock management'],
    purchases: ['Local Management', 'Purchase History'],
    'print-jobs': ['Local Management', 'Print Job Costing'],
    'in-house-filament': ['Local Management', 'In-House Filament'],
    backups: ['Settings', 'Backups'],
    'version-history': ['Settings', 'Version History'],
    'version-detail': ['Settings', 'Release details'],
    documentation: ['Settings', 'Documentation'],
    'test-cases': ['Settings', 'Test Cases'],
    'site-overview': ['Settings', 'About this Site'],
    todos: ['Settings', 'Todo / Backlog'],
    'audit-log': ['Settings', 'Audit Logs'],
    settings: ['Settings', 'Site settings'],
  };
  const [eyebrow, title] = titles[route] || titles.dashboard;
  $('#top-eyebrow').textContent = eyebrow;
  $('#top-title').textContent = title;
  // "+ Filament" / "+ Category" only make sense on the Product Catalog list
  // and its editor -- an exclusion list here (hide on THESE routes) meant
  // every route added afterwards (Registered Users, Orders, Clients, New
  // Order, Invoice History, Shipping, Resources, Design Requests,
  // Newsletter, WhatsApp Updates, Stock, Purchases, Print Job Costing,
  // In-House Filament...) defaulted to showing them, which is exactly the
  // "these buttons don't belong here" bug reported 2026-08-28. Inclusion
  // list instead, so a new route is hidden by default and has to opt in.
  show($('.topbar-actions'), route === 'catalog' || route === 'editor');
}


// Review #26 (todo #165): shared XHR upload with a visible progress bar --
// fetch() can't report upload progress. One overlay serves every admin
// upload (they're one-at-a-time interactions).
function uploadFormData(url, formData) {
  return new Promise((resolve, reject) => {
    let bar = document.getElementById('upload-progress-overlay');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'upload-progress-overlay';
      bar.innerHTML = '<div class="upl-label"></div><div class="upl-track"><span class="upl-fill"></span></div>';
      document.body.appendChild(bar);
    }
    const label = bar.querySelector('.upl-label');
    const fill = bar.querySelector('.upl-fill');
    const done = () => { bar.classList.remove('visible'); };
    bar.classList.add('visible');
    label.textContent = 'Uploading… 0%';
    fill.style.width = '0%';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      fill.style.width = pct + '%';
      label.textContent = pct < 100 ? 'Uploading… ' + pct + '%' : 'Processing…';
    });
    xhr.addEventListener('load', () => {
      done();
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Upload failed (' + xhr.status + ')'));
    });
    xhr.addEventListener('error', () => { done(); reject(new Error('Upload failed — network error')); });
    xhr.addEventListener('abort', () => { done(); reject(new Error('Upload cancelled')); });
    xhr.send(formData);
  });
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
  if (state.authenticated) {
    try {
      await loadApp();
    } catch (ex) {
      toast(ex.message);
    }
  }
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
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Server unreachable or already restarted -- either way the session
      // is gone; sign the UI out locally rather than staying stuck signed-in.
    }
    state.authenticated = false;
    renderAuth();
  });

  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
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
      } else if (btn.dataset.route === 'documentation') {
        setRoute('documentation');
        await renderDocumentation();
      } else if (btn.dataset.route === 'test-cases') {
        setRoute('test-cases');
        await renderTestCases();
      } else if (btn.dataset.route === 'site-overview') {
        setRoute('site-overview');
        await renderSiteOverview();
      } else if (btn.dataset.route === 'todos') {
        setRoute('todos');
        await renderTodos();
      } else if (btn.dataset.route === 'audit-log') {
        setRoute('audit-log');
        await renderAuditLog();
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
      } else if (btn.dataset.route === 'promos') {
        setRoute('promos');
        await renderPromos();
      } else if (btn.dataset.route === 'stock') {
        setRoute('stock');
        await renderStock();
      } else if (btn.dataset.route === 'resources') {
        setRoute('resources');
        await renderResources();
      } else if (btn.dataset.route === 'testimonials') {
        setRoute('testimonials');
        await renderTestimonials();
      } else if (btn.dataset.route === 'design-requests') {
        setRoute('design-requests');
        await renderDesignRequests();
      } else if (btn.dataset.route === 'invoice-history') {
        setRoute('invoice-history');
        await renderInvoiceHistory();
      } else if (btn.dataset.route === 'newsletter') {
        setRoute('newsletter');
        await renderNewsletterCampaigns();
      } else if (btn.dataset.route === 'potential-market') {
        setRoute('potential-market');
        await renderPotentialMarket();
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
      } catch (ex) {
        // Every panel render above is an unguarded await -- without this,
        // any API failure left the view blank with nothing but a console
        // rejection. (A 401 has already routed to the login screen inside
        // api() before this toast fires.)
        toast(ex.message);
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

// Owner request (2026-09-02): visits vs unique visitors per hour, last 24h.
// Same no-chart-library inline-SVG approach as renderRevenueChart, with the
// #148 lesson applied from the start: legend, axis labels, and a caption.
function hourlyTrafficChartHtml(series) {
  if (!series?.length || !series.some((h) => h.visits > 0)) {
    return '<p class="muted">No visits recorded in the last 24 hours yet.</p>';
  }
  const width = 640;
  const height = 160;
  const groupW = width / series.length;
  const barW = Math.max(2, groupW * 0.38);
  const max = Math.max(...series.map((h) => h.visits), 1);
  const bars = series
    .map((h, i) => {
      const x = i * groupW + (groupW - barW * 2 - 2) / 2;
      const vh = Math.max(h.visits ? 2 : 0, Math.round((h.visits / max) * (height - 4)));
      const uh = Math.max(h.uniqueVisitors ? 2 : 0, Math.round((h.uniqueVisitors / max) * (height - 4)));
      const title = `<title>${escapeHtml(h.hour)} — ${h.visits} visit${h.visits === 1 ? '' : 's'}, ${h.uniqueVisitors} unique visitor${h.uniqueVisitors === 1 ? '' : 's'}</title>`;
      return `<rect x="${x.toFixed(1)}" y="${height - vh}" width="${barW.toFixed(1)}" height="${vh}" rx="1.5" class="chart-bar">${title}</rect>
        <rect x="${(x + barW + 2).toFixed(1)}" y="${height - uh}" width="${barW.toFixed(1)}" height="${uh}" rx="1.5" class="chart-bar-alt">${title}</rect>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="revenue-chart" preserveAspectRatio="none" role="img" aria-label="Visits and unique visitors per hour, last 24 hours">${bars}</svg>
    <div class="muted" style="display:flex;justify-content:space-between;font-size:0.75rem;margin-top:0.25rem"><span>${escapeHtml(series[0].hour)}</span><span>${escapeHtml(series[series.length - 1].hour)}</span></div>
    <p class="muted" style="font-size:0.78rem;margin:0.4rem 0 0"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent,#c24b28);vertical-align:-1px"></span> Visits (page views) · <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:color-mix(in srgb, var(--accent,#c24b28) 40%, var(--line));vertical-align:-1px"></span> Unique visitors. Hover a bar for the exact figures. Your own admin sessions are excluded.</p>`;
}

async function renderAnalytics() {
  // Owner request (2026-09-02): range selectors for the funnel and top pages.
  state.analyticsFunnelRange = state.analyticsFunnelRange || '30d';
  state.analyticsPagesRange = state.analyticsPagesRange || 'all';
  const [active, summary] = await Promise.all([
    api('/api/analytics/active'),
    api(`/api/analytics/summary?${new URLSearchParams({ funnelRange: state.analyticsFunnelRange, pagesRange: state.analyticsPagesRange })}`),
  ]);
  const RANGE_LABELS = { '1h': 'Last Hour', '24h': 'Last 24 Hours', '7d': 'Last 7 Days', '30d': 'Last 30 Days' };
  const rangeOptions = (current, includeAll) => [
    ...Object.entries(RANGE_LABELS).map(([v, l]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${l}</option>`),
    ...(includeAll ? [`<option value="all" ${current === 'all' ? 'selected' : ''}>All Time</option>`] : []),
  ].join('');

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

    <div class="panel">
      <div class="section-head"><h3>Last 24 Hours — Hourly Traffic</h3></div>
      ${hourlyTrafficChartHtml(summary.hourlyTraffic)}
    </div>

    <div class="panel table-wrap">
      <div class="section-head"><h3>Shopping Funnel</h3><select id="analytics-funnel-range">${rangeOptions(state.analyticsFunnelRange, false)}</select></div>
      <table class="catalog">
        <thead><tr><th>Step</th><th>Events</th><th>Unique Visitors</th></tr></thead>
        <tbody>${(summary.events || [])
          .map((e) => {
            const labels = { add_to_cart: 'Added to cart', checkout_start: 'Started checkout', payment_complete: 'Payment completed', quote_submit: 'Quote requested', whatsapp_click: 'WhatsApp clicked' };
            return `<tr><td>${escapeHtml(labels[e.eventType] || e.eventType)}</td><td>${escapeHtml(String(e.count))}</td><td>${escapeHtml(String(e.uniqueVisitors))}</td></tr>`;
          })
          .join('')}</tbody>
      </table>
      <p class="muted" style="font-size:0.8rem">First-party and anonymous, same visitor id as page views. Payment completions are recorded server-side from Payfast confirmations (no visitor id).</p>
    </div>

    <div class="panel table-wrap">
      <div class="section-head"><h3>Active Registered Clients</h3></div>
      <table class="catalog">
        <thead><tr><th>Name</th><th>Email</th><th>Page</th><th>Last seen</th></tr></thead>
        <tbody id="analytics-active-clients-body"></tbody>
      </table>
    </div>

    <div class="grid-2" style="align-items:start; margin-top:1.5rem;">
      <div class="panel table-wrap">
        <div class="section-head"><h3>Last 30 Days</h3></div>
        <table class="catalog">
          <thead><tr><th>Day</th><th>Visits</th><th>Unique visitors</th></tr></thead>
          <tbody>${dailyRows || '<tr><td colspan="3"><div class="empty">No visits recorded yet</div></td></tr>'}</tbody>
        </table>
      </div>
      <div class="panel table-wrap">
        <div class="section-head"><h3>Top Pages</h3><select id="analytics-pages-range">${rangeOptions(state.analyticsPagesRange, true)}</select></div>
        <table class="catalog">
          <thead><tr><th>Page</th><th>Visits</th></tr></thead>
          <tbody>${topPageRows || '<tr><td colspan="2"><div class="empty">No visits recorded yet</div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  $('#analytics-funnel-range')?.addEventListener('change', async (e) => { state.analyticsFunnelRange = e.target.value; await renderAnalytics(); });
  $('#analytics-pages-range')?.addEventListener('change', async (e) => { state.analyticsPagesRange = e.target.value; await renderAnalytics(); });

  renderActiveSection(active);

  clearInterval(analyticsPollTimer);
  analyticsPollTimer = setInterval(async () => {
    renderActiveSection(await api('/api/analytics/active'));
  }, 20000);
}

const SALES_RANGE_LABELS = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All time' };

// Dependency-free bar chart -- this admin ships as a plain ES module with no
// build step and no chart library anywhere else, so a small inline SVG
// matches the rest of the codebase rather than pulling one in for one panel.
function renderRevenueChart(series) {
  if (!series.length) return '<p class="muted">No revenue in this range yet.</p>';
  const width = 640;
  const height = 160;
  const gap = series.length > 40 ? 1 : 4;
  const barWidth = Math.max(1, (width - gap * (series.length - 1)) / series.length);
  const max = Math.max(...series.map((d) => d.revenue), 1);
  const bars = series.map((d, i) => {
    const barHeight = Math.max(1, Math.round((d.revenue / max) * (height - 4)));
    const x = (i * (barWidth + gap)).toFixed(1);
    const y = height - barHeight;
    return `<rect x="${x}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="1.5" class="chart-bar"><title>${escapeHtml(d.date)}: ${escapeHtml(formatRand(d.revenue))}</title></rect>`;
  }).join('');
  // Review #9 (todo #148): the chart needs to explain itself -- axis
  // endpoints, the scale ceiling, and what a bar IS, not just hover titles.
  const first = series[0]?.date || '';
  const last = series[series.length - 1]?.date || '';
  const peak = series.reduce((a, b) => (b.revenue > a.revenue ? b : a), series[0]);
  return `<svg viewBox="0 0 ${width} ${height}" class="revenue-chart" preserveAspectRatio="none" role="img" aria-label="Daily revenue for the selected range">${bars}</svg>
    <div class="muted" style="display:flex;justify-content:space-between;font-size:0.75rem;margin-top:0.25rem"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>
    <p class="muted" style="font-size:0.78rem;margin:0.4rem 0 0">Each bar is one day's revenue from paid, shipped and completed orders (tallest bar: ${escapeHtml(formatRand(peak.revenue))} on ${escapeHtml(peak.date)}). Hover a bar for the exact figure. Pending-payment orders are not counted.</p>`;
}

async function renderDashboard() {
  state.salesRange = state.salesRange || '30d';
  const [data, sales, { publishHistory }] = await Promise.all([
    api('/api/dashboard'),
    api(`/api/dashboard/sales?range=${encodeURIComponent(state.salesRange)}`),
    api('/api/publish-history').catch(() => ({ publishHistory: [] })),
  ]);
  state.dashboard = data;
  state.sales = sales;
  const t = data.totals;

  $('#view-dashboard').innerHTML = `
    <div class="section-head">
      <h3>Sales</h3>
      <select id="sales-range">
        ${Object.entries(SALES_RANGE_LABELS).map(([value, label]) => `<option value="${value}" ${value === state.salesRange ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="label">Revenue</div><div class="value">${formatRand(sales.revenue)}</div></div>
      <div class="stat-card"><div class="label">Orders</div><div class="value">${sales.orderCount}</div></div>
      <div class="stat-card"><div class="label">Avg Order Value</div><div class="value">${formatRand(sales.averageOrderValue)}</div></div>
      <div class="stat-card"><div class="label">Pending Payment</div><div class="value">${formatRand(sales.pendingPayment.total)}</div><div class="muted" style="font-size:0.78rem">${sales.pendingPayment.count} order${sales.pendingPayment.count === 1 ? '' : 's'}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><h3>Revenue Trend</h3></div>
        ${renderRevenueChart(sales.series)}
      </div>
      <div class="panel table-wrap">
        <div class="section-head"><h3>Top Products</h3></div>
        <table class="catalog">
          <thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
          <tbody>
            ${sales.topProducts.map((p) => `
              <tr><td>${escapeHtml(p.name || p.productId)}</td><td>${p.units}</td><td>${formatRand(p.revenue)}</td></tr>
            `).join('') || '<tr><td colspan="3"><div class="empty">No sales in this range yet</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel table-wrap">
      <div class="section-head"><h3>Order Status</h3></div>
      <table class="catalog">
        <thead><tr><th>Status</th><th>Orders</th><th>Total</th></tr></thead>
        <tbody>
          ${sales.statusBreakdown.map((s) => `
            <tr><td>${statusBadge(s.status)}</td><td>${s.count}</td><td>${formatRand(s.total)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>

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
        ${publishHistory.length ? `
        <div class="recent-list" style="margin-top:0.5rem">
          ${publishHistory.map((h) => `
            <div class="recent-item">
              <div>
                <strong style="font-size:0.85rem;${/FAILED/.test(h.detail) ? 'color:#b53a2e' : ''}">${escapeHtml(h.detail)}</strong>
                <div class="muted" style="font-size:0.78rem">${escapeHtml(h.username || 'automatic')}</div>
              </div>
              <div class="muted" style="font-size:0.78rem;white-space:nowrap">${escapeHtml(formatDate(h.createdAt))}</div>
            </div>`).join('')}
        </div>` : '<p class="muted" style="font-size:0.85rem">No publishes recorded yet — the list fills as you save and publish.</p>'}
      </div>
      <div class="panel">
        <div class="section-head"><h3>Recently Edited</h3></div>
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
  $('#sales-range').addEventListener('change', (e) => {
    state.salesRange = e.target.value;
    renderDashboard();
  });
}

// Same grouping shape as Stock Management's STOCK_GROUP_DEFS (see its own
// comment for why Car Parts nests GWM/Landrover rather than matching
// directly) -- kept consistent across both admin pages. Filament rows have
// no single category product/name in common (PLA, ABS, etc. are each their
// own top-level row), so that group matches on kind alone; every other
// group matches a category product's name.
// Review #6 (todo #145): groups are built from the REAL category names at
// render time, not a hardcoded list -- renaming a category (Homeware ->
// Home & School) or adding one shows up here automatically instead of the
// rows falling into "Other". Car-part-brand categories (settings.
// carPartBrands) nest under one Car Parts parent; everything else is a
// top-level group. Shared by Product Catalog and Stock Management.
function dynamicGroupDefs(categoryNames, matchFor, filamentMatch) {
  const brandNames = new Set(
    (state.settings?.carPartBrands || []).filter((b) => b && b.active !== false && b.name).map((b) => String(b.name)),
  );
  const brands = categoryNames.filter((n) => brandNames.has(n));
  const rest = categoryNames.filter((n) => !brandNames.has(n));
  const defs = [{ key: 'filament', label: 'Filament', match: filamentMatch }];
  for (const n of rest) defs.push({ key: `cat-${slugify(n)}`, label: n, match: matchFor(n) });
  if (brands.length) {
    defs.push({
      key: 'car-parts',
      label: 'Car Parts',
      children: brands.map((n) => ({ key: `cat-${slugify(n)}`, label: n, match: matchFor(n) })),
    });
  }
  return defs;
}

function catalogGroupDefs() {
  const names = [...new Set(state.products.filter((p) => p.kind === 'category').map((p) => p.name))];
  return dynamicGroupDefs(names, (name) => (p) => p.kind === 'category' && p.name === name, (p) => p.kind === 'filament');
}

function catalogRowHtml(p) {
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
        <td><span class="badge ${p.status || 'draft'}">${p.status || 'draft'}</span></td>
        <td class="muted">${meta}</td>
        <td class="muted">${formatDate(p.updatedAt)}</td>
        <td>
          <button class="btn small" data-action="edit" type="button">Edit</button>
        </td>
      </tr>`;
}

const CATALOG_TABLE_HEAD = '<thead><tr><th>Product</th><th>Kind</th><th>Status</th><th>Details</th><th>Updated</th><th></th></tr></thead>';

// Mirrors stockSectionHtml -- see its own comment for the forceOpen/
// data-initial-open reasoning.
function catalogSectionHtml(key, label, list, forceOpen) {
  const open = forceOpen || !state.catalogCollapsed.has(key);
  const rows = list.map(catalogRowHtml).join('');
  return `
    <details class="stock-section" data-group="${escapeAttr(key)}" data-initial-open="${open}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(label)} <span class="muted">(${list.length})</span></summary>
      <div class="panel table-wrap">
        <table class="catalog">
          ${CATALOG_TABLE_HEAD}
          <tbody>${rows || '<tr><td colspan="6"><div class="empty">No products</div></td></tr>'}</tbody>
        </table>
      </div>
    </details>`;
}

async function renderCatalog() {
  state.catalogCollapsed = state.catalogCollapsed || new Set();
  await ensureSettingsLoaded(); // carPartBrands drives the Car Parts nesting
  await refreshProducts();

  // state.products is already filtered by the search/kind/status toolbar
  // (see refreshProducts) -- a group is only hidden while a filter is
  // active, same as Stock Management, so browsing unfiltered always shows
  // every group even if currently empty.
  const filtering = Boolean(state.filters.q || state.filters.kind || state.filters.status);
  const claimed = new Set();
  const sectionsHtml = catalogGroupDefs().map((def) => {
    if (def.children) {
      const childrenHtml = def.children
        .map((child) => {
          const childItems = state.products.filter((p) => child.match(p));
          childItems.forEach((p) => claimed.add(p.id));
          if (filtering && !childItems.length) return '';
          return catalogSectionHtml(child.key, child.label, childItems, filtering);
        })
        .join('');
      const totalCount = def.children.reduce((n, child) => n + state.products.filter((p) => child.match(p)).length, 0);
      if (filtering && !totalCount) return '';
      const open = filtering || !state.catalogCollapsed.has(def.key);
      return `
    <details class="stock-section stock-section-parent" data-group="${escapeAttr(def.key)}" data-initial-open="${open}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(def.label)} <span class="muted">(${totalCount})</span></summary>
      ${childrenHtml}
    </details>`;
    }
    const groupItems = state.products.filter((p) => def.match(p));
    groupItems.forEach((p) => claimed.add(p.id));
    if (filtering && !groupItems.length) return '';
    return catalogSectionHtml(def.key, def.label, groupItems, filtering);
  }).join('');

  const otherItems = state.products.filter((p) => !claimed.has(p.id));
  const otherHtml = otherItems.length || !filtering ? catalogSectionHtml('other', 'Other', otherItems, filtering) : '';

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
    <div class="stack gap-3">${sectionsHtml}${otherHtml}</div>
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

  $$('#view-catalog details.stock-section').forEach((el) => {
    el.addEventListener('toggle', () => {
      // Same spurious-initial-fire guard as Stock Management's identical
      // listener -- see its comment for why this can't just trust the
      // first 'toggle' event.
      if (el.dataset.initialOpen === String(el.open)) {
        delete el.dataset.initialOpen;
        return;
      }
      const key = el.dataset.group;
      if (el.open) state.catalogCollapsed.delete(key);
      else state.catalogCollapsed.add(key);
    });
  });

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

// Car-parts items need settings.carPartModels for their Model checkboxes,
// but state.settings otherwise only loads when the Settings tab is visited
// -- fetch it lazily here so it's ready however the editor was reached.
async function ensureSettingsLoaded() {
  if (state.settings) return;
  const data = await api('/api/settings');
  state.settings = data.settings;
}

async function openNew(kind) {
  await ensureSettingsLoaded();
  state.draft = blankProduct(kind);
  state.editingId = state.draft.id;
  setRoute('editor', { id: state.draft.id });
  renderEditor();
}

async function openEditor(id, kind) {
  await ensureSettingsLoaded();
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
            <h3>Core Details</h3>
            <span class="badge ${p.kind}">${p.kind}</span>
          </div>
          <div class="grid-2">
            <label class="field"><span>Name *</span><input data-field="name" value="${escapeAttr(p.name)}" /></label>
            <label class="field"><span>Slug *</span><input data-field="slug" value="${escapeAttr(p.slug)}" placeholder="auto-from-name" /></label>
          </div>
          <!-- div, not label: Chrome cancels execCommand edits on a
               contenteditable that sits inside a <label> -->
          <div class="field"><span>Description</span>${richTextField('data-field="description"', p.description)}</div>
          <div class="grid-3">
            <label class="field"><span>Status</span>
              <select data-field="status">
                <option value="published" ${p.status === 'published' ? 'selected' : ''}>Published</option>
                <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option>
              </select>
            </label>
            <label class="field"><span>Sort Order</span><input data-field="sortOrder" type="number" value="${p.sortOrder ?? 0}" /></label>
            <label class="field checkbox" style="margin-top:1.5rem">
              <input data-field="featured" type="checkbox" ${p.featured ? 'checked' : ''} />
              <span>Featured on Homepage Cues</span>
            </label>
          </div>
        </div>

        ${isFilament ? renderFilamentSections(p) : renderCategorySections(p)}

        <div class="panel stack gap-3">
          <div class="section-head"><h3>SEO</h3></div>
          <label class="field"><span>SEO Title</span><input data-field="seoTitle" value="${escapeAttr(p.seoTitle || '')}" /></label>
          <label class="field"><span>SEO Description</span><textarea data-field="seoDescription">${escapeHtml(p.seoDescription || '')}</textarea></label>
          <label class="field"><span>Internal Notes (Admin Only)</span><textarea data-field="internalNotes">${escapeHtml(p.internalNotes || '')}</textarea></label>
        </div>
      </div>

      <div class="stack gap-3">
        <div class="panel editor-actions">
          <button class="btn btn-primary" id="save-product" type="button">Save product</button>
          <button class="btn" id="back-catalog" type="button">Back to catalog</button>
          ${p._isNew ? '' : '<button class="btn btn-danger" id="delete-product" type="button">Delete</button>'}
        </div>
        <div class="panel">
          <div class="section-head"><h3>Field Map</h3></div>
          <p class="muted" style="margin-top:0;font-size:0.88rem;line-height:1.5">
            These fields power the public site pages:
            ${isFilament
              ? '<strong>name, slug, description, specs[], colours[{name,sku,weightG,rollLengthM,priceRand,stockQty,imagePath}], colourNote</strong>.'
              : '<strong>name, slug, description, crumbs, parent, items[{name,details,material,size,finish,price,sku,imageUrl,listed,available,creator,models[],sourceUrl}]</strong>. Creator/Model/Source link only apply to car-parts categories (GWM/Landrover).'}
          </p>
          <div class="meta-list" style="margin-top:1rem">
            <div><span>ID</span><span>${p.id.slice(0, 8)}…</span></div>
            <div><span>Created</span><span>${formatDate(p.createdAt)}</span></div>
            <div><span>Updated</span><span>${formatDate(p.updatedAt)}</span></div>
            <div><span>Colours / Items</span><span>${isFilament ? (p.colours?.length || 0) : (p.items?.length || 0)}</span></div>
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
        <h3>Colours & Pricing</h3>
        <button class="btn small" id="add-colour" type="button">+ Colour</button>
      </div>
      <div class="field" style="margin-bottom:0.85rem">
        <span>Colour Note (Shown Under Swatches)</span>
        ${richTextField('data-field="colourNote"', p.colourNote || '')}
      </div>
      <div id="colours-list">
        ${(p.colours || []).map((c, i) => `
          <div class="row-card" data-colour-index="${i}">
            <div class="row-card-actions">
              <div class="flex items-center gap-3">
                ${c._isNew
                  ? '<span class="muted" style="font-size:0.78rem">Save to Enable Photo Upload</span>'
                  : galleryPanelHtml('colour', c.id, c.images || [], c.imagePath)}
              </div>
              <button class="btn small btn-danger" data-remove-colour type="button">Remove</button>
            </div>
            <div class="row-card-actions" style="justify-content:flex-end">
              <button class="btn small btn-primary" data-save-colour type="button">Save roll</button>
            </div>
            <div class="grid-3">
              <label class="field"><span>Colour Name</span><input data-colour="name" value="${escapeAttr(c.name)}" /></label>
              <label class="field"><span>SKU</span><input data-colour="sku" value="${escapeAttr(c.sku)}" /></label>
              <label class="field"><span>Hex Override</span><input data-colour="hex" value="${escapeAttr(c.hex || '')}" placeholder="#c24b28" /></label>
            </div>
            <div class="grid-2">
              <label class="field"><span>Filament Weight (g)</span><input data-colour="weightG" type="number" min="0" step="1" value="${c.weightG ?? 0}" /></label>
              <label class="field"><span>Shipping Weight (g)</span><input data-colour="shippingWeightG" type="number" min="0" step="1" value="${c.shippingWeightG ?? c.weightG ?? 0}" /></label>
            </div>
            <div class="grid-2">
              <label class="field"><span>Roll Length (m, Optional)</span><input data-colour="rollLengthM" type="number" min="0" step="0.1" value="${c.rollLengthM ?? ''}" /></label>
              <label class="field"><span>Price per Roll (R)</span><input data-colour="priceRand" type="number" min="0" step="1" value="${c.priceRand ?? 0}" /></label>
            </div>
            <div class="grid-2">
              <label class="field"><span>Stock Quantity</span><input data-colour="stockQty" type="number" min="0" step="1" value="${c.stockQty ?? 0}" /></label>
              <label class="field"><span>Notes</span><input data-colour="notes" value="${escapeAttr(c.notes || '')}" /></label>
            </div>
          </div>
        `).join('') || '<div class="empty">No colours yet</div>'}
      </div>
    </div>
  `;
}

// Car-parts-only fields (GWM/Landrover) on a catalog item: who designed it
// and which vehicle model(s) it fits. A retired (active:false) model still
// renders here if the item already has it checked -- same rule as every
// other configurable list, see settings-defaults.js's LIST_SETTING_KEYS note.
function carPartItemFields(item, categorySlug) {
  // Separate lists per brand -- GWM (P300/P500/Tank 300/Tank 500/P-Series)
  // and Land Rover's naming don't overlap, and a shared list risked tagging
  // a part with the wrong brand's model (see settings-defaults.js).
  // #130: only the two founding brands have model lists; a newly-added
  // brand gets no picker (its items still work, just untagged) rather than
  // silently inheriting the wrong brand's models.
  const listKey = categorySlug === 'gwm' ? 'carPartModelsGwm' : categorySlug === 'landrover' ? 'carPartModelsLandrover' : null;
  const configured = (listKey && state.settings?.[listKey]) || [];
  const selected = new Set(item.models || []);
  const models = [
    ...configured,
    ...[...selected].filter((name) => !configured.some((m) => m.name === name)).map((name) => ({ id: name, name, active: true })),
  ];
  return `
    <div class="grid-2">
      <label class="field"><span>Creator (Design Credit)</span><input data-item="creator" value="${escapeAttr(item.creator || '')}" placeholder="e.g. Jonny Long" /></label>
      <label class="field"><span>Source Link (Admin Only)</span><input data-item="sourceUrl" value="${escapeAttr(item.sourceUrl || '')}" placeholder="https://..." /></label>
    </div>
    <div class="field">
      <span>Fits Models</span>
      <div class="model-checkbox-list" style="display:flex;flex-wrap:wrap;gap:0.5rem 1rem;margin-top:0.35rem">
        ${models.length
          ? models
              .map(
                (m) => `
          <label class="field checkbox" style="margin:0">
            <input type="checkbox" data-item-model="${escapeAttr(m.name)}" ${selected.has(m.name) ? 'checked' : ''} />
            <span>${escapeHtml(m.name)}${m.active ? '' : ' (retired)'}</span>
          </label>`,
              )
              .join('')
          : '<span class="muted" style="font-size:0.85rem">No models configured yet — add some in Settings.</span>'}
      </div>
    </div>
  `;
}

function renderCategorySections(p) {
  return `
    <div class="panel stack gap-3">
      <div class="section-head"><h3>Category Page</h3></div>
      <div class="grid-2">
        <label class="field"><span>Breadcrumbs</span><input data-field="crumbs" value="${escapeAttr(p.crumbs || '')}" placeholder="Home / Toys" /></label>
        <label class="field"><span>Parent Group</span>
          <select data-field="parent">
            <option value="" ${!p.parent ? 'selected' : ''}>None (top-level)</option>
            <option value="car-parts" ${p.parent === 'car-parts' ? 'selected' : ''}>car-parts</option>
          </select>
        </label>
      </div>
    </div>

    <div class="panel">
      <div class="section-head">
        <h3>Catalog Items</h3>
        <button class="btn small" id="add-item" type="button">+ Item</button>
      </div>
      <p class="muted" style="margin-top:0;font-size:0.85rem">Printed products shown on Toys / Homeware / Phones / Car Parts pages.</p>
      <div id="items-list">
        ${(p.items || []).map((item, i) => `
          <div class="row-card" data-item-index="${i}">
            <div class="row-card-actions">
              <strong>#${i + 1} ${escapeHtml(item.name || 'Untitled')}</strong>
              <button class="btn small btn-primary" data-save-item type="button">Save item</button>
              <button class="btn small btn-danger" data-remove-item type="button">Remove</button>
            </div>
            <div class="row-card-actions">
              ${item._isNew ? '<span class="muted" style="font-size:0.78rem">Save to Enable Photo Upload</span>' : galleryPanelHtml('item', item.id, item.images || [], item.imageUrl)}
            </div>
            ${item._isNew ? '' : `
            <div class="row-card-actions" data-video-panel="${escapeAttr(item.id)}">
              ${item.videoUrl ? `<a class="btn small btn-ghost" href="${escapeAttr(item.videoUrl)}" target="_blank" rel="noopener">View video</a><button class="btn small btn-danger" data-action="video-remove" type="button">Remove video</button>` : ''}
              <button class="btn small" data-action="video-add" type="button">${item.videoUrl ? 'Replace video' : '+ Add video (MP4/WebM, max 50MB)'}</button>
              <input type="file" class="hidden" accept="video/mp4,video/webm" data-video-input="${escapeAttr(item.id)}" />
            </div>`}
            <div class="grid-2">
              <label class="field"><span>Item Name</span><input data-item="name" value="${escapeAttr(item.name || '')}" /></label>
              <label class="field"><span>SKU</span><input data-item="sku" value="${escapeAttr(item.sku || '')}" /></label>
            </div>
            <div class="field"><span>Details</span>${richTextField('data-item="details"', item.details || '')}</div>
            <div class="grid-3">
              <label class="field"><span>Material</span><input data-item="material" value="${escapeAttr(item.material || '')}" /></label>
              <label class="field"><span>Size</span><input data-item="size" value="${escapeAttr(item.size || '')}" /></label>
              <label class="field"><span>Finish</span><input data-item="finish" value="${escapeAttr(item.finish || '')}" /></label>
            </div>
            <div class="grid-3">
              <label class="field"><span>Price</span><input data-item="price" value="${escapeAttr(item.price || '')}" placeholder="450 (or POA)" /></label>
              <label class="field"><span>Weight (g)</span><input data-item="weight" type="number" min="0" step="1" value="${item.weight ?? 0}" /></label>
              <label class="field"><span>Shipping Weight (g)</span><input data-item="shippingWeight" type="number" min="0" step="1" value="${item.shippingWeight ?? item.weight ?? 0}" /></label>
            </div>
            <div class="grid-3">
              <label class="field"><span>Stock Quantity</span><input data-item="stockQty" type="number" min="0" step="1" value="${item.stockQty ?? 0}" /></label>
              <label class="field checkbox" style="margin-top:1.5rem">
                <input data-item="listed" type="checkbox" ${item.listed !== false ? 'checked' : ''} />
                <span>Visible on Site</span>
              </label>
              <label class="field checkbox" style="margin-top:1.5rem">
                <input data-item="available" type="checkbox" ${item.available !== false ? 'checked' : ''} />
                <span>Available</span>
              </label>
            </div>
            ${p.parent === 'car-parts' ? carPartItemFields(item, p.slug) : ''}
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
  // Backlog #126: a newly added row appends to the END of the array on purpose
  // (array order IS the persisted storefront render order -- unshifting would
  // silently reorder the live page), so instead scroll the new row into view
  // and focus its first field to spare the long scroll on big catalogs.
  function focusNewRow(selector) {
    const rows = $$(selector);
    const row = rows[rows.length - 1];
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.querySelector('input, textarea, select')?.focus({ preventScroll: true });
  }
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
    focusNewRow('[data-colour-index]');
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
      listed: true,
      creator: '',
      models: [],
      sourceUrl: '',
      sortOrder: p.items.length,
      _isNew: true, // not yet persisted -- photo upload needs a real item id from the server first
    });
    renderEditor();
    focusNewRow('[data-item-index]');
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
  $$('[data-save-colour]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-colour-index]').dataset.colourIndex);
      await saveOneColour(p, idx);
    });
  });
  $$('[data-save-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-item-index]').dataset.itemIndex);
      await saveOneItem(p, idx);
    });
  });
  $$('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-item-index]').dataset.itemIndex);
      const item = p.items[idx];
      if (!item) return;
      // Same reasoning as data-remove-colour: an already-saved item needs
      // its own immediate DELETE (it isn't part of the bulk product
      // payload's expectations any more now that items have their own
      // save/delete endpoints); an item added via "+ Item" but never saved
      // (_isNew) only exists client-side, so just drop it locally.
      if (!item._isNew) {
        if (!confirm(`Remove item “${item.name || 'Untitled'}”? This cannot be undone.`)) return;
        try {
          await api(`/api/products/${p.id}/items/${item.id}`, { method: 'DELETE' });
          toast('Item removed');
        } catch (ex) {
          toast(ex.message);
          return;
        }
      }
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
  $$('[data-item-model]').forEach((cb) => {
    cb.addEventListener('change', () => syncNestedFromDom());
  });

  (p.colours || []).forEach((c) => {
    if (c._isNew) return;
    wireGalleryPanel('colour', c.id, { filamentId: p.id }, (images) => {
      state.draft.colours = state.draft.colours.map((row) => (row.id === c.id ? { ...row, images } : row));
      renderEditor();
    });
  });

  (p.items || []).forEach((item) => {
    if (item._isNew) return;
    wireGalleryPanel('item', item.id, { productId: p.id }, (images) => {
      state.draft.items = state.draft.items.map((row) => (row.id === item.id ? { ...row, images } : row));
      renderEditor();
    });

    // Review #25 (todo #164): per-item product video.
    const videoPanel = document.querySelector(`[data-video-panel="${item.id}"]`);
    if (videoPanel) {
      videoPanel.querySelector('[data-action="video-add"]')?.addEventListener('click', () => {
        videoPanel.querySelector(`[data-video-input="${item.id}"]`)?.click();
      });
      videoPanel.querySelector(`[data-video-input="${item.id}"]`)?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('video', file);
        try {
          const data = await uploadFormData(`/api/products/${p.id}/items/${item.id}/video`, formData);
          toast('Video uploaded');
          state.draft = { ...state.draft, items: data.product.items };
          renderEditor();
        } catch (ex) {
          toast(ex.message);
        }
      });
      videoPanel.querySelector('[data-action="video-remove"]')?.addEventListener('click', async () => {
        if (!confirm('Remove this video?')) return;
        try {
          const data = await api(`/api/products/${p.id}/items/${item.id}/video`, { method: 'DELETE' });
          toast('Video removed');
          state.draft = { ...state.draft, items: data.product.items };
          renderEditor();
        } catch (ex) {
          toast(ex.message);
        }
      });
    }
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
        toast(res.publishWarning || 'Product created and published live');
        renderEditor();
      } else {
        const res = await api(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) });
        state.draft = res.product;
        toast(res.publishWarning || 'Product saved and published live');
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

// Saves just one colour ("roll") immediately, without needing to click the
// top-level "Save product" -- same POST-if-new/PUT-if-existing shape
// saveFilament's own per-colour loop uses. If the parent filament type
// itself hasn't been saved yet (p._isNew, e.g. a brand-new filament with
// colours added before ever clicking Save), that has to happen first since
// a colour can't attach to a filament id that doesn't exist server-side yet
// -- transparent to the admin, "Save roll" just works either way.
async function saveOneColour(p, idx) {
  const c = p.colours[idx];
  if (!c) return;
  try {
    let filamentId = p.id;
    if (p._isNew) {
      const { _isNew, colours, items, ...payload } = p;
      const res = await api('/api/filaments', { method: 'POST', body: JSON.stringify(payload) });
      filamentId = res.filament.id;
      p.id = filamentId;
      p._isNew = false;
    }
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
    let saveRes;
    if (c._isNew) {
      saveRes = await api(`/api/filaments/${filamentId}/colours`, { method: 'POST', body });
    } else {
      saveRes = await api(`/api/filaments/${filamentId}/colours/${c.id}`, { method: 'PUT', body });
    }
    toast(saveRes.publishWarning || 'Roll saved and published live');
    const { filament } = await api(`/api/filaments/${filamentId}`);
    state.draft = { ...filament, kind: 'filament' };
    state.editingId = filamentId;
    renderEditor();
  } catch (ex) {
    toast(ex.message);
  }
}

// Saves just one catalog item immediately, without needing the top-level
// "Save product" -- same shape as saveOneColour above (POST if new, PUT if
// existing). Applies to every category page's items (Toys/Homeware/Phones/
// GWM/Landrover), so e.g. ticking a GWM item's "Fits models" boxes and
// clicking "Save item" is enough on its own to reach the DB and republish.
async function saveOneItem(p, idx) {
  const item = p.items?.[idx];
  if (!item) return;
  try {
    let productId = p.id;
    if (p._isNew) {
      const { _isNew, colours, items, ...payload } = p;
      const res = await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      productId = res.product.id;
      p.id = productId;
      p._isNew = false;
    }
    const body = JSON.stringify({
      name: item.name,
      details: item.details,
      material: item.material,
      size: item.size,
      finish: item.finish,
      price: item.price,
      sku: item.sku,
      creator: item.creator,
      models: item.models,
      sourceUrl: item.sourceUrl,
      weight: item.weight,
      shippingWeight: item.shippingWeight,
      stockQty: item.stockQty,
      available: item.available,
      listed: item.listed,
    });
    let saveRes;
    if (item._isNew) {
      saveRes = await api(`/api/products/${productId}/items`, { method: 'POST', body });
    } else {
      saveRes = await api(`/api/products/${productId}/items/${item.id}`, { method: 'PUT', body });
    }
    toast(saveRes.publishWarning || 'Item saved and published live');
    const { product } = await api(`/api/products/${productId}`);
    state.draft = { ...product, kind: 'category' };
    state.editingId = productId;
    renderEditor();
  } catch (ex) {
    toast(ex.message);
  }
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
      // I2: this mapper rebuilds every row from DOM state on every keystroke
      // (see the input listeners below) -- without carrying the gallery array
      // forward, every redraw would visually zero the panel to 0/5 even
      // though nothing was lost server-side.
      images: prev.images || [],
      _isNew: prev._isNew ?? false,
    };
  });

  p.items = $$('[data-item-index]').map((row, i) => {
    const prev = p.items?.[Number(row.dataset.itemIndex)] || {};
    return {
      id: prev.id || uid(),
      name: $('[data-item="name"]', row)?.value || '',
      details: $('[data-item="details"]', row)?.value || '',
      material: $('[data-item="material"]', row)?.value || '',
      size: $('[data-item="size"]', row)?.value || '',
      finish: $('[data-item="finish"]', row)?.value || '',
      price: $('[data-item="price"]', row)?.value || '',
      sku: $('[data-item="sku"]', row)?.value || '',
      // No longer a text field -- set only via the photo upload/remove
      // handlers below, so carry the current value forward unchanged here.
      imageUrl: prev.imageUrl || '',
      // I2: same reasoning as the colour mapper above -- carry the gallery
      // array forward through every redraw instead of dropping it.
      images: prev.images || [],
      // Review #25 (todo #164): set only by the video upload/remove
      // handlers -- carry forward like imageUrl or a whole-product save
      // would wipe it.
      videoUrl: prev.videoUrl || '',
      weight: Number($('[data-item="weight"]', row)?.value) || 0,
      shippingWeight: Number($('[data-item="shippingWeight"]', row)?.value) || 0,
      stockQty: Math.max(0, Number($('[data-item="stockQty"]', row)?.value) || 0),
      available: $('[data-item="available"]', row)?.checked !== false,
      listed: $('[data-item="listed"]', row)?.checked !== false,
      // Only rendered for car-parts items (carPartItemFields) -- absent
      // elsewhere, so fall back to whatever the item already had.
      creator: row.querySelector('[data-item="creator"]')?.value ?? (prev.creator || ''),
      sourceUrl: row.querySelector('[data-item="sourceUrl"]')?.value ?? (prev.sourceUrl || ''),
      models: $$('[data-item-model]', row).length
        ? $$('[data-item-model]', row).filter((cb) => cb.checked).map((cb) => cb.dataset.itemModel)
        : (prev.models || []),
      sortOrder: i,
      _isNew: prev._isNew ?? false,
    };
  });
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
      <button class="btn" id="sync-offsite" type="button">Sync offsite now</button>
      <span class="muted">${escapeHtml(String(backups.length))} backup(s) &middot; ${escapeHtml(formatBytes(totalBytes))} total</span>
    </div>
    <p class="muted" style="margin: -0.5rem 0 1rem; font-size: 0.85rem;">
      A backup of the full database runs automatically once a day; the most recent 30 are kept and older ones are pruned automatically. Manual backups count toward that same limit. Every daily run also mirrors this folder to an offsite remote (Google Drive via rclone) so backups survive a disk/VPS failure, not just bad data or a bad deploy -- see docs/DEPLOY.md if "Sync offsite now" errors with "not set".
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

  $('#sync-offsite').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      await api('/api/backups/sync-offsite', { method: 'POST' });
      toast('Synced to offsite remote');
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync offsite now';
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
          <td style="width: 100px; text-align: center;"><button class="btn small" data-version-id="${escapeAttr(v.id)}" type="button">V${escapeHtml(v.version_label || v.version_number)}</button></td>
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
        <thead><tr><th style="width: 100px;">Version</th><th>Description</th><th style="width: 180px;">Deployed Date</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3"><div class="empty">No versions recorded yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $$('#view-version-history [data-version-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      setRoute('version-detail');
      await renderVersionDetail(button.dataset.versionId);
    });
  });
}

function renderReleaseCommit(commit) {
  const body = commit.body ? `<pre class="release-commit-body">${escapeHtml(commit.body)}</pre>` : '';
  return `
    <details class="release-commit">
      <summary><strong>${escapeHtml(commit.subject)}</strong> <code>${escapeHtml(commit.hash.slice(0, 7))}</code></summary>
      <p class="muted">${escapeHtml(commit.authorName)} · ${escapeHtml(commit.authorEmail)} · ${escapeHtml(formatDate(commit.authoredAt))}</p>
      ${body}
    </details>`;
}

async function renderVersionDetail(id) {
  const { version, releaseDetails } = await api(`/api/version-history/${encodeURIComponent(id)}`);
  const label = `V${version.version_label || version.version_number}`;
  const commits = releaseDetails?.commits || [];
  const files = releaseDetails?.files || [];
  const filesRows = files
    .map((file) => `<tr><td><code>${escapeHtml(file.file)}</code></td><td>${escapeHtml(String(file.added))}</td><td>${escapeHtml(String(file.deleted))}</td></tr>`)
    .join('');

  $('#view-version-detail').innerHTML = `
    <div class="toolbar">
      <button class="btn" id="back-to-version-history" type="button">← Version History</button>
    </div>
    <div class="panel stack gap-3">
      <div class="section-head"><h3>${escapeHtml(label)} — ${escapeHtml(version.description)}</h3></div>
      <div class="release-meta">
        <span><strong>Deployed:</strong> ${escapeHtml(formatDate(version.deployed_date))}</span>
        <span><strong>Recorded by:</strong> ${escapeHtml(version.deployed_by)}</span>
        <span><strong>Commit range:</strong> <code>${escapeHtml(releaseDetails?.commitRange || 'Not available')}</code></span>
        <span><strong>Lines:</strong> +${escapeHtml(String(releaseDetails?.filesAdded || 0))} / -${escapeHtml(String(releaseDetails?.filesDeleted || 0))}</span>
      </div>
      ${releaseDetails ? `
        <div>
          <h4>Release Notes</h4>
          <pre class="release-notes">${escapeHtml(releaseDetails.releaseNotes || 'No commit notes were recorded for this release.')}</pre>
        </div>
        <div>
          <h4>Commits (${escapeHtml(String(commits.length))})</h4>
          <div class="stack gap-2">${commits.map(renderReleaseCommit).join('') || '<div class="empty">No Git commit was associated with this baseline release.</div>'}</div>
        </div>
        <div class="table-wrap">
          <h4>Changed files (${escapeHtml(String(files.length))})</h4>
          <table class="catalog">
            <thead><tr><th>File</th><th>Added</th><th>Deleted</th></tr></thead>
            <tbody>${filesRows || '<tr><td colspan="3"><div class="empty">No changed files were recorded for this baseline release.</div></td></tr>'}</tbody>
          </table>
        </div>` : '<div class="empty">Release detail has not been captured for this version.</div>'}
    </div>`;

  $('#back-to-version-history').addEventListener('click', async () => {
    setRoute('version-history');
    await renderVersionHistory();
  });
}

async function renderDocumentation() {
  const { documents } = await api('/api/documentation');
  $('#view-documentation').innerHTML = `
    <div class="panel stack gap-3">
      <div class="section-head">
        <div><h3>System Documentation</h3><p class="muted">Current documents stored with this application. Open any document in a new tab.</p></div>
      </div>
      <div class="documentation-list">
        ${documents.map((document) => `
          <article class="documentation-card">
            <div><h4>${escapeHtml(document.title)}</h4><p class="muted">${escapeHtml(document.description || document.path)}</p><code>${escapeHtml(document.path)}</code><p class="muted" style="margin:0.3rem 0 0;font-size:0.78rem">Last updated: ${document.updatedAt ? escapeHtml(new Date(document.updatedAt).toLocaleString()) : 'unknown'}</p></div>
            <a class="btn btn-secondary" href="/api/documentation/${encodeURIComponent(document.id)}" target="_blank" rel="noopener">Open</a>
          </article>`).join('') || '<div class="empty">No documentation files are available.</div>'}
      </div>
    </div>`;
}

function testStatusBadge(status) {
  if (!status) return '<span class="muted">Not Run</span>';
  return `<span class="badge test-${escapeAttr(status)}">${escapeHtml(status)}</span>`;
}

function testRunSummary(run) {
  if (!run) return 'No test runs have been recorded.';
  const duration = run.duration_ms == null ? 'Running…' : `${(run.duration_ms / 1000).toFixed(1)}s`;
  return `${testStatusBadge(run.status)} ${escapeHtml(run.scope)} · ${escapeHtml(String(run.passed_count))} passed · ${escapeHtml(String(run.failed_count))} failed · ${escapeHtml(duration)}`;
}

async function renderTestCases() {
  const { cases, runs } = await api('/api/test-cases');
  const suites = [...new Set(cases.map((item) => item.file))];
  const activeRun = runs.find((run) => run.status === 'running');
  $('#view-test-cases').innerHTML = `
    <div class="stack gap-3">
      <div class="panel stack gap-3">
        <div class="section-head"><div><h3>Automated Test Runner</h3><p class="muted">Runs only checked-in Node test cases from this application. Test execution is restricted to the catalog below.</p></div></div>
        <div class="test-run-controls">
          <button class="btn btn-primary" id="run-all-tests" type="button" ${activeRun ? 'disabled' : ''}>Run all test cases</button>
          <select id="test-suite-select" ${activeRun ? 'disabled' : ''}><option value="">Run a test suite…</option>${suites.map((file) => `<option value="${escapeAttr(file)}">${escapeHtml(file)}</option>`).join('')}</select>
          <button class="btn" id="run-suite-tests" type="button" ${activeRun ? 'disabled' : ''}>Run suite</button>
          <button class="btn" id="run-selected-tests" type="button" ${activeRun ? 'disabled' : ''}>Run selected</button>
        </div>
        <div id="test-run-status" class="test-run-status">${testRunSummary(runs[0])}</div>
      </div>
      <div class="panel table-wrap">
        <div class="section-head"><div><h3>Test Cases</h3><p class="muted">${escapeHtml(String(cases.length))} discovered test case(s). Select individual cases, a suite, or the complete suite.</p></div></div>
        <table class="catalog">
          <thead><tr><th><input id="select-all-test-cases" type="checkbox" aria-label="Select all test cases" /></th><th>Test case</th><th>Suite</th><th>Last result</th></tr></thead>
          <tbody>${cases.map((item) => `<tr><td><input class="test-case-select" type="checkbox" value="${escapeAttr(item.id)}" aria-label="Select ${escapeAttr(item.name)}" /></td><td>${escapeHtml(item.name)}</td><td><code>${escapeHtml(item.file)}</code></td><td>${testStatusBadge(item.lastStatus)} ${item.lastRunAt ? `<span class="muted">${escapeHtml(formatDate(item.lastRunAt))}</span>` : ''}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="panel stack gap-2">
        <div class="section-head"><h3>Recent Runs</h3></div>
        ${runs.map((run) => `<button class="test-run-history" type="button" data-run-id="${escapeAttr(run.id)}">${testRunSummary(run)} <span class="muted">${escapeHtml(formatDate(run.started_at))}</span></button>`).join('') || '<div class="empty">No test runs have been recorded.</div>'}
        <pre id="test-run-output" class="test-output hidden"></pre>
      </div>
    </div>`;

  const start = async (body) => {
    const { run } = await api('/api/test-runs', { method: 'POST', body: JSON.stringify(body) });
    toast('Test run started');
    await renderTestCases();
    testRunPollTimer = setInterval(async () => {
      const current = await api(`/api/test-runs/${encodeURIComponent(run.id)}`);
      if (current.run.status !== 'running') {
        clearInterval(testRunPollTimer);
        testRunPollTimer = null;
        await renderTestCases();
        toast(current.run.status === 'passed' ? 'Test run passed' : 'Test run failed');
      }
    }, 1500);
  };
  $('#run-all-tests').addEventListener('click', () => start({ scope: 'all' }).catch((err) => toast(err.message)));
  $('#run-suite-tests').addEventListener('click', () => {
    const suiteFile = $('#test-suite-select').value;
    if (!suiteFile) return toast('Select a test suite first');
    start({ scope: 'suite', suiteFile }).catch((err) => toast(err.message));
  });
  $('#run-selected-tests').addEventListener('click', () => {
    const testCaseIds = $$('.test-case-select:checked', $('#view-test-cases')).map((input) => input.value);
    if (!testCaseIds.length) return toast('Select one or more test cases first');
    start({ scope: 'selected', testCaseIds }).catch((err) => toast(err.message));
  });
  $('#select-all-test-cases').addEventListener('change', (event) => $$('.test-case-select', $('#view-test-cases')).forEach((input) => { input.checked = event.target.checked; }));
  $$('.test-run-history', $('#view-test-cases')).forEach((button) => button.addEventListener('click', async () => {
    const { run } = await api(`/api/test-runs/${encodeURIComponent(button.dataset.runId)}`);
    const output = $('#test-run-output');
    output.textContent = run.output || 'No output was captured.';
    output.classList.remove('hidden');
  }));
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function renderDirectoryInventory(directory) {
  const rows = directory.entries.map((entry) => `
    <tr>
      <td>${entry.browsable ? `<button class="directory-link" type="button" data-directory-path="${escapeAttr(entry.path)}">${escapeHtml(entry.name)}</button>` : escapeHtml(entry.name)}</td>
      <td>${escapeHtml(entry.type)}</td>
      <td>${entry.sizeBytes == null ? '—' : escapeHtml(formatBytes(entry.sizeBytes))}</td>
      <td>${escapeHtml(formatDate(entry.modifiedAt))}</td>
    </tr>`).join('');
  return `
    <div class="directory-toolbar">
      <button class="btn" id="directory-root" type="button">Filesystem root</button>
      ${directory.parentPath ? `<button class="btn" id="directory-parent" type="button" data-directory-path="${escapeAttr(directory.parentPath)}">Up one level</button>` : ''}
      <code class="directory-path">${escapeHtml(directory.path)}</code>
    </div>
    <div class="table-wrap">
      <table class="catalog">
        <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Modified</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4"><div class="empty">No readable entries.</div></td></tr>'}</tbody>
      </table>
    </div>
    ${directory.unreadableEntries ? `<p class="muted">${escapeHtml(String(directory.unreadableEntries))} inaccessible entries were omitted.</p>` : ''}
    ${directory.truncated ? '<p class="muted">Only the first 1,000 entries are displayed for this directory.</p>' : ''}`;
}

async function renderSiteOverview() {
  const overview = await api('/api/site-overview');
  const diskPercent = overview.disk.totalBytes ? Math.round((overview.disk.usedBytes / overview.disk.totalBytes) * 100) : 0;
  $('#view-site-overview').innerHTML = `
    <div class="stack gap-3">
      <div class="panel stack gap-3">
        <div class="section-head"><div><h3>VPS Operations Overview</h3><p class="muted">Read-only inventory for capacity planning, operations review, and future decisions. File contents are never exposed.</p></div></div>
        <div class="site-overview-grid">
          <div class="overview-stat"><span>Hostname</span><strong>${escapeHtml(overview.system.hostname)}</strong></div>
          <div class="overview-stat"><span>Operating System</span><strong>${escapeHtml(overview.system.platform)}</strong></div>
          <div class="overview-stat"><span>Uptime</span><strong>${escapeHtml(formatUptime(overview.system.uptimeSeconds))}</strong></div>
          <div class="overview-stat"><span>Runtime</span><strong>${escapeHtml(`${overview.system.nodeVersion} · ${overview.system.cpuCount} CPU`)}</strong></div>
          <div class="overview-stat"><span>Memory Free</span><strong>${escapeHtml(formatBytes(overview.system.memoryFreeBytes))} / ${escapeHtml(formatBytes(overview.system.memoryTotalBytes))}</strong></div>
          <div class="overview-stat"><span>Backups Retained</span><strong>${escapeHtml(String(overview.application.backupCount))}</strong></div>
          <div class="overview-stat"><span>Current Release</span><strong>${overview.application.latestRelease ? `V${escapeHtml(overview.application.latestRelease.versionLabel)}` : 'Unavailable'}</strong></div>
        </div>
        <div>
          <div class="section-head"><h4>Filesystem Capacity</h4><strong>${escapeHtml(formatBytes(overview.disk.usedBytes))} used of ${escapeHtml(formatBytes(overview.disk.totalBytes))} (${escapeHtml(String(diskPercent))}%)</strong></div>
          <div class="capacity-bar"><span style="width: ${Math.min(100, diskPercent)}%"></span></div>
          <p class="muted">${escapeHtml(formatBytes(overview.disk.freeBytes))} free on <code>${escapeHtml(overview.disk.filesystemRoot)}</code></p>
        </div>
      </div>
      ${overview.application.latestRelease ? `<div class="panel"><div class="section-head"><div><h3>Latest Deployed Release</h3><p class="muted">${escapeHtml(formatDate(overview.application.latestRelease.deployedAt))}</p></div><strong>V${escapeHtml(overview.application.latestRelease.versionLabel)}</strong></div><p style="margin:0">${escapeHtml(overview.application.latestRelease.description)}</p></div>` : ''}
      <div class="panel table-wrap">
        <div class="section-head"><div><h3>Application Storage</h3><p class="muted">Key persistent and operational paths.</p></div></div>
        <table class="catalog"><thead><tr><th>Area</th><th>Path</th><th>Size</th><th>Modified</th></tr></thead>
          <tbody>${overview.application.paths.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td><code>${escapeHtml(item.path)}</code></td><td>${item.sizeBytes == null ? 'Unavailable' : escapeHtml(formatBytes(item.sizeBytes))}</td><td>${escapeHtml(formatDate(item.modifiedAt))}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="panel">
        <div class="section-head"><div><h3>Complete Filesystem Inventory</h3><p class="muted">Browse directories to review names, types, dates, and allocated sizes. Virtual kernel paths (${escapeHtml(overview.virtualPaths.join(', '))}) are intentionally not traversed.</p></div></div>
        <div id="directory-inventory">${renderDirectoryInventory(overview.rootDirectory)}</div>
      </div>
    </div>`;
  const loadDirectory = async (pathname) => {
    try {
      const directory = await api(`/api/site-overview/directory?path=${encodeURIComponent(pathname)}`);
      $('#directory-inventory').innerHTML = renderDirectoryInventory(directory);
      bindDirectoryButtons();
    } catch (err) {
      toast(err.message);
    }
  };
  function bindDirectoryButtons() {
    $('#directory-root').addEventListener('click', () => loadDirectory(overview.disk.filesystemRoot));
    $$('[data-directory-path]', $('#directory-inventory')).forEach((button) => button.addEventListener('click', () => loadDirectory(button.dataset.directoryPath)));
  }
  bindDirectoryButtons();
}

// ---- Todo / Backlog (Settings) ----

// Category and Priority are admin-configurable now (Settings -> Todo/
// Backlog panels, settings.todoCategories/todoPriorities) -- these two
// plain arrays only remain as a defensive fallback if that setting is ever
// empty (e.g. every entry got deleted), used in renderTodos() below. Status
// stays a fixed, hardcoded enum: it drives real code behavior elsewhere
// (badge styling below, TODO_STATUS_RANK's sort order, "Claude Fix"/"Won't
// Fix" have specific meaning), so it's deliberately not configurable.
const TODO_CATEGORIES = ['Bug', 'Feature', 'Enhancement', 'Tech Debt'];
// 'Discarded' (2026-08-28): the item itself is no longer applicable
// (superseded, already covered elsewhere, describes something the site no
// longer needs) -- distinct from "Won't Fix" (a real decision not to build a
// still-valid idea). A backlog-hygiene classification, not a scope call.
const TODO_STATUSES = ['Backlog', 'In Progress', 'Done', "Won't Fix", 'Claude Fix', 'Discarded', 'Deferred'];
const TODO_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Default view: active work (In Progress, Backlog) on top, resolved/rejected
// work at the bottom -- plain alphabetical would scatter these ("Backlog"
// before "Claude Fix" before "Discarded" before "Done" before "In Progress"
// before "Won't Fix"), burying In Progress under everything else.
const TODO_STATUS_RANK = { 'In Progress': 0, Backlog: 1, Deferred: 2, 'Claude Fix': 3, Done: 4, "Won't Fix": 5, Discarded: 6 };

// Priority's rank is derived from settings.todoPriorities' own array order
// (built fresh in renderTodos() below), not a fixed map -- since the list
// is now open-ended, whatever order the admin adds/arranges entries in IS
// the sort order, with no code change needed for a newly added priority.
// A priority value not found in the current list (todo referencing one
// since deleted, or state not loaded yet) ranks last via the `?? 99`
// fallback where this is used.
function buildPriorityRank(todoPriorities) {
  return Object.fromEntries((todoPriorities || []).map((p, i) => [p.name, i]));
}

function sortTodos(todos, priorityRank) {
  const { key, dir } = state.todoSort;
  const mul = dir === 'desc' ? -1 : 1;
  const sorted = [...todos].sort((a, b) => {
    let cmp;
    if (key === 'status') cmp = (TODO_STATUS_RANK[a.status] ?? 99) - (TODO_STATUS_RANK[b.status] ?? 99);
    else if (key === 'priority') cmp = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
    else if (key === 'dateAdded' || key === 'plannedFixDate' || key === 'actualFixDate') {
      // Nulls (no date set yet) sort last regardless of direction -- an
      // empty Planned/Actual Fix Date isn't meaningfully "earliest".
      const av = a[key] ? new Date(a[key]).getTime() : null;
      const bv = b[key] ? new Date(b[key]).getTime() : null;
      if (av === null && bv === null) cmp = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else cmp = av - bv;
    } else {
      cmp = String(a[key] || '').localeCompare(String(b[key] || ''));
    }
    if (cmp === 0) cmp = (TODO_STATUS_RANK[a.status] ?? 99) - (TODO_STATUS_RANK[b.status] ?? 99);
    return cmp * mul;
  });
  return sorted;
}

function blankTodo() {
  return { id: null, category: 'Feature', priority: 'Medium', name: '', description: '', status: 'Backlog', plannedFixDate: '', actualFixDate: '' };
}

function filterTodos(todos) {
  const { q, category, status, plannedFixDate } = state.todoFilters;
  const needle = q.toLowerCase();
  return todos.filter((todo) => {
    if (category && todo.category !== category) return false;
    if (status && todo.status !== status) return false;
    if (plannedFixDate && toDateInputValue(todo.plannedFixDate) !== plannedFixDate) return false;
    if (!needle) return true;
    return [todo.name, todo.description].filter(Boolean).some((value) => value.toLowerCase().includes(needle));
  });
}

function toDateInputValue(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function todoStatusBadge(status) {
  const s = escapeHtml(status);
  const cls = status === 'Done' || status === 'Claude Fix' ? 'published' : status === "Won't Fix" || status === 'Discarded' || status === 'Deferred' ? 'draft' : '';
  return `<span class="badge ${cls}">${s}</span>`;
}

function todoPriorityBadge(priority) {
  const value = priority || 'Medium';
  return `<span class="badge priority-${escapeAttr(value.toLowerCase())}">${escapeHtml(value)}</span>`;
}

async function renderTodos() {
  state.editingTodo = state.editingTodo || null;
  const [{ todos }, { settings }] = await Promise.all([api('/api/todos'), api('/api/settings')]);

  const configuredCategories = settings.todoCategories?.length ? settings.todoCategories : TODO_CATEGORIES.map((name) => ({ id: name, name, active: true }));
  const configuredPriorities = settings.todoPriorities?.length ? settings.todoPriorities : TODO_PRIORITIES.map((name) => ({ id: name, name, active: true }));
  const priorityRank = buildPriorityRank(configuredPriorities);

  const editingCategory = state.editingTodo?.category;
  const editingPriority = state.editingTodo?.priority;
  // Filter dropdowns show every configured value (active or not) so an
  // existing item using a since-retired one is still filterable; the
  // add/edit form's pickers are active-only, plus whatever value the item
  // being edited already has -- same reasoning as In-House Filament's
  // brand pickers above.
  const allCategoryNames = configuredCategories.map((c) => c.name);
  const activeCategoryNames = configuredCategories.filter((c) => c.active).map((c) => c.name);
  if (editingCategory && !activeCategoryNames.includes(editingCategory)) activeCategoryNames.push(editingCategory);
  const activePriorityNames = configuredPriorities.filter((p) => p.active).map((p) => p.name);
  if (editingPriority && !activePriorityNames.includes(editingPriority)) activePriorityNames.push(editingPriority);

  const filteredTodos = sortTodos(filterTodos(todos), priorityRank);

  const sortHeader = (key, label) => {
    const active = state.todoSort.key === key;
    const arrow = active ? (state.todoSort.dir === 'desc' ? '▼' : '▲') : '';
    return `<th data-sort="${escapeAttr(key)}" class="${active ? 'sort-active' : ''}">${escapeHtml(label)}${arrow ? ` <span class="sort-arrow">${arrow}</span>` : ''}</th>`;
  };

  const rows = filteredTodos
    .map((t) => {
      const expanded = state.todoExpandedIds.has(t.id);
      return `
        <tr data-id="${escapeAttr(t.id)}" class="${expanded ? 'desc-expanded' : ''}">
          <td style="width: 40px; text-align: center;">${escapeHtml(String(t.number))}</td>
          <td style="width: 90px;">${escapeHtml(t.category)}</td>
          <td style="width: 95px;">${escapeHtml(formatDate(t.dateAdded))}</td>
          <td>${escapeHtml(t.name)}</td>
          <td class="todo-desc-cell" data-action="toggle-desc" title="Click to ${expanded ? 'collapse' : 'expand'}"><span class="todo-desc-text">${escapeHtml(t.description || '—')}</span></td>
          <td style="width: 80px;">${todoPriorityBadge(t.priority)}</td>
          <td style="width: 115px;">${t.plannedFixDate ? escapeHtml(formatDate(t.plannedFixDate)) : '—'}</td>
          <td style="width: 140px;"><input class="todo-inline-control todo-inline-date" data-action="actual-fix-date" type="date" aria-label="Actual Fix Date for ${escapeAttr(t.name)}" value="${escapeAttr(toDateInputValue(t.actualFixDate))}" /></td>
          <td style="width: 130px;"><select class="todo-inline-control" data-action="status" aria-label="Status for ${escapeAttr(t.name)}">${TODO_STATUSES.map((status) => `<option value="${escapeAttr(status)}" ${t.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select></td>
          <td class="muted" style="width: 90px;">${escapeHtml(t.createdBy || '—')}</td>
          <td><button class="btn small" data-action="edit" type="button">Edit</button></td>
        </tr>`;
    })
    .join('');

  const form = state.editingTodo;
  $('#view-todos').innerHTML = `
    <div class="toolbar todo-toolbar">
      <button class="btn btn-primary" id="new-todo" type="button">+ Add Item</button>
      <input id="todo-filter-q" type="search" placeholder="Search name or description…" value="${escapeAttr(state.todoFilters.q)}" />
      <select id="todo-filter-category">
        <option value="">All categories</option>
        ${allCategoryNames.map((category) => `<option value="${escapeAttr(category)}" ${state.todoFilters.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}
      </select>
      <select id="todo-filter-status">
        <option value="">All statuses</option>
        ${TODO_STATUSES.map((status) => `<option value="${escapeAttr(status)}" ${state.todoFilters.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
      </select>
      <label class="field todo-filter-date"><span>Planned Fix Date</span><input id="todo-filter-planned" type="date" value="${escapeAttr(state.todoFilters.plannedFixDate)}" /></label>
      <button class="btn small" id="clear-todo-filters" type="button">Clear filters</button>
      <span class="muted">${escapeHtml(String(filteredTodos.length))} of ${escapeHtml(String(todos.length))} item(s)</span>
    </div>
    <p class="muted" style="margin: -0.5rem 0 1rem; font-size: 0.85rem;">
      Tasks, ideas, and gaps identified during development -- manually added/edited here, no delete (a stale or duplicate item gets marked "Won't Fix" instead, so this stays a complete record).
    </p>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:640px">
        <div class="section-head"><h3>${form.id ? `Edit item` : 'New item'}</h3></div>
        <div class="grid-3">
          <label class="field"><span>Category</span>
            <select id="td-category">
              ${activeCategoryNames.map((c) => `<option value="${escapeAttr(c)}" ${form.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Status</span>
            <select id="td-status">
              ${TODO_STATUSES.map((s) => `<option value="${escapeAttr(s)}" ${form.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Priority</span>
            <select id="td-priority">
              ${activePriorityNames.map((priority) => `<option value="${escapeAttr(priority)}" ${(form.priority || 'Medium') === priority ? 'selected' : ''}>${escapeHtml(priority)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field"><span>Name</span><input id="td-name" value="${escapeAttr(form.name)}" /></label>
        <label class="field"><span>Description / Detail</span><textarea id="td-description" rows="4">${escapeHtml(form.description)}</textarea></label>
        <div class="grid-3">
          <label class="field"><span>Planned Fix Date</span><input id="td-planned" type="date" value="${escapeAttr(toDateInputValue(form.plannedFixDate))}" /></label>
          <label class="field"><span>Actual Fix Date</span><input id="td-actual" type="date" value="${escapeAttr(toDateInputValue(form.actualFixDate))}" /></label>
        </div>
        <p class="muted" style="font-size: 0.8rem;">Setting Status to "Done" auto-fills today's date here if left blank.</p>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-todo" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-todo" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap todo-table-wrap">
      <table class="catalog todo-table">
        <thead><tr>
          <th>No</th>
          ${sortHeader('category', 'Category')}
          ${sortHeader('dateAdded', 'Date Added')}
          <th>Name</th>
          <th>Description</th>
          ${sortHeader('priority', 'Priority')}
          ${sortHeader('plannedFixDate', 'Planned Fix Date')}
          ${sortHeader('actualFixDate', 'Actual Fix Date')}
          ${sortHeader('status', 'Status')}
          <th>Logged by</th>
          <th></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="10"><div class="empty">No items match your filters</div></td></tr>'}</tbody>
      </table>
    </div>`;

  const applyTodoFilters = async () => {
    state.todoFilters.q = $('#todo-filter-q').value.trim();
    state.todoFilters.category = $('#todo-filter-category').value;
    state.todoFilters.status = $('#todo-filter-status').value;
    state.todoFilters.plannedFixDate = $('#todo-filter-planned').value;
    await renderTodos();
  };

  $('#todo-filter-q').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyTodoFilters();
  });
  $('#todo-filter-category').addEventListener('change', applyTodoFilters);
  $('#todo-filter-status').addEventListener('change', applyTodoFilters);
  $('#todo-filter-planned').addEventListener('change', applyTodoFilters);
  $('#clear-todo-filters').addEventListener('click', async () => {
    state.todoFilters = { q: '', category: '', status: '', plannedFixDate: '' };
    await renderTodos();
  });

  const saveInlineTodo = async (id, payload) => {
    try {
      await api(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Saved');
      await renderTodos();
    } catch (ex) {
      toast(ex.message);
    }
  };

  $$('#view-todos th[data-sort]').forEach((th) => {
    th.addEventListener('click', async () => {
      const key = th.dataset.sort;
      if (state.todoSort.key === key) state.todoSort.dir = state.todoSort.dir === 'asc' ? 'desc' : 'asc';
      else state.todoSort = { key, dir: 'asc' };
      await renderTodos();
    });
  });

  // Toggles a class directly rather than going through renderTodos() --
  // expanding a description is a pure display change, not data that needs
  // saving, so it shouldn't cost a full table re-render (loses scroll
  // position) or an API round-trip. state.todoExpandedIds is still updated
  // so the expanded set survives whatever OTHER action does trigger a
  // re-render (a status change, a sort click, etc).
  $$('#view-todos [data-action="toggle-desc"]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const tr = cell.closest('tr');
      const id = tr.dataset.id;
      const nowExpanded = tr.classList.toggle('desc-expanded');
      if (nowExpanded) state.todoExpandedIds.add(id);
      else state.todoExpandedIds.delete(id);
      cell.title = `Click to ${nowExpanded ? 'collapse' : 'expand'}`;
    });
  });

  $$('#view-todos [data-action="status"]').forEach((select) => {
    select.addEventListener('change', () => saveInlineTodo(select.closest('tr').dataset.id, { status: select.value }));
  });
  $$('#view-todos [data-action="actual-fix-date"]').forEach((input) => {
    input.addEventListener('change', () => saveInlineTodo(input.closest('tr').dataset.id, { actualFixDate: input.value || null }));
  });

  $('#new-todo').addEventListener('click', async () => { state.editingTodo = blankTodo(); await renderTodos(); });
  $$('#view-todos tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const t = todos.find((x) => x.id === tr.dataset.id);
      state.editingTodo = { ...t };
      await renderTodos();
    });
  });

  if (form) {
    $('#cancel-todo').addEventListener('click', async () => { state.editingTodo = null; await renderTodos(); });
    $('#save-todo').addEventListener('click', async () => {
      const payload = {
        category: $('#td-category').value,
        status: $('#td-status').value,
        priority: $('#td-priority').value,
        name: $('#td-name').value,
        description: $('#td-description').value,
        plannedFixDate: $('#td-planned').value || null,
        actualFixDate: $('#td-actual').value || null,
      };
      try {
        if (form.id) await api(`/api/todos/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/todos', { method: 'POST', body: JSON.stringify(payload) });
        toast('Saved');
        state.editingTodo = null;
        await renderTodos();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

// ---- Audit Logs (Settings) ----

// Grouped (not a flat object) so the filter dropdown below can render
// optgroups -- with 16 event types spanning auth/actions/security, a flat
// alphabetical list would be a lot to scan for "just show me the security
// stuff". The flat AUDIT_EVENT_LABEL lookup and DRAFT_EVENT_TYPES set below
// are both derived from this so there's exactly one place to add a new type.
const AUDIT_EVENT_GROUPS = [
  {
    label: 'Auth & sessions',
    events: {
      setup: 'Initial setup',
      login_success: 'Login',
      login_failure: 'Login failed',
      logout: 'Logout',
      session_expired: 'Session expired',
      admin_created: 'Admin created',
      admin_deleted: 'Admin deleted',
      password_reset: 'Password reset',
      email_failure: 'Email send failed',
    },
  },
  {
    label: 'Actions',
    events: {
      order_updated: 'Order updated',
      stock_updated: 'Stock/pricing updated',
      catalog_updated: 'Catalog updated',
      settings_updated: 'Settings updated',
      marketing_updated: 'Newsletter updated',
    },
  },
  {
    label: 'Security',
    events: {
      client_login_failure: 'Customer login failed',
      rate_limit_exceeded: 'Rate limit hit',
      unauthorized_access: 'Unauthorized access attempt',
    },
  },
];
const AUDIT_EVENT_LABEL = Object.fromEntries(AUDIT_EVENT_GROUPS.flatMap((g) => Object.entries(g.events)));
// Amber/"needs a look" styling -- failures, security signals, and account
// removals. Everything else (successful logins, the four Actions types)
// reads as a routine, successful event.
const DRAFT_EVENT_TYPES = new Set([
  'login_failure', 'admin_deleted', 'password_reset', 'session_expired', 'email_failure',
  'client_login_failure', 'rate_limit_exceeded', 'unauthorized_access',
]);

function auditEventBadge(eventType) {
  const cls = DRAFT_EVENT_TYPES.has(eventType) ? 'draft' : 'published';
  return `<span class="badge ${cls}">${escapeHtml(AUDIT_EVENT_LABEL[eventType] || eventType)}</span>`;
}

async function renderAuditLog() {
  state.auditEventFilter = state.auditEventFilter || '';
  state.auditQ = state.auditQ || '';

  const params = new URLSearchParams();
  if (state.auditEventFilter) params.set('eventType', state.auditEventFilter);
  if (state.auditQ.trim()) params.set('q', state.auditQ.trim());
  const { entries } = await api(`/api/audit-log${params.toString() ? `?${params}` : ''}`);

  const rows = entries
    .map(
      (e) => `
        <tr>
          <td style="white-space:nowrap">${escapeHtml(formatDate(e.createdAt))}</td>
          <td>${auditEventBadge(e.eventType)}</td>
          <td>${escapeHtml(e.username || '—')}</td>
          <td><code>${escapeHtml(e.ipAddress || '—')}</code></td>
          <td class="muted" style="font-size:0.8rem;max-width:280px" title="${escapeAttr(e.userAgent || '')}">${escapeHtml(e.userAgent || '—')}</td>
          <td class="muted" style="font-size:0.85rem">${escapeHtml(e.detail || '—')}</td>
        </tr>`,
    )
    .join('');

  $('#view-audit-log').innerHTML = `
    <div class="toolbar">
      <input id="audit-q" type="search" placeholder="Search username, IP, detail…" value="${escapeAttr(state.auditQ)}" />
      <select id="audit-event-filter">
        <option value="">All events</option>
        ${AUDIT_EVENT_GROUPS.map((g) => `
          <optgroup label="${escapeAttr(g.label)}">
            ${Object.entries(g.events).map(([value, label]) => `<option value="${escapeAttr(value)}" ${state.auditEventFilter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </optgroup>`).join('')}
      </select>
      <span class="muted">${escapeHtml(String(entries.length))} entr${entries.length === 1 ? 'y' : 'ies'}</span>
    </div>
    <p class="muted" style="margin: -0.5rem 0 1rem; font-size: 0.85rem;">
      Auth &amp; sessions (login/logout/admin-account changes) plus Actions (order/stock/catalog/settings changes) and Security signals (customer login failures, rate-limit hits, unauthenticated admin-route access) -- append-only, newest first, most recent 500 shown. Older than 12 months is pruned automatically.
    </p>
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Time</th><th>Event</th><th>Admin</th><th>IP</th><th>User agent</th><th>Detail</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty">No audit events yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#audit-q').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    state.auditQ = $('#audit-q').value.trim();
    await renderAuditLog();
  });
  $('#audit-event-filter').addEventListener('change', async () => {
    state.auditEventFilter = $('#audit-event-filter').value;
    await renderAuditLog();
  });
}

// Backlog #120: on/off + threshold controls for server/alerts.js. Deliberately
// plain data-setting scalar fields (checkboxes/inputs), same collector as
// every other Settings field -- saves via the page's one "Save settings"
// button, no dedicated wiring needed.
function operationalAlertsPanel(s) {
  return `
    <div class="panel stack gap-3">
      <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Automatic alerts for system problems (backup, payment, checkout failures) -- distinct from the customer/owner business-event emails above. Email alerts go to the "Order &amp; Design-request Notification Email" set above under Invoicing &amp; Bank Details.</p>

      <label class="field checkbox"><input type="checkbox" data-setting="alertBackupFailureEnabled" ${s.alertBackupFailureEnabled ? 'checked' : ''} /><span>Email me if a scheduled backup (local or offsite sync) fails</span></label>
      <label class="field checkbox"><input type="checkbox" data-setting="alertPaymentFailureEnabled" ${s.alertPaymentFailureEnabled ? 'checked' : ''} /><span>Email me if a Payfast payment notification (ITN) fails validation or references an unknown order</span></label>
      <label class="field checkbox"><input type="checkbox" data-setting="alertCheckoutErrorEnabled" ${s.alertCheckoutErrorEnabled ? 'checked' : ''} /><span>Email me on an unexpected checkout error (not normal rejections like out-of-stock or empty cart)</span></label>

      <div class="stack gap-2" style="padding-top:8px;border-top:1px solid var(--border)">
        <strong style="font-size:0.92rem">Email-delivery-down fallback (WhatsApp)</strong>
        <p class="muted" style="margin:0;font-size:0.85rem;line-height:1.5">If Gmail itself stops sending, an email alert about that can't reach you -- this falls back to a WhatsApp message once several sends fail within an hour. Requires a WhatsApp message template approved in Meta Business Manager (free text isn't allowed for business-initiated messages) and the server's WhatsApp API credentials configured -- until both exist, this silently no-ops (logs to the server only).</p>
        <label class="field checkbox"><input type="checkbox" data-setting="alertEmailFallbackEnabled" ${s.alertEmailFallbackEnabled ? 'checked' : ''} /><span>Enable WhatsApp fallback</span></label>
        <div class="grid-2">
          <label class="field"><span>Failures Before Fallback Fires</span><input data-setting="alertEmailFallbackThreshold" type="number" min="1" step="1" value="${escapeAttr(String(s.alertEmailFallbackThreshold ?? 3))}" /></label>
          <label class="field"><span>Your WhatsApp Number</span><input data-setting="alertEmailFallbackWhatsappNumber" placeholder="27821234567" value="${escapeAttr(s.alertEmailFallbackWhatsappNumber || '')}" /></label>
        </div>
        <label class="field"><span>Approved Meta Template Name</span><input data-setting="alertEmailFallbackWhatsappTemplateName" placeholder="e.g. system_alert" value="${escapeAttr(s.alertEmailFallbackWhatsappTemplateName || '')}" /></label>
      </div>

      <div class="stack gap-2" style="padding-top:8px;border-top:1px solid var(--border)">
        <strong style="font-size:0.92rem">Security signal spike</strong>
        <p class="muted" style="margin:0;font-size:0.85rem;line-height:1.5">A single failed login or rate-limit hit is normal background noise. A burst of them in a short window is worth a look.</p>
        <label class="field checkbox"><input type="checkbox" data-setting="alertSecuritySpikeEnabled" ${s.alertSecuritySpikeEnabled ? 'checked' : ''} /><span>Email me on a security-signal burst</span></label>
        <div class="grid-2">
          <label class="field"><span>Events To Trigger</span><input data-setting="alertSecuritySpikeThreshold" type="number" min="1" step="1" value="${escapeAttr(String(s.alertSecuritySpikeThreshold ?? 10))}" /></label>
          <label class="field"><span>Within (Minutes)</span><input data-setting="alertSecuritySpikeWindowMinutes" type="number" min="1" step="1" value="${escapeAttr(String(s.alertSecuritySpikeWindowMinutes ?? 15))}" /></label>
        </div>
      </div>
    </div>`;
}

// Subject/message for every branded transactional email server/mailer.js
// sends (see its per-function comments for the authoritative token list --
// kept in sync here). Structural HTML (buttons, order tables, security
// disclaimers) is code-controlled, not editable here, on purpose.
// Owner request (2026-09-02): Communications gets the Product Catalog
// treatment -- templates grouped into collapsible sections (customer vs
// owner mail), one collapsible card per template with a subject preview in
// its summary, a "when it sends" line, and clickable token chips that
// insert at the cursor.
const EMAIL_TEMPLATE_META = [
  { key: 'orderConfirmation', label: 'Order confirmation', group: 'customer', when: 'Sent the moment an order is placed.', tokens: ['{{name}}', '{{orderRef}}'] },
  { key: 'orderShipped', label: 'Order shipped', group: 'customer', when: 'Sent the first time a tracking number is set on an order.', tokens: ['{{name}}', '{{orderRef}}', '{{trackingNumber}}'] },
  { key: 'restockAlert', label: 'Back-in-stock alert', group: 'customer', when: 'Sent to waiting subscribers when an out-of-stock product is restocked.', tokens: ['{{productName}}'] },
  { key: 'designRequestReceived', label: 'Design request received', group: 'customer', when: 'Acknowledgement with the status-tracking link, sent on every design request.', tokens: ['{{name}}'] },
  { key: 'designRequestQuoted', label: 'Design request quoted', group: 'customer', when: 'Sent when you save & email a quote — carries the accept-and-pay link.', tokens: ['{{name}}', '{{amount}}'] },
  { key: 'designRequestStatus', label: 'Design request status change', group: 'customer', when: 'Sent whenever you change a design request\u2019s status.', tokens: ['{{name}}', '{{status}}'] },
  { key: 'passwordReset', label: 'Password reset', group: 'customer', when: 'Sent when a customer asks to reset their password.', tokens: ['{{name}}'] },
  { key: 'emailVerification', label: 'Verify email', group: 'customer', when: 'Sent after registration to confirm the address.', tokens: ['{{name}}'] },
  { key: 'newsletterConfirm', label: 'Newsletter confirmation', group: 'customer', when: 'Sent when someone subscribes to the newsletter.', tokens: [] },
  { key: 'newOrderNotification', label: 'New order', group: 'owner', when: 'Sent to you when an order comes in.', tokens: ['{{orderRef}}', '{{total}}', '{{clientName}}', '{{clientEmail}}', '{{paymentMethod}}', '{{itemCount}}'] },
  { key: 'orderCancelledNotification', label: 'Order cancelled', group: 'owner', when: 'Sent to you when an order is cancelled.', tokens: ['{{orderRef}}', '{{total}}', '{{clientName}}', '{{clientEmail}}', '{{reason}}'] },
  { key: 'newDesignRequestNotification', label: 'New design request', group: 'owner', when: 'Sent to you when a design request arrives.', tokens: ['{{name}}', '{{email}}', '{{phone}}'] },
  { key: 'lowStockAlert', label: 'Low stock alert', group: 'owner', when: 'Sent to you when an item falls to the low-stock threshold.', tokens: ['{{itemName}}', '{{stockQty}}', '{{sku}}'] },
];

// Panel content saves via the page's main "Save settings" button (like
// homeTiles) rather than saving itself immediately (like configurableListPanel
// below) -- editing several templates' wording in one sitting shouldn't mean
// several separate round-trips.
function communicationsTemplateCard(meta, entry) {
  const chips = meta.tokens.length
    ? `<div class="comm-chips">${meta.tokens.map((tok) => `<button type="button" class="comm-chip" data-comm-token="${escapeAttr(tok)}" data-comm-target="${escapeAttr(meta.key)}" title="Insert ${escapeAttr(tok)} at the cursor">${escapeHtml(tok)}</button>`).join('')}<span class="muted" style="font-size:0.75rem;align-self:center">click to insert</span></div>`
    : '<p class="muted" style="margin:0;font-size:0.78rem">No placeholders for this email.</p>';
  return `
    <details class="comm-template">
      <summary>
        <span class="comm-name">${escapeHtml(meta.label)}</span>
        <span class="muted comm-subject-preview">${escapeHtml(entry.subject || 'No subject set')}</span>
      </summary>
      <div class="stack gap-2" style="padding:0.75rem 0.9rem 0.9rem">
        <p class="muted" style="margin:0;font-size:0.82rem">${escapeHtml(meta.when)}</p>
        <label class="field"><span>Subject</span><input data-email-template="${escapeAttr(meta.key)}" data-email-template-field="subject" value="${escapeAttr(entry.subject || '')}" /></label>
        <label class="field"><span>Message</span><textarea data-email-template="${escapeAttr(meta.key)}" data-email-template-field="message" rows="5">${escapeHtml(entry.message || '')}</textarea></label>
        ${chips}
      </div>
    </details>`;
}

function communicationsPanel(templates) {
  const t = templates || {};
  const groupHtml = (groupKey, heading, note) => {
    const cards = EMAIL_TEMPLATE_META.filter((m) => m.group === groupKey)
      .map((m) => communicationsTemplateCard(m, t[m.key] || {}))
      .join('');
    return `
      <details class="stock-section" open>
        <summary>${escapeHtml(heading)} <span class="muted">(${EMAIL_TEMPLATE_META.filter((m) => m.group === groupKey).length})</span></summary>
        <p class="muted" style="margin:0.4rem 0 0.6rem;font-size:0.82rem">${escapeHtml(note)}</p>
        <div class="stack gap-2">${cards}</div>
      </details>`;
  };
  return `
    <div class="panel stack gap-3">
      <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Subject and message copy for every automated email. Structural parts (buttons, links, order details, the reset-link expiry notice) always stay in place — only the wording here is editable, so a save here can't drop a link or a security notice. Open a card to edit; the grey text next to each name is its current subject line.</p>
      ${groupHtml('customer', 'Customer Emails', 'What your customers receive. Placeholders like {{name}} are replaced with the real value when the email sends.')}
      ${groupHtml('owner', 'Notifications to You', 'Operational alerts sent to the order-notification address in Storefront settings.')}
    </div>`;
}

// Shared UI for every admin-editable {id,name,active}[] setting (in-house
// filament brands, todo categories/priorities). Each panel saves itself
// immediately on toggle/add -- independent of the page's big "Save
// settings" button, which only covers the plain scalar fields above it.
// Slugifying the new-item id client-side is cosmetic (the server backfills
// one regardless, see PUT /api/settings) -- doing it here just means the
// id looks sensible immediately, before the round-trip.
function slugifyListId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function configurableListPanel(key, label, items, helpText = '') {
  const rows = (items || [])
    .map(
      (item) => `
        <div class="config-list-row" data-item-id="${escapeAttr(item.id)}">
          <label class="field checkbox config-list-active" title="${item.active ? 'Active — click to retire' : 'Inactive — click to reactivate'}">
            <input type="checkbox" data-action="toggle-active" ${item.active ? 'checked' : ''} />
          </label>
          <span class="config-list-name">${escapeHtml(item.name)}</span>
          ${item.active ? '' : '<span class="badge draft">Inactive</span>'}
        </div>`,
    )
    .join('');
  return `
    <div class="panel stack gap-3 config-list-panel" data-list-key="${escapeAttr(key)}">
      ${helpText ? `<p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">${helpText}</p>` : ''}
      <div class="config-list">${rows || '<p class="muted" style="margin:0">No items yet.</p>'}</div>
      <div class="row-card-actions">
        <input type="text" class="config-list-new-input" placeholder="Add new…" />
        <button class="btn small" data-action="add-list-item" type="button">+ Add</button>
      </div>
    </div>`;
}

function wireConfigurableListPanels() {
  const saveList = async (key, items) => {
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ [key]: items }) });
      toast(res.publishWarning || 'Saved');
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
    }
  };

  $$('#view-settings .config-list-panel').forEach((panel) => {
    const key = panel.dataset.listKey;
    panel.querySelectorAll('[data-action="toggle-active"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.closest('[data-item-id]').dataset.itemId;
        const items = (state.settings[key] || []).map((item) => (item.id === id ? { ...item, active: cb.checked } : item));
        saveList(key, items);
      });
    });
    const input = panel.querySelector('.config-list-new-input');
    const addItem = () => {
      const name = input.value.trim();
      if (!name) return;
      const existing = state.settings[key] || [];
      const id = slugifyListId(name) || `item-${existing.length}`;
      saveList(key, [...existing, { id, name, active: true }]);
    };
    panel.querySelector('[data-action="add-list-item"]').addEventListener('click', addItem);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addItem();
    });
  });
}

// #95: shared drag-reorder gallery panel for both filament colours and
// category items -- `kind` is 'colour' or 'item', used to build distinct
// data-attributes so two panels on the same page never collide, and to
// pick the right upload/delete/reorder endpoint in wireGalleryPanel below.
// I1: `legacyImage` is the owning colour/item's pre-gallery single photo
// (colour.imagePath / item.imageUrl) -- rendered read-only, ONLY when the
// real gallery array is empty, so the ~208 items/110 colours that predate
// this feature don't show a false "no photos" here while their legacy photo
// is still live on the storefront (colourGalleryPaths()/itemGalleryPaths()
// fall back to this exact field the same way -- this mirrors that check).
// It intentionally does NOT get the .gallery-thumb class, draggable
// attribute, data-gallery-image-id/-index, or a remove button: it is not
// wired to wireGalleryPanel's remove/reorder handlers below at all, because
// removeItemImage/removeColourImage filter the real images array (which
// never contains this synthesized entry) -- a wired × here would silently
// no-op that array update while the DELETE route still deleted the file
// from disk, destroying the live photo.
function galleryPanelHtml(kind, ownerId, images, legacyImage) {
  const thumbs = images
    .map(
      (img, i) => `
        <div class="gallery-thumb" draggable="true" data-gallery-image-id="${escapeAttr(img.id || img)}" data-gallery-index="${i}">
          <img src="${escapeAttr(img.imagePath || img)}" alt="" />
          <button class="gallery-thumb-remove" data-gallery-remove="${escapeAttr(img.id || img)}" type="button" title="Remove">&times;</button>
        </div>`,
    )
    .join('');
  const showLegacy = !images.length && legacyImage;
  const legacyThumb = showLegacy
    ? `<div class="gallery-thumb-legacy" title="Legacy photo — upload a new photo to replace">
        <img src="${escapeAttr(legacyImage)}" alt="Legacy photo" />
        <span class="gallery-thumb-legacy-badge">Legacy</span>
      </div>`
    : '';
  const canAddMore = images.length < 5;
  return `
    <div class="gallery-panel" data-gallery-kind="${kind}" data-gallery-owner="${escapeAttr(ownerId)}">
      <div class="gallery-thumbs">${legacyThumb}${thumbs}</div>
      ${showLegacy ? '<p class="muted" style="font-size:0.72rem;margin:0">Legacy photo — upload a new photo to replace</p>' : ''}
      ${canAddMore
        ? `<button class="btn small" data-action="trigger-gallery-add" data-gallery-owner="${escapeAttr(ownerId)}" type="button">+ Add photo (${images.length}/5)</button>
           <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" data-gallery-add="${escapeAttr(ownerId)}" />`
        : '<span class="muted" style="font-size:0.78rem">5/5 photos</span>'}
    </div>`;
}

// One call wires exactly ONE panel (identified by kind+ownerId), not every
// panel on the page -- callers loop over their own rows and call this once
// per already-persisted row (see Task 5 Step 4 / Task 6 Step 2).
function wireGalleryPanel(kind, ownerId, ownerContext, onUpdated) {
  const panel = document.querySelector(`.gallery-panel[data-gallery-kind="${kind}"][data-gallery-owner="${ownerId}"]`);
  if (!panel) return;
  const basePath = kind === 'colour'
    ? `/api/filaments/${ownerContext.filamentId}/colours/${ownerId}/images`
    : `/api/products/${ownerContext.productId}/items/${ownerId}/images`;

  panel.querySelector('[data-action="trigger-gallery-add"]')?.addEventListener('click', () => {
    $(`[data-gallery-add="${ownerId}"]`)?.click();
  });

  $(`[data-gallery-add="${ownerId}"]`)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const data = await uploadFormData(basePath, formData);
      toast('Photo added');
      onUpdated(data.images);
    } catch (ex) {
      toast(ex.message);
    }
  });

  panel.querySelectorAll('[data-gallery-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const imageId = btn.dataset.galleryRemove;
      try {
        const res = kind === 'colour'
          ? await api(`${basePath}/${imageId}`, { method: 'DELETE' })
          : await api(basePath, { method: 'DELETE', body: JSON.stringify({ imagePath: imageId }) });
        toast('Photo removed');
        onUpdated(res.images);
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  // Native HTML5 drag-and-drop reorder -- no library. Dropping a thumb onto
  // another thumb's position swaps it there and immediately PUTs the new
  // order (matches this admin's existing "no separate Save step"
  // convention for other reorderable lists, e.g. the deposit-tier panel).
  let dragSourceIndex = null;
  panel.querySelectorAll('.gallery-thumb').forEach((thumb) => {
    thumb.addEventListener('dragstart', (e) => {
      dragSourceIndex = Number(thumb.dataset.galleryIndex);
      // Some browsers (historically Firefox) require at least one
      // setData() call in dragstart for the drag to actually initiate --
      // without it, drop can silently never fire.
      e.dataTransfer.setData('text/plain', thumb.dataset.galleryImageId);
    });
    thumb.addEventListener('dragover', (e) => e.preventDefault());
    thumb.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetIndex = Number(thumb.dataset.galleryIndex);
      if (dragSourceIndex === null || dragSourceIndex === targetIndex) return;
      const thumbs = [...panel.querySelectorAll('.gallery-thumb')];
      const ids = thumbs.map((t) => t.dataset.galleryImageId);
      const [moved] = ids.splice(dragSourceIndex, 1);
      // Insert at the target's slot, regardless of drag direction -- without
      // this adjustment, splice() lands the moved item AFTER the target when
      // dragging forward but BEFORE it when dragging backward (same "drop
      // onto this thumb" gesture, opposite result depending on direction).
      const insertIndex = dragSourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      ids.splice(insertIndex, 0, moved);
      try {
        const res = await api(`${basePath}/reorder`, { method: 'PUT', body: JSON.stringify({ order: ids }) });
        onUpdated(res.images);
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

// #94: same shape and UX as configurableListPanel above, but entries are
// {id,pct,active} -- whole-number percentages, not free-text names -- so it
// gets its own small panel + numeric input instead of reusing that one.
// Picked per-quote on the Design Requests form (quoteDepositPct is locked
// onto the request at quote time); this list is only the menu offered.
function depositTierPanel(items) {
  const sorted = [...(items || [])].sort((a, b) => a.pct - b.pct);
  const rows = sorted
    .map(
      (item) => `
        <div class="config-list-row" data-item-id="${escapeAttr(item.id)}">
          <label class="field checkbox config-list-active" title="${item.active ? 'Active — click to retire' : 'Inactive — click to reactivate'}">
            <input type="checkbox" data-action="toggle-active" ${item.active ? 'checked' : ''} />
          </label>
          <span class="config-list-name">${escapeHtml(String(item.pct))}%</span>
          ${item.active ? '' : '<span class="badge draft">Inactive</span>'}
        </div>`,
    )
    .join('');
  return `
    <div class="panel stack gap-3" id="deposit-tier-panel">
      <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">The deposit percentages an admin can offer when quoting a design request (100 = full payment). Picked per quote, not sitewide — retiring a tier here only stops it appearing on NEW quotes; requests already quoted under it are unaffected.</p>
      <div class="config-list">${rows || '<p class="muted" style="margin:0">No tiers yet.</p>'}</div>
      <div class="row-card-actions">
        <input type="number" id="deposit-tier-new-input" min="1" max="100" step="1" placeholder="e.g. 40" style="max-width:120px" />
        <button class="btn small" id="deposit-tier-add" type="button">+ Add</button>
      </div>
    </div>`;
}

function wireDepositTierPanel() {
  const panel = $('#deposit-tier-panel');
  if (!panel) return;
  const saveTiers = async (items) => {
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ quoteDepositOptions: items }) });
      toast(res.publishWarning || 'Saved');
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
    }
  };
  panel.querySelectorAll('[data-action="toggle-active"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.closest('[data-item-id]').dataset.itemId;
      const items = (state.settings.quoteDepositOptions || []).map((t) => (t.id === id ? { ...t, active: cb.checked } : t));
      saveTiers(items);
    });
  });
  const input = $('#deposit-tier-new-input');
  const addTier = () => {
    const pct = Math.round(Number(input.value));
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) return toast('Enter a whole number between 1 and 100');
    const existing = state.settings.quoteDepositOptions || [];
    if (existing.some((t) => t.pct === pct)) return toast(`${pct}% is already a tier`);
    saveTiers([...existing, { id: String(pct), pct, active: true }]);
  };
  $('#deposit-tier-add').addEventListener('click', addTier);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addTier();
  });
}

// Unlike the {id,name,active} lists above, an entry here stores a
// productId (same scheme the cart uses -- filament:{slug}:{sku} /
// category:{slug}:{sku}), not a typed name -- server/export.js resolves the
// real name/price fresh on every publish, so this admin view resolves the
// same way against state.productCatalog (the /api/inventory list New Order
// already loads) purely for display, never persisting the resolved values.
function featuredProductsPanel(items) {
  const list = items || [];
  const search = state.featuredSearch || { query: '', matches: [] };
  const matchesHtml = search.matches
    .map(
      (p) => `
        <div class="row-card-actions" data-product-id="${escapeAttr(p.productId)}">
          <span>${escapeHtml(p.name)} <span class="muted">${escapeHtml(p.sku || '')}</span> — ${escapeHtml(formatRand(p.price))}</span>
          <button class="btn small" data-action="add-featured" type="button">+ Add</button>
        </div>`,
    )
    .join('');
  const rows = list
    .map((entry) => {
      const product = state.productCatalog.find((p) => p.productId === entry.productId);
      const label = product ? `${product.name} — ${formatRand(product.price)}` : `⚠ Product no longer exists (${entry.productId})`;
      return `
        <div class="config-list-row" data-item-id="${escapeAttr(entry.id)}">
          <label class="field checkbox config-list-active" title="${entry.active ? 'Active — click to retire' : 'Inactive — click to reactivate'}">
            <input type="checkbox" data-action="toggle-featured-active" ${entry.active ? 'checked' : ''} />
          </label>
          <span class="config-list-name">${escapeHtml(label)}</span>
          ${entry.active ? '' : '<span class="badge draft">Inactive</span>'}
          <button class="btn small btn-danger" data-action="remove-featured" type="button">Remove</button>
        </div>`;
    })
    .join('');
  const activeCount = list.filter((e) => e.active !== false).length;
  return `
    <div class="panel stack gap-3" id="featured-products-panel">
      <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Pick 4–6 products to feature on the homepage. Name and price are pulled live from the catalog on every publish, so a price change here never goes stale on the homepage.</p>
      <input type="text" id="featured-search-input" placeholder="Search products by name or SKU… (Enter to search)" value="${escapeAttr(search.query)}" />
      ${matchesHtml ? `<div class="config-list">${matchesHtml}</div>` : ''}
      <div class="config-list">${rows || '<p class="muted" style="margin:0">No featured products yet.</p>'}</div>
      <p class="muted" style="margin:0;font-size:0.8rem">${escapeHtml(String(activeCount))} active${activeCount < 4 || activeCount > 6 ? ' — aim for 4–6' : ''}</p>
    </div>`;
}

function wireFeaturedProductsPanel() {
  const panel = $('#featured-products-panel');
  if (!panel) return;

  const saveFeatured = async (items) => {
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ featuredProducts: items }) });
      toast(res.publishWarning || 'Saved');
      state.featuredSearch = { query: '', matches: [] };
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
    }
  };

  const searchInput = $('#featured-search-input');
  searchInput?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const q = searchInput.value.trim();
    state.featuredSearch = {
      query: q,
      matches: q ? state.productCatalog.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || '').toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [],
    };
    await renderSettings();
  });

  panel.querySelectorAll('[data-action="add-featured"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const productId = btn.closest('[data-product-id]').dataset.productId;
      const existing = state.settings.featuredProducts || [];
      if (existing.some((e) => e.productId === productId)) {
        toast('Already featured');
        return;
      }
      saveFeatured([...existing, { id: uid(), productId, active: true }]);
    });
  });

  panel.querySelectorAll('[data-action="toggle-featured-active"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.closest('[data-item-id]').dataset.itemId;
      const items = (state.settings.featuredProducts || []).map((e) => (e.id === id ? { ...e, active: cb.checked } : e));
      saveFeatured(items);
    });
  });

  panel.querySelectorAll('[data-action="remove-featured"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-item-id]').dataset.itemId;
      const items = (state.settings.featuredProducts || []).filter((e) => e.id !== id);
      saveFeatured(items);
    });
  });
}

// Every settings section, in render order -- drives both the jump-link
// menu and the collapsible <details> wrapper each section renders inside.
// Same collapsible pattern as Stock Management/Product Catalog
// (STOCK_GROUP_DEFS/CATALOG_GROUP_DEFS), reused here so all three admin
// list-shaped pages behave consistently.
const SETTINGS_SECTIONS = [
  { key: 'typography', label: 'Typography' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'homepage-tiles', label: 'Homepage Tiles' },
  { key: 'admin-accounts', label: 'Admin Accounts' },
  { key: 'public-contact', label: 'Public Site Contact' },
  { key: 'storefront-delivery', label: 'Storefront Stock & Delivery' },
  { key: 'invoicing', label: 'Invoicing & Bank Details' },
  { key: 'communications', label: 'Communications' },
  { key: 'operational-alerts', label: 'Operational Alerts' },
  { key: 'filament-brands', label: 'In-house Filament Brands' },
  { key: 'todo-categories', label: 'Todo Categories' },
  { key: 'todo-priorities', label: 'Todo Priorities' },
  { key: 'car-part-brands', label: 'Car-part Brands' },
  { key: 'car-part-models-landrover', label: 'Landrover Part Models' },
  { key: 'car-part-models-gwm', label: 'GWM Part Models' },
  { key: 'deposit-tiers', label: 'Quote Deposit Tiers' },
  { key: 'featured-products', label: 'Featured Products' },
  { key: 'print-costing', label: 'Print Job Costing Rates' },
];

function settingsSectionWrap(key, label, innerHtml) {
  const open = !state.settingsCollapsed.has(key);
  return `
    <details class="stock-section" data-group="${escapeAttr(key)}" id="settings-section-${escapeAttr(key)}" data-initial-open="${open}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(label)}</summary>
      ${innerHtml}
    </details>`;
}

function settingsJumpMenuHtml() {
  return `
    <div class="panel" style="padding:0.75rem 1rem">
      <strong style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:0.6rem">Jump to section</strong>
      <div style="display:flex;flex-wrap:wrap;gap:0.4rem">
        ${SETTINGS_SECTIONS.map((s) => `<button type="button" class="btn small btn-ghost settings-jump" data-jump="${escapeAttr(s.key)}">${escapeHtml(s.label)}</button>`).join('')}
      </div>
    </div>`;
}

// Each scoped save button reads only the [data-setting] (and any
// structured-field) inputs inside its own section container, so saving one
// section can never touch another's fields -- PUT /api/settings only
// merges the keys actually present in the request body (see server/
// settings.js), which is what makes per-section saves safe in the first
// place.
function wireScopedSettingsSave(sectionKey, buttonId, buildPatch) {
  $(`#${buttonId}`)?.addEventListener('click', async () => {
    const btn = $(`#${buttonId}`);
    const patch = buildPatch($(`#settings-section-${sectionKey}`));
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
      toast(res.publishWarning || 'Saved');
      await renderSettings();
    } catch (ex) {
      toast(ex.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function scopedSettingFieldsPatch(container) {
  const patch = {};
  container.querySelectorAll('[data-setting]').forEach((input) => {
    if (input.dataset.setting === 'adminPassword' && !input.value) return;
    if (input.type === 'checkbox') patch[input.dataset.setting] = input.checked;
    else patch[input.dataset.setting] = input.value;
  });
  return patch;
}

async function renderSettings() {
  state.settingsCollapsed = state.settingsCollapsed || new Set();
  const data = await api('/api/settings');
  state.settings = data.settings;
  // Same combined filament+category list New Order's product picker and
  // Stock Management already use (listInventory) -- reused here so the
  // Featured Products picker below can search/resolve without a separate
  // endpoint. Cached on state, same as New Order does.
  if (!state.productCatalog) {
    const { items } = await api('/api/inventory');
    state.productCatalog = items;
  }
  state.featuredSearch = state.featuredSearch || { query: '', matches: [] };
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
      ${settingsJumpMenuHtml()}
      ${settingsSectionWrap('typography', 'Typography', `
      <div class="panel stack gap-3">
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          Choose fonts for the public website. Enable <strong>universal font</strong> to use one typeface everywhere (body + headings).
        </p>
        <label class="field checkbox">
          <input data-setting="useUniversalFont" type="checkbox" ${s.useUniversalFont ? 'checked' : ''} />
          <span>Use a Universal Font Across the Whole Site</span>
        </label>
        <label class="field" id="universal-font-field">
          <span>Universal Font</span>
          <select data-setting="universalFont">${fontOptions}</select>
        </label>
        <div class="grid-2" id="split-font-fields">
          <label class="field">
            <span>Body / UI Font</span>
            <select data-setting="fontSans">${fontOptions}</select>
          </label>
          <label class="field">
            <span>Display / Heading Font</span>
            <select data-setting="fontSerif">${fontOptions}</select>
          </label>
        </div>
        <p class="hint" id="font-preview" style="font-size:1.05rem;padding:0.85rem 0 0;border-top:1px dashed var(--line)">Preview updates after save + refresh of the public site.</p>
        <div><button class="btn btn-primary" id="save-settings-typography" type="button">Save Typography</button></div>
      </div>`)}

      ${settingsSectionWrap('appearance', 'Appearance', `
      <div class="panel stack gap-3">
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          Visitors can toggle light/dark on the website. This sets the default before they choose.
        </p>
        <label class="field">
          <span>Default Theme</span>
          <select data-setting="defaultTheme">
            <option value="system" ${s.defaultTheme === 'system' ? 'selected' : ''}>Match visitor system</option>
            <option value="light" ${s.defaultTheme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.defaultTheme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
        <div><button class="btn btn-primary" id="save-settings-appearance" type="button">Save Appearance</button></div>
      </div>`)}

      ${settingsSectionWrap('homepage-tiles', 'Homepage Tiles', `
      <div class="panel stack gap-3">
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">
          The 3 "Shop the range" cards on the homepage. Colours, links and layout stay fixed — only the copy below is editable.
        </p>
        ${(s.homeTiles && s.homeTiles.length ? s.homeTiles : [{}, {}, {}]).map((t, i) => `
        <div class="stack gap-2" style="padding:0.75rem 0;border-top:1px dashed var(--line)">
          <strong style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">Tile ${i + 1}</strong>
          <div class="grid-2">
            <label class="field"><span>Eyebrow Label</span><input data-tile-index="${i}" data-tile-field="eyebrow" value="${escapeAttr(t.eyebrow || '')}" /></label>
            <label class="field"><span>Title</span><input data-tile-index="${i}" data-tile-field="title" value="${escapeAttr(t.title || '')}" /></label>
          </div>
          <label class="field"><span>Description</span><input data-tile-index="${i}" data-tile-field="description" value="${escapeAttr(t.description || '')}" /></label>
        </div>`).join('')}
        <div><button class="btn btn-primary" id="save-settings-homepage-tiles" type="button">Save Homepage Tiles</button></div>
      </div>`)}

      ${settingsSectionWrap('admin-accounts', 'Admin Accounts', `
      <div class="panel stack gap-3">
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
          <label class="field"><span>New Admin Username</span><input id="new-admin-username" type="text" /></label>
          <label class="field"><span>New Admin Password</span><input id="new-admin-password" type="password" placeholder="8+ characters" /></label>
        </div>
        <div><button class="btn" id="add-admin" type="button">Add admin</button></div>
      </div>`)}

      ${settingsSectionWrap('public-contact', 'Public Site Contact', `
      <div class="panel stack gap-3">
        <div class="grid-2">
          <label class="field"><span>Site Name</span><input data-setting="siteName" value="${escapeAttr(s.siteName || '')}" /></label>
          <label class="field"><span>Tagline</span><input data-setting="tagline" value="${escapeAttr(s.tagline || '')}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Phone Display</span><input data-setting="phoneDisplay" value="${escapeAttr(s.phoneDisplay || '')}" /></label>
          <label class="field"><span>Phone Tel Link</span><input data-setting="phoneTel" value="${escapeAttr(s.phoneTel || '')}" /></label>
        </div>
        <label class="field"><span>Email</span><input data-setting="email" value="${escapeAttr(s.email || '')}" /></label>
        <label class="field"><span>Address</span><input data-setting="address" value="${escapeAttr(s.address || '')}" /></label>
        <label class="field"><span>Hours</span><input data-setting="hours" value="${escapeAttr(s.hours || '')}" placeholder="e.g. Mon–Fri 8am–5pm, Sat 8am–12pm" /></label>
        <label class="field"><span>WhatsApp Response Expectation</span><input data-setting="whatsappResponseNote" value="${escapeAttr(s.whatsappResponseNote || '')}" placeholder="e.g. Usually within a few hours during business hours" /></label>
        <label class="field"><span>Escalation / Appointment Guidance</span><textarea data-setting="escalationContactsNote" rows="2" placeholder="Who to contact and how, outside normal channels">${escapeHtml(s.escalationContactsNote || '')}</textarea></label>
        <label class="field"><span>WhatsApp Link</span><input data-setting="whatsapp" value="${escapeAttr(s.whatsapp || '')}" /></label>
        <div class="grid-2">
          <label class="field"><span>Facebook</span><input data-setting="facebook" value="${escapeAttr(s.facebook || '')}" /></label>
          <label class="field"><span>Instagram</span><input data-setting="instagram" value="${escapeAttr(s.instagram || '')}" /></label>
        </div>
        <label class="field"><span>Change Admin Password</span><input data-setting="adminPassword" type="password" placeholder="Leave blank to keep current" /></label>
        <div><button class="btn btn-primary" id="save-settings-public-contact" type="button">Save Public Site Contact</button></div>
      </div>`)}

      ${settingsSectionWrap('storefront-delivery', 'Storefront Stock & Delivery', `
      <div class="panel stack gap-3">
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Filament colour swatches show "Only N left" once stock drops to or below this number, instead of the raw count. Takes effect on the next Publish to site.</p>
        <label class="field" style="max-width:260px"><span>Design-file Retention (Months After Finalized)</span><input data-setting="designFileRetentionMonths" type="number" min="1" step="1" value="${escapeAttr(String(s.designFileRetentionMonths ?? 12))}" /></label>
        <label class="field"><span>Default Quote Terms ({{depositPct}} Is Replaced at Quote Time)</span><textarea data-setting="quoteTermsDefault" rows="3">${escapeHtml(s.quoteTermsDefault || '')}</textarea></label>
        <label class="field" style="max-width:220px"><span>Low-stock Threshold</span><input data-setting="lowStockThreshold" type="number" min="1" step="1" value="${escapeAttr(String(s.lowStockThreshold ?? 3))}" /></label>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Shown on filament/category pages and in the cart. Free text (e.g. "3-5") since these are ranges, not exact counts.</p>
        <div class="grid-2">
          <label class="field"><span>Ready-stock Filament Dispatch (Business Days)</span><input data-setting="filamentDispatchDays" value="${escapeAttr(s.filamentDispatchDays || '')}" /></label>
          <label class="field"><span>Custom-print Production Lead Time (Business Days)</span><input data-setting="printLeadTimeDays" value="${escapeAttr(s.printLeadTimeDays || '')}" /></label>
        </div>
        <div class="section-head" style="margin-top:0.5rem"><h3>Filament Volume Discounts (#60)</h3></div>
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Quantity price breaks on filament rolls, applied automatically at online checkout to the filament portion of the order (best matching tier wins). Leave empty for no discounts. Shown to shoppers on filament pages after the next Publish to site.</p>
        <div id="volume-discount-rows" class="stack gap-2">
          ${(s.volumeDiscounts || [])
            .map(
              (t, i) => `<div class="row-card-actions" data-vd-index="${i}">
              <label class="field" style="max-width:160px"><span>From (Rolls)</span><input data-vd="minQty" type="number" min="2" step="1" value="${escapeAttr(String(t.minQty))}" /></label>
              <label class="field" style="max-width:160px"><span>Discount %</span><input data-vd="pct" type="number" min="0" max="90" step="0.5" value="${escapeAttr(String(t.pct))}" /></label>
              <label class="field checkbox"><input data-vd="active" type="checkbox" ${t.active !== false ? 'checked' : ''} /><span>Active</span></label>
              <button type="button" class="btn small btn-ghost" data-vd-remove="${i}">Remove</button>
            </div>`,
            )
            .join('')}
        </div>
        <div><button type="button" class="btn small" id="vd-add">+ Add Tier</button></div>
        <div><button class="btn btn-primary" id="save-settings-storefront-delivery" type="button">Save Storefront Stock &amp; Delivery</button></div>
      </div>`)}

      ${settingsSectionWrap('invoicing', 'Invoicing & Bank Details', `
      <div class="panel stack gap-3">
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Shown on every printable invoice (Invoice History → Print).</p>
        <div class="grid-2">
          <label class="field"><span>Bank Name</span><input data-setting="bankName" value="${escapeAttr(s.bankName || '')}" /></label>
          <label class="field"><span>Account Name</span><input data-setting="bankAccountName" value="${escapeAttr(s.bankAccountName || '')}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Account Number</span><input data-setting="bankAccountNumber" value="${escapeAttr(s.bankAccountNumber || '')}" /></label>
          <label class="field"><span>Branch Code</span><input data-setting="bankBranchCode" value="${escapeAttr(s.bankBranchCode || '')}" /></label>
        </div>
        <label class="field" style="max-width:220px"><span>Next Invoice Number Seed</span><input data-setting="invoiceNumberSeed" type="number" min="1" step="1" value="${escapeAttr(String(s.invoiceNumberSeed ?? 1))}" /></label>
        <label class="field" style="max-width:320px"><span>Order &amp; Design-request Notification Email</span><input data-setting="orderNotificationEmail" type="email" value="${escapeAttr(s.orderNotificationEmail || '')}" /></label>
        <div><button class="btn btn-primary" id="save-settings-invoicing" type="button">Save Invoicing &amp; Bank Details</button></div>
      </div>`)}
      ${settingsSectionWrap('communications', 'Communications', `${communicationsPanel(s.emailTemplates)}
        <div><button class="btn btn-primary" id="save-settings-communications" type="button">Save Communications</button></div>`)}
      ${settingsSectionWrap('operational-alerts', 'Operational Alerts', `${operationalAlertsPanel(s)}
        <div><button class="btn btn-primary" id="save-settings-operational-alerts" type="button">Save Operational Alerts</button></div>`)}
      ${settingsSectionWrap('filament-brands', 'In-house Filament Brands', configurableListPanel('inHouseFilamentBrands', 'In-house filament brands', s.inHouseFilamentBrands, 'Used when adding and filtering local print-stock rolls. Untick a brand to retire it from the "add new roll" picker without touching existing stock already logged under it.'))}
      ${settingsSectionWrap('todo-categories', 'Todo Categories', configurableListPanel('todoCategories', 'Todo / Backlog: Categories', s.todoCategories, 'Options for the Category field on the Todo/Backlog page.'))}
      ${settingsSectionWrap('todo-priorities', 'Todo Priorities', configurableListPanel('todoPriorities', 'Todo / Backlog: Priorities', s.todoPriorities, 'Options for the Priority field, and its sort order in the Todo/Backlog table — a new priority is added at the end (lowest urgency) until reordering is supported.'))}
      ${settingsSectionWrap('car-part-brands', 'Car-part Brands', configurableListPanel('carPartBrands', 'Car-part brands', s.carPartBrands, 'The vehicle brands with their own car-parts page (name becomes the page URL — keep it simple, e.g. Toyota). After adding one: create its category via Product Catalog → + Category with parent car-parts and the matching slug, then Publish to site. Unticking hides the page and nav link on the next publish without touching existing items.'))}
      ${settingsSectionWrap('car-part-models-landrover', 'Landrover Part Models', configurableListPanel('carPartModelsLandrover', 'Landrover part models', s.carPartModelsLandrover, 'Vehicle models a Landrover catalog item can be tagged as fitting (multi-select, on the item itself). Untick a model to retire it from new picks without touching items already tagged with it.'))}
      ${settingsSectionWrap('car-part-models-gwm', 'GWM Part Models', configurableListPanel('carPartModelsGwm', 'GWM part models', s.carPartModelsGwm, 'Vehicle models a GWM catalog item can be tagged as fitting (multi-select, on the item itself). Untick a model to retire it from new picks without touching items already tagged with it.'))}
      ${settingsSectionWrap('deposit-tiers', 'Quote Deposit Tiers', depositTierPanel(s.quoteDepositOptions))}
      ${settingsSectionWrap('featured-products', 'Featured Products (Homepage)', featuredProductsPanel(s.featuredProducts))}

      ${settingsSectionWrap('print-costing', 'Print Job Costing Rates', `
      <div class="panel stack gap-3">
        <p class="muted" style="margin:0;font-size:0.88rem;line-height:1.5">Drives the internal-only cost calculator (Print Job Costing) — never affects storefront prices. Markup/Running costs are fractions (0.25 = 25%).</p>
        <div class="grid-3">
          <label class="field"><span>Markup (Fraction)</span><input data-setting="markupPct" type="number" min="0" step="0.05" value="${escapeAttr(String(s.markupPct ?? 0))}" /></label>
          <label class="field"><span>Running Costs (Fraction)</span><input data-setting="runningCostsPct" type="number" min="0" step="0.05" value="${escapeAttr(String(s.runningCostsPct ?? 0))}" /></label>
          <label class="field"><span>Electricity Rate (R/kWh)</span><input data-setting="electricityRate" type="number" min="0" step="0.01" value="${escapeAttr(String(s.electricityRate ?? 0))}" /></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Printer Power Draw (kWh/hr)</span><input data-setting="printerPowerDraw" type="number" min="0" step="0.01" value="${escapeAttr(String(s.printerPowerDraw ?? 0))}" /></label>
          <label class="field"><span>Design Rate (R/hr)</span><input data-setting="designRate" type="number" min="0" step="1" value="${escapeAttr(String(s.designRate ?? 0))}" /></label>
          <label class="field"><span>Setup Rate (R/hr)</span><input data-setting="setupRate" type="number" min="0" step="1" value="${escapeAttr(String(s.setupRate ?? 0))}" /></label>
        </div>
        <label class="field" style="max-width:220px"><span>Post-processing Rate (R/hr)</span><input data-setting="postProcessingRate" type="number" min="0" step="1" value="${escapeAttr(String(s.postProcessingRate ?? 0))}" /></label>
        <div>
          <button class="btn btn-primary" id="save-settings-print-costing" type="button">Save Print Job Costing Rates</button>
        </div>
      </div>`)}
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
  wireConfigurableListPanels();
  wireDepositTierPanel();
  wireFeaturedProductsPanel();

  // Jump-link menu: expand the target section if collapsed, then scroll to
  // it -- same collapse-state Set the section's own toggle listener below
  // maintains, so a jump never fights a manually-collapsed section.
  $$('.settings-jump').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.jump;
      const details = $(`#settings-section-${key}`);
      if (!details) return;
      if (!details.open) {
        details.open = true;
        state.settingsCollapsed.delete(key);
      }
      details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $$('#view-settings details.stock-section').forEach((el) => {
    el.addEventListener('toggle', () => {
      // Same spurious-initial-fire guard as Stock Management/Product
      // Catalog's identical listener -- see their comments for why.
      if (el.dataset.initialOpen === String(el.open)) {
        delete el.dataset.initialOpen;
        return;
      }
      const key = el.dataset.group;
      if (el.open) state.settingsCollapsed.delete(key);
      else state.settingsCollapsed.add(key);
    });
  });

  wireScopedSettingsSave('typography', 'save-settings-typography', scopedSettingFieldsPatch);
  wireScopedSettingsSave('appearance', 'save-settings-appearance', scopedSettingFieldsPatch);
  wireScopedSettingsSave('homepage-tiles', 'save-settings-homepage-tiles', (container) => {
    const tiles = [];
    container.querySelectorAll('[data-tile-index]').forEach((input) => {
      const i = Number(input.dataset.tileIndex);
      tiles[i] = tiles[i] || {};
      tiles[i][input.dataset.tileField] = input.value;
    });
    return { homeTiles: tiles };
  });
  wireScopedSettingsSave('public-contact', 'save-settings-public-contact', scopedSettingFieldsPatch);
  wireScopedSettingsSave('storefront-delivery', 'save-settings-storefront-delivery', (container) => {
    const patch = scopedSettingFieldsPatch(container);
    // #60: volume-discount tiers -- always sent (an empty list is a real
    // "no discounts" choice, not an omission), same reasoning the previous
    // single shared save carried.
    patch.volumeDiscounts = [...container.querySelectorAll('#volume-discount-rows [data-vd-index]')].map((row) => ({
      minQty: Number(row.querySelector('[data-vd="minQty"]').value) || 0,
      pct: Number(row.querySelector('[data-vd="pct"]').value) || 0,
      active: row.querySelector('[data-vd="active"]').checked,
    }));
    return patch;
  });
  wireScopedSettingsSave('invoicing', 'save-settings-invoicing', scopedSettingFieldsPatch);
  wireScopedSettingsSave('communications', 'save-settings-communications', (container) => {
    const emailTemplates = {};
    container.querySelectorAll('[data-email-template]').forEach((input) => {
      const key = input.dataset.emailTemplate;
      emailTemplates[key] = emailTemplates[key] || {};
      emailTemplates[key][input.dataset.emailTemplateField] = input.value;
    });
    return { emailTemplates };
  });
  wireScopedSettingsSave('operational-alerts', 'save-settings-operational-alerts', scopedSettingFieldsPatch);
  wireScopedSettingsSave('print-costing', 'save-settings-print-costing', scopedSettingFieldsPatch);

  // #60: tier add/remove -- static template, values typed by the admin.
  $('#vd-add')?.addEventListener('click', () => {
    const rows = $('#volume-discount-rows');
    const idx = rows.querySelectorAll('[data-vd-index]').length;
    const div = document.createElement('div');
    div.className = 'row-card-actions';
    div.dataset.vdIndex = String(idx);
    div.insertAdjacentHTML(
      'beforeend',
      `<label class="field" style="max-width:160px"><span>From (Rolls)</span><input data-vd="minQty" type="number" min="2" step="1" value="3" /></label>
       <label class="field" style="max-width:160px"><span>Discount %</span><input data-vd="pct" type="number" min="0" max="90" step="0.5" value="5" /></label>
       <label class="field checkbox"><input data-vd="active" type="checkbox" checked /><span>Active</span></label>
       <button type="button" class="btn small btn-ghost" data-vd-remove type="button">Remove</button>`,
    );
    rows.appendChild(div);
  });
  $('#volume-discount-rows')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vd-remove]');
    if (btn) btn.closest('[data-vd-index]').remove();
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
  // Fulfilment ticks (owner request 2026-09-03): Shipped/Finalized drive the
  // REAL status machine (shipped/completed) via the existing audited status
  // route -- no parallel state that could disagree with it. Collected is its
  // own timestamp (collected_at) since courier orders can also be handed
  // over in person. All three disabled on cancelled orders.
  const fulfilCell = (o, kind) => {
    const disabled = o.status === 'cancelled' ? 'disabled' : '';
    const checked =
      kind === 'collected' ? (o.collectedAt ? 'checked' : '')
      : kind === 'shipped' ? (o.status === 'shipped' || o.status === 'completed' ? 'checked' : '')
      : (o.status === 'completed' ? 'checked' : '');
    return `<td class="fulfil-cell"><input type="checkbox" data-fulfil="${kind}" ${checked} ${disabled} /></td>`;
  };
  const rows = orders
    .map(
      (o) => `
        <tr data-id="${escapeAttr(o.id)}">
          <td><code>${escapeHtml(o.invoiceNumber || o.id.slice(0, 8))}</code></td>
          <td>${statusBadge(o.status)}</td>
          <td>${formatRand(o.total)}</td>
          <td>${escapeHtml(o.paymentMethod)}</td>
          <td>${escapeHtml(formatDate(o.createdAt))}</td>
          ${fulfilCell(o, 'collected')}${fulfilCell(o, 'shipped')}${fulfilCell(o, 'finalized')}
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
        <thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Payment</th><th>Placed</th><th>Collected</th><th>Shipped</th><th>Finalized</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9"><div class="empty">No orders match your filters</div></td></tr>'}</tbody>
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

  // Checkbox cells sit inside the clickable row -- stop propagation so a
  // tick doesn't also open the order detail view.
  $$('#view-orders .fulfil-cell').forEach((td) => {
    td.addEventListener('click', (e) => e.stopPropagation());
  });
  $$('#view-orders input[data-fulfil]').forEach((box) => {
    box.addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      const id = tr.dataset.id;
      const kind = e.target.dataset.fulfil;
      e.target.disabled = true;
      try {
        if (kind === 'collected') {
          await api(`/api/orders/${id}/collected`, { method: 'PATCH', body: JSON.stringify({ collected: e.target.checked }) });
        } else if (kind === 'shipped') {
          // Tick = shipped; untick steps back to paid.
          await api(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: e.target.checked ? 'shipped' : 'paid' }) });
        } else {
          // Finalized tick = completed; untick steps back to shipped.
          await api(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: e.target.checked ? 'completed' : 'shipped' }) });
        }
      } catch (err) {
        toast(err.message || 'Update failed');
      }
      await renderOrders();
    });
  });
}

// Lapanza is South Africa-only, so a bare local number (leading 0) is
// assumed SA and rewritten to the 27 country code wa.me/api.whatsapp.com
// links require; anything already carrying a country code is left as-is.
function normalizeZaPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

// Click-to-chat, not the Meta Business Cloud API used elsewhere (whatsapp.js)
// -- that path needs a pre-approved template and is built for bulk
// marketing sends, not one-off "here's your order" messages. This opens
// WhatsApp with the message pre-filled for the admin to review and send,
// same pattern as every other WhatsApp link on the public site.
function orderWhatsAppMessage(order) {
  const c = order.client || {};
  const lines = order.items.map((i) => `${i.quantity} x ${i.productName} — ${formatRand(i.price * i.quantity)}`).join('\n');
  return `Hi ${c.name || 'there'}, here's your Lapanza 3D order ${order.invoiceNumber || order.id.slice(0, 8)}:\n\n${lines}\n\nTotal: ${formatRand(order.total)}\n\nThanks for your order!`;
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
      (i) => `<tr><td>${escapeHtml(i.productName)}</td><td>${escapeHtml(String(i.quantity))}</td><td>${formatRand(i.price)}</td><td>${escapeHtml(String(i.weight))}g</td><td>${formatRand(i.price * i.quantity)}</td></tr>`,
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
          <label class="field"><span>Tracking Number</span><input id="order-tracking" value="${escapeAttr(order.trackingNumber || '')}" /></label>
          <div class="field"><span>&nbsp;</span><button class="btn btn-primary" id="save-order" type="button">Save</button></div>
        </div>
        <p class="muted" style="font-size:0.85rem">
          Confirmation email: ${order.confirmationEmailSentAt ? `sent ${escapeHtml(formatDate(order.confirmationEmailSentAt))}` : 'not sent'}
          &nbsp;·&nbsp; <button class="btn small" id="resend-email" type="button">${order.confirmationEmailSentAt ? 'Resend' : 'Send'} confirmation email</button>
          &nbsp;·&nbsp; <button class="btn small" id="whatsapp-order" type="button" ${c.phone ? '' : 'disabled title="No phone number on file"'}>Send via WhatsApp</button>
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
          Subtotal: ${formatRand(order.subtotal)} &middot; Shipping (${escapeHtml(order.shippingOption?.name || SHIPPING_METHOD_LABELS[order.shippingMethod] || order.shippingMethod || '—')}): ${formatRand(order.shippingPrice)} &middot;
          <strong>Total: ${formatRand(order.total)}</strong> &middot; Weight: ${escapeHtml(String(order.totalWeight))}g
        </p>
      </div>

      <div class="panel table-wrap">
        <div class="section-head"><h3>Payment Transactions</h3></div>
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

  $('#whatsapp-order')?.addEventListener('click', () => {
    const phone = normalizeZaPhone(c.phone);
    if (!phone) return toast('This client has no phone number on file');
    const text = encodeURIComponent(orderWhatsAppMessage(order));
    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${text}`, '_blank', 'noopener');
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
    pudoRelevant: false, pudoLockerName: '', pudoLockerAddress: '', pudoLockerSuburb: '', pudoLockerCity: '', pudoLockerPostalCode: '',
    discountPct: 0, discountNote: '', source: '', emailMarketingOptIn: false, emailMarketingConsentSource: '',
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
    return `<tr class="nested-row" data-nested-for="${escapeAttr(clientId)}"><td colspan="${colspan}"><span class="muted">No Orders Yet</span></td></tr>`;
  }
  const orderRows = orders
    .map((o) => {
      const badgeClass = ORDER_STATUS_BADGE_CLASS[o.status] || '';
      return `<tr>
        <td><code>${escapeHtml(o.id.slice(0, 8))}</code></td>
        <td>${escapeHtml(formatDate(o.created_at))}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(o.status)}</span></td>
        <td>${formatRand(o.total)}</td>
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

// Nested row shown under a client while merging it into another -- same
// expand-in-place shape ordersNestedRowHtml uses, just with a client search
// (reusing New Order's own client-search pattern) instead of an order list.
function mergeRowHtml(merging, colspan) {
  const resultsHtml = merging.results
    .filter((c) => c.id !== merging.sourceId)
    .map(
      (c) => `
        <div class="panel" style="padding:0.5rem 0.75rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem" data-merge-target-id="${escapeAttr(c.id)}">
          <span>${escapeHtml(c.name || c.email)} <span class="muted">(${escapeHtml(c.email)})</span></span>
          <button class="btn small btn-danger" data-action="confirm-merge" type="button">Merge into this client</button>
        </div>`,
    )
    .join('');
  return `
    <tr class="nested-row" data-merge-row-for="${escapeAttr(merging.sourceId)}">
      <td colspan="${colspan}">
        <div class="stack gap-2" style="max-width:500px">
          <p class="muted" style="margin:0;font-size:0.85rem">Merging <strong>${escapeHtml(merging.sourceLabel)}</strong> into another client moves all their orders and design requests over, then deletes this record. This cannot be undone.</p>
          <input id="merge-target-q" type="search" placeholder="Search the client to merge into…" value="${escapeAttr(merging.query)}" />
          <div class="stack gap-1">${resultsHtml}</div>
          <button class="btn small btn-ghost" data-action="cancel-merge" type="button" style="align-self:flex-start">Cancel</button>
        </div>
      </td>
    </tr>`;
}

async function renderClients() {
  state.clientQ = state.clientQ || '';
  state.editingClient = state.editingClient || null;
  state.expandedClients = state.expandedClients || new Set();
  state.clientOrders = state.clientOrders || {};
  state.mergingClient = state.mergingClient || null;
  const { clients } = await api(`/api/clients?${new URLSearchParams({ q: state.clientQ })}`);

  const rows = clients
    .map((c) => {
      const expanded = state.expandedClients.has(c.id);
      const row = `
        <tr data-id="${escapeAttr(c.id)}">
          <td><button class="btn-expand" data-action="toggle-orders" type="button" aria-expanded="${expanded}" aria-label="Toggle orders">${expanded ? '▾' : '▸'}</button></td>
          <td><code>${escapeHtml(c.clientCode)}</code></td>
          <td>${escapeHtml(c.name || '—')}</td>
          <td>${escapeHtml(c.businessName || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml(c.phone || '—')}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small" data-action="merge" type="button">Merge&hellip;</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`;
      const extra = (expanded ? ordersNestedRowHtml(c.id, 7) : '') + (state.mergingClient?.sourceId === c.id ? mergeRowHtml(state.mergingClient, 7) : '');
      return row + extra;
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
        <button class="btn btn-ghost small" id="back-to-clients" type="button" style="align-self:flex-start">&larr; Back to Clients</button>
        <div class="section-head"><h3>${form.id ? `Edit client (${escapeHtml(form.clientCode || '')})` : 'New client'}</h3></div>
        <div class="grid-2">
          <label class="field"><span>First Name</span><input id="cf-first-name" value="${escapeAttr(form.firstName || '')}" /></label>
          <label class="field"><span>Surname</span><input id="cf-last-name" value="${escapeAttr(form.lastName || '')}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Business Name (Optional)</span><input id="cf-business-name" value="${escapeAttr(form.businessName || '')}" /></label>
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
        <label class="field" style="max-width:200px"><span>Postal Code</span><input id="cf-postal" value="${escapeAttr(form.postalCode)}" /></label>
        <label class="field checkbox"><input id="cf-pudo-relevant" type="checkbox" ${form.pudoRelevant ? 'checked' : ''} /><span>PUDO Address Relevant (Preferred Locker on File)</span></label>
        <div id="cf-pudo-fields" class="${form.pudoRelevant ? '' : 'hidden'} stack gap-2">
          <div class="grid-2">
            <label class="field"><span>Locker Name</span><input id="cf-pudo-name" value="${escapeAttr(form.pudoLockerName || '')}" placeholder="e.g. PUDO Locker — Pierre van Ryneveld Spar" /></label>
            <label class="field"><span>Locker Address</span><input id="cf-pudo-address" value="${escapeAttr(form.pudoLockerAddress || '')}" /></label>
          </div>
          <div class="grid-3">
            <label class="field"><span>Locker Suburb</span><input id="cf-pudo-suburb" value="${escapeAttr(form.pudoLockerSuburb || '')}" /></label>
            <label class="field"><span>Locker City</span><input id="cf-pudo-city" value="${escapeAttr(form.pudoLockerCity || '')}" /></label>
            <label class="field" style="max-width:200px"><span>Locker Postal Code</span><input id="cf-pudo-postal" value="${escapeAttr(form.pudoLockerPostalCode || '')}" /></label>
          </div>
        </div>
        <div class="grid-3">
          <label class="field"><span>Discount %</span><input id="cf-discount-pct" type="number" min="0" max="100" step="0.5" value="${escapeAttr(String(form.discountPct ?? 0))}" /></label>
          <label class="field"><span>Discount Note</span><input id="cf-discount-note" value="${escapeAttr(form.discountNote || '')}" placeholder="e.g. Family, Supplier" /></label>
          <label class="field"><span>Lead Source</span><input id="cf-source" value="${escapeAttr(form.source || '')}" placeholder="e.g. Website, Facebook, WA Group" /></label>
        </div>
        <p class="muted" style="font-size:0.8rem">Discount only applies on manually-created orders (New Order) — never automatically at online checkout.</p>
        <div class="grid-2">
          <label class="field checkbox"><input id="cf-email-marketing-opt-in" type="checkbox" ${form.emailMarketingOptIn ? 'checked' : ''} /><span>Email Marketing Consent Recorded</span></label>
          <label class="field"><span>Consent Source</span><input id="cf-email-marketing-source" value="${escapeAttr(form.emailMarketingConsentSource || '')}" placeholder="e.g. Written consent, website signup" ${form.emailMarketingOptIn ? '' : 'disabled'} /></label>
        </div>
        <p class="muted" style="font-size:0.8rem">Only clients with explicit email-marketing consent can be selected for a newsletter. WhatsApp consent is separate.</p>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-client" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-client" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th></th><th>Code</th><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No clients yet</div></td></tr>'}</tbody>
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
    tr.querySelector('[data-action="merge"]').addEventListener('click', async () => {
      const c = clients.find((x) => x.id === tr.dataset.id);
      state.mergingClient = { sourceId: c.id, sourceLabel: c.name || c.email, query: '', results: [] };
      await renderClients();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this client? If they have order history, only their login/account is removed (orders are kept) — otherwise the record is deleted entirely.')) return;
      try {
        const result = await api(`/api/clients/${tr.dataset.id}`, { method: 'DELETE' });
        toast(result.deleted ? 'Client deleted' : 'Account removed (order history kept)');
        await renderClients();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (state.mergingClient) {
    $('#merge-target-q')?.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      state.mergingClient.query = $('#merge-target-q').value.trim();
      if (!state.mergingClient.query) { state.mergingClient.results = []; return renderClients(); }
      const { clients: results } = await api(`/api/clients?${new URLSearchParams({ q: state.mergingClient.query })}`);
      state.mergingClient.results = results;
      await renderClients();
    });
    $('[data-action="cancel-merge"]')?.addEventListener('click', async () => { state.mergingClient = null; await renderClients(); });
    $$('[data-merge-target-id]').forEach((row) => {
      row.querySelector('[data-action="confirm-merge"]').addEventListener('click', async () => {
        const targetId = row.dataset.mergeTargetId;
        const target = state.mergingClient.results.find((c) => c.id === targetId);
        if (!confirm(`Merge "${state.mergingClient.sourceLabel}" into "${target?.name || target?.email}"? This moves over their order history and cannot be undone.`)) return;
        try {
          await api(`/api/clients/${state.mergingClient.sourceId}/merge`, { method: 'POST', body: JSON.stringify({ intoClientId: targetId }) });
          toast('Clients merged');
          state.mergingClient = null;
          await renderClients();
        } catch (ex) {
          toast(ex.message);
        }
      });
    });
  }

  if (form) {
    $('#cancel-client').addEventListener('click', async () => { state.editingClient = null; await renderClients(); });
    $('#back-to-clients').addEventListener('click', async () => { state.editingClient = null; await renderClients(); });
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
        pudoRelevant: $('#cf-pudo-relevant').checked,
        pudoLockerName: $('#cf-pudo-name').value,
        pudoLockerAddress: $('#cf-pudo-address').value,
        pudoLockerSuburb: $('#cf-pudo-suburb').value,
        pudoLockerCity: $('#cf-pudo-city').value,
        pudoLockerPostalCode: $('#cf-pudo-postal').value,
        discountPct: Number($('#cf-discount-pct').value) || 0,
        discountNote: $('#cf-discount-note').value,
        source: $('#cf-source').value,
        emailMarketingOptIn: $('#cf-email-marketing-opt-in').checked,
        emailMarketingConsentSource: $('#cf-email-marketing-source').value,
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
    $('#cf-pudo-relevant').addEventListener('change', (event) => {
      $('#cf-pudo-fields').classList.toggle('hidden', !event.target.checked);
    });
    $('#cf-email-marketing-opt-in').addEventListener('change', (event) => {
      $('#cf-email-marketing-source').disabled = !event.target.checked;
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
          <td>
            ${c.emailVerified ? '<span class="badge published">Verified</span>' : '<span class="badge draft">Unverified</span>'}
            ${c.disabled ? '<span class="badge disabled">Disabled</span>' : ''}
          </td>
          <td>${escapeHtml(formatDate(c.createdAt))}</td>
          <td>${c.lastLoginAt ? escapeHtml(formatDate(c.lastLoginAt)) : '<span class="muted">Never</span>'}</td>
          <td>
            ${c.emailVerified ? '' : '<button class="btn small" data-action="verify" type="button">Verify</button>'}
            ${c.emailVerified ? '' : '<button class="btn small" data-action="resend" type="button">Resend email</button>'}
            <button class="btn small" data-action="send-reset" type="button">Send Password Reset</button>
            ${c.disabled
              ? '<button class="btn small" data-action="enable" type="button">Enable</button>'
              : '<button class="btn small btn-danger" data-action="disable" type="button">Disable</button>'}
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
    tr.querySelector('[data-action="send-reset"]')?.addEventListener('click', async () => {
      try {
        await api(`/api/clients/${id}/send-password-reset`, { method: 'POST' });
        toast('Password reset email sent');
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="disable"]')?.addEventListener('click', async () => {
      if (!confirm('Disable this account? They will no longer be able to log in until re-enabled. Order history and the account itself are kept.')) return;
      try {
        await api(`/api/clients/${id}/disabled`, { method: 'PATCH', body: JSON.stringify({ disabled: true }) });
        toast('Account disabled');
        await renderRegisteredUsers();
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="enable"]')?.addEventListener('click', async () => {
      try {
        await api(`/api/clients/${id}/disabled`, { method: 'PATCH', body: JSON.stringify({ disabled: false }) });
        toast('Account re-enabled');
        await renderRegisteredUsers();
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

// Payment select is deliberately narrower than the full order.status
// workflow: it only ever moves an order between pending_payment and paid
// (updateOrderStatus keeps payment_status in lockstep with whichever of
// those it's given -- see orders.js). An order already shipped/completed
// shows "Payment received" (payment is implied once past pending) without
// this control being able to regress it past paid -- the Completed
// checkbox below is the only thing that can move status further forward.
function invoicePaymentSelectHtml(o) {
  if (o.status === 'cancelled') return '<span class="muted">—</span>';
  const isPending = o.status === 'pending_payment';
  return `<select class="inv-payment-inline" data-id="${escapeAttr(o.id)}">
    <option value="pending_payment" ${isPending ? 'selected' : ''}>Pending</option>
    <option value="paid" ${!isPending ? 'selected' : ''}>Payment received</option>
  </select>`;
}

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
          <td>${escapeHtml(o.client?.name || '—')}</td>
          <td>${formatRand(o.total)}</td>
          <td>${statusBadge(o.status)}</td>
          <td>${invoicePaymentSelectHtml(o)}</td>
          <td><label class="field checkbox" style="margin:0"><input type="checkbox" class="inv-completed-inline" data-id="${escapeAttr(o.id)}" ${o.status === 'completed' ? 'checked' : ''} ${o.status === 'pending_payment' || o.status === 'cancelled' ? 'disabled' : ''} /></label></td>
          <td>
            <a href="/api/orders/${escapeAttr(o.id)}/invoice" target="_blank" rel="noopener">Print</a>
            ${o.status !== 'cancelled' ? `<button class="btn small" data-action="cancel" type="button">Cancel</button>` : ''}
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
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
        <thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th>Value</th><th>Status</th><th>Payment</th><th>Completed</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8"><div class="empty">No invoices yet</div></td></tr>'}</tbody>
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
      if (e.target.closest('a, button, select, input, label')) return;
      openOrderDetail(tr.dataset.id);
    });
    tr.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      if (!confirm('Cancel this invoice/order? This cannot be undone from here.')) return;
      try {
        await api(`/api/orders/${tr.dataset.id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
        toast('Order cancelled');
        await renderInvoiceHistory();
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this invoice/order permanently? This removes the order and its line items entirely and cannot be undone.')) return;
      try {
        await api(`/api/orders/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Order deleted');
        await renderInvoiceHistory();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  $$('.inv-payment-inline').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api(`/api/orders/${select.dataset.id}/status`, { method: 'PUT', body: JSON.stringify({ status: select.value }) });
        toast(select.value === 'paid' ? 'Marked as payment received' : 'Marked as pending');
        await renderInvoiceHistory();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  $$('.inv-completed-inline').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const status = checkbox.checked ? 'completed' : 'paid';
      try {
        await api(`/api/orders/${checkbox.dataset.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
        toast(checkbox.checked ? 'Marked completed (printed & shipped)' : 'Reverted to paid');
        await renderInvoiceHistory();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });
}

// ---- New Order (Phase 3, manual/walk-in order entry) ----

function blankNewOrderItem() {
  return {
    mode: 'custom', // 'product' (picked from the catalog) or 'custom' (free-text job)
    productId: '',
    productLabel: '',
    productPrice: 0,
    productWeight: 0,
    productStock: null,
    productQuery: '',
    productMatches: [],
    description: '',
    quantity: 1,
    unitPrice: 0,
  };
}

function blankNewOrder() {
  return {
    clientMode: 'search',
    clientQuery: '',
    clientResults: [],
    selectedClient: null,
    newClient: { firstName: '', lastName: '', businessName: '', email: '', phone: '' },
    items: [blankNewOrderItem()],
    // Mirrors checkout.html's own radio set exactly (fixed_pudo/fixed_local
    // are a UI-only split of the backend's single 'fixed' method -- see
    // FIXED_BUCKETS below and checkout-entry.js's identical pattern).
    shippingMethod: 'fixed_pudo',
    shippingOptionId: '',
    manualShippingPrice: '',
    discountPct: 0,
    paymentMethod: 'manual_eft',
    alreadyPaid: false,
  };
}

function newOrderItemPrice(item) {
  return item.mode === 'product' ? Number(item.productPrice) || 0 : Number(item.unitPrice) || 0;
}

function newOrderWeight(order) {
  return order.items.reduce((sum, i) => sum + (i.mode === 'product' ? Number(i.productWeight) || 0 : 0) * (Number(i.quantity) || 0), 0);
}

function newOrderTotals(order, shippingOptions) {
  const subtotal = order.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * newOrderItemPrice(i), 0);
  let shippingPrice = 0;
  if (order.shippingMethod !== 'own_courier' && order.shippingMethod !== 'collect') {
    const shippingOption = shippingOptions.find((o) => o.id === order.shippingOptionId);
    shippingPrice = shippingOption ? shippingOption.price : (Number(order.manualShippingPrice) || 0);
  }
  const discountAmount = Math.round(subtotal * ((Number(order.discountPct) || 0) / 100));
  const total = Math.max(0, subtotal - discountAmount + shippingPrice);
  return { subtotal, shippingPrice, discountAmount, total };
}

// Same category-first, name-fallback split checkout-entry.js's FIXED_BUCKETS
// uses -- category is now a real admin-set field (see the Shipping Options
// page), the name check only covers the rare row with no category at all.
const NEW_ORDER_FIXED_BUCKETS = {
  fixed_local: (o) => (o.category ? o.category === 'Local Delivery' : /local/i.test(o.name)),
  fixed_pudo: (o) => (o.category ? o.category !== 'Local Delivery' : !/local/i.test(o.name)),
};

function newOrderShippingControlHtml(order, shippingOptions, weight) {
  if (order.shippingMethod === 'own_courier') {
    return `<p class="muted">No delivery charge — the customer arranges their own courier collection.</p>`;
  }
  if (order.shippingMethod === 'collect') {
    return `<p class="muted">No delivery charge — collect from the store.</p>`;
  }
  if (order.shippingMethod === 'fixed_pudo' || order.shippingMethod === 'fixed_local') {
    const bucketOptions = shippingOptions.filter((o) => o.optionType === 'fixed' && NEW_ORDER_FIXED_BUCKETS[order.shippingMethod](o));
    const opts = bucketOptions.map((o) => `<option value="${escapeAttr(o.id)}" ${order.shippingOptionId === o.id ? 'selected' : ''}>${escapeHtml(o.name)} — ${formatRand(o.price)}</option>`).join('');
    return `<label class="field"><span>${order.shippingMethod === 'fixed_local' ? 'Local Delivery option' : 'PUDO Locker option'}</span>
      <select id="no-shipping-fixed"><option value="">Choose an option…</option>${opts}</select></label>`;
  }
  // 'courier' -- same weight-bracket matching as online checkout
  // (matchShippingForWeight), just computed client-side against the
  // already-fetched options list rather than a round trip, since the admin
  // may still want to override the auto-picked bracket.
  const autoOptions = shippingOptions.filter((o) => o.optionType === 'auto_weight');
  const opts = autoOptions
    .map((o) => `<option value="${escapeAttr(o.id)}" ${order.shippingOptionId === o.id ? 'selected' : ''}>${escapeHtml(o.name)} — ${formatRand(o.price)} (${o.minWeight}–${o.maxWeight ?? '∞'}g)</option>`)
    .join('');
  return `
    <p class="muted" style="margin:0 0 0.5rem">Order weight: ${weight}g${order.shippingOptionId ? '' : ' — no bracket auto-matched; pick one below or enter a price manually'}</p>
    <div class="grid-2">
      <label class="field"><span>Courier Bracket</span><select id="no-shipping-fixed"><option value="">Choose an option…</option>${opts}</select></label>
      <label class="field"><span>Or Manual Price (R, Used Only If No Bracket Picked)</span><input id="no-shipping-manual" type="number" min="0" step="1" value="${escapeAttr(String(order.manualShippingPrice))}" ${order.shippingOptionId ? 'disabled' : ''} /></label>
    </div>`;
}

// UX rework (2026-09-02, owner feedback): both New Order pickers are live
// type-ahead — results appear as you type (no Enter, no separate "Use"
// click; the whole result row is the button). Product matching stays
// client-side against the cached inventory list; client matching debounces
// one server query. All interpolated values pass escapeHtml/escapeAttr.
function newOrderProductMatchHtml(p) {
  return `<button type="button" class="picker-row" data-product-id="${escapeAttr(p.productId)}">
    <span>${escapeHtml(p.name)}</span>
    <span class="muted">${formatRand(p.price)}${p.sku ? ` · ${escapeHtml(p.sku)}` : ''} · ${escapeHtml(String(p.stockQty))} in stock</span>
  </button>`;
}

function newOrderClientResultHtml(c) {
  return `<button type="button" class="picker-row" data-client-id="${escapeAttr(c.id)}">
    <span>${escapeHtml(c.name || c.email)}</span>
    <span class="muted">${escapeHtml(c.email)}${c.clientCode ? ` · ${escapeHtml(c.clientCode)}` : ''}${c.discountPct ? ` · ${escapeHtml(String(c.discountPct))}% discount` : ''}</span>
  </button>`;
}

function newOrderItemRowHtml(item, idx, itemCount) {
  const productBlock = item.productId
    ? `<div class="panel" style="padding:0.5rem 0.75rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem">
         <span>${escapeHtml(item.productLabel)} <span class="muted">(${formatRand(item.productPrice)}${item.productStock != null ? `, ${escapeHtml(String(item.productStock))} in stock` : ''})</span></span>
         <button class="btn small btn-ghost" data-action="item-clear-product" type="button">Change</button>
       </div>`
    : `<input class="ip-product-q" type="search" placeholder="Type product name or SKU — results appear as you type" value="${escapeAttr(item.productQuery)}" autocomplete="off" />
       <div class="ip-matches stack gap-1">${item.productMatches.map(newOrderProductMatchHtml).join('')}</div>`;

  return `
    <div class="panel stack gap-2" data-item-idx="${idx}" style="padding:0.75rem 0.9rem">
      <div class="row-card-actions">
        <button class="btn small ${item.mode === 'product' ? 'btn-primary' : ''}" data-action="item-mode-product" type="button">Pick product</button>
        <button class="btn small ${item.mode === 'custom' ? 'btn-primary' : ''}" data-action="item-mode-custom" type="button">Custom item</button>
        <button class="btn small btn-danger" data-action="remove-item" type="button" style="margin-left:auto" ${itemCount <= 1 ? 'disabled' : ''}>Remove</button>
      </div>
      ${item.mode === 'product' ? productBlock : `<input class="ni-desc" value="${escapeAttr(item.description)}" placeholder="Custom job description" />`}
      <div class="grid-3">
        <label class="field"><span>Qty</span><input class="ni-qty" type="number" min="1" step="1" value="${escapeAttr(String(item.quantity))}" /></label>
        ${
          item.mode === 'product'
            ? `<div class="field"><span>Unit Price</span><p style="margin:0.4rem 0 0">${formatRand(item.productPrice)} <span class="muted">(Catalog Price)</span></p></div>`
            : `<label class="field"><span>Unit Price (R)</span><input class="ni-price" type="number" min="0" step="1" value="${escapeAttr(String(item.unitPrice))}" /></label>`
        }
        <div class="field"><span>Line Total</span><p style="margin:0.4rem 0 0">${formatRand((Number(item.quantity) || 0) * newOrderItemPrice(item))}</p></div>
      </div>
    </div>`;
}

async function renderNewOrder() {
  state.newOrder = state.newOrder || blankNewOrder();
  const order = state.newOrder;
  // Fetched once and cached -- the picker searches this client-side rather
  // than hitting the server per keystroke, and it's the same combined
  // filament+category list Stock Management already uses (listInventory).
  if (!state.productCatalog) {
    const { items } = await api('/api/inventory');
    state.productCatalog = items;
  }
  const { shippingOptions } = await api('/api/shipping-options?activeOnly=true');
  const weight = newOrderWeight(order);
  const totals = newOrderTotals(order, shippingOptions);

  const clientResultsHtml = order.clientResults.map(newOrderClientResultHtml).join('');

  const itemRows = order.items.map((item, idx) => newOrderItemRowHtml(item, idx, order.items.length)).join('');

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
            <div class="panel" style="padding:0.6rem 0.9rem">
              <div class="row-card-actions">
                <strong>${escapeHtml(order.selectedClient.name || order.selectedClient.email)}${order.selectedClient.businessName ? ` (${escapeHtml(order.selectedClient.businessName)})` : ''}${order.selectedClient.discountPct ? ` <span class="muted">— ${escapeHtml(String(order.selectedClient.discountPct))}% discount</span>` : ''}</strong>
                <button class="btn small btn-ghost" data-action="clear-client" type="button">Change</button>
              </div>
              <p class="muted" style="margin:0.4rem 0 0">${escapeHtml(order.selectedClient.email || '')}</p>
              <p class="muted" style="margin:0.2rem 0 0">${escapeHtml(order.selectedClient.phone || 'No phone on file')}</p>
              <p class="muted" style="margin:0.2rem 0 0">${escapeHtml([order.selectedClient.street, order.selectedClient.suburb, order.selectedClient.city, order.selectedClient.province, order.selectedClient.postalCode].filter(Boolean).join(', ') || 'No shipping address on file')}</p>
              ${order.selectedClient.pudoRelevant ? `<p class="muted" style="margin:0.2rem 0 0">PUDO: ${escapeHtml([order.selectedClient.pudoLockerName, order.selectedClient.pudoLockerAddress, order.selectedClient.pudoLockerSuburb, order.selectedClient.pudoLockerCity, order.selectedClient.pudoLockerPostalCode].filter(Boolean).join(', ') || 'locker marked relevant, details not filled in yet')}</p>` : ''}
            </div>` : `
            <input id="no-client-q" type="search" placeholder="Type name, email or client code — results appear as you type" value="${escapeAttr(order.clientQuery)}" autocomplete="off" />
            <div id="no-client-results" class="stack gap-2">${clientResultsHtml}</div>`}
        ` : `
          <p class="muted" style="margin:0">Submitting this creates a real client record (same as checkout) — it appears in Clients and this order shows in their order history.</p>
          <div class="grid-2">
            <label class="field"><span>First Name</span><input id="no-new-first" value="${escapeAttr(order.newClient.firstName)}" /></label>
            <label class="field"><span>Surname</span><input id="no-new-last" value="${escapeAttr(order.newClient.lastName)}" /></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Business Name (Optional)</span><input id="no-new-business" value="${escapeAttr(order.newClient.businessName)}" /></label>
            <label class="field"><span>Email *</span><input id="no-new-email" type="email" value="${escapeAttr(order.newClient.email)}" /></label>
          </div>
          <label class="field"><span>Phone</span><input id="no-new-phone" value="${escapeAttr(order.newClient.phone)}" /></label>
        `}
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Line Items</h3><button class="btn small" id="add-item" type="button">+ Add line</button></div>
        <div class="stack gap-2">${itemRows}</div>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Shipping</h3></div>
        <div class="stack gap-2">
          <label class="field checkbox"><input type="radio" name="no-shipping-method" value="fixed_pudo" ${order.shippingMethod === 'fixed_pudo' ? 'checked' : ''} /><span>PUDO Locker</span></label>
          <label class="field checkbox"><input type="radio" name="no-shipping-method" value="courier" ${order.shippingMethod === 'courier' ? 'checked' : ''} /><span>Our Shipping (Courier)</span></label>
          <label class="field checkbox"><input type="radio" name="no-shipping-method" value="own_courier" ${order.shippingMethod === 'own_courier' ? 'checked' : ''} /><span>Customer's Own Courier</span></label>
          <label class="field checkbox"><input type="radio" name="no-shipping-method" value="collect" ${order.shippingMethod === 'collect' ? 'checked' : ''} /><span>Collect from Store</span></label>
          <label class="field checkbox"><input type="radio" name="no-shipping-method" value="fixed_local" ${order.shippingMethod === 'fixed_local' ? 'checked' : ''} /><span>Local Delivery</span></label>
        </div>
        ${newOrderShippingControlHtml(order, shippingOptions, weight)}
        <label class="field" style="max-width:220px"><span>Discount %</span><input id="no-discount" type="number" min="0" max="100" step="0.5" value="${escapeAttr(String(order.discountPct))}" /></label>
      </div>

      <div class="panel stack gap-3">
        <div class="section-head"><h3>Payment</h3></div>
        <div class="grid-3">
          <label class="field"><span>Payment Method</span>
            <select id="no-payment-method">
              <option value="manual_eft" ${order.paymentMethod === 'manual_eft' ? 'selected' : ''}>Manual EFT</option>
              <option value="cash_on_collection" ${order.paymentMethod === 'cash_on_collection' ? 'selected' : ''}>Cash</option>
              <option value="payfast_card" ${order.paymentMethod === 'payfast_card' ? 'selected' : ''}>Payfast (Card)</option>
              <option value="payfast_eft" ${order.paymentMethod === 'payfast_eft' ? 'selected' : ''}>Payfast (Instant EFT)</option>
            </select>
          </label>
          <label class="field checkbox" style="align-self:end"><input id="no-already-paid" type="checkbox" ${order.alreadyPaid ? 'checked' : ''} /><span>Already Paid</span></label>
        </div>
      </div>

      <div class="panel stack gap-2">
        <div class="section-head"><h3>Total</h3></div>
        <p>Subtotal: ${formatRand(totals.subtotal)}</p>
        ${totals.discountAmount ? `<p>Discount: -${formatRand(totals.discountAmount)}</p>` : ''}
        <p>Shipping: ${formatRand(totals.shippingPrice)}</p>
        <p><strong>Total due: ${formatRand(totals.total)}</strong></p>
        <button class="btn btn-primary" id="create-order" type="button">Create order</button>
      </div>
    </div>`;

  $('[data-action="mode-search"]')?.addEventListener('click', async () => { order.clientMode = 'search'; await renderNewOrder(); });
  $('[data-action="mode-new"]')?.addEventListener('click', async () => { order.clientMode = 'new'; await renderNewOrder(); });
  $('[data-action="clear-client"]')?.addEventListener('click', async () => { order.selectedClient = null; order.clientResults = []; await renderNewOrder(); });

  // Live client search: debounced fetch, results injected into the results
  // container only (a full re-render would steal focus mid-typing).
  const bindClientPicks = () => {
    $$('#no-client-results [data-client-id]').forEach((row) => {
      row.addEventListener('click', async () => {
        order.selectedClient = order.clientResults.find((c) => c.id === row.dataset.clientId);
        order.discountPct = order.selectedClient?.discountPct || 0;
        await renderNewOrder();
      });
    });
  };
  bindClientPicks();
  let clientSearchTimer = null;
  $('#no-client-q')?.addEventListener('input', (e) => {
    order.clientQuery = e.target.value.trim();
    clearTimeout(clientSearchTimer);
    clientSearchTimer = setTimeout(async () => {
      const box = $('#no-client-results');
      if (!box) return;
      if (order.clientQuery.length < 2) {
        order.clientResults = [];
        box.innerHTML = order.clientQuery ? '<p class="muted" style="margin:0;font-size:0.85rem">Keep typing…</p>' : '';
        return;
      }
      const { clients } = await api(`/api/clients?${new URLSearchParams({ q: order.clientQuery })}`);
      order.clientResults = clients;
      box.innerHTML = clients.length
        ? clients.map(newOrderClientResultHtml).join('')
        : '<p class="muted" style="margin:0;font-size:0.85rem">No clients match — switch to "New client" to create one.</p>';
      bindClientPicks();
    }, 250);
  });

  $('#add-item')?.addEventListener('click', async () => {
    order.items.push(blankNewOrderItem());
    await renderNewOrder();
  });
  $$('[data-item-idx]').forEach((row) => {
    const idx = Number(row.dataset.itemIdx);
    const item = order.items[idx];
    row.querySelector('[data-action="item-mode-product"]')?.addEventListener('click', async () => { item.mode = 'product'; await renderNewOrder(); });
    row.querySelector('[data-action="item-mode-custom"]')?.addEventListener('click', async () => { item.mode = 'custom'; await renderNewOrder(); });
    row.querySelector('[data-action="item-clear-product"]')?.addEventListener('click', async () => {
      item.productId = ''; item.productLabel = ''; item.productPrice = 0; item.productWeight = 0; item.productStock = null;
      item.productQuery = ''; item.productMatches = [];
      await renderNewOrder();
    });
    // Live product search: the inventory list is already cached client-side,
    // so filtering is instant on every keystroke; only this row's results
    // container updates (a full re-render would steal focus).
    const pickProduct = async (productId) => {
      const p = item.productMatches.find((m) => m.productId === productId);
      if (!p) return;
      item.productId = p.productId;
      item.productLabel = p.name;
      item.productPrice = p.price;
      item.productWeight = p.weight || 0;
      item.productStock = p.stockQty;
      item.productMatches = [];
      await renderNewOrder();
    };
    const bindProductPicks = () => {
      row.querySelectorAll('.ip-matches [data-product-id]').forEach((matchRow) => {
        matchRow.addEventListener('click', () => pickProduct(matchRow.dataset.productId));
      });
    };
    bindProductPicks();
    row.querySelector('.ip-product-q')?.addEventListener('input', (e) => {
      item.productQuery = e.target.value.trim();
      const q = item.productQuery.toLowerCase();
      item.productMatches = q.length >= 2
        ? state.productCatalog.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 8)
        : [];
      const box = row.querySelector('.ip-matches');
      if (!box) return;
      if (q.length < 2) box.innerHTML = q ? '<p class="muted" style="margin:0;font-size:0.85rem">Keep typing…</p>' : '';
      else box.innerHTML = item.productMatches.length
        ? item.productMatches.map(newOrderProductMatchHtml).join('')
        : '<p class="muted" style="margin:0;font-size:0.85rem">No products match that name or SKU.</p>';
      bindProductPicks();
    });
    row.querySelector('.ni-desc')?.addEventListener('input', (e) => { item.description = e.target.value; });
    row.querySelector('.ni-qty')?.addEventListener('input', (e) => { item.quantity = e.target.value; });
    row.querySelector('.ni-price')?.addEventListener('input', (e) => { item.unitPrice = e.target.value; });
    row.querySelector('[data-action="remove-item"]')?.addEventListener('click', async () => {
      order.items.splice(idx, 1);
      await renderNewOrder();
    });
  });

  $$('[name="no-shipping-method"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      order.shippingMethod = radio.value;
      order.shippingOptionId = '';
      order.manualShippingPrice = '';
      await renderNewOrder();
    });
  });
  $('#no-shipping-fixed')?.addEventListener('change', async (e) => { order.shippingOptionId = e.target.value; await renderNewOrder(); });
  $('#no-shipping-manual')?.addEventListener('input', (e) => { order.manualShippingPrice = e.target.value; });
  $('#no-discount')?.addEventListener('input', (e) => { order.discountPct = e.target.value; });
  $('#no-payment-method')?.addEventListener('change', (e) => { order.paymentMethod = e.target.value; });
  $('#no-already-paid')?.addEventListener('change', (e) => { order.alreadyPaid = e.target.checked; });

  $('#create-order').addEventListener('click', async () => {
    const items = order.items
      .filter((i) => (i.mode === 'product' ? Boolean(i.productId) : i.description.trim()))
      .map((i) =>
        i.mode === 'product'
          ? { productId: i.productId, quantity: Number(i.quantity) || 1 }
          : { description: i.description, quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0 },
      );
    if (!items.length) return toast('Add at least one line item');

    // 'fixed_pudo'/'fixed_local' are this form's own UI split (like
    // checkout's) of the single backend 'fixed' shippingMethod.
    const backendShippingMethod = order.shippingMethod.startsWith('fixed') ? 'fixed' : order.shippingMethod;
    const payload = {
      items,
      shippingMethod: backendShippingMethod,
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
      const { order: created, clientDataUpdated } = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      toast(clientDataUpdated ? 'Updating Client Data…' : `Order created — ${created.invoiceNumber}`);
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
    quantity: 1,
    slots: Array.from({ length: MAX_PRINT_JOB_FILAMENT_SLOTS }, () => ({ inHouseFilamentId: '', grams: '', meters: '' })),
    // Captured as separate hours/minutes fields for easier data entry --
    // combined into the single printTimeMinutes the API/DB actually store
    // (see readPrintJobPayload) only when the payload is built.
    printTimeHours: 0, printTimeMins: 0, designHours: 0, setupHours: 0, postProcessingHours: 0, markupPct: '',
    status: 'Printed', finalSellingPrice: '',
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
    quantity: Math.max(1, Math.round(Number(draft.quantity) || 1)),
    filaments,
    printTimeMinutes: (Number(draft.printTimeHours) || 0) * 60 + (Number(draft.printTimeMins) || 0),
    designHours: Number(draft.designHours) || 0,
    setupHours: Number(draft.setupHours) || 0,
    postProcessingHours: Number(draft.postProcessingHours) || 0,
    markupPct: draft.markupPct === '' ? undefined : Number(draft.markupPct),
    status: draft.status,
    finalSellingPrice: draft.finalSellingPrice === '' ? undefined : Number(draft.finalSellingPrice),
  };
}

async function renderPrintJobs() {
  state.newPrintJob = state.newPrintJob || blankPrintJob();
  const draft = state.newPrintJob;
  const [{ printJobs }, { filaments: allFilaments }] = await Promise.all([api('/api/print-jobs'), api('/api/in-house-filament')]);
  // Review #5 (todo #144): archived rolls never appear in the picker.
  const filaments = allFilaments.filter((f) => !f.archived);

  const slotRows = draft.slots
    .map((slot, idx) => `
        <div class="grid-4" data-slot-idx="${idx}" style="align-items:end">
          <label class="field" style="grid-column:span 2"><span>Filament ${idx + 1}${idx === 0 ? '' : ' (optional)'}</span>
            <select class="pjs-filament">
              <option value="">${idx === 0 ? '— Choose —' : '— None —'}</option>
              ${printJobFilamentOptions(filaments, slot.inHouseFilamentId)}
            </select>
          </label>
          <label class="field"><span>Grams (Per Copy)</span><input class="pjs-grams" type="number" min="0" step="0.01" value="${escapeAttr(String(slot.grams))}" /></label>
          <label class="field"><span>Meters (Per Copy)</span><input class="pjs-meters" type="number" min="0" step="0.01" value="${escapeAttr(String(slot.meters))}" /></label>
        </div>`)
    .join('');

  const totalGrams = draft.slots.reduce((sum, s) => sum + (Number(s.grams) || 0), 0);
  const totalMeters = draft.slots.reduce((sum, s) => sum + (Number(s.meters) || 0), 0);

  const preview = draft.preview;
  const stockWarningsHtml = (warnings) => (warnings && warnings.length
    ? `<p class="error-text" style="margin-top:0.5rem">⚠ Exceeds recorded stock: ${warnings.map((w) => `${escapeHtml(w.name)} (needs ${escapeHtml(String(w.requestedG))}g, ${escapeHtml(String(w.remainingG))}g on record)`).join('; ')}</p>`
    : '');
  const previewHtml = preview ? `
      <div class="panel stack gap-2" style="background:var(--panel-2, transparent)">
        <div class="section-head"><h3>Validation Result</h3></div>
        <p>Filament cost: ${formatRand(preview.filamentCost)} · Power: ${formatRand(preview.powerCost)} · Labour: ${formatRand(preview.labourCost)} · Running: ${formatRand(preview.runningCost)}</p>
        <p><strong>Total cost: ${formatRand(preview.totalCost)} — Markup: ${formatRand(preview.markupAmount)} — Selling price: ${formatRand(preview.sellingPrice)}${(preview.quantity || 1) > 1 ? ` (${preview.quantity} copies — ${formatRand(Math.round((preview.sellingPrice / preview.quantity) * 100) / 100)} each)` : ''}</strong></p>
        ${stockWarningsHtml(preview.stockWarnings)}
      </div>` : '';

  const listing = state.editingListingJobId ? printJobs.find((j) => j.id === state.editingListingJobId) : null;
  const listingCategories = state.printJobCategories || [];

  // Storage filenames are randomized (see uploads.js) so uploads never
  // collide -- referenceFile/ImageOriginalName is what a human recognizes.
  // Rows uploaded before that column existed have no original name on
  // record, so fall back to the randomized name rather than showing nothing.
  const basename = (p) => (p ? p.split('/').pop() : '');

  const rows = printJobs
    .map(
      (j) => `
        <tr data-id="${escapeAttr(j.id)}">
          <td>${j.referenceImagePath ? `<img src="${escapeAttr(j.referenceImagePath)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:0.5rem" />` : ''}${escapeHtml(j.itemName)}${(j.quantity || 1) > 1 ? ` <span class="muted">×${j.quantity}</span>` : ''}</td>
          <td style="font-size:0.8rem">
            <div class="stack gap-1">
              <div>
                ${j.referenceFilePath
                  ? `<a href="${escapeAttr(j.referenceFilePath)}" download="${escapeAttr(j.referenceFileOriginalName || basename(j.referenceFilePath))}" class="text-terracotta" style="text-decoration:underline">${escapeHtml(j.referenceFileOriginalName || basename(j.referenceFilePath))}</a>`
                  : '<span class="muted">No File</span>'}
                <button class="btn small" data-action="upload-file" type="button">${j.referenceFilePath ? 'Replace' : '+ Add file'}</button>
                <input type="file" class="hidden" data-role="file-input" accept=".stl,.3mf,.obj,.gcode,.zip,.pdf" />
              </div>
              <div>
                ${j.referenceImagePath
                  ? `<a href="${escapeAttr(j.referenceImagePath)}" target="_blank" rel="noopener" class="text-terracotta" style="text-decoration:underline">${escapeHtml(j.referenceImageOriginalName || basename(j.referenceImagePath))}</a>`
                  : '<span class="muted">No Photo</span>'}
                <button class="btn small" data-action="upload-image" type="button">${j.referenceImagePath ? 'Replace' : '+ Add photo'}</button>
                <input type="file" class="hidden" data-role="image-input" accept="image/jpeg,image/png,image/webp" />
              </div>
            </div>
          </td>
          <td>${escapeHtml(j.totalGrams.toFixed(1))}g / ${escapeHtml(j.totalMeters.toFixed(2))}m</td>
          <td>${formatRand(j.totalCost)}</td>
          <td>${formatRand(j.sellingPrice)}</td>
          <td><span class="muted" style="margin-right:0.25rem">R</span><input class="pj-final-price-cell" type="number" min="0" step="0.01" value="${escapeAttr(String(j.finalSellingPrice ?? ''))}" style="width:80px" /></td>
          <td>
            <select class="pj-status-cell">
              <option value="Printed" ${j.status === 'Printed' ? 'selected' : ''}>Printed</option>
              <option value="Estimate" ${j.status === 'Estimate' ? 'selected' : ''}>Estimate</option>
            </select>
          </td>
          <td>${escapeHtml(formatDate(j.datePrinted || j.createdAt))}</td>
          <td>
            <button class="btn small" data-action="${j.listingItemId ? 'update-listing' : 'list-for-sale'}" type="button">${j.listingItemId ? 'Update listing' : 'List for sale'}</button>
            <button class="btn small btn-danger" data-action="delete-job" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const listingPanelHtml = listing ? `
    <div class="panel stack gap-3" style="max-width:480px">
      <div class="section-head"><h3>${listing.listingItemId ? 'Update listing' : 'List'} "${escapeHtml(listing.itemName)}" for sale</h3></div>
      ${listing.listingItemId ? '' : `
        <label class="field"><span>Category</span>
          <select id="lst-category">
            ${listingCategories.map((c) => `<option value="${escapeAttr(c.slug)}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </label>`}
      <label class="field"><span>Stock Quantity</span><input id="lst-stock" type="number" min="0" step="1" value="${listing.listingItemId ? escapeAttr(String(state.listingItemSnapshot?.stockQty ?? 0)) : '1'}" /></label>
      <p class="muted" style="font-size:0.8rem">Sells at the Final Selling Price (${formatRand(listing.finalSellingPrice ?? 0)}) set above -- change that first if it needs updating, then Save here to push it into the listing too.</p>
      <div class="row-card-actions">
        <button class="btn btn-primary" id="save-listing" type="button">${listing.listingItemId ? 'Update' : 'List for sale'}</button>
        <button class="btn btn-ghost" id="cancel-listing" type="button">Cancel</button>
      </div>
    </div>` : '';

  $('#view-print-jobs').innerHTML = `
    <div class="stack gap-4">
      <div class="panel stack gap-3" style="max-width:900px">
        <div class="section-head"><h3>Log a Print Job</h3></div>
        <label class="field"><span>Item / File Name</span><input id="pj-name" value="${escapeAttr(draft.itemName)}" /></label>
        <label class="field"><span>Quantity (Copies Printed — Filament, Print Time &amp; Post-processing Below Are Per Copy)</span><input id="pj-qty" type="number" min="1" step="1" value="${escapeAttr(String(draft.quantity || 1))}" /></label>

        <div class="stack gap-2">${slotRows}</div>
        <div>
          <button type="button" class="btn small" id="pj-new-roll-toggle">+ New In-House Roll</button>
          <div id="pj-new-roll-form" class="hidden panel stack gap-2" style="margin-top:0.5rem;padding:0.75rem">
            <div class="grid-3">
              <label class="field"><span>Brand</span><input id="pj-nr-brand" placeholder="e.g. SunLu" /></label>
              <label class="field"><span>Filament Type</span><input id="pj-nr-type" placeholder="e.g. PLA" /></label>
              <label class="field"><span>Colour</span><input id="pj-nr-colour" placeholder="e.g. Black" /></label>
            </div>
            <div class="grid-4">
              <label class="field"><span>Rolls Available</span><input id="pj-nr-rolls" type="number" min="0" step="1" value="1" /></label>
              <label class="field"><span>Roll Weight (g)</span><input id="pj-nr-weight" type="number" min="0" step="1" value="1000" /></label>
              <label class="field"><span>Roll Length (m)</span><input id="pj-nr-length" type="number" min="0" step="0.1" value="335" /></label>
              <label class="field"><span>Cost / Roll (R)</span><input id="pj-nr-cost" type="number" min="0" step="0.01" /></label>
            </div>
            <div><button type="button" class="btn small" id="pj-new-roll-save">Save Roll</button></div>
          </div>
        </div>
        <p class="muted" style="font-size:0.85rem">Totals (Per Copy): <strong>${escapeHtml(totalGrams.toFixed(1))}g</strong> · <strong>${escapeHtml(totalMeters.toFixed(2))}m</strong> across ${escapeHtml(String(draft.slots.filter((s) => s.inHouseFilamentId).length))} filament(s)</p>

        <div class="grid-4">
          <label class="field"><span>Print Time</span>
            <div class="grid-2" style="gap:0.4rem">
              <input id="pj-time-h" type="number" min="0" step="1" placeholder="Hours" value="${escapeAttr(String(draft.printTimeHours))}" />
              <input id="pj-time-m" type="number" min="0" max="59" step="1" placeholder="Minutes" value="${escapeAttr(String(draft.printTimeMins))}" />
            </div>
          </label>
          <label class="field"><span>Design (hrs)</span><input id="pj-design-hrs" type="number" min="0" step="0.25" value="${escapeAttr(String(draft.designHours))}" /></label>
          <label class="field"><span>Setup (hrs)</span><input id="pj-setup-hrs" type="number" min="0" step="0.25" value="${escapeAttr(String(draft.setupHours))}" /></label>
          <label class="field"><span>Post-processing (hrs, Per Copy)</span><input id="pj-post-hrs" type="number" min="0" step="0.25" value="${escapeAttr(String(draft.postProcessingHours))}" /></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Markup Override (Fraction, Blank = Settings Default)</span><input id="pj-markup" type="number" min="0" step="0.05" value="${escapeAttr(String(draft.markupPct))}" placeholder="e.g. 0.25 = 25%" /></label>
          <label class="field"><span>Status</span>
            <select id="pj-status">
              <option value="Printed" ${draft.status === 'Printed' ? 'selected' : ''}>Printed</option>
              <option value="Estimate" ${draft.status === 'Estimate' ? 'selected' : ''}>Estimate</option>
            </select>
          </label>
          <label class="field"><span>Final Selling Price (Blank = Minimum Selling Price)</span>
            <div style="display:flex;align-items:center;gap:0.4rem">
              <span class="muted">R</span>
              <input id="pj-final-price" type="number" min="0" step="0.01" value="${escapeAttr(String(draft.finalSellingPrice))}" placeholder="${preview ? escapeAttr(String(preview.sellingPrice)) : '0.00'}" style="flex:1" />
            </div>
          </label>
        </div>

        <div class="grid-2">
          <div class="field"><span>Model File (Optional) — STL/3MF/OBJ/gcode/zip/PDF</span>
            <label class="btn small" for="pj-model-file">Choose File</label>
            <input type="file" class="hidden" id="pj-model-file" accept=".stl,.3mf,.obj,.gcode,.zip,.pdf" />
          </div>
          <div class="field"><span>Reference Photo (Optional)</span>
            <label class="btn small" for="pj-model-image">Choose File</label>
            <input type="file" class="hidden" id="pj-model-image" accept="image/jpeg,image/png,image/webp" />
          </div>
        </div>

        ${previewHtml}

        <div class="row-card-actions">
          <button class="btn" id="validate-job" type="button">Validate</button>
          <button class="btn btn-primary" id="log-job" type="button">Log job &amp; compute cost</button>
        </div>
      </div>
      ${listingPanelHtml}
      <div class="panel table-wrap">
        <table class="catalog">
          <thead><tr><th>Item</th><th>Attachments</th><th>Filament used</th><th>Cost</th><th>Min. selling price</th><th>Final selling price</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9"><div class="empty">No print jobs logged yet</div></td></tr>'}</tbody>
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
    draft.quantity = $('#pj-qty').value;
    draft.printTimeHours = $('#pj-time-h').value;
    draft.printTimeMins = $('#pj-time-m').value;
    draft.designHours = $('#pj-design-hrs').value;
    draft.setupHours = $('#pj-setup-hrs').value;
    draft.postProcessingHours = $('#pj-post-hrs').value;
    draft.markupPct = $('#pj-markup').value;
    draft.status = $('#pj-status').value;
    draft.finalSellingPrice = $('#pj-final-price').value;
  }

  // Backlog #135: log a brand-new in-house roll without leaving the
  // print-job form. On save, the new roll auto-selects into the first
  // empty filament slot; the In-House Filament page stays the place for
  // full roll management (edit/transfer/history).
  $('#pj-new-roll-toggle')?.addEventListener('click', () => {
    $('#pj-new-roll-form').classList.toggle('hidden');
  });
  $('#pj-new-roll-save')?.addEventListener('click', async () => {
    const payload = {
      brand: $('#pj-nr-brand').value.trim(),
      filamentType: $('#pj-nr-type').value.trim(),
      colorName: $('#pj-nr-colour').value.trim(),
      rollsAvailable: Number($('#pj-nr-rolls').value) || 0,
      weightG: Number($('#pj-nr-weight').value) || 0,
      rollLengthM: Number($('#pj-nr-length').value) || 0,
      costPerRollRand: Number($('#pj-nr-cost').value) || 0,
    };
    try {
      const { filament } = await api('/api/in-house-filament', { method: 'POST', body: JSON.stringify(payload) });
      syncFormIntoDraft();
      const empty = draft.slots.find((s) => !s.inHouseFilamentId);
      if (empty && filament?.id) empty.inHouseFilamentId = filament.id;
      toast('Roll saved and selected');
      renderPrintJobs();
    } catch (ex) {
      toast(ex.message);
    }
  });

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
      const warningSuffix = printJob._stockWarnings?.length
        ? ` — ⚠ exceeds recorded stock: ${printJob._stockWarnings.map((w) => w.name).join(', ')}`
        : '';
      toast(`Cost: ${formatRand(printJob.totalCost)} — Minimum selling price: ${formatRand(printJob.sellingPrice)}${warningSuffix}`);

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

  $$('#view-print-jobs tbody tr[data-id]').forEach((tr) => {
    const jobId = tr.dataset.id;

    tr.querySelector('[data-action="delete-job"]').addEventListener('click', async () => {
      if (!confirm('Delete this print job?')) return;
      await api(`/api/print-jobs/${jobId}`, { method: 'DELETE' });
      await renderPrintJobs();
    });

    // Attach/replace the model file or reference photo on an already-logged
    // job -- previously only possible at the moment a job was first created.
    const fileInputCell = tr.querySelector('[data-role="file-input"]');
    tr.querySelector('[data-action="upload-file"]').addEventListener('click', () => fileInputCell.click());
    fileInputCell.addEventListener('change', async () => {
      if (!fileInputCell.files[0]) return;
      await uploadPrintJobAsset(jobId, 'file', fileInputCell.files[0]);
      await renderPrintJobs();
    });

    const imageInputCell = tr.querySelector('[data-role="image-input"]');
    tr.querySelector('[data-action="upload-image"]').addEventListener('click', () => imageInputCell.click());
    imageInputCell.addEventListener('change', async () => {
      if (!imageInputCell.files[0]) return;
      await uploadPrintJobAsset(jobId, 'image', imageInputCell.files[0]);
      await renderPrintJobs();
    });

    // Auto-saves on interaction (no separate Save button per row) --
    // matches this table's existing pattern of committing a change as soon
    // as it's made, same as the totals-live-update above.
    tr.querySelector('.pj-status-cell').addEventListener('change', async (e) => {
      try {
        await api(`/api/print-jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
        toast('Status updated');
      } catch (ex) {
        toast(ex.message);
        await renderPrintJobs();
      }
    });
    tr.querySelector('.pj-final-price-cell').addEventListener('blur', async (e) => {
      const value = Number(e.target.value);
      if (!value || value <= 0) return; // ignore an accidental clear -- keeps whatever price was already set
      try {
        await api(`/api/print-jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify({ finalSellingPrice: value }) });
        toast('Final selling price updated');
      } catch (ex) {
        toast(ex.message);
      }
    });

    const listBtn = tr.querySelector('[data-action="list-for-sale"]');
    if (listBtn) {
      listBtn.addEventListener('click', async () => {
        if (!state.printJobCategories) {
          const { products } = await api('/api/products');
          state.printJobCategories = products.map((p) => ({ slug: p.slug, name: p.name }));
        }
        state.editingListingJobId = jobId;
        state.listingItemSnapshot = null;
        await renderPrintJobs();
      });
    }
    const updateBtn = tr.querySelector('[data-action="update-listing"]');
    if (updateBtn) {
      updateBtn.addEventListener('click', async () => {
        const job = printJobs.find((j) => j.id === jobId);
        const { product } = await api(`/api/products/${job.listingCategoryId}`);
        const item = product.items.find((i) => i.id === job.listingItemId);
        state.editingListingJobId = jobId;
        state.listingItemSnapshot = item ? { stockQty: item.stockQty, price: item.price } : { stockQty: 0, price: 0 };
        await renderPrintJobs();
      });
    }
  });

  if (listing) {
    $('#cancel-listing').addEventListener('click', async () => {
      state.editingListingJobId = null;
      state.listingItemSnapshot = null;
      await renderPrintJobs();
    });
    $('#save-listing').addEventListener('click', async () => {
      const stockQty = Number($('#lst-stock').value) || 0;
      try {
        if (listing.listingItemId) {
          await api(`/api/print-jobs/${listing.id}/listing`, { method: 'PUT', body: JSON.stringify({ stockQty }) });
          toast('Listing updated');
        } else {
          const categorySlug = $('#lst-category').value;
          await api(`/api/print-jobs/${listing.id}/list-for-sale`, { method: 'POST', body: JSON.stringify({ categorySlug, stockQty }) });
          toast('Listed for sale');
        }
        state.editingListingJobId = null;
        state.listingItemSnapshot = null;
        await renderPrintJobs();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

async function uploadPrintJobAsset(jobId, field, file) {
  const formData = new FormData();
  formData.append(field, file);
  const endpoint = field === 'image' ? 'image' : 'file';
  try {
    await uploadFormData(`/api/print-jobs/${jobId}/${endpoint}`, formData);
  } catch (ex) {
    toast(ex.message);
  }
}

// ---- In-House Filament ----

function blankInHouseFilament() {
  return { id: null, brand: '', filamentType: '', colorName: '', rollsAvailable: 0, weightG: 1000, rollLengthM: 335, costPerRollRand: 0 };
}

async function renderInHouseFilament() {
  state.editingInHouseFilament = state.editingInHouseFilament || null;
  state.inHouseFilters = state.inHouseFilters || { q: '', brand: '' };
  const [{ filaments }, { settings }, { items: inventory }] = await Promise.all([api('/api/in-house-filament'), api('/api/settings'), api('/api/inventory')]);
  // Filtering must still find stock logged under a since-retired brand, so
  // the filter dropdown lists every configured brand regardless of
  // `active`; the create/edit form's picker is active-only -- you can't
  // start a new roll under a retired brand. Both fall back to whatever
  // brand name is already on the record itself (form.brand / a filament's
  // own f.brand) even if that name isn't in the list at all anymore, so an
  // existing value never silently disappears from its own dropdown.
  const allBrands = settings.inHouseFilamentBrands || [];
  const activeBrandNames = allBrands.filter((b) => b.active).map((b) => b.name);
  const editingBrand = state.editingInHouseFilament?.brand;
  if (editingBrand && !activeBrandNames.includes(editingBrand)) activeBrandNames.push(editingBrand);
  const filterBrandNames = allBrands.map((b) => b.name);
  const filtered = filaments
    .filter((f) => (!state.inHouseFilters.brand || f.brand === state.inHouseFilters.brand) && [f.brand, f.filamentType, f.colorName].some((v) => v.toLowerCase().includes(state.inHouseFilters.q.toLowerCase())))
    // Review #5 (todo #144): archived rolls sink to the bottom, greyed.
    .sort((a, b) => Number(a.archived) - Number(b.archived));
  const stockOptions = inventory.filter((item) => item.kind === 'filament' && item.stockQty > 0);

  const rows = filtered
    .map(
      (f, index) => `
        ${index === 0 || filtered[index - 1].filamentType !== f.filamentType ? `<tr class="table-group"><td colspan="8"><strong>${escapeHtml(f.filamentType)}</strong></td></tr>` : ''}
        <tr data-id="${escapeAttr(f.id)}" ${f.archived ? 'style="opacity:0.55"' : ''}>
          <td>${escapeHtml(f.brand)}${f.archived ? ' <span class="badge draft">Archived</span>' : ''}</td>
          <td>${escapeHtml(f.colorName)}</td>
          <td><select class="ihf-stock-item"><option value="">Select stock item…</option>${stockOptions.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} (${escapeHtml(String(item.stockQty))})</option>`).join('')}</select><button class="btn small" data-action="transfer" type="button">+ Roll</button></td>
          <td>${escapeHtml(String(f.rollsAvailable))}</td>
          <td>${escapeHtml(f.filamentType)} · ${escapeHtml(String(f.weightG))}g / ${escapeHtml(String(f.rollLengthM))}m</td>
          <td>${formatRand(f.costPerRollRand)}</td>
          <td>${escapeHtml(f.remainingG.toFixed(0))}g / ${escapeHtml(f.percentLeft != null ? Math.round(f.percentLeft * 100) : '—')}%</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small" data-action="archive" type="button">${f.archived ? 'Unarchive' : 'Archive'}</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  const form = state.editingInHouseFilament;
  $('#view-in-house-filament').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-in-house-filament" type="button">+ Filament</button>
      <input id="ihf-filter-q" type="search" placeholder="Search brand, type, colour…" value="${escapeAttr(state.inHouseFilters.q)}" />
      <select id="ihf-filter-brand"><option value="">All brands</option>${filterBrandNames.map((brand) => `<option value="${escapeAttr(brand)}" ${state.inHouseFilters.brand === brand ? 'selected' : ''}>${escapeHtml(brand)}</option>`).join('')}</select>
      <span class="muted">${escapeHtml(String(filtered.length))} of ${escapeHtml(String(filaments.length))} filaments</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:600px">
        <div class="section-head"><h3>${form.id ? 'Edit filament' : 'New filament'}</h3></div>
        <div class="grid-2">
          <label class="field"><span>Brand</span><select id="ihf-brand"><option value="">Select brand…</option>${activeBrandNames.map((brand) => `<option value="${escapeAttr(brand)}" ${form.brand === brand ? 'selected' : ''}>${escapeHtml(brand)}</option>`).join('')}</select></label>
          <label class="field"><span>Filament Type</span><input id="ihf-type" value="${escapeAttr(form.filamentType)}" placeholder="PLA" /></label>
          <label class="field"><span>Color Name</span><input id="ihf-color" value="${escapeAttr(form.colorName)}" placeholder="Black" /></label>
        </div>
        <div class="grid-4">
          <label class="field"><span>Rolls Available</span><input id="ihf-rolls" type="number" min="0" step="1" value="${escapeAttr(String(form.rollsAvailable))}" /></label>
          <label class="field"><span>Weight per Roll (g)</span><input id="ihf-weight" type="number" min="0" step="1" value="${escapeAttr(String(form.weightG))}" /></label>
          <label class="field"><span>Length per Roll (m)</span><input id="ihf-length" type="number" min="0" step="1" value="${escapeAttr(String(form.rollLengthM))}" /></label>
          <label class="field"><span>Cost per Roll (R)</span><input id="ihf-cost" type="number" min="0" step="1" value="${escapeAttr(String(form.costPerRollRand))}" /></label>
        </div>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-in-house-filament" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-in-house-filament" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Brand</th><th>Color</th><th>Add roll from Stock Management</th><th>Rolls</th><th>Type / per-roll spec</th><th>Cost/roll</th><th>Remaining</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8"><div class="empty">No in-house filament logged yet</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#new-in-house-filament').addEventListener('click', async () => { state.editingInHouseFilament = blankInHouseFilament(); await renderInHouseFilament(); });
  $('#ihf-filter-q').addEventListener('input', async () => { state.inHouseFilters.q = $('#ihf-filter-q').value; await renderInHouseFilament(); });
  $('#ihf-filter-brand').addEventListener('change', async () => { state.inHouseFilters.brand = $('#ihf-filter-brand').value; await renderInHouseFilament(); });
  $$('#view-in-house-filament tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { filament } = await api(`/api/in-house-filament/${tr.dataset.id}`);
      state.editingInHouseFilament = filament;
      await renderInHouseFilament();
    });
    tr.querySelector('[data-action="archive"]').addEventListener('click', async () => {
      const f = filaments.find((x) => x.id === tr.dataset.id);
      try {
        await api(`/api/in-house-filament/${tr.dataset.id}/archive`, { method: 'PATCH', body: JSON.stringify({ archived: !f.archived }) });
        toast(f.archived ? 'Unarchived' : 'Archived — hidden from the print-job picker, history kept');
        await renderInHouseFilament();
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this in-house filament?')) return;
      try {
        await api(`/api/in-house-filament/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderInHouseFilament();
      } catch (ex) {
        toast(ex.message === 'Cannot delete — this filament has been used in a logged print job.' ? ex.message + ' Use Archive instead.' : ex.message);
      }
    });
    tr.querySelector('[data-action="transfer"]').addEventListener('click', async () => {
      const stockItemId = $('.ihf-stock-item', tr).value;
      if (!stockItemId) return toast('Select a Stock Management item first');
      try {
        await api(`/api/in-house-filament/${tr.dataset.id}/transfer-roll`, { method: 'POST', body: JSON.stringify({ stockItemId }) });
        toast('Roll transferred to in-house stock');
        await renderInHouseFilament();
      } catch (ex) { toast(ex.message); }
    });
  });

  if (form) {
    $('#cancel-in-house-filament').addEventListener('click', async () => { state.editingInHouseFilament = null; await renderInHouseFilament(); });
    $('#save-in-house-filament').addEventListener('click', async () => {
      const payload = {
        brand: $('#ihf-brand').value,
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
          <td>${formatRand(p.totalValue)}</td>
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
          <label class="field"><span>Total Value (R)</span><input id="pu-value" type="number" min="0" step="1" value="${escapeAttr(String(form.totalValue))}" /></label>
          <label class="field"><span>Status</span>
            <select id="pu-status">
              <option value="outstanding" ${form.status === 'outstanding' ? 'selected' : ''}>Outstanding</option>
              <option value="paid" ${form.status === 'paid' ? 'selected' : ''}>Paid</option>
            </select>
          </label>
          <label class="field"><span>Payment Type</span><input id="pu-payment-type" value="${escapeAttr(form.paymentType)}" placeholder="e.g. Card, EFT" /></label>
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
  state.newsletterBlocks = state.newsletterBlocks || [{ type: 'heading', text: 'Lapanza 3D' }, { type: 'text', text: '' }];
  const [{ campaigns }, { analytics }, { recipients }, { templates }, { assets }] = await Promise.all([api('/api/newsletter-campaigns'), api('/api/newsletter-campaigns/analytics'), api('/api/newsletter-recipients'), api('/api/newsletter-templates'), api('/api/newsletter-assets')]);
  const blockEditor = state.newsletterBlocks.map((block, index) => `
    <div class="newsletter-block" data-block-index="${index}">
      <select class="nb-type"><option value="heading" ${block.type === 'heading' ? 'selected' : ''}>Heading</option><option value="text" ${block.type === 'text' ? 'selected' : ''}>Text</option><option value="image" ${block.type === 'image' ? 'selected' : ''}>Image</option><option value="button" ${block.type === 'button' ? 'selected' : ''}>Button</option><option value="divider" ${block.type === 'divider' ? 'selected' : ''}>Divider</option></select>
      <input class="nb-text" value="${escapeAttr(block.text || '')}" placeholder="${block.type === 'button' ? 'Button label' : 'Content'}" />
      ${['image', 'button'].includes(block.type) ? `<input class="nb-url" value="${escapeAttr(block.url || '')}" placeholder="${block.type === 'image' ? 'Image URL' : 'Button URL'}" />` : ''}
      ${block.type === 'image' ? `<input class="nb-alt" value="${escapeAttr(block.alt || '')}" placeholder="Image alt text" />` : ''}
      <button class="btn small nb-remove" type="button">Remove</button>
    </div>`).join('');

  const rows = campaigns
    .map(
      (c) => `
        <tr data-id="${escapeAttr(c.id)}">
          <td>${escapeHtml(c.subject)}</td>
          <td>${campaignStatusBadge(c.status)}</td>
          <td>${formatDate(c.createdAt)}</td>
          <td>${escapeHtml(String(c.selectedCount))} selected · ${escapeHtml(String(c.sentCount))} sent${c.failedCount ? ` · ${escapeHtml(String(c.failedCount))} failed` : ''}</td>
          <td>
            ${c.status === 'draft' ? '<button class="btn small" data-action="approve" type="button">Approve</button>' : ''}
            ${['approved', 'partial'].includes(c.status) ? '<button class="btn small" data-action="test" type="button">Send test</button><button class="btn small btn-primary" data-action="send" type="button">Send</button>' : ''}
            <button class="btn small" data-action="recipients" type="button">Report</button>
          </td>
        </tr>`,
    )
    .join('');

  $('#view-newsletter').innerHTML = `
    <div class="newsletter-analytics panel">
      <div><span>Campaigns</span><strong>${escapeHtml(String(analytics.campaignCount))}</strong></div>
      <div><span>Saved Audience</span><strong>${escapeHtml(String(analytics.audienceCount))}</strong></div>
      <div><span>Accepted by Mail Server</span><strong>${escapeHtml(String(analytics.acceptedCount))}</strong></div>
      <div><span>Failed</span><strong>${escapeHtml(String(analytics.failedCount))}</strong></div>
      <div><span>Acceptance Rate</span><strong>${analytics.acceptanceRate === null ? '—' : `${escapeHtml(String(analytics.acceptanceRate))}%`}</strong></div>
      <p class="muted newsletter-analytics-note">Acceptance confirms Gmail accepted the message for delivery; it does not confirm opens, clicks, or inbox placement.</p>
      ${analytics.bySource.length ? `<div class="newsletter-source-summary">${analytics.bySource.map((source) => `<span>${escapeHtml(source.sourceType)}: ${escapeHtml(String(source.acceptedCount))}/${escapeHtml(String(source.audienceCount))} accepted</span>`).join('')}</div>` : ''}
    </div>
    <div class="panel stack gap-3">
      <div class="section-head"><div><h3>Compose Newsletter</h3><p class="muted">Select only recipients with confirmed newsletter consent or recorded client email-marketing consent.</p></div></div>
      <label class="field"><span>Subject</span><input id="nc-subject" value="${escapeAttr(state.newsletterSubject || '')}" /></label>
      <div class="grid-3"><label class="field"><span>Use Template</span><select id="nc-template"><option value="">Choose a saved template…</option>${templates.map((template) => `<option value="${escapeAttr(template.id)}">${escapeHtml(template.name)}</option>`).join('')}</select></label><label class="field"><span>Upload Image</span><input id="nc-image-upload" type="file" accept="image/jpeg,image/png,image/webp" /></label><label class="field"><span>Import HTML Template</span><input id="nc-template-upload" type="file" accept=".html,.htm,text/html" /></label></div>
      <div class="newsletter-assets">${assets.map((asset) => `<button class="newsletter-asset" type="button" data-asset-url="${escapeAttr(asset.url)}" data-asset-alt="${escapeAttr(asset.altText)}"><img src="${escapeAttr(asset.url)}" alt="${escapeAttr(asset.altText)}" /></button>`).join('')}</div>
      <div id="newsletter-block-editor" class="stack gap-2">${blockEditor}</div>
      <div class="row-card-actions"><button class="btn small" id="nc-add-block" type="button">+ Content block</button><button class="btn small" id="nc-save-template" type="button">Save as template</button><button class="btn small" id="nc-preview" type="button">Preview</button></div>
      <iframe id="nc-preview-frame" class="newsletter-preview hidden" title="Newsletter preview"></iframe>
      <div class="newsletter-recipient-picker">
        <div class="section-head"><strong>Eligible recipients (${escapeHtml(String(recipients.length))})</strong><label class="field checkbox"><input id="nc-select-all" type="checkbox" /><span>Select All</span></label></div>
        <div class="newsletter-recipient-list">${recipients.map((recipient) => `<label class="newsletter-recipient"><input class="nc-recipient" type="checkbox" value="${escapeAttr(recipient.key)}" /><span><strong>${escapeHtml(recipient.name || recipient.email)}</strong><small>${escapeHtml(recipient.email)} · ${escapeHtml(recipient.sourceType)}</small></span></label>`).join('') || '<p class="muted">No eligible recipients. Record client email-marketing consent or wait for a subscriber to confirm.</p>'}</div>
      </div>
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
    const blocks = collectNewsletterBlocks();
    const recipientKeys = $$('.nc-recipient:checked', $('#view-newsletter')).map((input) => input.value);
    try {
      await api('/api/newsletter-campaigns', { method: 'POST', body: JSON.stringify({ subject, blocks, recipientKeys, importedHtml: state.newsletterImportedTemplate?.bodyHtml || '' }) });
      toast('Campaign saved as draft');
      await renderNewsletterCampaigns();
    } catch (ex) {
      toast(ex.message);
    }
  });
  function collectNewsletterBlocks() {
    return $$('#newsletter-block-editor [data-block-index]', $('#view-newsletter')).map((row) => ({ type: $('.nb-type', row).value, text: $('.nb-text', row)?.value || '', url: $('.nb-url', row)?.value || '', alt: $('.nb-alt', row)?.value || '' }));
  }
  function saveDraftState() { state.newsletterSubject = $('#nc-subject').value; state.newsletterBlocks = collectNewsletterBlocks(); }
  $('#nc-add-block').addEventListener('click', async () => { saveDraftState(); state.newsletterBlocks.push({ type: 'text', text: '' }); await renderNewsletterCampaigns(); });
  $$('.nb-remove', $('#view-newsletter')).forEach((button) => button.addEventListener('click', async () => { saveDraftState(); state.newsletterBlocks.splice(Number(button.closest('[data-block-index]').dataset.blockIndex), 1); await renderNewsletterCampaigns(); }));
  $('#nc-template').addEventListener('change', async (event) => { const template = templates.find((item) => item.id === event.target.value); if (template) { state.newsletterBlocks = template.blocks; state.newsletterImportedTemplate = template.blocks.length ? null : template; state.newsletterSubject = template.subject; await renderNewsletterCampaigns(); } });
  $$('.newsletter-asset', $('#view-newsletter')).forEach((button) => button.addEventListener('click', async () => { saveDraftState(); state.newsletterBlocks.push({ type: 'image', url: button.dataset.assetUrl, alt: button.dataset.assetAlt }); await renderNewsletterCampaigns(); }));
  $('#nc-image-upload').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; const form = new FormData(); form.append('image', file); let data; try { data = await uploadFormData('/api/newsletter-assets', form); } catch (ex) { return toast(ex.message); } saveDraftState(); state.newsletterBlocks.push({ type: 'image', url: data.asset.url, alt: data.asset.altText }); await renderNewsletterCampaigns(); });
  $('#nc-template-upload').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; const form = new FormData(); form.append('template', file); form.append('name', file.name.replace(/\.html?$/i, '')); form.append('subject', $('#nc-subject').value); let data; try { data = await uploadFormData('/api/newsletter-templates/import', form); } catch (ex) { return toast(ex.message); } state.newsletterImportedTemplate = data.template; state.newsletterBlocks = []; state.newsletterSubject = data.template.subject; toast('HTML template imported'); await renderNewsletterCampaigns(); });
  $('#nc-save-template').addEventListener('click', async () => { const name = prompt('Template name:'); if (!name) return; try { await api('/api/newsletter-templates', { method: 'POST', body: JSON.stringify({ name, subject: $('#nc-subject').value, blocks: collectNewsletterBlocks() }) }); toast('Template saved'); await renderNewsletterCampaigns(); } catch (error) { toast(error.message); } });
  $('#nc-preview').addEventListener('click', () => { const blocks = collectNewsletterBlocks(); const html = state.newsletterImportedTemplate?.bodyHtml || blocks.map((block) => block.type === 'heading' ? `<h1>${escapeHtml(block.text)}</h1>` : block.type === 'text' ? `<p>${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>` : block.type === 'image' ? `<img src="${escapeAttr(block.url)}" alt="${escapeAttr(block.alt)}" style="max-width:100%">` : block.type === 'button' ? `<p><a href="${escapeAttr(block.url)}">${escapeHtml(block.text)}</a></p>` : '<hr>').join(''); const frame = $('#nc-preview-frame'); frame.srcdoc = `<main style="max-width:640px;margin:auto;font:16px Arial;padding:24px">${html}</main>`; frame.classList.remove('hidden'); });
  $('#nc-select-all').addEventListener('change', (event) => $$('.nc-recipient', $('#view-newsletter')).forEach((input) => { input.checked = event.target.checked; }));

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
      if (!confirm('Queue this campaign for its saved recipients now?')) return;
      try {
        const { campaign } = await api(`/api/newsletter-campaigns/${tr.dataset.id}/send`, { method: 'POST' });
        toast(`Campaign is sending to ${campaign.selectedCount} selected recipient(s)`);
        await renderNewsletterCampaigns();
        setTimeout(() => renderNewsletterCampaigns().catch(() => {}), 3000);
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="test"]')?.addEventListener('click', async () => {
      const email = prompt('Send a test email to:');
      if (!email) return;
      try {
        await api(`/api/newsletter-campaigns/${tr.dataset.id}/test`, { method: 'POST', body: JSON.stringify({ email }) });
        toast('Test email sent');
      } catch (ex) {
        toast(ex.message);
      }
    });
    tr.querySelector('[data-action="recipients"]')?.addEventListener('click', async () => {
      const { recipients: selected } = await api(`/api/newsletter-campaigns/${tr.dataset.id}/recipients`);
      const summary = selected.map((recipient) => `${recipient.email} — ${recipient.status}${recipient.failureReason ? ` (${recipient.failureReason})` : ''}`).join('\n');
      alert(summary || 'No recipients selected.');
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
        <h3>Compose WhatsApp Update</h3>
        ${configured ? '' : '<span class="badge draft">Not Configured</span>'}
      </div>
      ${configured ? '' : '<p class="muted">Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env to enable sending -- see .env.example.</p>'}
      <label class="field"><span>Template Name (Meta-approved)</span><input id="wc-template" /></label>
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
  return { id: null, name: '', optionType: 'fixed', minWeight: 0, maxWeight: '', price: 0, active: true, category: '' };
}

// Groups the flat option list under a subheading row per category --
// PUDO Locker/Local Delivery/Courier are backfilled automatically (see
// ensureShippingCategoryColumn in db.js), anything else is whatever the
// admin has since typed. Uncategorised options (a fresh "+ Shipping
// option" that hasn't been saved with one yet) get their own bucket rather
// than being hidden or crashing the group.
function shippingRowsGroupedByCategory(shippingOptions) {
  const groups = new Map();
  shippingOptions.forEach((o) => {
    const key = o.category || 'Uncategorised';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function shippingOptionRowHtml(o) {
  return `
    <tr data-id="${escapeAttr(o.id)}">
      <td>${escapeHtml(o.name)}</td>
      <td>${o.optionType === 'fixed' ? '<span class="badge">Flat Rate</span>' : `${escapeHtml(String(o.minWeight))}g – ${o.maxWeight == null ? '∞' : `${escapeHtml(String(o.maxWeight))}g`}`}</td>
      <td>${formatRand(o.price)}</td>
      <td>${o.active ? '<span class="badge published">Active</span>' : '<span class="badge draft">Inactive</span>'}</td>
      <td>
        <button class="btn small" data-action="edit" type="button">Edit</button>
        <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
      </td>
    </tr>`;
}

async function renderShipping() {
  state.editingShipping = state.editingShipping || null;
  const { shippingOptions } = await api('/api/shipping-options');

  const rows = shippingRowsGroupedByCategory(shippingOptions)
    .map(
      ([category, options]) =>
        `<tr class="row-group-header"><td colspan="5"><strong>${escapeHtml(category)}</strong> <span class="muted">(${escapeHtml(String(options.length))})</span></td></tr>` +
        options.map(shippingOptionRowHtml).join(''),
    )
    .join('');

  const categorySuggestions = [...new Set(shippingOptions.map((o) => o.category).filter(Boolean))];
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
        <label class="field"><span>Category</span><input id="sf-category" list="sf-category-list" value="${escapeAttr(form.category || '')}" placeholder="e.g. PUDO Locker, Local Delivery, Courier" />
          <datalist id="sf-category-list">${categorySuggestions.map((c) => `<option value="${escapeAttr(c)}"></option>`).join('')}</datalist>
        </label>
        <label class="field"><span>Type</span>
          <select id="sf-type">
            <option value="fixed" ${isFixed ? 'selected' : ''}>Flat rate — customer/admin picks by name (PUDO, local delivery)</option>
            <option value="auto_weight" ${!isFixed ? 'selected' : ''}>Weight bracket — auto-matched to cart weight (courier)</option>
          </select>
        </label>
        <div class="grid-3" id="sf-weight-fields" style="${isFixed ? 'display:none' : ''}">
          <label class="field"><span>Min Weight (g)</span><input id="sf-min" type="number" min="0" step="1" value="${escapeAttr(String(form.minWeight))}" /></label>
          <label class="field"><span>Max Weight (g, Blank = No Limit)</span><input id="sf-max" type="number" min="0" step="1" value="${escapeAttr(String(form.maxWeight ?? ''))}" /></label>
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
        category: $('#sf-category').value.trim(),
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

// ---- Promo codes (#99) ----

function blankPromo() {
  return { id: null, code: '', kind: 'percent', value: 10, minSubtotal: 0, expiresAt: '', maxUses: '', active: true };
}

async function renderPromos() {
  state.editingPromo = state.editingPromo || null;
  const { promoCodes } = await api('/api/promo-codes');
  const form = state.editingPromo;

  const rows = promoCodes
    .map((p) => `
      <tr data-id="${escapeAttr(p.id)}">
        <td><strong>${escapeHtml(p.code)}</strong></td>
        <td>${p.kind === 'percent' ? `${escapeHtml(String(p.value))}% off` : `${formatRand(p.value)} off`}</td>
        <td>${p.minSubtotal ? `min ${formatRand(p.minSubtotal)}` : '—'}</td>
        <td>${p.expiresAt ? escapeHtml(String(p.expiresAt).slice(0, 10)) : '—'}</td>
        <td>${escapeHtml(String(p.usedCount))}${p.maxUses !== null ? ` / ${escapeHtml(String(p.maxUses))}` : ''}</td>
        <td>${p.active ? '<span class="badge published">Active</span>' : '<span class="badge draft">Inactive</span>'}</td>
        <td><button class="btn small" data-action="edit" type="button">Edit</button></td>
      </tr>`)
    .join('');

  $('#view-promos').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-promo" type="button">+ Promo code</button>
      <span class="muted">${escapeHtml(String(promoCodes.length))} codes · discounts stack after volume pricing · codes are case-insensitive</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:600px">
        <div class="section-head"><h3>${form.id ? 'Edit promo code' : 'New promo code'}</h3></div>
        <label class="field"><span>Code</span><input id="pc-code" value="${escapeAttr(form.code)}" placeholder="e.g. SPRING10" /></label>
        <div class="grid-2">
          <label class="field"><span>Type</span>
            <select id="pc-kind">
              <option value="percent" ${form.kind === 'percent' ? 'selected' : ''}>% off the order</option>
              <option value="fixed" ${form.kind === 'fixed' ? 'selected' : ''}>Fixed R off the order</option>
            </select>
          </label>
          <label class="field"><span>Value</span><input id="pc-value" type="number" min="1" step="0.5" value="${escapeAttr(String(form.value))}" /></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Min Order (R, 0 = None)</span><input id="pc-min" type="number" min="0" step="1" value="${escapeAttr(String(form.minSubtotal))}" /></label>
          <label class="field"><span>Expires (Blank = Never)</span><input id="pc-expires" type="date" value="${escapeAttr(String(form.expiresAt || '').slice(0, 10))}" /></label>
          <label class="field"><span>Max Uses (Blank = Unlimited)</span><input id="pc-max" type="number" min="1" step="1" value="${escapeAttr(String(form.maxUses ?? ''))}" /></label>
        </div>
        <label class="field checkbox"><input id="pc-active" type="checkbox" ${form.active ? 'checked' : ''} /><span>Active</span></label>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-promo" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-promo" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Code</th><th>Discount</th><th>Min order</th><th>Expires</th><th>Uses</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No promo codes yet — create one and share it in a campaign</div></td></tr>'}</tbody>
      </table>
    </div>`;

  $('#new-promo').addEventListener('click', async () => { state.editingPromo = blankPromo(); await renderPromos(); });
  $$('#view-promos tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', () => {
      const p = promoCodes.find((x) => x.id === tr.dataset.id);
      state.editingPromo = { ...p, maxUses: p.maxUses ?? '', expiresAt: p.expiresAt || '' };
      renderPromos();
    });
  });

  if (form) {
    $('#cancel-promo').addEventListener('click', async () => { state.editingPromo = null; await renderPromos(); });
    $('#save-promo').addEventListener('click', async () => {
      const expires = $('#pc-expires').value;
      const payload = {
        code: $('#pc-code').value.trim(),
        kind: $('#pc-kind').value,
        value: Number($('#pc-value').value) || 0,
        minSubtotal: Number($('#pc-min').value) || 0,
        // Stored as end-of-day so a code "expiring the 15th" still works ON
        // the 15th -- matches how people read an expiry date.
        expiresAt: expires ? `${expires}T23:59:59.999Z` : null,
        maxUses: $('#pc-max').value === '' ? null : Number($('#pc-max').value),
        active: $('#pc-active').checked,
      };
      try {
        if (form.id) await api(`/api/promo-codes/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        else await api('/api/promo-codes', { method: 'POST', body: JSON.stringify(payload) });
        toast('Promo code saved');
        state.editingPromo = null;
        await renderPromos();
      } catch (ex) {
        toast(ex.message);
      }
    });
  }
}

// ---- Stock management (unified bulk-edit grid) ----

// Fixed section order for the grouped view -- Car Parts is a UI grouping
// only (no inventory row's own `category` is ever literally "Car Parts";
// GWM/Landrover items carry their own product name as category, same as
// Toys/Phones/Homeware do), so it nests two child sections instead of
// matching directly. Anything whose category doesn't match any of these
// (a future new catalog category, added without an admin.js update) falls
// into a trailing "Other" catch-all appended at render time rather than
// silently vanishing from the page.
// Review #6 (todo #145): see dynamicGroupDefs -- stock groups come from the
// live inventory's own category names, matching the Product Catalog page.
function stockGroupDefs(items) {
  const names = [...new Set(items.map((i) => i.category).filter((c) => c && c !== 'Filament'))];
  return dynamicGroupDefs(names, (name) => (cat) => cat === name, (cat) => cat === 'Filament');
}

function stockRowHtml(item) {
  const edit = state.stockEdits[item.id] || {};
  const stockVal = edit.stockQty ?? item.stockQty;
  const priceVal = edit.price ?? item.price;
  const listedVal = edit.listed ?? item.listed !== false;
  const dirty = edit.stockQty !== undefined || edit.price !== undefined || edit.listed !== undefined;
  // Phase 3: spool-level fields only exist for filament rows -- read-only
  // here, written only by logging a print job (see renderPrintJobs()).
  const spoolCell = item.kind === 'filament'
    ? `${escapeHtml(item.remainingG != null ? item.remainingG.toFixed(0) : '—')}g / ${escapeHtml(item.percentLeft != null ? Math.round(item.percentLeft * 100) : '—')}%`
    : '—';
  const radioName = `listed-${escapeAttr(item.id)}`;
  return `
        <tr data-id="${escapeAttr(item.id)}" class="${dirty ? 'row-dirty' : ''}">
          <td><code>${escapeHtml(item.sku || '—')}</code></td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td><input type="number" min="0" step="1" class="stock-input" data-field="stockQty" value="${escapeAttr(String(stockVal))}" style="width:5rem" /></td>
          <td><input type="number" min="0" step="1" class="stock-input" data-field="price" value="${escapeAttr(String(priceVal))}" style="width:6rem" /></td>
          <td class="muted" style="font-size:0.85rem">${spoolCell}</td>
          <td style="white-space:nowrap;font-size:0.85rem">
            <label style="margin-right:0.75rem"><input type="radio" class="stock-listed" name="${radioName}" data-field="listed" value="1" ${listedVal ? 'checked' : ''} /> Listed</label>
            <label><input type="radio" class="stock-listed" name="${radioName}" data-field="listed" value="0" ${listedVal ? '' : 'checked'} /> Not listed</label>
          </td>
          <td class="muted" data-status style="font-size:0.8rem">${dirty ? 'Edited' : ''}</td>
        </tr>`;
}

const STOCK_TABLE_HEAD = '<thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Stock</th><th>Price (R)</th><th>Remaining (filament)</th><th>Products page</th><th></th></tr></thead>';

// Renders one leaf section (a real <details> with its own mini-table).
// `forceOpen` wins over the remembered collapse state -- used while
// searching so a match is never hidden behind a section the admin had
// manually collapsed earlier.
function stockSectionHtml(key, label, items, forceOpen) {
  const open = forceOpen || !state.stockCollapsed.has(key);
  const rows = items.map(stockRowHtml).join('');
  // data-initial-open: some browsers fire a spurious 'toggle' event the
  // moment a freshly-inserted `<details open>` is parsed (no user action
  // involved) -- the toggle listener below uses this to tell that apart
  // from a real click and avoid corrupting the remembered collapse state.
  return `
    <details class="stock-section" data-group="${escapeAttr(key)}" data-initial-open="${open}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(label)} <span class="muted">(${items.length})</span></summary>
      <div class="panel table-wrap">
        <table class="catalog">
          ${STOCK_TABLE_HEAD}
          <tbody>${rows || '<tr><td colspan="8"><div class="empty">No items</div></td></tr>'}</tbody>
        </table>
      </div>
    </details>`;
}

async function renderStock() {
  state.stockQ = state.stockQ || '';
  state.stockPriceMin = state.stockPriceMin ?? '';
  state.stockPriceMax = state.stockPriceMax ?? '';
  state.stockEdits = state.stockEdits || {}; // id -> { stockQty?, price? }
  state.stockCollapsed = state.stockCollapsed || new Set(); // group keys currently collapsed -- survives re-render (e.g. after Save)
  await ensureSettingsLoaded(); // carPartBrands drives the Car Parts nesting
  const { items } = await api('/api/inventory');
  state.stockItems = items;

  const needle = state.stockQ.trim().toLowerCase();
  const priceMin = state.stockPriceMin === '' ? null : Number(state.stockPriceMin);
  const priceMax = state.stockPriceMax === '' ? null : Number(state.stockPriceMax);
  const searching = needle.length > 0 || priceMin !== null || priceMax !== null;
  const filtered = items.filter((i) => {
    if (needle && ![i.sku, i.name, i.category].filter(Boolean).some((v) => v.toLowerCase().includes(needle))) return false;
    if (priceMin !== null && Number(i.price) < priceMin) return false;
    if (priceMax !== null && Number(i.price) > priceMax) return false;
    return true;
  });

  const claimed = new Set();
  const sectionsHtml = stockGroupDefs(items).map((def) => {
    if (def.children) {
      const childrenHtml = def.children
        .map((child) => {
          const childItems = filtered.filter((i) => child.match(i.category));
          childItems.forEach((i) => claimed.add(i.id));
          if (searching && !childItems.length) return '';
          return stockSectionHtml(child.key, child.label, childItems, searching);
        })
        .join('');
      const totalCount = def.children.reduce((n, child) => n + filtered.filter((i) => child.match(i.category)).length, 0);
      if (searching && !totalCount) return '';
      const open = searching || !state.stockCollapsed.has(def.key);
      return `
    <details class="stock-section stock-section-parent" data-group="${escapeAttr(def.key)}" data-initial-open="${open}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(def.label)} <span class="muted">(${totalCount})</span></summary>
      ${childrenHtml}
    </details>`;
    }
    const groupItems = filtered.filter((i) => def.match(i.category));
    groupItems.forEach((i) => claimed.add(i.id));
    if (searching && !groupItems.length) return '';
    return stockSectionHtml(def.key, def.label, groupItems, searching);
  }).join('');

  // Anything not claimed by a known category (e.g. a future new catalog
  // category) still shows up here instead of silently disappearing.
  const otherItems = filtered.filter((i) => !claimed.has(i.id));
  const otherHtml = otherItems.length || !searching ? stockSectionHtml('other', 'Other', otherItems, searching) : '';

  const dirtyCount = Object.keys(state.stockEdits).length;

  // #122: reorder report -- fetched alongside, rendered above the sections.
  let reorderHtml = '';
  try {
    const { items: reorderItems, threshold } = await api('/api/reorder-report');
    reorderHtml = `
    <details class="panel" ${reorderItems.length ? 'open' : ''} style="padding:0.75rem 1rem;margin-bottom:0.75rem">
      <summary class="section-head" style="cursor:pointer"><h3 style="display:inline">Reorder Report — ${reorderItems.length} item${reorderItems.length === 1 ? '' : 's'} at or below ${threshold} in stock</h3></summary>
      ${reorderItems.length
        ? `<div class="table-wrap"><table class="catalog">
        <thead><tr><th>Item</th><th>SKU</th><th>Category</th><th>In Stock</th><th>Sold (30 Days)</th></tr></thead>
        <tbody>${reorderItems
          .map(
            (i) => `<tr>
          <td>${escapeHtml(i.name)}</td>
          <td><code>${escapeHtml(i.sku || '—')}</code></td>
          <td>${escapeHtml(i.category || i.kind)}</td>
          <td style="font-weight:600;${Number(i.stockQty) <= 0 ? 'color:var(--danger, #c24b28)' : ''}">${escapeHtml(String(i.stockQty))}</td>
          <td>${escapeHtml(String(i.soldLast30Days))}</td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:0.8rem;margin:0.5rem 0 0">Threshold is the Low-stock Threshold in Settings → Storefront. Sold counts exclude cancelled orders.</p>`
        : '<p class="muted" style="margin:0.5rem 0 0">Nothing needs reordering right now.</p>'}
    </details>`;
  } catch { /* report is an extra -- stock editing must still work */ }

  const stockView = $('#view-stock');
  stockView.innerHTML = `
    ${reorderHtml}
    <div class="toolbar">
      <input id="stock-q" type="search" placeholder="Search SKU, name, category…" value="${escapeAttr(state.stockQ)}" />
      <input id="stock-price-min" type="number" min="0" step="1" placeholder="Min R" style="max-width:100px" value="${escapeAttr(String(state.stockPriceMin))}" />
      <input id="stock-price-max" type="number" min="0" step="1" placeholder="Max R" style="max-width:100px" value="${escapeAttr(String(state.stockPriceMax))}" />
      <span class="muted">${escapeHtml(String(filtered.length))} items</span>
      <button class="btn btn-primary" id="save-stock" type="button" ${dirtyCount ? '' : 'disabled'}>Save Changes${dirtyCount ? ` (${escapeHtml(String(dirtyCount))})` : ''}</button>
    </div>
    <div class="stack gap-3">${sectionsHtml}${otherHtml}</div>`;

  $$('#view-stock details.stock-section').forEach((el) => {
    el.addEventListener('toggle', () => {
      // Swallow the one spurious initial fire some browsers emit for a
      // freshly-parsed `<details open>` -- el.open still matches whatever
      // this render set it to, so it can't be a real click yet. Clearing
      // the marker means a genuine toggle right after is never mistaken
      // for another spurious one.
      if (el.dataset.initialOpen === String(el.open)) {
        delete el.dataset.initialOpen;
        return;
      }
      const key = el.dataset.group;
      if (el.open) state.stockCollapsed.delete(key);
      else state.stockCollapsed.add(key);
    });
  });

  $('#stock-q').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    state.stockQ = $('#stock-q').value.trim();
    await renderStock();
  });

  $('#stock-price-min').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    state.stockPriceMin = $('#stock-price-min').value.trim();
    await renderStock();
  });

  $('#stock-price-max').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    state.stockPriceMax = $('#stock-price-max').value.trim();
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

  $$('#view-stock .stock-listed').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const tr = radio.closest('tr');
      const id = tr.dataset.id;
      const statusEl = tr.querySelector('[data-status]');
      state.stockEdits[id] = state.stockEdits[id] || {};
      state.stockEdits[id].listed = radio.value === '1';
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
      // expectedStockQty = what this grid displayed at load; the server
      // rejects the row (instead of clobbering) if an order or another
      // admin changed it in the meantime.
      return { kind: item.kind, id: item.id, parentId: item.parentId, expectedStockQty: item.stockQty, ...state.stockEdits[id] };
    });
    const saveBtn = $('#save-stock');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const { results } = await api('/api/inventory', { method: 'PUT', body: JSON.stringify({ updates }) });
      const failed = results.filter((r) => !r.ok);
      toast(failed.length ? `${failed.length} item(s) failed to save — ${failed[0].error}` : 'Stock updated');
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
          <td>${r.active ? '<span class="badge published">Active</span>' : '<span class="badge draft">Hidden</span>'}</td>
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
          <label class="field"><span>Print Settings</span><input id="rf-print-settings" value="${escapeAttr(form.printSettings || '')}" placeholder="0.2mm layer, 20% infill" /></label>
          <label class="field"><span>Filament Type</span><input id="rf-filament-type" value="${escapeAttr(form.filamentType || '')}" placeholder="PLA" /></label>
          <label class="field"><span>Dimensions</span><input id="rf-dimensions" value="${escapeAttr(form.dimensions || '')}" placeholder="120 x 80 x 40mm" /></label>
        </div>
        <label class="field checkbox"><input id="rf-active" type="checkbox" ${form.active ? 'checked' : ''} /><span>Visible in Public Gallery</span></label>
        ${form.id ? `
          <div class="grid-2">
            <div class="field">
              <span>Cover image ${form.imagePath ? '(replace)' : ''}</span>
              <label class="btn small" for="rf-image-upload">Choose File</label>
              <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" id="rf-image-upload" />
              ${form.imagePath ? `<img src="${escapeAttr(form.imagePath)}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:4px;margin-top:0.5rem" />` : ''}
            </div>
            <div class="field">
              <span>Downloadable file ${form.filePath ? '(replace)' : ''}</span>
              <label class="btn small" for="rf-file-upload">Choose File</label>
              <input type="file" class="hidden" accept=".stl,.3mf,.obj,.gcode,.zip,.pdf" id="rf-file-upload" />
              ${form.filePath ? `<p class="muted" style="font-size:0.8rem;margin-top:0.5rem">Current: ${escapeHtml(form.fileOriginalName || form.filePath.split('/').pop())}</p>` : ''}
            </div>
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
        const data = await uploadFormData(`/api/resources/${form.id}/${endpoint}`, formData);
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

// ---- Testimonials (backlog #51) ----

function blankTestimonial() {
  return {
    id: null, customerName: '', displayName: '', consentGiven: false, consentNote: '',
    testimonialDate: '', quote: '', linkUrl: '', linkLabel: '', status: 'draft', imagePath: null,
  };
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function testimonialsViewHtml(testimonials, form) {
  const rows = testimonials
    .map(
      (t) => `
        <tr data-id="${escapeAttr(t.id)}">
          <td>${escapeHtml(t.displayName)}</td>
          <td class="muted" style="font-size:0.85rem">${escapeHtml(t.customerName)}</td>
          <td>${escapeHtml(truncate(t.quote, 60))}</td>
          <td>${escapeHtml(t.testimonialDate || '—')}</td>
          <td>${t.consentGiven ? '<span class="badge published">Consent on file</span>' : '<span class="badge draft">No consent recorded</span>'}</td>
          <td>${t.status === 'published' ? '<span class="badge published">Published</span>' : '<span class="badge draft">Draft</span>'}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  return `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-testimonial" type="button">+ Testimonial</button>
      <span class="muted">${escapeHtml(String(testimonials.length))} testimonials</span>
    </div>
    <p class="muted" style="margin:0 0 1rem;font-size:0.88rem;line-height:1.5">Admin-managed only -- there's no public submission form. Add a testimonial after getting a customer's explicit permission to quote them; a testimonial can't be Published without "Consent on file" checked below, regardless of what else is filled in.</p>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:700px">
        <div class="section-head"><h3>${form.id ? 'Edit testimonial' : 'New testimonial'}</h3></div>
        <div class="grid-2">
          <label class="field"><span>Customer's Real Name (internal only, never shown publicly)</span><input id="tf-customer-name" value="${escapeAttr(form.customerName)}" /></label>
          <label class="field"><span>Display Name (shown on the site)</span><input id="tf-display-name" value="${escapeAttr(form.displayName)}" placeholder="e.g. full name, first name only, or &quot;A happy customer&quot;" /></label>
        </div>
        <label class="field checkbox"><input id="tf-consent-given" type="checkbox" ${form.consentGiven ? 'checked' : ''} /><span>Consent on file -- this customer explicitly agreed to be quoted publicly</span></label>
        <label class="field"><span>Consent Note (internal -- how/when consent was obtained)</span><input id="tf-consent-note" value="${escapeAttr(form.consentNote || '')}" placeholder="e.g. WhatsApp message, 2026-08-28" /></label>
        <div class="grid-2">
          <label class="field"><span>Date</span><input id="tf-date" type="date" value="${escapeAttr(form.testimonialDate || '')}" /></label>
          <label class="field"><span>Status</span>
            <select id="tf-status">
              <option value="draft" ${form.status !== 'published' ? 'selected' : ''}>Draft</option>
              <option value="published" ${form.status === 'published' ? 'selected' : ''}>Published</option>
            </select>
          </label>
        </div>
        <label class="field"><span>Quote</span><textarea id="tf-quote" rows="3">${escapeHtml(form.quote || '')}</textarea></label>
        <div class="grid-2">
          <label class="field"><span>Project/Product Link (optional)</span><input id="tf-link-url" value="${escapeAttr(form.linkUrl || '')}" placeholder="e.g. car-parts/gwm.html" /></label>
          <label class="field"><span>Link Label (optional)</span><input id="tf-link-label" value="${escapeAttr(form.linkLabel || '')}" placeholder="e.g. GWM Cup Holder" /></label>
        </div>
        ${form.id ? `
          <div class="field">
            <span>Photo (optional) ${form.imagePath ? '(replace)' : ''}</span>
            <label class="btn small" for="tf-image-upload">Choose File</label>
            <input type="file" class="hidden" accept="image/jpeg,image/png,image/webp" id="tf-image-upload" />
            ${form.imagePath ? `<img src="${escapeAttr(form.imagePath)}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:4px;margin-top:0.5rem" />` : ''}
          </div>` : '<p class="muted" style="font-size:0.85rem">Save the testimonial first to enable a photo upload.</p>'}
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-testimonial" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-testimonial" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Display Name</th><th>Customer</th><th>Quote</th><th>Date</th><th>Consent</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">No testimonials yet</div></td></tr>'}</tbody>
      </table>
    </div>`;
}

async function renderTestimonials() {
  state.editingTestimonial = state.editingTestimonial || null;
  const { testimonials } = await api('/api/testimonials');

  const form = state.editingTestimonial;
  $('#view-testimonials').innerHTML = testimonialsViewHtml(testimonials, form);

  $('#new-testimonial').addEventListener('click', async () => { state.editingTestimonial = blankTestimonial(); await renderTestimonials(); });
  $$('#view-testimonials tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { testimonial } = await api(`/api/testimonials/${tr.dataset.id}`);
      state.editingTestimonial = testimonial;
      await renderTestimonials();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this testimonial?')) return;
      try {
        await api(`/api/testimonials/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderTestimonials();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (!form) return;

  $('#cancel-testimonial').addEventListener('click', async () => { state.editingTestimonial = null; await renderTestimonials(); });
  $('#save-testimonial').addEventListener('click', async () => {
    const payload = {
      customerName: $('#tf-customer-name').value,
      displayName: $('#tf-display-name').value,
      consentGiven: $('#tf-consent-given').checked,
      consentNote: $('#tf-consent-note').value,
      testimonialDate: $('#tf-date').value,
      status: $('#tf-status').value,
      quote: $('#tf-quote').value,
      linkUrl: $('#tf-link-url').value,
      linkLabel: $('#tf-link-label').value,
    };
    try {
      if (form.id) await api(`/api/testimonials/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/testimonials', { method: 'POST', body: JSON.stringify(payload) });
      toast('Testimonial saved');
      state.editingTestimonial = null;
      await renderTestimonials();
    } catch (ex) {
      toast(ex.message);
    }
  });

  const imageInput = $('#tf-image-upload');
  imageInput?.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const data = await uploadFormData(`/api/testimonials/${form.id}/image`, formData);
      state.editingTestimonial = data.testimonial;
      toast('Uploaded');
      await renderTestimonials();
    } catch (ex) {
      toast(ex.message);
    }
  });
}

// ---- Potential market (marketing-lead contacts) ----

const POTENTIAL_MARKET_STATUSES = ['Initial Load', 'Active', 'Inactive', 'Opt Out'];

function blankPotentialMarketContact() {
  return { id: null, name: '', surname: '', email: '', mobileNumber: '', status: 'Initial Load' };
}

// Minimal RFC4180-ish CSV parser -- handles quoted fields (embedded commas/
// newlines/escaped "") without a new dependency, matching this admin's
// zero-dependency convention. Header row maps loosely to our field names
// (case/space-insensitive: "Mobile Number" or "mobile" both work) so an
// export from a spreadsheet doesn't need exact column names.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const CSV_FIELD_ALIASES = {
  name: 'name',
  firstname: 'name',
  surname: 'surname',
  lastname: 'surname',
  email: 'email',
  emailaddress: 'email',
  mobile: 'mobileNumber',
  mobilenumber: 'mobileNumber',
  phone: 'mobileNumber',
  status: 'status',
};

function csvRowsToContacts(rows) {
  if (!rows.length) return [];
  const headerKeys = rows[0].map((h) => CSV_FIELD_ALIASES[h.trim().toLowerCase().replace(/[^a-z]/g, '')] || null);
  return rows.slice(1).map((r) => {
    const contact = {};
    headerKeys.forEach((key, i) => { if (key) contact[key] = (r[i] || '').trim(); });
    return contact;
  });
}

function potentialMarketStatusSelectHtml(id, status) {
  const opts = POTENTIAL_MARKET_STATUSES.map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('');
  return `<select class="pm-status-inline" data-id="${escapeAttr(id)}">${opts}</select>`;
}

function potentialMarketViewHtml(contacts, form) {
  const rows = contacts
    .map(
      (c) => `
        <tr data-id="${escapeAttr(c.id)}">
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.surname)}</td>
          <td>${escapeHtml(c.email || '—')}</td>
          <td>${escapeHtml(c.mobileNumber || '—')}</td>
          <td>${potentialMarketStatusSelectHtml(c.id, c.status)}</td>
          <td>
            <button class="btn small" data-action="edit" type="button">Edit</button>
            <button class="btn small btn-danger" data-action="delete" type="button">Delete</button>
          </td>
        </tr>`,
    )
    .join('');

  return `
    <div class="toolbar">
      <button class="btn btn-primary" id="new-potential-market" type="button">+ Contact</button>
      <label class="btn" for="pm-csv-upload">+ Upload CSV</label>
      <input type="file" class="hidden" id="pm-csv-upload" accept=".csv,text/csv" />
      <span class="muted">${escapeHtml(String(contacts.length))} contacts</span>
    </div>
    <p class="muted" style="margin:0 0 1rem;font-size:0.85rem">CSV columns: Name, Surname, Email, Mobile Number, Status (Status optional, defaults to Initial Load). Rows matching an existing contact by email (or by name+surname if no email) are skipped, not overwritten.</p>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:700px">
        <div class="section-head"><h3>${form.id ? 'Edit contact' : 'New contact'}</h3></div>
        <div class="grid-2">
          <label class="field"><span>Name *</span><input id="pm-name" value="${escapeAttr(form.name)}" /></label>
          <label class="field"><span>Surname *</span><input id="pm-surname" value="${escapeAttr(form.surname)}" /></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Email</span><input id="pm-email" type="email" value="${escapeAttr(form.email || '')}" /></label>
          <label class="field"><span>Mobile Number</span><input id="pm-mobile" value="${escapeAttr(form.mobileNumber || '')}" /></label>
        </div>
        <label class="field"><span>Status</span>
          <select id="pm-status">${POTENTIAL_MARKET_STATUSES.map((s) => `<option value="${s}" ${form.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </label>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-potential-market" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-potential-market" type="button">Cancel</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Name</th><th>Surname</th><th>Email</th><th>Mobile</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty">No potential market contacts yet</div></td></tr>'}</tbody>
      </table>
    </div>`;
}

async function renderPotentialMarket() {
  state.editingPotentialMarketContact = state.editingPotentialMarketContact || null;
  const { contacts } = await api('/api/potential-market');

  const form = state.editingPotentialMarketContact;
  $('#view-potential-market').innerHTML = potentialMarketViewHtml(contacts, form);

  $('#new-potential-market').addEventListener('click', async () => { state.editingPotentialMarketContact = blankPotentialMarketContact(); await renderPotentialMarket(); });

  $('#pm-csv-upload').addEventListener('change', async () => {
    const input = $('#pm-csv-upload');
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const contacts = csvRowsToContacts(parseCsv(text));
      if (!contacts.length) { toast('No rows found in that file'); return; }
      const result = await api('/api/potential-market/import', { method: 'POST', body: JSON.stringify({ contacts }) });
      toast(`${result.created} added, ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped`);
      await renderPotentialMarket();
    } catch (ex) {
      toast(ex.message);
    } finally {
      input.value = '';
    }
  });
  $$('#view-potential-market tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      const { contact } = await api(`/api/potential-market/${tr.dataset.id}`);
      state.editingPotentialMarketContact = contact;
      await renderPotentialMarket();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm('Delete this contact?')) return;
      try {
        await api(`/api/potential-market/${tr.dataset.id}`, { method: 'DELETE' });
        toast('Deleted');
        await renderPotentialMarket();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  // Inline status update, same convention as design-requests' inline select
  // -- no need to open "Edit" just to move a contact through the pipeline.
  $$('.pm-status-inline').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        const { contact } = await api(`/api/potential-market/${select.dataset.id}`, { method: 'PUT', body: JSON.stringify({ status: select.value }) });
        toast('Status updated');
        if (state.editingPotentialMarketContact?.id === contact.id) state.editingPotentialMarketContact = contact;
        await renderPotentialMarket();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (!form) return;

  $('#cancel-potential-market').addEventListener('click', async () => { state.editingPotentialMarketContact = null; await renderPotentialMarket(); });
  $('#save-potential-market').addEventListener('click', async () => {
    const payload = {
      name: $('#pm-name').value,
      surname: $('#pm-surname').value,
      email: $('#pm-email').value,
      mobileNumber: $('#pm-mobile').value,
      status: $('#pm-status').value,
    };
    try {
      if (form.id) await api(`/api/potential-market/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/potential-market', { method: 'POST', body: JSON.stringify(payload) });
      toast('Contact saved');
      state.editingPotentialMarketContact = null;
      await renderPotentialMarket();
    } catch (ex) {
      toast(ex.message);
    }
  });
}

// ---- Custom 3D design requests (Phase 2) ----

const DESIGN_REQUEST_STATUSES = ['new', 'quoted', 'in_progress', 'finalized'];
const DESIGN_REQUEST_STATUS_LABEL = {
  new: 'New',
  quoted: 'Quoted',
  in_progress: 'In progress',
  finalized: 'Finalized',
};

function designRequestStatusSelectHtml(id, status) {
  const opts = DESIGN_REQUEST_STATUSES.map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${DESIGN_REQUEST_STATUS_LABEL[s]}</option>`).join('');
  return `<select class="dr-status-inline" data-id="${escapeAttr(id)}">${opts}</select>`;
}

// #94: derived (server-computed, never admin-set) -- tracks the quote's own
// payment lifecycle independently of the New/In Progress/Finalized status
// above, which tracks the design/print WORK instead. Order Paid needs no
// admin action: it appears the instant the linked order's real status
// becomes paid/shipped/completed.
const QUOTE_STAGE_LABEL = { quoted: 'Quoted', order_placed: 'Order Placed', order_paid: 'Order Paid' };
const QUOTE_STAGE_BADGE_CLASS = { quoted: 'draft', order_placed: 'draft', order_paid: 'published' };
function quoteStageBadgeHtml(stage) {
  if (!stage) return '<span class="muted">—</span>';
  return `<span class="badge ${QUOTE_STAGE_BADGE_CLASS[stage]}">${QUOTE_STAGE_LABEL[stage]}</span>`;
}

async function renderDesignRequests() {
  state.editingDesignRequest = state.editingDesignRequest || null;
  await ensureSettingsLoaded();
  const { designRequests } = await api('/api/design-requests');

  const rows = designRequests
    .map(
      (r) => `
        <tr data-id="${escapeAttr(r.id)}">
          <td>${escapeHtml(r.name || '—')}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>${designRequestStatusSelectHtml(r.id, r.status)}</td>
          <td>${quoteStageBadgeHtml(r.quoteStage)}</td>
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
  const activeDepositTiers = (state.settings.quoteDepositOptions || []).filter((t) => t.active).sort((a, b) => a.pct - b.pct);
  const depositOptionsHtml = form
    ? activeDepositTiers.map((t) => `<option value="${t.pct}" ${(form.quoteDepositPct ?? 100) === t.pct ? 'selected' : ''}>${t.pct}%${t.pct === 100 ? ' (full payment)' : ''}</option>`).join('')
    : '';

  $('#view-design-requests').innerHTML = `
    <div class="toolbar">
      <span class="muted">${escapeHtml(String(designRequests.length))} requests</span>
    </div>
    ${form ? `
      <div class="panel stack gap-3" style="max-width:700px">
        <div class="section-head"><h3>Request from ${escapeHtml(form.name || form.email)}</h3></div>
      <p class="muted" style="margin:0;font-size:0.85rem">Uploaded reference files auto-delete a set number of months after a request is finalized (Settings → Storefront → Design-file Retention). The request record itself is kept.</p>
        <p class="muted" style="font-size:0.85rem">${escapeHtml(form.email)} ${form.phone ? `· ${escapeHtml(form.phone)}` : ''}</p>
        <label class="field"><span>Description</span><textarea readonly>${escapeHtml(form.description)}</textarea></label>
        ${form.serviceType || form.intendedUse || form.dimensions || (form.quantity || 1) > 1 || form.materialPref || form.colourPref || form.finishPref || form.urgency || form.deliveryPref ? `
        <div class="muted" style="font-size:0.85rem;line-height:1.6">
          ${form.serviceType ? `<div><strong>Service:</strong> ${form.serviceType === 'design_for_me' ? 'Design it for me' : 'Print my model'}</div>` : ''}
          ${form.intendedUse ? `<div><strong>Use:</strong> ${escapeHtml(form.intendedUse)}</div>` : ''}
          ${form.dimensions ? `<div><strong>Size:</strong> ${escapeHtml(form.dimensions)}</div>` : ''}
          ${(form.quantity || 1) > 1 ? `<div><strong>Quantity:</strong> ${escapeHtml(String(form.quantity))}</div>` : ''}
          ${form.materialPref ? `<div><strong>Material:</strong> ${escapeHtml(form.materialPref)}</div>` : ''}
          ${form.colourPref ? `<div><strong>Colour:</strong> ${escapeHtml(form.colourPref)}</div>` : ''}
          ${form.finishPref ? `<div><strong>Finish:</strong> ${escapeHtml(form.finishPref)}</div>` : ''}
          ${form.urgency ? `<div><strong>Urgency:</strong> ${escapeHtml(form.urgency)}</div>` : ''}
          ${form.deliveryPref ? `<div><strong>Delivery:</strong> ${escapeHtml(form.deliveryPref)}</div>` : ''}
        </div>` : ''}
        ${(form.files || []).length ? `
        <div class="stack gap-2" style="padding:10px;border:1px solid var(--line);border-radius:10px">
          <strong style="font-size:0.92rem">Uploaded Files (${form.files.length})</strong>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${form.files.map((f) => f.kind === 'image' ? `
              <a href="${escapeAttr(f.filePath)}" target="_blank" rel="noopener" title="${escapeAttr(f.originalName || '')}" style="display:block">
                <img src="${escapeAttr(f.filePath)}" alt="${escapeAttr(f.originalName || 'Uploaded image')}" style="width:110px;height:110px;object-fit:cover;border-radius:6px;border:1px solid var(--line)" />
              </a>` : `
              <div class="stack" style="gap:4px;justify-content:center;padding:8px 12px;border:1px solid var(--line);border-radius:6px;max-width:220px">
                <span style="font-size:0.82rem;word-break:break-all">${escapeHtml(f.originalName || f.filePath.split('/').pop())}</span>
                <div class="row-card-actions">
                  <a class="btn small" href="${escapeAttr(f.filePath)}" download="${escapeAttr(f.originalName || 'file')}">Download</a>
                  <a class="btn small btn-ghost" href="${escapeAttr(f.filePath)}" target="_blank" rel="noopener">Open</a>
                </div>
              </div>`).join('')}
          </div>
        </div>` : '<p class="muted" style="font-size:0.85rem">No files were uploaded with this request.</p>'}
        ${form.budgetNote ? `<p class="muted" style="font-size:0.85rem">Budget: ${escapeHtml(form.budgetNote)}</p>` : ''}
        <div class="grid-2">
          ${form.referenceImagePath ? `<img src="${escapeAttr(form.referenceImagePath)}" alt="Reference image" style="width:120px;height:120px;object-fit:cover;border-radius:4px" />` : ''}
          ${form.referenceFilePath ? `<a class="btn small" href="${escapeAttr(form.referenceFilePath)}" download="${escapeAttr(form.referenceFileOriginalName || form.referenceFilePath.split('/').pop())}" target="_blank" rel="noopener">${escapeHtml(form.referenceFileOriginalName || 'Reference file')}</a>` : ''}
        </div>
        <label class="field"><span>Status</span><select id="dr-status">${statusOptions}</select></label>
        ${form.finalizedAt ? `<p class="muted" style="font-size:0.85rem">Finalized ${escapeHtml(formatDate(form.finalizedAt))}</p>` : ''}
        <label class="field"><span>Admin Notes</span><textarea id="dr-notes">${escapeHtml(form.adminNotes || '')}</textarea></label>
        <div class="stack gap-2" style="padding-top:8px;border-top:1px solid var(--border)">
          <div class="row-card-actions"><strong style="font-size:0.92rem">Quote (#87)</strong>${quoteStageBadgeHtml(form.quoteStage)}</div>
          ${form.quoteStatus === 'accepted'
            ? `<p class="muted" style="margin:0">R${escapeHtml(String(form.quoteAmount))} quote, ${escapeHtml(String(form.quoteDepositPct ?? 100))}% (R${escapeHtml(String(Math.round((form.quoteAmount * (form.quoteDepositPct ?? 100)) / 100)))}) taken up front ${form.quoteOrderId ? `— payment order <code>${escapeHtml(form.quoteOrderId.slice(0, 8))}</code> (see Invoice History)` : ''}</p>`
            : `
          <div class="row-card-actions">
            <label class="field" style="max-width:180px"><span>Amount (R)</span><input id="dr-quote-amount" type="number" min="1" step="1" value="${escapeAttr(form.quoteAmount ? String(form.quoteAmount) : '')}" /></label>
            <label class="field" style="max-width:180px"><span>Deposit</span><select id="dr-quote-deposit-pct">${depositOptionsHtml}</select></label>
            <button class="btn small btn-primary" id="dr-send-quote" type="button">${form.quoteStatus === 'quoted' ? 'Update & Re-email Quote' : 'Save & Email Quote'}</button>
          </div>
          <label class="field"><span>Quote Terms (Shown to the Customer)</span><textarea id="dr-quote-terms" placeholder="e.g. Price includes design time and one revision. Balance due on collection.">${escapeHtml(form.quoteTerms || (state.settings.quoteTermsDefault || '').replace('{{depositPct}}', String(form.quoteDepositPct ?? activeDepositTiers[0]?.pct ?? 50)))}</textarea></label>
          <p class="muted" style="margin:0;font-size:0.78rem">Pre-filled from Settings → Storefront → Default Quote Terms — edit freely before sending.</p>
          ${form.quoteStatus === 'quoted' ? `<p class="muted" style="margin:0;font-size:0.85rem">Quoted R${escapeHtml(String(form.quoteAmount))} (${escapeHtml(String(form.quoteDepositPct ?? 100))}% deposit) on ${escapeHtml((form.quotedAt || '').slice(0, 10))} — awaiting customer acceptance.</p>` : ''}
          `}
        </div>
        <div class="row-card-actions">
          <button class="btn btn-primary" id="save-design-request" type="button">Save</button>
          <button class="btn btn-ghost" id="cancel-design-request" type="button">Close</button>
        </div>
      </div>` : ''}
    <div class="panel table-wrap">
      <table class="catalog">
        <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Quote Stage</th><th>Received</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty">No design requests yet</div></td></tr>'}</tbody>
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

  // Inline status update, no need to open "View" first -- fires from every
  // row's own select in the table, independent of whether the detail panel
  // (form) is currently open for a different (or the same) request.
  $$('.dr-status-inline').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        const { designRequest } = await api(`/api/design-requests/${select.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
        toast('Status updated — client notified');
        if (state.editingDesignRequest?.id === designRequest.id) state.editingDesignRequest = designRequest;
        await renderDesignRequests();
      } catch (ex) {
        toast(ex.message);
      }
    });
  });

  if (!form) return;

  $('#cancel-design-request').addEventListener('click', async () => { state.editingDesignRequest = null; await renderDesignRequests(); });
  // #87: save + email the quote in one action.
  $('#dr-send-quote')?.addEventListener('click', async () => {
    const btn = $('#dr-send-quote');
    btn.disabled = true;
    try {
      const { request, emailSent, emailError } = await api(`/api/design-requests/${form.id}/quote`, {
        method: 'PUT',
        body: JSON.stringify({ amount: Number($('#dr-quote-amount').value), terms: $('#dr-quote-terms').value, depositPct: Number($('#dr-quote-deposit-pct').value) }),
      });
      toast(emailSent ? 'Quote saved and emailed to the customer' : emailError || 'Quote saved (email failed)');
      state.editingDesignRequest = request;
      await renderDesignRequests();
    } catch (ex) {
      toast(ex.message);
      btn.disabled = false;
    }
  });
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

// ---------------------------------------------------------------------------
// #139: rich-text editor for product descriptions (filament description /
// colour note, category description, item details).
//
// The editor is a contenteditable div with a formatting toolbar, paired with
// a HIDDEN textarea that keeps the field's original data-field/data-item
// attribute -- so every existing binding (bindEditorEvents' input listeners,
// the per-row save readers) keeps reading `.value` untouched. The editor
// syncs its HTML into the textarea on every input and re-dispatches the
// event. server/rich-text.js re-sanitizes on save either way; the client
// mirror below only exists so the editor never renders stored markup that
// the server never approved (legacy pre-#139 values are raw text).
const RT_ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'DIV']);

function rtSanitizeToFragment(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const out = document.createDocumentFragment();
  const copy = (from, to) => {
    for (const node of Array.from(from.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(node.textContent));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!RT_ALLOWED_TAGS.has(node.tagName)) {
        copy(node, to); // drop the tag, keep its content
        continue;
      }
      const el = document.createElement(node.tagName === 'DIV' ? 'p' : node.tagName.toLowerCase());
      if (node.tagName === 'A') {
        const href = String(node.getAttribute('href') || '').trim();
        if (!/^https?:\/\//i.test(href)) {
          copy(node, to);
          continue;
        }
        el.setAttribute('href', href);
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      }
      copy(node, el);
      to.appendChild(el);
    }
  };
  copy(doc.body, out);
  return out;
}

const RT_TOOLBAR = [
  ['bold', 'B', 'Bold'],
  ['italic', 'I', 'Italic'],
  ['underline', 'U', 'Underline'],
  ['strikeThrough', 'S', 'Strikethrough'],
  ['h3', 'H3', 'Heading'],
  ['h4', 'H4', 'Small heading'],
  ['paragraph', '¶', 'Normal text'],
  ['insertUnorderedList', '• List', 'Bullet list'],
  ['insertOrderedList', '1. List', 'Numbered list'],
  ['link', 'Link', 'Insert link (https)'],
  ['unlink', 'Unlink', 'Remove link'],
  ['removeFormat', 'Clear', 'Clear formatting'],
];

function richTextField(attr, value) {
  // Value goes into the hidden textarea only -- the visible editor is filled
  // from it through rtSanitizeToFragment() by the boot-time observer below.
  return `<div class="rt-wrap">
    <div class="rt-toolbar" role="toolbar" aria-label="Text formatting">
      ${RT_TOOLBAR.map(([cmd, label, title]) => `<button type="button" tabindex="-1" data-rt-cmd="${cmd}" title="${title}">${label}</button>`).join('')}
    </div>
    <div class="rt-editor" contenteditable="true"></div>
    <textarea ${attr} hidden>${escapeHtml(value || '')}</textarea>
  </div>`;
}

function rtSync(wrap) {
  const editor = wrap.querySelector('.rt-editor');
  const textarea = wrap.querySelector('textarea');
  if (!editor || !textarea) return;
  textarea.value = editor.innerHTML;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function initRichTextEditors(root) {
  for (const wrap of (root instanceof Element || root instanceof Document ? root : document).querySelectorAll('.rt-wrap')) {
    const editor = wrap.querySelector('.rt-editor');
    if (!editor || editor.dataset.rtReady) continue;
    editor.dataset.rtReady = '1';
    editor.replaceChildren(rtSanitizeToFragment(wrap.querySelector('textarea')?.value || ''));
    editor.addEventListener('input', () => rtSync(wrap));
    editor.addEventListener('blur', () => rtSync(wrap));
  }
}

document.addEventListener('mousedown', (e) => {
  // Keep the editor's selection alive while a toolbar button is clicked.
  if (e.target.closest?.('[data-rt-cmd]')) e.preventDefault();
});

// Inline formats are toggled by hand instead of execCommand: Chrome's
// execCommand('bold') was observed splitting the selection's text nodes and
// then wrapping nothing (italic worked, bold silently no-opped), so the
// toolbar wraps/unwraps the real elements itself. Block commands
// (formatBlock, lists) and createLink still go through execCommand, which
// behaves.
const RT_INLINE = { bold: 'strong', italic: 'em', underline: 'u', strikeThrough: 's' };

function rtToggleInline(editor, tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  const container = range.commonAncestorContainer;
  const fromEl = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  const existing = fromEl?.closest(tagName);
  if (existing && existing !== editor && editor.contains(existing)) {
    // Already inside the format -- unwrap that element.
    const parent = existing.parentNode;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    parent.normalize();
    return;
  }
  if (range.collapsed) return;
  const el = document.createElement(tagName);
  el.appendChild(range.extractContents());
  range.insertNode(el);
  sel.removeAllRanges();
  const after = document.createRange();
  after.selectNodeContents(el);
  sel.addRange(after);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-rt-cmd]');
  if (!btn) return;
  const wrap = btn.closest('.rt-wrap');
  const editor = wrap?.querySelector('.rt-editor');
  if (!editor) return;
  editor.focus();
  const cmd = btn.dataset.rtCmd;
  try {
    // Boolean false, NOT the string 'false' -- Chrome treats the string as
    // truthy and flips to style-span output, which the sanitizer strips.
    document.execCommand('styleWithCSS', false, false);
    if (RT_INLINE[cmd]) rtToggleInline(editor, RT_INLINE[cmd]);
    else if (cmd === 'h3' || cmd === 'h4') document.execCommand('formatBlock', false, cmd.toUpperCase());
    else if (cmd === 'paragraph') document.execCommand('formatBlock', false, 'P');
    else if (cmd === 'link') {
      const url = window.prompt('Link URL (must start with https://)', 'https://');
      if (url && /^https?:\/\//i.test(url.trim())) document.execCommand('createLink', false, url.trim());
    } else {
      document.execCommand(cmd, false, null);
    }
  } catch { /* never let an editing quirk break the panel */ }
  rtSync(wrap);
});

// Review #27 (todo #166): show/hide toggle on every password field --
// deliberate twin of the public bundle's attachPasswordToggles (admin/ is a
// separately served bundle, same reasoning as money.js).
function attachPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-pw-eye])').forEach((input) => {
    input.dataset.pwEye = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.classList.toggle('pw-eye-on', show);
      input.focus();
    });
    wrap.appendChild(btn);
  });
}

// Panels re-render by replacing innerHTML, so editors and password fields
// appear at arbitrary times -- watch for them instead of threading an init
// call through every render site.
new MutationObserver(() => {
  initRichTextEditors(document);
  attachPasswordToggles(document);
}).observe(document.body, { childList: true, subtree: true });

// Communications token chips: insert the placeholder at the cursor of the
// matching message textarea (falls back to appending).
document.addEventListener('click', (e) => {
  const chip = e.target.closest?.('[data-comm-token]');
  if (!chip) return;
  const box = document.querySelector(`textarea[data-email-template="${chip.dataset.commTarget}"][data-email-template-field="message"]`);
  if (!box) return;
  const tok = chip.dataset.commToken;
  const start = box.selectionStart ?? box.value.length;
  const end = box.selectionEnd ?? box.value.length;
  box.value = box.value.slice(0, start) + tok + box.value.slice(end);
  box.focus();
  box.selectionStart = box.selectionEnd = start + tok.length;
  box.dispatchEvent(new Event('input', { bubbles: true }));
});

boot();
initRichTextEditors(document);
attachPasswordToggles(document);
