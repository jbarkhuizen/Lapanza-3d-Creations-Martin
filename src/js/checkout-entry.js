import './site.js';
import { getCart, getCartTotal, getCartTotalWeight, clearCart } from './cart.js';
import { formatRand as formatPrice } from './money.js';
import { readCheckoutPrefs as readPrefs, writeCheckoutPrefs as writePrefs, clearCheckoutPrefs } from './checkout-prefs.js';
import { computeVolumeDiscount } from './volume-discount.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    // Needed for /api/client/me and /api/client/me (update) to see the
    // client session cookie -- without this a logged-in customer would
    // never be detected on this page.
    credentials: 'include',
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

// Phase 4: offered only after the order has actually succeeded, never
// before -- so it can't add friction to completing a purchase. "Create an
// account" is skipped for a client who already has one (order.client.hasAccount).
function optInPanelHtml(client) {
  const accountBlock = client.hasAccount
    ? ''
    : `<div class="border-t border-charcoal/10 pt-4 mt-4">
        <p class="text-sm font-semibold mb-2">Create an account to track this order</p>
        <form id="optin-account-form" class="flex flex-wrap gap-2 items-start">
          <input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" class="border border-charcoal/15 rounded-sm px-3 py-2 bg-transparent text-sm flex-1 min-w-[200px]" />
          <button type="submit" class="text-sm font-semibold bg-charcoal text-cream rounded-full px-4 py-2 hover:bg-terracotta transition-colors">Create account</button>
        </form>
        <p id="optin-account-note" class="text-sm text-espresso/70 mt-1"></p>
      </div>`;
  return `
    <div class="border-t border-charcoal/10 pt-4 mt-4">
      <p class="text-sm font-semibold mb-2">Stay in the loop</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" id="optin-email" class="text-xs font-semibold uppercase tracking-[0.1em] border-2 border-charcoal rounded-full px-4 py-2 hover:bg-charcoal hover:text-cream transition-colors">Email me updates</button>
        <button type="button" id="optin-whatsapp" class="text-xs font-semibold uppercase tracking-[0.1em] border-2 border-charcoal rounded-full px-4 py-2 hover:bg-charcoal hover:text-cream transition-colors">WhatsApp me updates</button>
      </div>
      <p id="optin-marketing-note" class="text-sm text-espresso/70 mt-2"></p>
    </div>
    ${accountBlock}`;
}

