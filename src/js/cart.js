const STORAGE_KEY = 'lapanza-cart';
// Stamped on every cart write -- lets the homepage distinguish "cart from a
// previous, long-gone visit" (cleared) from "cart I'm actively shopping with
// and just navigated home" (kept). Before this, the homepage cleared the
// cart unconditionally, which wiped an active cart on any home round-trip.
const TOUCHED_KEY = 'lapanza-cart-touched';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h

export function isCartStale() {
  try {
    if (!readRaw().length) return false; // nothing to clear
    const touched = Number(localStorage.getItem(TOUCHED_KEY));
    // A cart with no stamp predates this feature -- keep it (it gets a
    // stamp on its next mutation); never wipe a possibly-active cart.
    if (!Number.isFinite(touched) || touched <= 0) return false;
    return Date.now() - touched > STALE_AFTER_MS;
  } catch {
    return false;
  }
}

function readRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    localStorage.setItem(TOUCHED_KEY, String(Date.now()));
  } catch {
    /* private-mode/quota-full localStorage — cart still works for this page load, just won't persist */
  }
  window.dispatchEvent(new CustomEvent('cart:updated', { detail: { items } }));
}

export function getCart() {
  return readRaw();
}

export function getCartTotal() {
  return readRaw().reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function getCartCount() {
  return readRaw().reduce((sum, item) => sum + item.quantity, 0);
}

// Weight is grams, matching the unit used end to end (filament_colours.weight_g,
// order_items.weight, data-weight attributes on Add to Cart buttons).
export function getCartTotalWeight() {
  return readRaw().reduce((sum, item) => sum + (Number(item.weight) || 0) * item.quantity, 0);
}

export function addItem({ productId, name, price, image, weight, quantity = 1 }) {
  if (!productId) return getCart();
  // Backlog #113: decoupled event dispatch -- analytics.js listens for
  // 'lapanza:track' when loaded; on pages without it this is a no-op.
  try {
    document.dispatchEvent(new CustomEvent('lapanza:track', { detail: { eventType: 'add_to_cart', detail: productId } }));
  } catch { /* tracking must never break the cart */ }
  const items = readRaw();
  const existing = items.find((i) => i.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    items.push({
      productId,
      name: name || 'Item',
      price: Number(price) || 0,
      image: image || '',
      weight: Number(weight) || 0,
      quantity: Math.max(1, quantity),
    });
  }
  writeRaw(items);
  return items;
}

export function removeItem(productId) {
  const items = readRaw().filter((i) => i.productId !== productId);
  writeRaw(items);
  return items;
}

export function updateQuantity(productId, quantity) {
  if (quantity < 1) return removeItem(productId);
  const items = readRaw();
  const item = items.find((i) => i.productId === productId);
  if (!item) return items;
  item.quantity = quantity;
  writeRaw(items);
  return items;
}

export function clearCart() {
  writeRaw([]);
  return [];
}
