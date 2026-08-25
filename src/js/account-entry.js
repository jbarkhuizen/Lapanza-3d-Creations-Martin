import './site.js';
import { formatRand as formatPrice } from './money.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

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

function orderRowHtml(order) {
  const reference = escapeHtml(order.invoice_number || order.id?.slice(0, 8) || order.id);
  const placedDate = escapeHtml(new Date(order.created_at).toLocaleDateString());
  const status = escapeHtml(order.status);
  const total = formatPrice(order.total);
  const cells = [reference, placedDate, status, total];
  const tds = cells.map((cell, i) => `<td class="px-4 py-2.5${i === 3 ? ' text-right' : ''}">${cell}</td>`).join('');
  return `<tr class="border-t border-charcoal/10">${tds}</tr>`;
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

  try {
    const { orders } = await api('/api/client/orders');
    const tbody = document.getElementById('account-orders');
    const emptyEl = document.getElementById('account-orders-empty');
    if (!orders.length) {
      emptyEl.classList.remove('hidden');
    } else {
      tbody.innerHTML = orders.map(orderRowHtml).join('');
    }
  } catch {
    // Order history is a nice-to-have on this page -- a failed fetch
    // shouldn't block the account page itself from working.
  }
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