function wireOptInPanel(client) {
  document.getElementById('optin-email')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const note = document.getElementById('optin-marketing-note');
    btn.disabled = true;
    try {
      await api('/api/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email: client.email }) });
      note.textContent = 'Check your email to confirm your subscription.';
    } catch (err) {
      note.textContent = err.message;
      btn.disabled = false;
    }
  });

  document.getElementById('optin-whatsapp')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const note = document.getElementById('optin-marketing-note');
    btn.disabled = true;
    try {
      await api(`/api/client/${client.id}/marketing-preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ email: client.email, whatsappOptIn: true }),
      });
      note.textContent = "You're opted in for WhatsApp updates.";
    } catch (err) {
      note.textContent = err.message;
      btn.disabled = false;
    }
  });

  const accountForm = document.getElementById('optin-account-form');
  accountForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = document.getElementById('optin-account-note');
    const password = new FormData(accountForm).get('password');
    try {
      const { message } = await api('/api/client/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          password,
        }),
      });
      note.textContent = message || 'Account created — check your email to verify it.';
      accountForm.classList.add('hidden');
    } catch (err) {
      note.textContent = err.message;
    }
  });
}

// Renders from the checkout response's own bankingDetails, not from
// /site-settings.json -- the public settings file deliberately no longer
// carries the bank account (launch-audit #3); the server attaches the
// details only to the manual-EFT order response, and the invoice email
// carries them independently, so a missing/null value here just omits the
// panel rather than blocking the success screen.
function bankingDetailsHtml(bankingDetails) {
  if (!bankingDetails || !bankingDetails.bankName) return '';
  return `
          <p class="mt-3 mb-1"><strong>Banking details</strong></p>
          <p>Bank: ${escapeHtml(bankingDetails.bankName)}</p>
          <p>Account name: ${escapeHtml(bankingDetails.accountName)}</p>
          <p>Account number: ${escapeHtml(bankingDetails.accountNumber)}</p>
          <p>Branch code: ${escapeHtml(bankingDetails.branchCode)}</p>`;
}

function showOrderPlacedSuccess(order, paymentMethod, bankingDetails) {
  document.getElementById('checkout-form').classList.add('hidden');
  const box = document.getElementById('checkout-success');
  box.classList.remove('hidden');
  const reference = order.id.slice(0, 8);
  const paymentNote =
    paymentMethod === 'manual_eft'
      ? `<div class="border border-charcoal/10 rounded-sm p-4 bg-linen text-sm mb-4">
          <p><strong>Order reference:</strong> ${escapeHtml(reference)}</p>
          <p><strong>Amount:</strong> ${escapeHtml(formatPrice(order.total))}</p>
          <p class="mt-2 text-espresso/60">Please pay via EFT using your order reference.</p>
          ${bankingDetailsHtml(bankingDetails)}
        </div>`
      : `<div class="border border-charcoal/10 rounded-sm p-4 bg-linen text-sm mb-4">
          <p><strong>Order reference:</strong> ${escapeHtml(reference)}</p>
          <p><strong>Amount due on collection:</strong> ${escapeHtml(formatPrice(order.total))}</p>
          <p class="mt-2 text-espresso/60">We'll let you know when your order is ready to collect. Pay in cash when you pick it up.</p>
        </div>`;
  box.innerHTML = `
    <h2 class="font-serif text-2xl mb-3">Order placed — ${escapeHtml(reference)}</h2>
    ${paymentNote}
    <a href="index.html" class="inline-flex text-sm font-semibold bg-charcoal text-cream rounded-full px-5 py-2.5 hover:bg-terracotta transition-colors">Back to shop</a>
    ${order.client ? optInPanelHtml(order.client) : ''}`;
  if (order.client) wireOptInPanel(order.client);
}

async function init() {
  const items = getCart();
  if (!items.length) {
    document.getElementById('checkout-empty').classList.remove('hidden');
    document.getElementById('checkout-form').classList.add('hidden');
    return;
  }

  renderLines(items);

  // Duplicate-order fix (2026-09-03): Payfast's cancel_url lands back here
  // with ?cancelled=<orderId>. Offer to finish paying the EXISTING order --
  // before this, every retry submitted the still-full cart as a brand-new
  // order (new invoice + emails + stock reserved again; three customers hit
  // it on launch day). The server also dedupes identical re-submissions,
  // so even ignoring this banner no longer mints duplicates.
  const cancelledOrderId = new URLSearchParams(window.location.search).get('cancelled');
  if (cancelledOrderId) {
    const banner = document.createElement('div');
    banner.className = 'panel p-6 border-2 border-terracotta rounded-sm mb-8';
    banner.innerHTML = `
      <h2 class="font-serif text-xl mb-2 tracking-tight">Your payment wasn't completed</h2>
      <p class="text-sm text-espresso/70 mb-4">No problem — your order is saved and unpaid. Finish paying it below (no new order will be created):</p>
      <div class="flex flex-wrap gap-3">
        <button type="button" data-retry-method="payfast_card" class="inline-flex items-center gap-2 bg-charcoal text-cream rounded-full px-5 py-2.5 text-sm font-semibold hover:bg-terracotta transition-colors">Pay by Card</button>
        <button type="button" data-retry-method="payfast_eft" class="inline-flex items-center gap-2 border-2 border-charcoal rounded-full px-5 py-2.5 text-sm font-semibold hover:bg-charcoal hover:text-cream transition-colors">Pay by Instant EFT</button>
      </div>
      <p class="text-xs text-espresso/50 mt-3" data-retry-note>Prefer EFT into our account or cash on collection? Just place the order again below with that option — we'll reuse your saved order.</p>`;
    const main = document.getElementById('main');
    main?.insertBefore(banner, main.querySelector('#checkout-empty'));
    banner.querySelectorAll('[data-retry-method]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const { redirect } = await api('/api/checkout/retry-payment', {
            method: 'POST',
            body: JSON.stringify({ orderId: cancelledOrderId, method: btn.dataset.retryMethod }),
          });
          submitToPayfast(redirect);
        } catch (err) {
          banner.querySelector('[data-retry-note]').textContent = err.message;
          btn.disabled = false;
        }
      });
    });
  }
  // Backlog #113: a checkout page load with a non-empty cart = checkout
  // started (fires once per load; analytics.js's listener does the send).
  try {
    document.dispatchEvent(new CustomEvent('lapanza:track', { detail: { eventType: 'checkout_start' } }));
  } catch { /* tracking must never break checkout */ }
  const weight = getCartTotalWeight();
  const subtotal = getCartTotal();
  // Backlog #60: mirror the server's volume-discount rule so the displayed
  // total always matches what createOrder will actually charge (and what
  // Payfast is asked for). Settings fetch failure -> no discount shown; the
  // server still applies it, erring on charging LESS than displayed.
  let volumeDiscountAmount = 0;
  try {
    const settingsRes = await fetch('/site-settings.json', { cache: 'no-store' });
    if (settingsRes.ok) {
      const vd = computeVolumeDiscount(items, (await settingsRes.json()).volumeDiscounts);
      if (vd) {
        volumeDiscountAmount = vd.amount;
        document.getElementById('checkout-discount').textContent = `−${formatPrice(vd.amount)}`;
        document.getElementById('checkout-discount-row').classList.remove('hidden');
      }
    }
  } catch { /* no discount display -- server remains the authority */ }
  // Backlog #99: applied promo code. Like the volume discount above, this is
  // a display mirror -- the server re-validates the code and computes the
  // authoritative discount inside createOrder(). lastShippingPrice remembers
  // the most recent shipping price so applying/removing a code can refresh
  // the total without waiting for the next shipping event.
  let appliedPromo = null; // { code, discountAmount }
  let lastShippingPrice = 0;
  const orderTotal = (shippingPrice) => {
    lastShippingPrice = shippingPrice;
    return Math.max(0, subtotal - volumeDiscountAmount - (appliedPromo?.discountAmount || 0) + shippingPrice);
  };
  document.getElementById('checkout-weight').textContent = `${weight}g`;
  document.getElementById('checkout-subtotal').textContent = formatPrice(subtotal);

  const promoInput = document.getElementById('checkout-promo-input');
  const promoNote = document.getElementById('checkout-promo-note');
  const promoRow = document.getElementById('checkout-promo-row');
  const setPromoNote = (text, ok) => {
    promoNote.textContent = text;
    promoNote.classList.toggle('hidden', !text);
    promoNote.style.color = ok ? '#2e6e46' : '#b53a2e';
  };
  document.getElementById('checkout-promo-apply')?.addEventListener('click', async () => {
    const code = (promoInput.value || '').trim();
    appliedPromo = null;
    promoRow.classList.add('hidden');
    if (!code) {
      setPromoNote('', true);
      document.getElementById('checkout-total').textContent = formatPrice(orderTotal(lastShippingPrice));
      return;
    }
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotal: subtotal - volumeDiscountAmount }),
      });
      const data = await res.json();
      if (!data.ok) {
        setPromoNote(data.reason || 'That promo code is not valid.', false);
      } else {
        appliedPromo = { code: data.code, discountAmount: data.discountAmount };
        document.getElementById('checkout-promo-label').textContent = `Promo ${data.code}`;
        document.getElementById('checkout-promo-amount').textContent = `−${formatPrice(data.discountAmount)}`;
        promoRow.classList.remove('hidden');
        setPromoNote(`Code ${data.code} applied.`, true);
      }
    } catch {
      setPromoNote('Could not check that code — please try again.', false);
    }
    document.getElementById('checkout-total').textContent = formatPrice(orderTotal(lastShippingPrice));
  });

  const form = document.getElementById('checkout-form');
  const shippingBox = document.getElementById('checkout-shipping');
  const addressFields = document.getElementById('checkout-address-fields');
  const cocLabel = document.getElementById('checkout-coc-label');
  const submitBtn = document.getElementById('checkout-submit');

  let shippingOption = null;
  let shippingReady = false;
  let fixedOptions = null;

  // Admin-managed 'fixed' shipping_options rows have no category field --
  // just a free-text name (e.g. "PUDO Locker to Locker (Small)", "Local
  // Delivery") -- so the two radios below are split by name here, purely
  // for checkout-page display. Both still submit as the single backend
  // 'fixed' shippingMethod (see backendShippingMethod in the submit handler).
  // category is now a real admin-set field (server/db.js's
  // ensureShippingCategoryColumn backfilled every existing row from this
  // exact name heuristic) -- still falls back to the name check for the
  // rare row that somehow has no category at all, rather than vanishing
  // from both buckets.
  const FIXED_BUCKETS = {
    fixed_local: (o) => (o.category ? o.category === 'Local Delivery' : /local/i.test(o.name)),
    fixed_pudo: (o) => (o.category ? o.category !== 'Local Delivery' : !/local/i.test(o.name)),
  };

  function renderFixedOptionsPicker(method) {
    shippingBox.textContent = '';
    const bucketOptions = fixedOptions.filter(FIXED_BUCKETS[method]);
    if (!bucketOptions.length) {
      const note = document.createElement('p');
      note.className = 'text-sm text-espresso/60';
      note.textContent = 'No options available right now — please choose another shipping method or contact us.';
      shippingBox.appendChild(note);
      return;
    }

    const select = document.createElement('select');
    select.id = 'checkout-fixed-shipping';
    select.className = 'w-full border border-charcoal/15 rounded-sm px-3 py-2 bg-cream text-charcoal text-sm';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose an option…';
    select.appendChild(blank);
    bucketOptions.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = `${o.name} — ${formatPrice(o.price)}`;
      select.appendChild(opt);
    });
    shippingBox.appendChild(select);

    select.addEventListener('change', () => {
      shippingOption = bucketOptions.find((o) => o.id === select.value) || null;
      shippingReady = Boolean(shippingOption);
      submitBtn.disabled = !shippingReady;
      writePrefs({ fixedShippingOptionId: shippingOption?.id || null });
      const price = shippingOption?.price || 0;
      document.getElementById('checkout-shipping-price').textContent = formatPrice(price);
      document.getElementById('checkout-total').textContent = formatPrice(orderTotal(price));
    });
    // Restore a previously-picked PUDO/local-delivery option (the select's
    // own choices, not just the shippingMethod radio above it) after coming
    // back to this page.
    const savedOptionId = readPrefs().fixedShippingOptionId;
    if (savedOptionId && bucketOptions.some((o) => o.id === savedOptionId)) {
      select.value = savedOptionId;
      select.dispatchEvent(new Event('change'));
    }
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
      document.getElementById('checkout-total').textContent = formatPrice(orderTotal(0));
      return;
    }

    if (method === 'fixed_pudo' || method === 'fixed_local') {
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
          shippingBox.textContent = '';
          const note = document.createElement('p');
          note.className = 'text-sm text-terracotta';
          note.textContent = err.message;
          shippingBox.appendChild(note);
          return;
        }
      }
      renderFixedOptionsPicker(method);
      return;
    }

    setAddressRequired(true);
    shippingBox.textContent = 'Calculating…';
    try {
      const { shippingOption: match } = await api(`/api/shipping-match?weight=${weight}`);
      shippingOption = match;
      shippingReady = true;
      shippingBox.textContent = '';
      const note = document.createElement('p');
      note.className = 'text-sm';
      note.textContent = `${match.name} — ${formatPrice(match.price)}`;
      shippingBox.appendChild(note);
      document.getElementById('checkout-shipping-price').textContent = formatPrice(match.price);
      document.getElementById('checkout-total').textContent = formatPrice(orderTotal(match.price));
      submitBtn.disabled = false;
    } catch (err) {
      shippingBox.textContent = '';
      const note = document.createElement('p');
      note.className = 'text-sm text-terracotta';
      note.textContent = err.message;
      shippingBox.appendChild(note);
    }
  }

  function updatePaymentOptions() {
    // Cash on Collection is only valid with the 'collect' shipping method --
    // the server hard-rejects every other combination (orders.js), so hide
    // the option rather than letting the customer fill in the whole form and
    // only learn about the rule at submit time.
    const method = form.querySelector('[name="shippingMethod"]:checked')?.value;
    const collectChosen = method === 'collect';
    cocLabel.classList.toggle('hidden', !collectChosen);
    cocLabel.classList.toggle('flex', collectChosen);
    const cocRadio = cocLabel.querySelector('input[name="paymentMethod"]');
    if (cocRadio) {
      cocRadio.disabled = !collectChosen;
      if (!collectChosen && cocRadio.checked) {
        const fallback = form.querySelector('[name="paymentMethod"][value="payfast_card"]');
        if (fallback) {
          fallback.checked = true;
          writePrefs({ paymentMethod: fallback.value });
        }
      }
    }
  }

  // Restore the shippingMethod/paymentMethod radio the customer had picked
  // before navigating away -- otherwise every fresh load of this static page
  // silently resets both back to the hardcoded `checked` defaults in the HTML.
  const savedPrefs = readPrefs();
  if (savedPrefs.shippingMethod) {
    const radio = form.querySelector(`[name="shippingMethod"][value="${savedPrefs.shippingMethod}"]`);
    if (radio) radio.checked = true;
  }
  if (savedPrefs.paymentMethod) {
    const radio = form.querySelector(`[name="paymentMethod"][value="${savedPrefs.paymentMethod}"]`);
    if (radio) radio.checked = true;
  }

  form.querySelectorAll('[name="shippingMethod"]').forEach((r) =>
    r.addEventListener('change', () => { writePrefs({ shippingMethod: r.value }); updateShipping(); updatePaymentOptions(); }),
  );
  form.querySelectorAll('[name="paymentMethod"]').forEach((r) =>
    r.addEventListener('change', () => writePrefs({ paymentMethod: r.value })),
  );
  await updateShipping();
  updatePaymentOptions();

  function buildClientPayload() {
    const data = new FormData(form);
    return {
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
      whatsappOptIn: data.get('whatsappOptIn') === 'on',
      emailMarketingOptIn: data.get('emailMarketingOptIn') === 'on',
      emailMarketingConsentSource: data.get('emailMarketingOptIn') === 'on' ? 'checkout' : '',
    };
  }

  function collectMissingFields() {
    const missing = [];
    form.querySelectorAll('[required]').forEach((input) => {
      const ok = input.type === 'email' ? input.checkValidity() : String(input.value || '').trim() !== '';
      if (ok) return;
      const label = input.closest('label')?.querySelector('span')?.textContent?.replace(/\s*\*\s*$/, '').trim() || input.name;
      missing.push(label);
    });
    return missing;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('checkout-error');
    const infoEl = document.getElementById('checkout-info');
    errorEl.classList.add('hidden');
    infoEl.classList.add('hidden');
    if (!shippingReady) {
      // Previously a silent no-op -- the button just "did nothing" when
      // shipping options had failed to load or no fixed option was picked.
      errorEl.textContent = 'Please choose a shipping option above before placing the order.';
      errorEl.classList.remove('hidden');
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const missing = collectMissingFields();
    if (missing.length) {
      errorEl.textContent = `Please complete the following before placing your order: ${missing.join(', ')}.`;
      errorEl.classList.remove('hidden');
      form.reportValidity();
      return;
    }
    const client = buildClientPayload();
    const data = new FormData(form);
    const paymentMethod = data.get('paymentMethod');
    const shippingMethod = data.get('shippingMethod');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
    try {
      // 'fixed_pudo' and 'fixed_local' are a checkout-page-only split of the
      // single backend 'fixed' shipping method (see FIXED_BUCKETS below) --
      // the server only knows about 'fixed' plus a shippingOptionId.
      const backendShippingMethod = shippingMethod.startsWith('fixed') ? 'fixed' : shippingMethod;
      const { order, redirect, clientDataUpdated, bankingDetails } = await api('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          client,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          shippingMethod: backendShippingMethod,
          shippingOptionId: shippingOption?.id || null,
          paymentMethod,
          promoCode: appliedPromo?.code || '',
        }),
      });

      // The client record matched an existing one (by email, or by name when
      // the details submitted here no longer match what's on file) and got
      // updated -- brief, non-blocking heads-up before moving on.
      if (clientDataUpdated) {
        infoEl.textContent = 'Updating Client Data…';
        infoEl.classList.remove('hidden');
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      if (paymentMethod === 'manual_eft' || paymentMethod === 'cash_on_collection') {
        clearCart();
        clearCheckoutPrefs();
        showOrderPlacedSuccess(order, paymentMethod, bankingDetails);
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
  document.getElementById('checkout-cancel').addEventListener('click', () => {
    if (!confirm('Cancel this order and return to the shop? Your cart will be cleared.')) return;
    clearCart();
    window.location.href = 'index.html';
  });

  // Prefill from the logged-in client's saved details, and only surface
  // "Update Details" once they've actually changed something -- otherwise
  // the button has no purpose to click (nothing to save) on every visit.
  const DETAIL_FIELDS = ['firstName', 'lastName', 'businessName', 'email', 'phone', 'street', 'suburb', 'city', 'province', 'postalCode'];
  const updateDetailsBtn = document.getElementById('checkout-update-details');
  let detailsSnapshot = null;

  function currentDetailValues() {
    return DETAIL_FIELDS.map((name) => form.querySelector(`[name="${name}"]`)?.value || '').join(' ');
  }

  function checkDetailsDirty() {
    if (!detailsSnapshot) return;
    updateDetailsBtn.classList.toggle('hidden', currentDetailValues() === detailsSnapshot);
  }

  try {
    const { authenticated, client } = await api('/api/client/me');
    if (authenticated && client) {
      DETAIL_FIELDS.forEach((name) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (input && client[name] != null) input.value = client[name];
      });
      form.querySelector('[name="whatsappOptIn"]').checked = client.whatsappOptIn !== false;
      form.querySelector('[name="emailMarketingOptIn"]').checked = client.emailMarketingOptIn !== false;
      detailsSnapshot = currentDetailValues();
      DETAIL_FIELDS.forEach((name) => form.querySelector(`[name="${name}"]`)?.addEventListener('input', checkDetailsDirty));

      updateDetailsBtn.addEventListener('click', async () => {
        updateDetailsBtn.disabled = true;
        try {
          await api('/api/client/me', { method: 'PATCH', body: JSON.stringify(buildClientPayload()) });
          detailsSnapshot = currentDetailValues();
          updateDetailsBtn.textContent = 'Saved';
          setTimeout(() => {
            updateDetailsBtn.textContent = 'Update Details';
            updateDetailsBtn.classList.add('hidden');
            updateDetailsBtn.disabled = false;
          }, 1200);
        } catch (err) {
          updateDetailsBtn.disabled = false;
          const errorEl = document.getElementById('checkout-error');
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        }
      });
    }
  } catch {
    // Not logged in (or the check failed) -- checkout works fine as a guest,
    // the Update Details button just never has anything to show for.
  }
}

document.addEventListener('DOMContentLoaded', init);
