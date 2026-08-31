import './site.js';

// Native file inputs give no clear feedback once picked -- pairs each hidden
// `data-file-input` with a styled trigger, a name display, and a clear
// button. Phase-5 #82: inputs are `multiple` now; the display shows the
// count + names.
function initFileField(input) {
  const row = input.closest('div');
  const display = row.querySelector('.file-name-display');
  const clearBtn = row.querySelector('.file-clear-btn');
  const defaultText = display.dataset.defaultText;

  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
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
    try {
      await uploadWithProgress(new FormData(form), (pct) => {
        progressBar.style.width = `${pct}%`;
        progressText.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Processing…';
      });
      note.textContent = "Thanks — we've received your request. Check your email for a link to follow its status.";
      try {
        document.dispatchEvent(new CustomEvent('lapanza:track', { detail: { eventType: 'quote_submit' } }));
      } catch { /* tracking must never break the form */ }
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
