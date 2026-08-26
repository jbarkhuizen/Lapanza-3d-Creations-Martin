import { FILAMENT_NAV } from '../data/site.js';

/** Homepage-only header widgets: sidebar collapse, quick search, account panel.
 *  Guarded by element presence so this stays a no-op on every other page. */

const SEARCH_INDEX = [
  { title: 'Our Story', href: 'story.html' },
  { title: 'Shop the range', href: '#range' },
  { title: '3D Resources', href: 'resources.html' },
  { title: 'Custom Design and Print Request', href: 'design-request.html' },
  { title: 'My Account', href: 'account.html' },
  { title: 'Contact', href: '#contact' },
  { title: 'Car Parts — GWM', href: 'car-parts/gwm.html' },
  { title: 'Car Parts — Landrover', href: 'car-parts/landrover.html' },
  { title: 'Toys', href: 'toys.html' },
  { title: 'Homeware', href: 'homeware.html' },
  { title: 'Phone Accessories', href: 'phones.html' },
  ...FILAMENT_NAV.map((f) => ({ title: `Filament — ${f.label}`, href: `filament/${f.slug}.html` })),
];

function openPanel(panel, btn) {
  panel.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
}

function closePanel(panel, btn) {
  panel.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
}

function initSidebarCollapse() {
  const btn = document.getElementById('sidebar-collapse-btn');
  const aside = document.getElementById('catalogue-sidebar');
  const header = document.getElementById('site-header');
  if (!btn || !aside || !header) return;

  const STORAGE_KEY = 'lapanza-sidebar-hidden';
  const apply = (hide) => {
    aside.classList.toggle('is-collapsed', hide);
    header.classList.toggle('is-collapsed', hide);
    btn.classList.toggle('rotate-180', hide);
    btn.setAttribute('aria-expanded', String(!hide));
    btn.setAttribute('aria-label', hide ? 'Show menu' : 'Hide menu');
  };

  apply(localStorage.getItem(STORAGE_KEY) === '1');

  btn.addEventListener('click', () => {
    const hide = !aside.classList.contains('is-collapsed');
    apply(hide);
    localStorage.setItem(STORAGE_KEY, hide ? '1' : '0');
  });
}

function renderResults(container, query) {
  container.textContent = '';
  const q = query.trim().toLowerCase();
  if (!q) return;

  const matches = SEARCH_INDEX.filter((item) => item.title.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'text-espresso/50 px-2 py-2';
    empty.textContent = 'No matches.';
    container.appendChild(empty);
    return;
  }

  matches.forEach((item) => {
    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'block px-2 py-2 rounded-lg hover:bg-charcoal/5 transition-colors';
    a.textContent = item.title;
    container.appendChild(a);
  });
}

function initSiteSearch() {
  const btn = document.getElementById('site-search-btn');
  const panel = document.getElementById('site-search-panel');
  const input = document.getElementById('site-search-input');
  const results = document.getElementById('site-search-results');
  if (!btn || !panel || !input || !results) return;

  btn.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) {
      openPanel(panel, btn);
      input.focus();
    } else {
      closePanel(panel, btn);
    }
  });

  input.addEventListener('input', () => renderResults(results, input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('a');
      if (first) window.location.href = first.getAttribute('href');
    } else if (e.key === 'Escape') {
      closePanel(panel, btn);
    }
  });

  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !btn.contains(e.target)) {
      closePanel(panel, btn);
    }
  });
}

async function initAccountWidget() {
  const btn = document.getElementById('site-account-btn');
  const panel = document.getElementById('site-account-panel');
  const guest = document.getElementById('site-account-guest');
  const loggedIn = document.getElementById('site-account-loggedin');
  const nameEl = document.getElementById('site-account-name');
  const emailEl = document.getElementById('site-account-email');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) openPanel(panel, btn);
    else closePanel(panel, btn);
  });

  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !btn.contains(e.target)) {
      closePanel(panel, btn);
    }
  });

  try {
    const res = await fetch('/api/client/me', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (data.authenticated && data.client) {
      guest.classList.add('hidden');
      loggedIn.classList.remove('hidden');
      nameEl.textContent = data.client.name || 'My account';
      emailEl.textContent = data.client.email || '';
    }
  } catch {
    // Offline or logged out -- the guest view already shown is correct.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initSidebarCollapse();
  initSiteSearch();
  initAccountWidget();
});
