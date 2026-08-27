// GWM/Landrover pages only -- no-ops instantly everywhere else since
// #part-filter-bar only exists on those two generated pages (see
// scripts/generate-pages.mjs's partFilterBar()). Pure client-side: the site
// is statically generated, so filtering happens over the already-rendered
// cards' data-search/data-models attributes, no network call.
export function mountCarPartsFilter() {
  const bar = document.getElementById('part-filter-bar');
  if (!bar) return;

  const searchInput = document.getElementById('part-search');
  const modelSelect = document.getElementById('part-model-filter');
  const cards = [...document.querySelectorAll('.catalogue-grid [data-search]')];
  const emptyMessage = document.getElementById('part-filter-empty');

  function apply() {
    const query = (searchInput?.value || '').trim().toLowerCase();
    const selectedModel = modelSelect?.value || '';

    let visibleCount = 0;
    cards.forEach((card) => {
      const matchesSearch = !query || card.dataset.search.includes(query);
      const cardModels = card.dataset.models ? card.dataset.models.split('|') : [];
      const matchesModel = !selectedModel || cardModels.includes(selectedModel);
      const visible = matchesSearch && matchesModel;
      card.classList.toggle('hidden', !visible);
      if (visible) visibleCount += 1;
    });

    if (emptyMessage) emptyMessage.classList.toggle('hidden', visibleCount > 0);
  }

  searchInput?.addEventListener('input', apply);
  modelSelect?.addEventListener('change', apply);
}
