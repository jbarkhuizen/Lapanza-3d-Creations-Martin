// Backlog #43 (SITE-009): "Email me when it's back" on out-of-stock
// filament swatches (button rendered by generate-pages.mjs only when
// stockQty <= 0). Click swaps the button for an inline email form; submit
// posts to the public subscribe route. Delegated on document, so it works
// on any current or future page without per-page wiring.
export function mountRestockNotify() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.restock-notify');
    if (!btn || btn.dataset.expanded) return;
    btn.dataset.expanded = '1';

    const wrap = document.createElement('form');
    wrap.className = 'flex gap-1.5 mt-1.5';
    const input = document.createElement('input');
    input.type = 'email';
    input.required = true;
    input.placeholder = 'you@email.com';
    input.className = 'flex-1 min-w-0 border border-charcoal/20 rounded-sm px-2 py-1.5 text-xs bg-transparent';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'text-xs font-semibold bg-charcoal text-cream rounded-full px-3 py-1.5 hover:bg-terracotta transition-colors shrink-0';
    submit.textContent = 'Notify me';
    wrap.append(input, submit);
    btn.replaceWith(wrap);
    input.focus();

    wrap.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      submit.disabled = true;
      const note = document.createElement('p');
      note.className = 'text-xs mt-1.5';
      try {
        const res = await fetch('/api/restock-subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: btn.dataset.restockProduct, email: input.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Something went wrong');
        note.textContent = data.message || "Done — we'll email you when it's back.";
        note.style.color = '#2e6e46';
        wrap.replaceWith(note);
      } catch (err) {
        note.textContent = err.message;
        note.className += ' text-terracotta';
        wrap.after(note);
        submit.disabled = false;
        setTimeout(() => note.remove(), 4000);
      }
    });
  });
}
