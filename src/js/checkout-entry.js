import './site.js';
import { getCart, getCartTotal, getCartTotalWeight, clearCart } from './cart.js';

function formatPrice(value) {
  return `R${Number(value || 0).toFixed(0)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderLines(items) {
  const list = document.getElementById('checkout-lines');
  list.innerHTML = items
    .map(
      (i) => `<li class="flex justify-between gap-3 text-sm">
        <span>${escapeHtml(i.name)} &times; ${escapeHtml(String(i.quantity))}</span>
        <span>${escapeHtml(formatPrice(i.price * i.quantity))}</span>
      </li>`,
    )
    .join('');
}

// Submits a real, browser-navigated POST to Payfast's hosted page -- not a
// fetch/XHR redirect, since Payfast needs to own the top-level navigation
// for its own checkout UI. Field order mirrors what buildPayfastRedirect()
// signed server-side, though Payfast itself only cares about field names.
function submitToPayfast({ actionUrl, fields }) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function showManualEftSuccess(order) {
  document.getElementById('checkout-form').classList.add('hidden');
  const box = document.getElementById('checkout-success');
  box.classList.remove('hidden');
  box.innerHTML = `
    <h2 class="font-serif text-2xl mb-3">Order placed — ${escapeHtml(order.id.slice(0, 8))}</h2>
    <p class="text-espresso/70 mb-4">Please pay via EFT using the details below, using your order reference. We'll confirm once payment reflects.</p>
    <div class="border border-charcoal/10 rounded-sm p-4 bg-linen text-sm mb-4">
      <p><strong>Order reference:</strong> ${escapeHtml(order.id)}</p>
      <p><strong>Amount:</strong> ${escapeHtml(formatPrice(order.total))}</p>
      <p class="mt-2 text-espresso/60">Banking details have also been emailed to you.</p>
    </div>
    <a href="index.html" class="inline-flex text-sm font-semibold bg-charcoal text-cream rounded-full px-5 py-2.5 hover:bg-terracotta transition-colors">Back to shop</a>`;
}

async function init() {
  const items = getCart();
  if (!items.length) {
    document.getElementById('checkout-empty').classList.remove('hidden');
    document.getElementById('checkout-form').classList.add('hidden');
    return;
  }

  renderLines(items);
  const weight = getCartTotalWeight();
  const subtotal = getCartTotal();
  document.getElementById('checkout-weight').textContent = `${weight}g`;
  document.getElementById('checkout-subtotal').textContent = formatPrice(subtotal);

  const shippingBox = document.getElementById('checkout-shipping');
  const submitBtn = document.getElementById('checkout-submit');
  let shippingOption = null;
  try {
    const { shippingOption: match } = await api(`/api/shipping-match?weight=${weight}`);
    shippingOption = match;
    shippingBox.innerHTML = `<p class="text-sm">${escapeHtml(match.name)} — ${escapeHtml(formatPrice(match.price))}</p>`;
    document.getElementById('checkout-shipping-price').textContent = formatPrice(match.price);
    document.getElementById('checkout-total').textContent = formatPrice(subtotal + match.price);
  } catch (err) {
    shippingBox.innerHTML = `<p class="text-sm text-terracotta">${escapeHtml(err.message)}</p>`;
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }

  document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('checkout-error');
    errorEl.classList.add('hidden');
    if (!shippingOption) return;

    const data = new FormData(e.target);
    const client = {
      name: data.get('name'),
      email: data.get('email'),
      phone: data.get('phone'),
      street: data.get('street'),
      suburb: data.get('suburb'),
      city: data.get('city'),
      province: data.get('province'),
      postalCode: data.get('postalCode'),
      country: data.get('country'),
    };
    const paymentMethod = data.get('paymentMethod');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
    try {
      const { order, redirect } = await api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          client,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          shippingOptionId: shippingOption.id,
          paymentMethod,
        }),
      });

      if (paymentMethod === 'manual_eft') {
        clearCart();
        showManualEftSuccess(order);
      } else {
        // Cart is cleared on the return_url page (checkout-complete.html),
        // not here -- clearing it before the customer has actually reached
        // Payfast (or if they hit back/cancel) would lose their cart for no
        // reason if the payment never completes.
        submitToPayfast(redirect);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Place order';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
