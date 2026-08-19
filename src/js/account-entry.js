import './site.js';

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
  document.getElementById('account-guest').classList.remove('hidden');
}

async function init() {
  try {
    const { authenticated, client } = await api('/api/client/me');
    if (authenticated && client) await showLoggedIn(client);
    else showGuest();
  } catch {
    showGuest();
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
