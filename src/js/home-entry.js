import './site.js';
import './home-header.js';
import { clearCart } from './cart.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Phase 4: a cart carried over from a previous, unrelated visit shouldn't
  // silently reappear when someone lands back on the homepage.
  clearCart();

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
