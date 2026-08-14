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
  show($('#view-login'), !state.authenticated);
  show($('#shell'), state.authenticated);
}

function bindChrome() {
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = new FormData(e.target).get('password');
    const err = $('#login-error');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
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

async function refreshProducts() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.kind) params.set('kind', state.filters.kind);
  if (state.filters.status) params.set('status', state.filters.status);
  const data = await api(`/api/products?${params}`);
  state.products = data.products;
  return data;
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
            <div class="recent-item" data-id="${p.id}">
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
    row.addEventListener('click', () => openEditor(row.dataset.id));
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
      <tr data-id="${p.id}">
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
          <button class="btn small" data-action="dup" type="button">Duplicate</button>
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
      openEditor(tr.dataset.id);
    });
    tr.querySelector('[data-action="edit"]')?.addEventListener('click', () => openEditor(tr.dataset.id));
    tr.querySelector('[data-action="dup"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await api(`/api/products/${tr.dataset.id}/duplicate`, { method: 'POST' });
      toast(`Duplicated as ${res.product.name}`);
      openEditor(res.product.id);
    });
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

async function openEditor(id) {
  const { product } = await api(`/api/products/${id}`);
  state.draft = structuredClone(product);
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
              ? '<strong>name, slug, description, specs[], colours[{name,sku,price}], colourNote</strong>.'
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
              <div class="swatch-preview" style="background:${escapeAttr(c.hex || guessHex(c.name))}"></div>
              <button class="btn small btn-danger" data-remove-colour type="button">Remove</button>
            </div>
            <div class="grid-3">
              <label class="field"><span>Colour name</span><input data-colour="name" value="${escapeAttr(c.name)}" /></label>
              <label class="field"><span>SKU</span><input data-colour="sku" value="${escapeAttr(c.sku)}" /></label>
              <label class="field"><span>Price</span><input data-colour="price" value="${escapeAttr(c.price)}" placeholder="R299" /></label>
            </div>
            <div class="grid-3">
              <label class="field"><span>Hex override</span><input data-colour="hex" value="${escapeAttr(c.hex || '')}" placeholder="#c24b28" /></label>
              <label class="field"><span>Notes</span><input data-colour="notes" value="${escapeAttr(c.notes || '')}" /></label>
              <label class="field checkbox" style="margin-top:1.5rem">
                <input data-colour="inStock" type="checkbox" ${c.inStock !== false ? 'checked' : ''} />
                <span>In stock</span>
              </label>
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

  $('#add-spec')?.addEventListener('click', () => {
    p.specs = p.specs || [];
    p.specs.push({ id: uid(), label: '', value: '' });
    syncNestedFromDom();
    renderEditor();
  });
  $('#add-colour')?.addEventListener('click', () => {
    p.colours = p.colours || [];
    p.colours.push({ id: uid(), name: '', sku: '', price: '', hex: '', inStock: true, notes: '' });
    syncNestedFromDom();
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
    btn.addEventListener('click', () => {
      syncNestedFromDom();
      const idx = Number(btn.closest('[data-colour-index]').dataset.colourIndex);
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

  $('#back-catalog').addEventListener('click', async () => {
    setRoute('catalog');
    await renderCatalog();
  });

  $('#save-product').addEventListener('click', async () => {
    syncNestedFromDom();
    if (!p.name.trim()) return toast('Name is required');
    if (!p.slug.trim()) p.slug = slugify(p.name);
    try {
      if (p._isNew) {
        const { _isNew, ...payload } = p;
        const res = await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
        state.draft = res.product;
        toast('Product created');
      } else {
        const res = await api(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify(p) });
        state.draft = res.product;
        toast('Product saved');
      }
      renderEditor();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#delete-product')?.addEventListener('click', async () => {
    if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    try {
      await api(`/api/products/${p.id}`, { method: 'DELETE' });
      toast('Product deleted');
      setRoute('catalog');
      await renderCatalog();
    } catch (ex) {
      toast(ex.message);
    }
  });
}

function syncNestedFromDom() {
  const p = state.draft;
  if (!p) return;

  p.specs = $$('[data-spec-index]').map((row) => ({
    id: p.specs?.[Number(row.dataset.specIndex)]?.id || uid(),
    label: $('[data-spec="label"]', row)?.value || '',
    value: $('[data-spec="value"]', row)?.value || '',
  }));

  p.colours = $$('[data-colour-index]').map((row) => ({
    id: p.colours?.[Number(row.dataset.colourIndex)]?.id || uid(),
    name: $('[data-colour="name"]', row)?.value || '',
    sku: $('[data-colour="sku"]', row)?.value || '',
    price: $('[data-colour="price"]', row)?.value || '',
    hex: $('[data-colour="hex"]', row)?.value || '',
    notes: $('[data-colour="notes"]', row)?.value || '',
    inStock: $('[data-colour="inStock"]', row)?.checked !== false,
  }));

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
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
      toast('Settings saved — refresh the public site to see fonts/theme defaults');
      await renderSettings();
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
