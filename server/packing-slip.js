// F.3 packing slip, extracted from index.js (2026-09-03) so the new-order
// owner email can attach it — mailer.js importing index.js would be
// circular. Print-friendly HTML, no PDF dependency: the admin route serves
// it in a tab, and the owner email attaches it as an .html file whose
// Print button works the moment it's opened. Branded with the letterhead
// logo (absolute URL — file is opened outside the site).
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const SHIPPING_METHOD_LABELS = {
  courier: 'Our shipping',
  own_courier: "Customer's own courier",
  collect: 'Collect from store',
  fixed: 'Shipping',
};

export function renderPackingSlipHtml(order) {
  const rows = order.items
    .map((i) => `<tr><td>${escapeHtml(i.productName)}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${i.weight * i.quantity}g</td></tr>`)
    .join('');
  const addr = order.client
    ? [order.client.street, order.client.suburb, order.client.city, order.client.province, order.client.postalCode, order.client.country]
        .filter(Boolean)
        .join(', ')
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Packing slip — ${escapeHtml(order.invoiceNumber || order.id)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 2rem auto; color: #1a1612; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #ddd; }
  .muted { color: #666; font-size: 0.9rem; }
  .totals { font-weight: 600; }
  @media print { button { display: none; } }
</style></head>
<body>
  <button onclick="window.print()">Print</button>
  <img src="https://lapanza3d.co.za/branding/lapanza-logo.png" alt="Lapanza 3D" style="height:56px;width:auto;margin-bottom:6px" />
  <h1>Packing slip — ${escapeHtml(order.invoiceNumber || order.id.slice(0, 8))}</h1>
  <p class="muted">Order ${escapeHtml(order.id)} — ${escapeHtml(order.createdAt)}</p>
  <p><strong>${escapeHtml(order.client?.name || '')}</strong>${order.client?.businessName ? ` (${escapeHtml(order.client.businessName)})` : ''}<br>${escapeHtml(addr)}<br>${escapeHtml(order.client?.phone || '')}</p>
  <table>
    <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Weight</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="totals"><td>Total parcel weight</td><td></td><td style="text-align:right">${order.totalWeight}g</td></tr></tfoot>
  </table>
  <p>Shipping method: ${escapeHtml(SHIPPING_METHOD_LABELS[order.shippingMethod] || order.shippingMethod || '—')}</p>
  <p class="muted">Thank you for supporting Lapanza 3D Creative Lab — lapanza3d.co.za</p>
</body></html>`;
}
