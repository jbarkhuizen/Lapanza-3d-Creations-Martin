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

/** Hero "Featured" products -- 2 flanking the hero text on each side
 *  (desktop) / two rows below it (mobile). settings.featuredProducts
 *  arrives already resolved (name/price/image/href) by server/export.js's
 *  syncPublicJson(), fresh on every publish, so this is pure rendering, no
 *  lookup of its own. Built with DOM methods rather than innerHTML since
 *  product names come from admin-picked catalog data, not hand-authored
 *  copy. */
function featuredProductCard(item) {
  const link = document.createElement('a');
  link.href = item.href;
  link.className =
    'featured-product group flex items-center gap-3 md:flex-col md:items-stretch md:text-center bg-cream/85 backdrop-blur-sm border-2 border-charcoal/15 rounded-sm p-2.5 hover:border-terracotta transition-colors w-full';

  const imgWrap = document.createElement('div');
  imgWrap.className = 'w-14 h-14 md:w-full md:aspect-square shrink-0 rounded-sm overflow-hidden bg-linen flex items-center justify-center';
  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.name;
    img.loading = 'lazy';
    img.className = 'w-full h-full object-cover';
    // A stale reference (item deleted/replaced since the photo was set)
    // shouldn't show a broken-image icon -- same onerror fallback pattern
    // used for cart line items and admin thumbnails elsewhere on the site.
    img.onerror = () => {
      img.remove();
      imgWrap.textContent = '';
    };
    imgWrap.appendChild(img);
  }

  const text = document.createElement('div');
  text.className = 'min-w-0 text-left md:text-center';

  const name = document.createElement('p');
  name.className = 'text-xs md:text-sm font-medium leading-tight truncate md:whitespace-normal md:line-clamp-2 group-hover:text-terracotta transition-colors';
  name.textContent = item.name;

  const price = document.createElement('p');
  price.className = 'text-terracotta font-semibold text-xs md:text-sm';
  price.textContent = item.price;

  text.append(name, price);
  link.append(imgWrap, text);
  return link;
}

async function hydrateFeaturedProducts() {
  const left = document.getElementById('featured-products-left');
  const right = document.getElementById('featured-products-right');
  if (!left || !right) return;
  try {
    const res = await fetch('/site-settings.json', { cache: 'no-store' });
    if (!res.ok) return;
    const settings = await res.json();
    const items = Array.isArray(settings.featuredProducts) ? settings.featuredProducts : [];
    if (!items.length) return;

    // Split evenly across the two flanking columns -- first half left,
    // second half right, whatever the count (not hardcoded to 4), so 5 or 6
    // picks still degrade sensibly instead of piling onto one side.
    const mid = Math.ceil(items.length / 2);
    items.slice(0, mid).forEach((item) => left.appendChild(featuredProductCard(item)));
    items.slice(mid).forEach((item) => right.appendChild(featuredProductCard(item)));

    left.classList.remove('hidden');
    right.classList.remove('hidden');
  } catch {
    /* columns stay hidden -- no partial/broken state shown */
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
