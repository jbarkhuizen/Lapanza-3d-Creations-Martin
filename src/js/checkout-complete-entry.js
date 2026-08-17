import './site.js';
import { clearCart } from './cart.js';

// Payfast's return_url only means "the customer's browser was sent back
// here" -- it says nothing about whether the ITN has actually confirmed
// payment yet, so this page deliberately doesn't claim the order is paid.
// Clearing the cart here (rather than before the Payfast redirect) means a
// customer who hits Back/Cancel on Payfast's page keeps their cart intact.
clearCart();

const orderId = new URLSearchParams(window.location.search).get('order');
if (orderId) {
  document.getElementById('order-ref').textContent = `Order reference: ${orderId}`;
}
