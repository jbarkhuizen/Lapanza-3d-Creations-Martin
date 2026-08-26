import './site.js';
import { formatRand as formatPrice } from './money.js';

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function textCell(text, extraClass = '') {
  const td = document.createElement('td');
  td.className = `px-4 py-2.5${extraClass}`;
  td.textContent = text;
  return td;
}

function orderRow(order) {
  const tr = document.createElement('tr');
  tr.className = 'border-t border-charcoal/10';
  tr.appendChild(textCell(order.invoice_number || order.id?.slice(0, 8) || order.id));
  tr.appendChild(textCell(new Date(order.created_at).toLocaleDateString()));
  tr.appendChild(textCell(order.status));

  const actionTd = document.createElement('td');
  actionTd.className = 'px-4 py-2.5';
  // Only an order still awaiting payment can be cancelled self-service --
  // mirrors cancelOrderByClient's own server-side guard, this is just the
  // UI-level reflection of the same rule (paid/shipped/completed orders
  // never show the button at all).
  if (order.status === 'pending_payment') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cancel-order-btn text-xs font-semibold uppercase tracking-[0.1em] border-2 border-charcoal rounded-full px-3 py-1.5 hover:bg-charcoal hover:text-cream transition-colors';
    btn.dataset.orderId = order.id;
    btn.textContent = 'Cancel';
    actionTd.appendChild(btn);
  }
  tr.appendChild(actionTd);

  tr.appendChild(textCell(formatPrice(order.total), ' text-right'));
  return tr;
}

async function loadOrders() {
  const tbody = document.getElementById('account-orders');
  const emptyEl = document.getElementById('account-orders-empty');
  try {
    const { orders } = await api('/api/client/orders');
    emptyEl.classList.toggle('hidden', orders.length > 0);
    tbody.replaceChildren(...orders.map(orderRow));
  } catch {
    // Order history is a nice-to-have on this page -- a failed fetch
    // shouldn't block the account page itself from working.
  }
}

// Event delegation on the tbody -- orders re-render wholesale after every
// load/cancel (loadOrders replaces its children), so binding to individual
// buttons would silently stop working after the first refresh.
function wireOrderCancelHandler() {
  const tbody = document.getElementById('account-orders');
  const note = document.getElementById('account-orders-note');
  tbody?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.cancel-order-btn');
    if (!btn) return;
    if (!confirm('Cancel this order? This cannot be undone.')) return;
    btn.disabled = true;
    note.classList.add('hidden');
    try {
      await api(`/api/client/orders/${btn.dataset.orderId}/cancel`, { method: 'POST' });
      await loadOrders();
      note.textContent = 'Order cancelled.';
      note.classList.remove('hidden');
    } catch (err) {
      btn.disabled = false;
      note.textContent = err.message || 'Something went wrong.';
      note.classList.remove('hidden');
    }
  });
}

async function showLoggedIn(client) {
  document.getElementById('account-loading').classList.add('hidden');
  document.getElementById('account-guest').classList.add('hidden');
  document.getElementById('account-forgot').classList.add('hidden');
  document.getElementById('account-reset').classList.add('hidden');
  const panel = document.getElementById('account-loggedin');
  panel.classList.remove('hidden');
  const welcomeName = client.name ? `, ${client.name}` : '';
  document.getElementById('account-welcome').textContent = `Welcome back${welcomeName}`;

  wireOrderCancelHandler();
  await loadOrders();
}

function showGuest() {
  document.getElementById('account-loading').classList.add('hidden');
  document.getElementById('account-loggedin').classList.add('hidden');
  document.getElementById('account-forgot').classList.add('hidden');
  document.getElementById('account-reset').classList.add('hidden');
  document.getElementById('account-guest').classList.remove('hidden');
}

function showForgot() {
  document.getElementById('account-guest').classList.add('hidden');
  document.getElementById('account-forgot').classList.remove('hidden');
}

function showReset() {
  document.getElementById('account-loading').classList.add('hidden');
  document.getElementById('account-guest').classList.add('hidden');
  document.getElementById('account-loggedin').classList.add('hidden');
  document.getElementById('account-forgot').classList.add('hidden');
  document.getElementById('account-reset').classList.remove('hidden');
}

async function init() {
  // A reset link (?reset_token=...) takes priority over the normal
  // logged-in/guest check below -- the token itself is the proof of
  // identity here, not any existing session.
  const resetToken = new URLSearchParams(window.location.search).get('reset_token');
  if (resetToken) {
    showReset();
  } else {
    try {
      const { authenticated, client } = await api('/api/client/me');
      if (authenticated && client) await showLoggedIn(client);
      else showGuest();
    } catch {
      showGuest();
    }
  }

  const loginForm = document.getElementById('login-form');
  const loginNote = document.getElementById('login-note');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginNote.textContent = '';
    const data = new FormData(loginForm);
    try {
      const { client } = await api('/api/client/login', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      await showLoggedIn(client);
    } catch (err) {
      loginNote.textContent = err.message || 'Something went wrong.';
    }
  });

  const registerForm = document.getElementById('register-form');
  const registerNote = document.getElementById('register-note');
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerNote.textContent = '';
    const data = new FormData(registerForm);
    try {
      const { message } = await api('/api/client/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName: data.get('firstName'),
          lastName: data.get('lastName'),
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      registerNote.textContent = message || 'Account created — check your email to verify it.';
      registerForm.reset();
    } catch (err) {
      registerNote.textContent = err.message || 'Something went wrong.';
    }
  });

  document.getElementById('forgot-password-link')?.addEventListener('click', showForgot);
  document.getElementById('back-to-login-link')?.addEventListener('click', showGuest);

  const forgotForm = document.getElementById('forgot-form');
  const forgotNote = document.getElementById('forgot-note');
  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    forgotNote.textContent = '';
    const data = new FormData(forgotForm);
    try {
      const { message } = await api('/api/client/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email') }),
      });
      forgotNote.textContent = message || "If an account exists for that email, we've sent a reset link.";
      forgotForm.reset();
    } catch (err) {
      forgotNote.textContent = err.message || 'Something went wrong.';
    }
  });

  const resetForm = document.getElementById('reset-form');
  const resetNote = document.getElementById('reset-note');
  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetNote.textContent = '';
    const data = new FormData(resetForm);
    const password = data.get('password');
    if (password !== data.get('confirmPassword')) {
      resetNote.textContent = 'Passwords do not match.';
      return;
    }
    try {
      const { client } = await api('/api/client/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, password }),
      });
      window.history.replaceState({}, '', window.location.pathname);
      await showLoggedIn(client);
    } catch (err) {
      resetNote.textContent = err.message || 'Something went wrong.';
    }
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/client/logout', { method: 'POST' });
    } catch {
      // Logging out is best-effort client-side too -- clearing the cookie
      // is what the endpoint does regardless of response body.
    }
    showGuest();
  });
}

document.addEventListener('DOMContentLoaded', init);
