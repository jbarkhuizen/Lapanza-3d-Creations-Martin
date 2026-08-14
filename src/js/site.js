import '../styles/main.css';
import { mountNav, mountWhatsAppFab, toggleDrawer } from './nav.js';
import { enhanceColourCards } from './swatches.js';
import { initAppearance, toggleTheme, applyTheme } from './appearance.js';

window.toggleDrawer = toggleDrawer;

function syncYear() {
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
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
  enhanceColourCards();
  syncYear();
});
