import './site.js';
import './home-header.js';
import { clearCart, isCartStale } from './cart.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Phase 4 intent, corrected 2026-08-31: only a cart untouched for 24h+ is
  // "a previous, unrelated visit" worth clearing. The original unconditional
  // clearCart() here wiped an ACTIVE cart on any homepage round-trip -- e.g.
  // home -> Shop Filament -> add to cart -> back home lost the roll.
  if (isCartStale()) clearCart();

  const { initHomeMotion } = await import('./home.js');
  initHomeMotion();

  // Backlog #104/#105: the Three.js hero scene is its own chunk, fetched
  // after the motion pass and only for visitors who allow motion -- a
  // reduced-motion visitor never downloads it (static hero background is
  // the fallback). requestIdleCallback keeps the fetch off the critical
  // path; the 1.5s timeout guarantees it still loads promptly on browsers
  // that never go idle.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && document.getElementById('hero-canvas')) {
    const load = async () => {
      const { initHeroScene } = await import('./hero-scene.js');
      initHeroScene();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 1500 });
    else setTimeout(load, 300);
  }
});
