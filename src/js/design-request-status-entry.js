// Phase-5 #86/#87: tokenized guest view of one design request, plus quote
// acceptance. The token (from the acknowledgement email) is the whole
// credential -- the API returns only customer-safe fields, never admin
// notes. Statuses map to the real 3-state model.
import '../styles/main.css';

const STATUS_LABELS = {
  new: ['Received', "We have your request and it's waiting for review — we'll be in touch with questions or a quote."],
  in_progress: ['In Progress', "We're on it — reviewing, designing or already printing. A quote appears here the moment there is one."],
  finalized: ['Finalized', 'This request is wrapped up. Need something more? Send a new request any time.'],
};

function formatRand(v) {
  return `R ${Number(v).toFixed(2)}`;
}

// Payfast owns the top-level navigation for its hosted payment page -- both
// Accept & Pay and Order This Again land here on the same browser-navigated
// POST the regular checkout uses.
function submitPayfastRedirect(redirect) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = redirect.actionUrl;
  for (const [name, value] of redirect.fields) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

async function init() {
  const token = new URLSearchParams(location.search).get('token');
  const show = (id) => document.getElementById(id).classList.remove('hidden');
  const hide = (id) => document.getElementById(id).classList.add('hidden');
  hide('drs-loading');
  if (!token) return show('drs-missing');

  let request = null;
  try {
    const res = await fetch(`/api/design-request-status?token=${encodeURIComponent(token)}`);
    if (res.ok) request = (await res.json()).request;
  } catch { /* handled below */ }
  if (!request) return show('drs-missing');

  const [label, note] = STATUS_LABELS[request.status] || [request.status, ''];
  document.getElementById('drs-status').textContent = label;
  document.getElementById('drs-status-note').textContent = note;
  document.getElementById('drs-date').textContent = new Date(request.createdAt).toLocaleDateString();
  document.getElementById('drs-service').textContent = request.serviceType === 'design_for_me' ? 'Design & print' : 'Print my model';
  show('drs-found');

  if (request.quoteStatus === 'quoted' || request.quoteStatus === 'accepted') {
    document.getElementById('drs-quote-amount').textContent = formatRand(request.quoteAmount || 0);
    document.getElementById('drs-quote-terms').textContent = request.quoteTerms || '';
    show('drs-quote');
    if (request.quoteStatus === 'accepted') {
      hide('drs-accept-wrap');
      show('drs-accepted-note');
    }
  }

  // #93: repeat orders only make sense once the job is actually finished
  // and there's a recorded price to reorder at.
  if (request.status === 'finalized' && request.quoteAmount) {
    document.getElementById('drs-reorder-amount').textContent = formatRand(request.quoteAmount);
    show('drs-reorder');
  }

  document.getElementById('drs-accept')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const errEl = document.getElementById('drs-quote-error');
    errEl.classList.add('hidden');
    try {
      const res = await fetch('/api/design-request-status/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (data.redirect) return submitPayfastRedirect(data.redirect);
      hide('drs-accept-wrap');
      show('drs-accepted-note');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
    }
  });

  document.getElementById('drs-reorder-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const errEl = document.getElementById('drs-reorder-error');
    errEl.classList.add('hidden');
    try {
      const res = await fetch('/api/design-request-status/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (data.redirect) return submitPayfastRedirect(data.redirect);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
