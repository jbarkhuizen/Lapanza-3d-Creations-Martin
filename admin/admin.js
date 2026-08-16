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

function setRoute(route, { id } = {}) {
  state.route = route;
  state.editingId = id || null;
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route || (route === 'editor' && btn.dataset.route === 'catalog')));
  show($('#view-dashboard'), route === 'dashboard');
  show($('#view-catalog'), route === 'catalog');
  show($('#view-editor'), route === 'editor');
  show($('#view-settings'), route === 'settings');

  const titles = {
    dashboard: ['Overview', 'Dashboard'],
    catalog: ['Inventory', 'Product catalog'],
    editor: ['Editor', 'Edit product'],
    settings: ['Configuration', 'Site settings'],
  };
  const [eyebrow, title] = titles[route] || titles.dashboard;
  $('#top-eyebrow').textContent = eyebrow;
  $('#top-title').textContent = title;
  show($('.topbar-actions'), route !== 'settings' && route !== 'editor');
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
      } else if (btn.dataset.route === 'catalog') {
        setRoute('catalog');
        await renderCatalog();
      } else if (btn.dataset.route === 'settings') {
        setRoute('settings');
        await renderSettings();
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
            <div class="grid-3">
              <label class="field"><span>Weight (g)</span><input data-colour="weightG" type="number" min="0" step="1" value="${c.weightG ?? 0}" /></label>
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
      available: true,
      sortOrder: p.items.length,
    });
    syncNestedFromDom();
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
    available: $('[data-item="available"]', row)?.checked !== false,
    sortOrder: i,
  }));
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
