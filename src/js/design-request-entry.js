import './site.js';

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

// Offered only after the request has actually been sent, same reasoning as
// checkout's post-purchase opt-in (src/js/checkout-entry.js): never adds
// friction to submitting, and is skipped outright when the submitter
// already has an account (data.client.hasAccount from the submit response).
// The single `name` field this form collects is split into first/last word
// to match /api/client/register's signature.
function accountPanelHtml() {
  return `<div class="border-t border-charcoal/10 pt-4 mt-4">
    <p class="text-sm font-semibold mb-2">Create an account to track this request</p>
    <form id="dr-account-form" class="flex flex-wrap gap-2 items-start">
      <input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" class="border border-charcoal/15 rounded-sm px-3 py-2 bg-transparent text-sm flex-1 min-w-[200px]" />
      <button type="submit" class="text-sm font-semibold bg-charcoal text-cream rounded-full px-4 py-2 hover:bg-terracotta transition-colors">Create account</button>
    </form>
    <p id="dr-account-note" class="text-sm text-espresso/70 mt-1"></p>
  </div>`;
}

function wireAccountPanel(panel, { name, email }) {
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/);
  const lastName = rest.join(' ');
  const form = panel.querySelector('#dr-account-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = panel.querySelector('#dr-account-note');
    const password = new FormData(form).get('password');
    try {
      const { message } = await api('/api/client/register', {
        method: 'POST',
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      note.textContent = message || 'Account created — check your email to verify it.';
      form.classList.add('hidden');
    } catch (err) {
      note.textContent = err.message;
    }
  });
}

// Native file inputs give no clear feedback once picked -- pairs each hidden
// `data-file-input` with a styled trigger, a name display, and a clear
// button. Phase-5 #82: inputs are `multiple` now; the display shows the
// count + names.
// Mirrors server/uploads.js's allowlists. The server's multer fileFilter
// silently DROPS a disallowed file (cb(null, false)) -- the request still
// succeeds and the customer sees "we've received your request" with no file
// attached. Rejecting here, at pick time, is the only place the customer
// actually gets told.
const FILE_RULES = {
  referenceImage: {
    ok: (f) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type),
    hint: 'JPG, PNG or WebP images',
  },
  referenceFile: {
    ok: (f) => ['.stl', '.3mf', '.obj', '.gcode', '.zip', '.pdf'].some((ext) => f.name.toLowerCase().endsWith(ext)),
    hint: 'STL, 3MF, OBJ, GCODE, ZIP or PDF files',
  },
};
const MAX_FILE_BYTES = 50 * 1024 * 1024; // matches server/uploads.js fileSize limit

function initFileField(input) {
  const row = input.closest('div');
  const display = row.querySelector('.file-name-display');
  const clearBtn = row.querySelector('.file-clear-btn');
  const defaultText = display.dataset.defaultText;
  const rule = FILE_RULES[input.name];

  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    const rejected = rule ? files.filter((f) => !rule.ok(f)) : [];
    const oversized = files.filter((f) => f.size > MAX_FILE_BYTES);
    if (rejected.length || oversized.length) {
      input.value = '';
      display.textContent = rejected.length
        ? `${rejected.map((f) => f.name).join(', ')} — not accepted here. Please pick ${rule.hint}.`
        : `${oversized.map((f) => f.name).join(', ')} — over the 50MB limit. Please pick a smaller file.`;
      display.classList.add('text-terracotta');
      display.classList.remove('text-charcoal', 'text-espresso/60');
      clearBtn.classList.add('hidden');
      return;
    }
    display.classList.remove('text-terracotta');
    display.textContent = files.length
      ? files.length === 1
        ? files[0].name
        : `${files.length} files: ${files.map((f) => f.name).join(', ')}`
      : defaultText;
    display.classList.toggle('text-charcoal', files.length > 0);
    display.classList.toggle('text-espresso/60', files.length === 0);
    clearBtn.classList.toggle('hidden', files.length === 0);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('change'));
  });
}

// #83: XHR (not fetch) purely for upload progress events -- 50MB model
// files on home connections upload for a long, otherwise-silent time.
function uploadWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/design-requests');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Something went wrong'));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error — your details are still filled in, please try again.')));
    xhr.send(formData);
  });
}

