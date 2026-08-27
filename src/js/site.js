import '../styles/main.css';
import { mountNav, mountWhatsAppFab, toggleDrawer } from './nav.js';
import { enhanceColourCards } from './swatches.js';
import { initAppearance, toggleTheme, applyTheme } from './appearance.js';
import { mountCartUI } from './cart-ui.js';
import { trackVisit } from './analytics.js';
import { mountCarPartsFilter } from './car-parts-filter.js';

window.toggleDrawer = toggleDrawer;

function syncYear() {
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
}

/** Homepage "shop the range" tile copy is admin-editable; hydrate at runtime
 *  since index.html is hand-crafted and skipped by the page generator. */
async function hydrateHomeTiles() {
  const targets = document.querySelectorAll('[data-tile][data-tile-field]');
  if (!targets.length) return;
  try {
    const res = await fetch('/site-settings.json', { cache: 'no-store' });
    if (!res.ok) return;
    const settings = await res.json();
    if (!Array.isArray(settings.homeTiles)) return;
    targets.forEach((el) => {
      const tile = settings.homeTiles[Number(el.dataset.tile)];
      const value = tile?.[el.dataset.tileField];
      if (value) el.textContent = value;
    });
  } catch {
    /* keep the static copy already in the HTML */
  }
}

/** Homepage "Featured" section -- settings.featuredProducts arrives already
 *  resolved (name/price/href) by server/export.js's syncPublicJson(), fresh
 *  on every publish, so this is pure rendering, no lookup of its own. Built
 *  with DOM methods rather than innerHTML since product names come from
 *  admin-picked catalog data, not hand-authored copy. */
async function hydrateFeaturedProducts() {
  const container = document.getElementById('featured-products');
  const section = document.getElementById('featured-products-section');
  if (!container || !section) return;
  try {
    const res = await fetch('/site-settings.json', { cache: 'no-store' });
    if (!res.ok) return;
    const settings = await res.json();
    const items = Array.isArray(settings.featuredProducts) ? settings.featuredProducts : [];
    if (!items.length) return;

    items.forEach((item) => {
      const link = document.createElement('a');
      link.href = item.href;
      link.className = 'featured-product group block border border-charcoal/10 rounded-sm p-4 hover:border-terracotta transition-colors';

      const name = document.createElement('p');
      name.className = 'font-medium mb-1 tracking-tight group-hover:text-terracotta transition-colors';
      name.textContent = item.name;

      const price = document.createElement('p');
      price.className = 'text-terracotta font-semibold';
      price.textContent = item.price;

      link.append(name, price);
      container.appendChild(link);
    });

    section.classList.remove('hidden');
  } catch {
    /* section stays hidden -- no partial/broken state shown */
  }
}

function wireThemeButtons() {
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => toggleTheme());
  });
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
}

/** Ensure a visible toggle exists on desktop even if markup is missing */
function ensureDesktopThemeToggle() {
  const hasDesktopToggle = [...document.querySelectorAll('[data-theme-toggle]')].some((btn) => {
    const style = window.getComputedStyle(btn);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  if (hasDesktopToggle) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle-btn';
  btn.setAttribute('data-theme-toggle', 'true');
  btn.setAttribute('aria-label', 'Toggle dark mode');
  btn.innerHTML = `
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/></svg>
  `;
  btn.style.cssText = 'position:fixed;top:1.25rem;right:1.25rem;z-index:60;';
  document.body.appendChild(btn);
}

document.addEventListener('DOMContentLoaded', async () => {
  await initAppearance();
  mountNav();
  ensureDesktopThemeToggle();
  wireThemeButtons();
  mountWhatsAppFab();
  mountCartUI();
  enhanceColourCards();
  mountCarPartsFilter();
  syncYear();
  hydrateHomeTiles();
  hydrateFeaturedProducts();
  trackVisit();
});
