import { test } from 'node:test';
import assert from 'node:assert';
import { renderPackingSlipHtml } from './packing-slip.js';

// 2026-09-03: the slip is attached to the new-order owner email as a
// printable file, so its content must be complete and correctly escaped.
test('renderPackingSlipHtml carries items, quantities, address, weight and escapes HTML', () => {
  const html = renderPackingSlipHtml({
    id: 'abc-123',
    invoiceNumber: 'INV-0042',
    createdAt: '2026-09-03T10:00:00.000Z',
    totalWeight: 1500,
    shippingMethod: 'courier',
    client: { name: 'Test <script>alert(1)</script> Client', businessName: '', phone: '0820000000', street: '1 Test Rd', suburb: 'Testville', city: 'Centurion', province: 'Gauteng', postalCode: '0157', country: 'South Africa' },
    items: [
      { productName: 'GWM Cup Holder & Co', quantity: 2, weight: 500 },
      { productName: 'Fuel Cap', quantity: 1, weight: 500 },
    ],
  });
  assert.match(html, /INV-0042/);
  assert.match(html, /GWM Cup Holder &amp; Co/);
  assert.match(html, /1000g/); // 2 x 500 line weight
  assert.match(html, /1500g/); // parcel total
  assert.match(html, /1 Test Rd, Testville, Centurion/);
  assert.match(html, /Our shipping/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /window\.print/);
});