// #81: review-before-submit. First submit shows the summary; the confirm
// button inside it performs the real upload. Field values are never
// cleared on failure (#83's error-recovery requirement).
function buildReview(form) {
  const body = document.getElementById('dr-review-body');
  body.textContent = '';
  const fd = new FormData(form);
  const files = [
    ...[...(form.querySelector('[name="referenceImage"]').files || [])],
    ...[...(form.querySelector('[name="referenceFile"]').files || [])],
  ];
  const rows = [
    ['Service', fd.get('serviceType') === 'design_for_me' ? 'Design it for me' : 'Print my model'],
    ['Contact', `${fd.get('name') || ''} · ${fd.get('email') || ''} · ${fd.get('phone') || ''}`],
    ['Description', String(fd.get('description') || '').slice(0, 160)],
    ['Use / size / qty', [fd.get('intendedUse'), fd.get('dimensions'), `qty ${fd.get('quantity') || 1}`].filter(Boolean).join(' · ')],
    ['Preferences', [fd.get('materialPref') || 'material: recommend', fd.get('colourPref'), fd.get('finishPref'), fd.get('urgency'), fd.get('deliveryPref')].filter(Boolean).join(' · ')],
    ['Files', files.length ? files.map((f) => f.name).join(', ') : 'None attached'],
  ];
  for (const [label, value] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.className = 'font-semibold inline';
    dt.textContent = `${label}: `;
    const dd = document.createElement('dd');
    dd.className = 'inline text-espresso/75';
    dd.textContent = value;
    div.append(dt, dd);
    body.appendChild(div);
  }
}

async function init() {
  const form = document.getElementById('design-request-form');
  const note = document.getElementById('design-request-note');
  if (!form) return;

  form.querySelectorAll('[data-file-input]').forEach(initFileField);

  // Backlog #72: vehicle pages link here with ?context=<brand>.
  const context = new URLSearchParams(window.location.search).get('context');
  if (context) {
    const desc = form.querySelector('[name="description"]');
    if (desc && !desc.value.trim()) {
      desc.value = `Vehicle: ${context.slice(0, 60)}\nPart number (if known): \nWhat the part is / what it should do: `;
    }
  }

  const review = document.getElementById('dr-review');
  const progressWrap = document.getElementById('dr-progress');
  const progressBar = document.getElementById('dr-progress-bar');
  const progressText = document.getElementById('dr-progress-text');
  let confirmed = false;

  document.getElementById('dr-edit')?.addEventListener('click', () => {
    review.classList.add('hidden');
    confirmed = false;
  });

  document.getElementById('dr-confirm')?.addEventListener('click', () => {
    confirmed = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.textContent = '';
    if (!form.reportValidity()) return;

    if (!confirmed) {
      buildReview(form);
      review.classList.remove('hidden');
      review.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const confirmBtn = document.getElementById('dr-confirm');
    confirmBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    const submittedFormData = new FormData(form);
    try {
      const data = await uploadWithProgress(submittedFormData, (pct) => {
        progressBar.style.width = `${pct}%`;
        progressText.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Processing…';
      });
      note.textContent = "Thanks — we've received your request. Check your email for a link to follow its status.";
      try {
        document.dispatchEvent(new CustomEvent('lapanza:track', { detail: { eventType: 'quote_submit' } }));
      } catch { /* tracking must never break the form */ }
      if (data.client && !data.client.hasAccount) {
        const panel = document.getElementById('dr-account-panel');
        panel.innerHTML = accountPanelHtml();
        wireAccountPanel(panel, { name: submittedFormData.get('name'), email: submittedFormData.get('email') });
      }
      form.reset();
      form.querySelectorAll('[data-file-input]').forEach((i) => i.dispatchEvent(new Event('change')));
      review.classList.add('hidden');
      confirmed = false;
      note.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      // #83: nothing is cleared -- the customer fixes and retries.
      note.textContent = err.message || 'Something went wrong — please try again.';
    } finally {
      confirmBtn.disabled = false;
      progressWrap.classList.add('hidden');
      progressBar.style.width = '0%';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
