import './site.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function resourceCardHtml(resource) {
  const title = escapeHtml(resource.title);
  const description = escapeHtml(resource.description);
  const id = escapeHtml(resource.id);
  const imagePath = escapeHtml(resource.imagePath);
  const img = resource.imagePath
    ? `<img src="${imagePath}" alt="${title}" class="w-full aspect-square object-cover" loading="lazy">`
    : `<div class="w-full aspect-square flex items-center justify-center bg-gradient-to-br from-linen to-cream"><span class="text-espresso/35 text-xs uppercase tracking-[0.2em]">Photo coming soon</span></div>`;

  const metaRows = [
    resource.filamentType ? ['Filament', escapeHtml(resource.filamentType)] : null,
    resource.printSettings ? ['Print settings', escapeHtml(resource.printSettings)] : null,
    resource.dimensions ? ['Dimensions', escapeHtml(resource.dimensions)] : null,
  ].filter(Boolean);

  const metaHtml = metaRows
    .map(([label, value]) => `<div class="flex justify-between gap-2"><dt>${label}</dt><dd class="text-espresso/80 text-right">${value}</dd></div>`)
    .join('');
  const meta = metaRows.length ? `<dl class="text-xs text-espresso/60 space-y-1 mb-4">${metaHtml}</dl>` : '';

  const downloadBtn = resource.filePath
    ? `<a href="/api/resources/${id}/download" class="inline-flex text-xs font-semibold bg-charcoal text-cream rounded-full px-4 py-2 hover:bg-terracotta transition-colors">Download</a>`
    : `<span class="text-xs text-espresso/40 uppercase tracking-wide">No file yet</span>`;

  const descriptionHtml = resource.description ? `<p class="text-espresso/60 text-sm mb-3">${description}</p>` : '';

  const cardParts = [
    '<article class="group border border-charcoal/10 rounded-sm overflow-hidden hover:border-terracotta transition-colors flex flex-col">',
    `<div class="border-b border-charcoal/10 overflow-hidden">${img}</div>`,
    '<div class="p-4 flex flex-col flex-1">',
    `<h3 class="font-serif text-lg mb-1">${title}</h3>`,
    descriptionHtml,
    meta,
    `<div class="mt-auto">${downloadBtn}</div>`,
    '</div>',
    '</article>',
  ];
  return cardParts.join('');
}

async function init() {
  const loadingEl = document.getElementById('resources-loading');
  const emptyEl = document.getElementById('resources-empty');
  const gridEl = document.getElementById('resources-grid');
  try {
    const res = await fetch('/api/resources/public/list');
    const data = await res.json();
    loadingEl.classList.add('hidden');
    const resources = data.resources || [];
    if (!resources.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    gridEl.innerHTML = resources.map(resourceCardHtml).join('');
  } catch {
    loadingEl.textContent = 'Could not load resources right now — please try again later.';
  }
}

document.addEventListener('DOMContentLoaded', init);
