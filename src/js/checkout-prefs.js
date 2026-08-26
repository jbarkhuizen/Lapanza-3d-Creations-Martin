// Shipping/payment method choice persists across static page reloads the
// same way cart.js persists the cart -- but must be cleared once an order
// actually completes, otherwise the next checkout in the same session
// silently reopens with the previous order's picks instead of the page's
// real defaults (Payfast — Card, PUDO Locker).
const PREFS_KEY = 'lapanza-checkout-prefs';

export function readCheckoutPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCheckoutPrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readCheckoutPrefs(), ...patch }));
  } catch {
    /* private-mode/quota-full localStorage -- selection just won't persist */
  }
}

export function clearCheckoutPrefs() {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    /* private-mode localStorage -- nothing to clear */
  }
}
