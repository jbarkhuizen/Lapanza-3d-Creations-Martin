import './site.js';

async function init() {
  const form = document.getElementById('design-request-form');
  const note = document.getElementById('design-request-note');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.textContent = '';
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
