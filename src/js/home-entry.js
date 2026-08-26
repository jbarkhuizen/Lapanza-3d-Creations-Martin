import './site.js';
import './home-header.js';
import { clearCart } from './cart.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Phase 4: a cart carried over from a previous, unrelated visit shouldn't
  // silently reappear when someone lands back on the homepage.
  clearCart();

  const { initHomeMotion } = await import('./home.js');
  initHomeMotion();
});
