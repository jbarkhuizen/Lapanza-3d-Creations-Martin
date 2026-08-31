import './site.js';

// Native file inputs give no clear feedback once a file is picked (just a
// cramped "Choose File <name>" the browser renders itself, no way to tell
// at a glance whether something's attached or to remove it) -- pairs each
// hidden `data-file-input` with a styled trigger label, a filename display,
// and a clear button, all driven from the input's own 'change' event.
function initFileField(input) {
  const row = input.closest('div');
  const display = row.querySelector('.file-name-display');
  const clearBtn = row.querySelector('.file-clear-btn');
  const defaultText = display.dataset.defaultText;

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    display.textContent = file ? file.name : defaultText;
    display.classList.toggle('text-charcoal', Boolean(file));
    display.classList.toggle('text-espresso/60', !file);
    clearBtn.classList.toggle('hidden', !file);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('change'));
  });
}

async function init() {
  const form = document.getElementById('design-request-form');
  const note = document.getElementById('design-request-note');
  if (!form) return;

  form.querySelectorAll('[data-file-input]').forEach(initFileField);

  // Backlog #72: vehicle pages link here with ?context=<brand>. Seed the
  // description with the vehicle and a part-number prompt so the request
  // arrives complete -- only when the field is still empty, never over
  // anything the customer already typed. Set via .value (plain text), so
  // the URL param can't inject markup.
  const context = new URLSearchParams(window.location.search).get('context');
  if (context) {
    const desc = form.querySelector('[name="description"]');
    if (desc && !desc.value.trim()) {
      desc.value = `Vehicle: ${context.slice(0, 60)}\nPart number (if known): \nWhat the part is / what it should do: `;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.textContent = '';
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    try {
      const res = await fetch('/api/design-requests', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      note.textContent = "Thanks — we've received your request and will be in touch.";
      try {
        document.dispatchEvent(new CustomEvent('lapanza:track', { detail: { eventType: 'quote_submit' } }));
      } catch { /* tracking must never break the form */ }
      form.reset();
    } catch (err) {
      note.textContent = err.message || 'Something went wrong — please try again.';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
