import { FILAMENT_NAV, SITE } from '../data/site.js';

function depthPrefix() {
  const depth = (window.__PAGE_DEPTH__ ?? 0) | 0;
  return depth > 0 ? '../'.repeat(depth) : '';
}

function isActive(href, current) {
  if (!current) return false;
  const a = href.replace(/^\.\.\//, '').replace(/^\//, '');
  const b = current.replace(/^\//, '');
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export function renderSidebar({ current = '', openGroups = [] } = {}) {
  const p = depthPrefix();
  const filamentOpen = openGroups.includes('Filament') || current.startsWith('filament/');
  const carOpen = openGroups.includes('Car Parts') || current.startsWith('car-parts/');

  const filamentLinks = FILAMENT_NAV.map((item) => {
    const href = `${p}filament/${item.slug}.html`;
    const active = isActive(`filament/${item.slug}.html`, current) ? 'active' : '';
    return `<a href="${href}" class="side-link ${active} block py-1.5 text-[0.92rem] text-espresso/70 hover:text-terracotta transition-colors">${item.label}</a>`;
  }).join('\n    ');

  return `
<div class="flex items-start justify-between gap-3 mb-2">
  <div class="min-w-0">
    <a href="${p}index.html" class="brand-mark font-serif text-[1.35rem] hover:opacity-80 transition-opacity tracking-tight font-semibold">Lapanza <span class="mark-3d">3D</span></a>
    <p class="text-[0.65rem] uppercase tracking-[0.22em] text-espresso/45 mt-1 mb-0">Creative Lab · Centurion</p>
  </div>
  <button type="button" class="theme-toggle-btn shrink-0 hidden md:inline-flex" data-theme-toggle aria-label="Toggle dark mode" title="Toggle dark mode">
    <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/></svg>
  </button>
</div>
<a href="${p}story.html" class="side-link ${isActive('story.html', current) ? 'active' : ''} block py-2.5 uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors border-t border-charcoal/10 mt-6">Our Story</a>
<details class="rot-open border-t border-charcoal/10 py-2" data-nav-key="Filament" ${filamentOpen ? 'open' : ''}>
  <summary class="flex items-center justify-between uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors py-1.5 font-semibold"><span>Filament</span><span class="chev transition-transform duration-200 text-terracotta">&#8250;</span></summary>
  <div class="pl-3 mt-1 space-y-0.5 border-l border-charcoal/10">
    ${filamentLinks}
  </div>
</details>
<details class="rot-open border-t border-charcoal/10 py-2" data-nav-key="Car Parts" ${carOpen ? 'open' : ''}>
  <summary class="flex items-center justify-between uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors py-1.5 font-semibold"><span>Car Parts</span><span class="chev transition-transform duration-200 text-terracotta">&#8250;</span></summary>
  <div class="pl-3 mt-1 space-y-0.5 border-l border-charcoal/10">
    <a href="${p}car-parts/gwm.html" class="side-link ${isActive('car-parts/gwm.html', current) ? 'active' : ''} block py-1.5 text-espresso/70 hover:text-terracotta transition-colors">GWM</a>
    <a href="${p}car-parts/landrover.html" class="side-link ${isActive('car-parts/landrover.html', current) ? 'active' : ''} block py-1.5 text-espresso/70 hover:text-terracotta transition-colors">Landrover</a>
  </div>
</details>
<a href="${p}toys.html" class="side-link ${isActive('toys.html', current) ? 'active' : ''} block py-2.5 uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors border-t border-charcoal/10">Toys</a>
<a href="${p}homeware.html" class="side-link ${isActive('homeware.html', current) ? 'active' : ''} block py-2.5 uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors border-t border-charcoal/10">Homeware</a>
<a href="${p}phones.html" class="side-link ${isActive('phones.html', current) ? 'active' : ''} block py-2.5 uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors border-t border-charcoal/10">Phones</a>
<a href="${p}resources.html" class="side-link ${isActive('resources.html', current) ? 'active' : ''} block py-2.5 uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors border-t border-charcoal/10">3D Resources</a>
<a href="${p}design-request.html" class="side-link ${isActive('design-request.html', current) ? 'active' : ''} block py-2.5 uppercase text-[0.68rem] tracking-[0.18em] text-espresso/80 hover:text-terracotta transition-colors border-t border-charcoal/10 border-b border-charcoal/10">Custom Design</a>
`.trim();
}

export function mountNav() {
  const current = window.__PAGE_PATH__ || '';
  const openGroups = window.__OPEN_NAV__ || [];
  document.querySelectorAll('[data-site-nav]').forEach((el) => {
    el.innerHTML = renderSidebar({ current, openGroups });
    el.classList.add('site-sidebar', 'text-sm');
  });

  document.querySelectorAll('.site-sidebar details[data-nav-key]').forEach((d) => {
    d.addEventListener('toggle', () => {
      document
        .querySelectorAll(`.site-sidebar details[data-nav-key="${d.getAttribute('data-nav-key')}"]`)
        .forEach((other) => {
          if (other !== d) other.open = d.open;
        });
    });
  });
}

export function mountWhatsAppFab() {
  if (document.querySelector('.wa-fab')) return;
  const a = document.createElement('a');
  a.href = SITE.whatsapp;
  a.className = 'wa-fab';
  a.setAttribute('aria-label', 'Chat on WhatsApp');
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11 11 0 0 0 2.1 17.3L1 23l5.9-1.5A11 11 0 0 0 20.5 3.5zm-8.5 17a9 9 0 0 1-4.6-1.3l-.3-.2-3.5.9.9-3.4-.2-.3A9 9 0 1 1 12 20.5zm5.2-6.7c-.3-.1-1.6-.8-1.9-.9s-.4-.1-.6.1-.7.9-.8 1-.3.2-.6.1a7.4 7.4 0 0 1-2.2-1.4 8.2 8.2 0 0 1-1.5-1.9c-.2-.3 0-.4.1-.6l.5-.6c.1-.2.1-.3 0-.5l-.9-2.1c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3s-1 1-1 2.4 1 2.8 1.2 3 .9 1.9 3.4 3.1c2 .1 2.4.8 2.8.8s1.3-.1 1.5-.4.9-1.1 1-1.4.2-.3.1-.4z"/></svg><span>WhatsApp</span>`;
  document.body.appendChild(a);
}

export function toggleDrawer(force) {
  const drawer = document.getElementById('sidebar-drawer');
  if (!drawer) return;
  const hide = force === false ? true : force === true ? false : drawer.classList.contains('hidden') === false;
  drawer.classList.toggle('hidden', hide);
  document.body.style.overflow = hide ? '' : 'hidden';
}
