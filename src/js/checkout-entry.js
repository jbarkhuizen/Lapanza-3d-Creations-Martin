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

function showOrderPlacedSuccess(order, paymentMethod) {
  document.getElementById('checkout-form').classList.add('hidden');
  const box = document.getElementById('checkout-success');
  box.classList.remove('hidden');
  const paymentNote =
    paymentMethod === 'manual_eft'
      ? `<div class="border border-charcoal/10 rounded-sm p-4 bg-linen text-sm mb-4">
          <p><strong>Order reference:</strong> ${escapeHtml(order.id)}</p>
          <p><strong>Amount:</strong> ${escapeHtml(formatPrice(order.total))}</p>
          <p class="mt-2 text-espresso/60">Please pay via EFT using your order reference. Banking details have also been emailed to you.</p>
        </div>`
      : `<div class="border border-charcoal/10 rounded-sm p-4 bg-linen text-sm mb-4">
          <p><strong>Order reference:</strong> ${escapeHtml(order.id)}</p>
          <p><strong>Amount due on collection:</strong> ${escapeHtml(formatPrice(order.total))}</p>
          <p class="mt-2 text-espresso/60">We'll let you know when your order is ready to collect. Pay in cash when you pick it up.</p>
        </div>`;
  box.innerHTML = `
    <h2 class="font-serif text-2xl mb-3">Order placed — ${escapeHtml(order.id.slice(0, 8))}</h2>
    ${paymentNote}
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

  const form = document.getElementById('checkout-form');
  const shippingBox = document.getElementById('checkout-shipping');
  const addressFields = document.getElementById('checkout-address-fields');
  const cocLabel = document.getElementById('checkout-coc-label');
  const submitBtn = document.getElementById('checkout-submit');

  let shippingOption = null;
  let shippingReady = false;
  let fixedOptions = null;

  function renderFixedOptionsPicker() {
    shippingBox.innerHTML = `
      <select id="checkout-fixed-shipping" class="w-full border border-charcoal/15 rounded-sm px-3 py-2 bg-transparent text-sm">
        <option value="">Choose an option…</option>
        ${fixedOptions.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)} — ${escapeHtml(formatPrice(o.price))}</option>`).join('')}
      </select>`;
    const select = document.getElementById('checkout-fixed-shipping');
    select.addEventListener('change', () => {
      shippingOption = fixedOptions.find((o) => o.id === select.value) || null;
      shippingReady = Boolean(shippingOption);
      submitBtn.disabled = !shippingReady;
      const price = shippingOption?.price || 0;
      document.getElementById('checkout-shipping-price').textContent = formatPrice(price);
      document.getElementById('checkout-total').textContent = formatPrice(subtotal + price);
    });
  }

  function setAddressRequired(required) {
    addressFields.querySelectorAll('input').forEach((input) => {
      if (input.name === 'country') return; // has a sensible default either way
      input.required = required;
    });
    addressFields.classList.toggle('opacity-50', !required);
  }

  async function updateShipping() {
    const method = form.shippingMethod.value;
    shippingReady = false;
    submitBtn.disabled = true;

    if (method === 'own_courier' || method === 'collect') {
      shippingOption = null;
      shippingReady = true;
      submitBtn.disabled = false;
      setAddressRequired(false);
      shippingBox.innerHTML = `<p class="text-sm text-espresso/60">${
        method === 'collect' ? 'No delivery charge — collect from our store.' : "No delivery charge — you'll arrange your own courier collection."
      }</p>`;
      document.getElementById('checkout-shipping-price').textContent = formatPrice(0);
      document.getElementById('checkout-total').textContent = formatPrice(subtotal);
      return;
    }

    if (method === 'fixed') {
      setAddressRequired(true);
      shippingOption = null;
      shippingReady = false;
      submitBtn.disabled = true;
      if (!fixedOptions) {
        shippingBox.textContent = 'Loading options…';
        try {
          const { shippingOptions } = await api('/api/shipping-options/public/fixed');
          fixedOptions = shippingOptions;
        } catch (err) {
          shippingBox.innerHTML = `<p class="text-sm text-terracotta">${escapeHtml(err.message)}</p>`;
          return;
        }
      }
      renderFixedOptionsPicker();
      return;
    }

    setAddressRequired(true);
    shippingBox.textContent = 'Calculating…';
    try {
      const { shippingOption: match } = await api(`/api/shipping-match?weight=${weight}`);
      shippingOption = match;
      shippingReady = true;
      shippingBox.innerHTML = `<p class="text-sm">${escapeHtml(match.name)} — ${escapeHtml(formatPrice(match.price))}</p>`;
      document.getElementById('checkout-shipping-price').textContent = formatPrice(match.price);
      document.getElementById('checkout-total').textContent = formatPrice(subtotal + match.price);
      submitBtn.disabled = false;
    } catch (err) {
      shippingBox.innerHTML = `<p class="text-sm text-terracotta">${escapeHtml(err.message)}</p>`;
    }
  }

  function updatePaymentOptions() {
    const isCollect = form.shippingMethod.value === 'collect';
    cocLabel.classList.toggle('hidden', !isCollect);
    cocLabel.classList.toggle('flex', isCollect);
    // Cash on Collection only makes sense when actually collecting -- if the
    // customer had it selected and then switches to a shipped method, fall
    // back to a sane default rather than submitting an invalid combination.
    if (!isCollect && form.paymentMethod.value === 'cash_on_collection') {
      form.querySelector('[name="paymentMethod"][value="payfast_card"]').checked = true;
    }
  }

  form.querySelectorAll('[name="shippingMethod"]').forEach((r) =>
    r.addEventListener('change', () => { updateShipping(); updatePaymentOptions(); }),
  );
  await updateShipping();
  updatePaymentOptions();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('checkout-error');
    errorEl.classList.add('hidden');
    if (!shippingReady) return;

    const data = new FormData(form);
    const client = {
      name: `${data.get('firstName')} ${data.get('lastName')}`.trim(),
      firstName: data.get('firstName'),
      lastName: data.get('lastName'),
      businessName: data.get('businessName'),
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
    const shippingMethod = data.get('shippingMethod');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
    try {
      const { order, redirect } = await api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          client,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          shippingMethod,
          shippingOptionId: shippingOption?.id || null,
          paymentMethod,
        }),
      });

      if (paymentMethod === 'manual_eft' || paymentMethod === 'cash_on_collection') {
        clearCart();
        showOrderPlacedSuccess(order, paymentMethod);
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
