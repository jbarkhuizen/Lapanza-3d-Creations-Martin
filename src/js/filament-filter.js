// Backlog #40 (SITE-006): filament-page colour filters -- name search,
// in-stock-only, price/name sort. Same pure-client-side pattern as
// car-parts-filter.js (no-ops on pages without #colour-filter-bar, which
// only renders when a filament type has more than 3 listed colours).
// Filter state persists in the URL (?c=&stock=1&sort=) so a filtered view
// can be shared or returned to, per the spec.
export function mountFilamentFilter() {
  const bar = document.getElementById('colour-filter-bar');
  if (!bar) return;

  const searchInput = document.getElementById('colour-search');
  const stockToggle = document.getElementById('colour-instock');
  const sortSelect = document.getElementById('colour-sort');
  const grid = document.getElementById('colour-grid');
  const emptyMessage = document.getElementById('colour-filter-empty');
  const cards = [...grid.querySelectorAll('.swatch-card')];
  const originalOrder = [...cards];

  // Restore state from the URL before the first apply().
  const params = new URLSearchParams(location.search);
  if (searchInput && params.get('c')) searchInput.value = params.get('c');
  if (stockToggle) stockToggle.checked = params.get('stock') === '1';
  if (sortSelect && params.get('sort')) sortSelect.value = params.get('sort');

  function syncUrl() {
    const p = new URLSearchParams(location.search);
    const set = (key, val) => (val ? p.set(key, val) : p.delete(key));
    set('c', searchInput?.value.trim() || '');
    set('stock', stockToggle?.checked ? '1' : '');
    set('sort', sortSelect?.value || '');
    const qs = p.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }

  function apply() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const stockOnly = stockToggle?.checked;
    let visible = 0;
    cards.forEach((card) => {
      const name = (card.dataset.colourName || '').toLowerCase();
      const show = (!q || name.includes(q)) && (!stockOnly || card.dataset.instock === '1');
      card.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });
    emptyMessage?.classList.toggle('hidden', visible > 0);

    const sort = sortSelect?.value || '';
    const ordered =
      sort === ''
        ? originalOrder
        : [...cards].sort((a, b) => {
            if (sort === 'name') return (a.dataset.colourName || '').localeCompare(b.dataset.colourName || '');
            const pa = Number(a.dataset.price) || 0;
            const pb = Number(b.dataset.price) || 0;
            return sort === 'price-desc' ? pb - pa : pa - pb;
          });
    ordered.forEach((card) => grid.appendChild(card));
    syncUrl();
  }

  searchInput?.addEventListener('input', apply);
  stockToggle?.addEventListener('change', apply);
  sortSelect?.addEventListener('change', apply);
  apply();
}
