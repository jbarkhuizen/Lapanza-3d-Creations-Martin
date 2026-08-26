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
      form.reset();
    } catch (err) {
      note.textContent = err.message || 'Something went wrong — please try again.';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
