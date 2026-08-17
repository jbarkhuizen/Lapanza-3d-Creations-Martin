const STORAGE_KEY = 'lapanza-cart';

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

export function addItem({ productId, name, price, image, quantity = 1 }) {
  if (!productId) return getCart();
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
