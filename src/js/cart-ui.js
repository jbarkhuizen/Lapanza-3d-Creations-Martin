import gsap from 'gsap';
import { getCart, getCartCount, getCartTotal, addItem, removeItem, updateQuantity, clearCart } from './cart.js';

function formatPrice(value) {
  return `R${Number(value || 0).toFixed(0)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function lineItemHtml(item) {
  const name = escapeHtml(item.name);
  const image = escapeHtml(item.image);
  const img = item.image
    ? `<img src="${image}" alt="${name}" class="w-16 h-16 object-cover rounded-sm border border-charcoal/10 shrink-0" loading="lazy">`
    : `<div class="w-16 h-16 rounded-sm border border-charcoal/10 bg-gradient-to-br from-linen to-cream shrink-0"></div>`;
  return `
    <li class="flex gap-3 py-4 border-b border-charcoal/10" data-cart-line data-product-id="${escapeHtml(item.productId)}">
      ${img}
      <div class="flex-1 min-w-0">
        <p class="font-medium text-sm leading-snug mb-1">${name}</p>
        <p class="text-terracotta font-semibold text-sm mb-2">${formatPrice(item.price)}</p>
        <div class="flex items-center gap-2">
          <button type="button" class="w-6 h-6 flex items-center justify-center border border-charcoal/20 rounded-full text-sm hover:border-terracotta hover:text-terracotta transition-colors" data-cart-action="dec" aria-label="Decrease quantity">&minus;</button>
          <span class="text-sm w-5 text-center" data-cart-qty>${item.quantity}</span>
          <button type="button" class="w-6 h-6 flex items-center justify-center border border-charcoal/20 rounded-full text-sm hover:border-terracotta hover:text-terracotta transition-colors" data-cart-action="inc" aria-label="Increase quantity">+</button>
          <button type="button" class="ml-auto text-xs text-espresso/50 hover:text-terracotta transition-colors uppercase tracking-wide" data-cart-action="remove" aria-label="Remove item">Remove</button>
        </div>
      </div>
    </li>`;
}

export function mountCartUI() {
  if (document.getElementById('cart-fab')) return;

  const root = document.createElement('div');
  root.innerHTML = `
    <button type="button" id="cart-fab" aria-label="Open cart"
            class="fixed left-5 bottom-5 z-[55] flex items-center justify-center w-14 h-14 rounded-full bg-charcoal text-cream shadow-[0_10px_28px_rgb(26_22_18_/_0.3)] hover:bg-terracotta transition-colors">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>
      <span id="cart-badge" class="hidden absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full bg-terracotta text-cream text-[0.7rem] font-bold flex items-center justify-center">0</span>
    </button>

    <div id="cart-overlay" class="fixed inset-0 z-[60] bg-charcoal/40 opacity-0 pointer-events-none"></div>

    <aside id="cart-drawer" class="fixed top-0 right-0 z-[61] h-full w-full max-w-sm bg-cream flex flex-col pointer-events-none" aria-label="Shopping cart">
      <div class="flex items-center justify-between px-6 py-5 border-b border-charcoal/10">
        <h2 class="font-serif text-xl tracking-tight">Your Cart</h2>
        <button type="button" id="cart-close" class="border-2 border-charcoal rounded-full px-3 py-1.5 text-xs uppercase tracking-wide font-semibold" aria-label="Close cart">Close</button>
      </div>
      <ul id="cart-lines" class="flex-1 overflow-y-auto px-6"></ul>
      <p id="cart-empty" class="hidden px-6 py-10 text-center text-sm text-espresso/50">Your cart is empty.</p>
      <div class="px-6 py-5 border-t border-charcoal/10">
        <div class="flex items-center justify-between mb-4">
          <span class="text-sm font-semibold uppercase tracking-wide">Total</span>
          <span id="cart-total" class="font-serif text-xl text-terracotta">R0</span>
        </div>
        <a id="cart-checkout" href="#" class="block text-center text-xs font-semibold bg-charcoal text-cream rounded-full px-4 py-2.5 hover:bg-terracotta transition-colors mb-3">Checkout</a>
        <button type="button" id="cart-clear" class="w-full text-center text-xs text-espresso/50 hover:text-terracotta transition-colors uppercase tracking-wide">Clear cart</button>
      </div>
    </aside>`;
  document.body.append(...root.childNodes);

  const fab = document.getElementById('cart-fab');
  const badge = document.getElementById('cart-badge');
  const overlay = document.getElementById('cart-overlay');
  const drawer = document.getElementById('cart-drawer');
  const linesEl = document.getElementById('cart-lines');
  const emptyEl = document.getElementById('cart-empty');
  const totalEl = document.getElementById('cart-total');

  const depth = (window.__PAGE_DEPTH__ ?? 0) | 0;
  document.getElementById('cart-checkout').href = `${'../'.repeat(depth)}checkout.html`;

  gsap.set(drawer, { xPercent: 100 });

  function render() {
    const items = getCart();
    const count = getCartCount();
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
    linesEl.innerHTML = items.map(lineItemHtml).join('');
    emptyEl.classList.toggle('hidden', items.length > 0);
    totalEl.textContent = formatPrice(getCartTotal());
  }

  function openDrawer() {
    overlay.classList.remove('pointer-events-none');
    drawer.classList.remove('pointer-events-none');
    gsap.to(overlay, { opacity: 1, duration: 0.25 });
    gsap.to(drawer, { xPercent: 0, duration: 0.4, ease: 'power3.out' });
    fab.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    gsap.to(overlay, {
      opacity: 0,
      duration: 0.2,
      onComplete: () => overlay.classList.add('pointer-events-none'),
    });
    gsap.to(drawer, {
      xPercent: 100,
      duration: 0.35,
      ease: 'power3.in',
      onComplete: () => drawer.classList.add('pointer-events-none'),
    });
    fab.setAttribute('aria-expanded', 'false');
  }

  fab.addEventListener('click', openDrawer);
  document.getElementById('cart-close').addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  document.getElementById('cart-clear').addEventListener('click', clearCart);

  linesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cart-action]');
    if (!btn) return;
    const line = btn.closest('[data-product-id]');
    const productId = line?.dataset.productId;
    if (!productId) return;
    const item = getCart().find((i) => i.productId === productId);
    if (!item) return;
    if (btn.dataset.cartAction === 'inc') updateQuantity(productId, item.quantity + 1);
    else if (btn.dataset.cartAction === 'dec') updateQuantity(productId, item.quantity - 1);
    else if (btn.dataset.cartAction === 'remove') removeItem(productId);
  });

  // Delegated at document level so Add-to-cart buttons anywhere in the
  // statically generated page markup work without per-page wiring.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add-to-cart]');
    if (!btn) return;
    addItem({
      productId: btn.dataset.productId,
      name: btn.dataset.name,
      price: btn.dataset.price,
      image: btn.dataset.image,
      weight: btn.dataset.weight,
    });
    gsap.fromTo(badge, { scale: 1.5 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
  });

  window.addEventListener('cart:updated', render);
  render();
}
