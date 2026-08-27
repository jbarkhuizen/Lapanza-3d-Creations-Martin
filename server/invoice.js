import { formatRand } from './money.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Phase 3: formal numbered invoice -- "print-friendly HTML, no PDF
// dependency" approach, laid out to match the business's existing
// spreadsheet invoice (header, bill-to, line items, subtotal/shipping/
// discount/total, bank details). Shared by the admin's "Print invoice"
// route (server/index.js) and the invoice emails sent at order placement
// and, with `paid: true`, once Payfast confirms payment -- one template,
// so the printed and emailed invoice can never drift apart.
export function renderInvoiceHtml(order, settings, { paid = false } = {}) {
  const rows = order.items
    .map(
      (i, idx) =>
        `<tr><td>${idx + 1}</td><td>${escapeHtml(i.productName)}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${formatRand(i.price)}</td><td style="text-align:right">${formatRand(i.price * i.quantity)}</td></tr>`,
    )
    .join('');
  const addr = order.client
    ? [order.client.street, order.client.suburb, order.client.city, order.client.province, order.client.postalCode, order.client.country]
        .filter(Boolean)
        .join(', ')
    : '';
  const createdDate = order.createdAt ? new Date(order.createdAt) : new Date();
  const dueDate = new Date(createdDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const discountRow = order.discountAmount
    ? `<tr><td colspan="4" style="text-align:right">Discount${order.discountPct ? ` (${order.discountPct}%)` : ''}</td><td style="text-align:right">-${formatRand(order.discountAmount)}</td></tr>`
    : '';
  const paymentSection = paid
    ? `<p style="color:#1a7a3e"><strong>PAID IN FULL</strong><br>Payment received in full on ${escapeHtml(new Date().toLocaleDateString())}. Reference: ${escapeHtml(order.invoiceNumber || order.id)}.</p>`
    : `<p><strong>PAYMENT DETAILS</strong><br>
  Bank: ${escapeHtml(settings.bankName || '')}<br>
  Account Name: ${escapeHtml(settings.bankAccountName || '')}<br>
  Account No: ${escapeHtml(settings.bankAccountNumber || '')}<br>
  Branch Code: ${escapeHtml(settings.bankBranchCode || '')}<br>
  Reference: ${escapeHtml(order.invoiceNumber || order.id)}</p>`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${paid ? 'Paid invoice' : 'Invoice'} ${escapeHtml(order.invoiceNumber || order.id)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 2rem auto; color: #1a1612; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
  .muted { color: #666; font-size: 0.9rem; }
  .totals td { font-weight: 600; }
  .header-flex { display: flex; justify-content: space-between; align-items: flex-start; }
  @media print { button { display: none; } }
</style></head>
<body>
  <button onclick="window.print()">Print</button>
  <div class="header-flex">
    <div>
      <h1>${escapeHtml(settings.siteName || 'Lapanza')}</h1>
      <p class="muted">${escapeHtml(settings.address || '')}<br>${escapeHtml(settings.phoneDisplay || '')}<br>${escapeHtml(settings.email || '')}</p>
    </div>
    <div style="text-align:right">
      <h1>${paid ? 'PAID INVOICE' : 'INVOICE'}</h1>
      <p class="muted">Invoice No: ${escapeHtml(order.invoiceNumber || '—')}<br>
      Invoice Date: ${escapeHtml(createdDate.toLocaleDateString())}<br>
      ${paid ? '' : `Due Date: ${escapeHtml(dueDate.toLocaleDateString())}<br>`}</p>
    </div>
  </div>
  <p><strong>BILL TO</strong><br>
  ${escapeHtml(order.client?.name || '')}${order.client?.businessName ? ` (${escapeHtml(order.client.businessName)})` : ''}<br>
  ${escapeHtml(order.client?.email || '')}<br>
  ${escapeHtml(addr)}<br>
  ${escapeHtml(order.client?.phone || '')}</p>
  <table>
    <thead><tr><th>#</th><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="4" style="text-align:right">Subtotal</td><td style="text-align:right">${formatRand(order.subtotal)}</td></tr>
      ${discountRow}
      <tr><td colspan="4" style="text-align:right">Shipping</td><td style="text-align:right">${formatRand(order.shippingPrice)}</td></tr>
      <tr class="totals"><td colspan="4" style="text-align:right">${paid ? 'TOTAL PAID' : 'TOTAL DUE'}</td><td style="text-align:right">${formatRand(order.total)}</td></tr>
    </tfoot>
  </table>
  ${paymentSection}
  <p class="muted">Thank you for your support.</p>
</body></html>`;
}
