import './site.js';

document.addEventListener('DOMContentLoaded', async () => {
  const { initHomeMotion } = await import('./home.js');
  initHomeMotion();
});
