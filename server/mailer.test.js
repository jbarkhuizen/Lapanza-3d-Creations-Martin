import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  useTransporterForTests,
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
  sendDesignRequestReceivedEmail,
  sendDesignRequestQuoteEmail,
  sendRestockEmail,
  sendInvoiceEmail,
  sendLowStockAlert,
  sendClientVerificationEmail,
  sendDuplicateRegistrationEmail,
  sendClientPasswordResetEmail,
  sendNewsletterConfirmationEmail,
  sendNewsletterCampaignEmail,
  sendDesignRequestStatusEmail,
  sendNewOrderNotificationEmail,
  sendOrderCancelledNotificationEmail,
  sendNewDesignRequestNotificationEmail,
  sendOperationalAlertEmail,
} from './mailer.js';
import { getSettings } from './settings.js';

// getSettings() (called internally by every send* function below) resolves
// its DB via getDb()'s cwd-based dataDir() -- same isolation convention
// server/index.test.js's freshApp() and server/jobs.test.js's
// withScratchCwd() rely on. Without this, these tests would open the REAL
// local dev data/lapanza.db.
function withScratchCwd(fn) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  const originalCwd = process.cwd();
  process.chdir(tmpRoot);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.chdir(originalCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });
}

// mailer.js's send* functions only ever call one method on whatever
// getTransporter() returns -- .sendMail(options) -- and never use its own
// return value themselves, so a plain spy object (not a real nodemailer
// transport) is enough to capture exactly what each function actually
// composed (subject/html/text/to) without GMAIL_APP_PASSWORD or a real SMTP
// connection. This is what lets these tests exercise every send*
// function's REAL construction logic end to end (interpolation, escaping,
// conditional branches) rather than only ever hitting the
// "GMAIL_APP_PASSWORD missing" failure path every other test in this
// codebase that touches mailer.js stops at.
function captureSentMail() {
  const calls = [];
  useTransporterForTests({ sendMail: async (options) => { calls.push(options); return { messageId: 'test' }; } });
  return {
    calls,
    // sendPromise is the send* function's own call -- its return value is
    // irrelevant (none of them return anything); awaiting it just ensures
    // the sendMail() call above has actually happened before we read `calls`.
    async last(sendPromise) {
      await sendPromise;
      return calls[calls.length - 1];
    },
  };
}

// price/subtotal/total are plain Rand amounts, not cents (matches
// formatRand()'s own contract and every other fixture in this codebase,
// e.g. orders.test.js's `priceRand: 299`).
const order = (overrides = {}) => ({
  id: 'order-uuid-1234567890',
  invoiceNumber: 'INV-0042',
  client: { name: 'Sam <Ndlovu>', email: 'sam@example.com' },
  items: [{ productName: 'PLA — Blue', quantity: 2, price: 150 }],
  subtotal: 300,
  shippingPrice: 85,
  total: 385,
  shippingMethod: 'collect',
  paymentMethod: 'payfast_card',
  ...overrides,
});

test('sendOrderConfirmationEmail interpolates the subject, escapes the client name, and lists items', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendOrderConfirmationEmail(order()));
    assert.strictEqual(msg.to, 'sam@example.com');
    assert.match(msg.subject, /order-uu/); // orderRef = id.slice(0, 8)
    assert.ok(msg.html.includes('Sam &lt;Ndlovu&gt;'), 'client name must be HTML-escaped, not injected raw');
    assert.ok(!msg.html.includes('Sam <Ndlovu>'), 'unescaped angle brackets must never reach the email HTML');
    assert.ok(msg.html.includes('PLA — Blue'), 'order items table must list the product');
    assert.ok(msg.html.includes('R 300.00'), 'line total must be formatted via the shared formatRand, not ad hoc');
  }));

test('sendOrderConfirmationEmail includes banking details only for manual_eft, never for other payment methods', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const eft = await capture.last(sendOrderConfirmationEmail(order({ paymentMethod: 'manual_eft' })));
    assert.ok(eft.html.includes('Absa'), 'manual EFT order confirmation must show the real bank name');

    const capture2 = captureSentMail();
    const card = await capture2.last(sendOrderConfirmationEmail(order({ paymentMethod: 'payfast_card' })));
    assert.ok(!card.html.includes('Absa'), 'a card order must never show banking details');
  }));

test('sendOrderConfirmationEmail throws when the order has no client email', () =>
  withScratchCwd(async () => {
    captureSentMail();
    await assert.rejects(() => sendOrderConfirmationEmail(order({ client: { name: 'No Email' } })), /no client email/);
  }));

test('sendOrderShippedEmail includes the tracking number', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendOrderShippedEmail(order({ trackingNumber: 'TRK-999' })));
    assert.ok(msg.html.includes('TRK-999'));
  }));

test('sendDesignRequestReceivedEmail links to the given status URL', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendDesignRequestReceivedEmail({ name: 'Priya', email: 'priya@example.com' }, 'https://example.com/status/abc'));
    assert.strictEqual(msg.to, 'priya@example.com');
    assert.ok(msg.html.includes('https://example.com/status/abc'));
  }));

test('sendDesignRequestQuoteEmail shows the quoted amount and links to the accept page', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(
      sendDesignRequestQuoteEmail({ name: 'Priya', email: 'priya@example.com', quoteAmount: 450, quoteTerms: '50% deposit' }, 'https://example.com/status/abc'),
    );
    assert.ok(msg.html.includes('R 450'));
    assert.ok(msg.html.includes('50% deposit'));
    assert.ok(msg.html.includes('https://example.com/status/abc'));
  }));

test('sendRestockEmail formats price with the shared formatRand -- regression for the ad hoc "R1250.00" bug', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(
      sendRestockEmail({ email: 'buyer@example.com', token: 'tok en/1' }, { name: 'PETG Speed 1kg', price: 1250 }, 'https://example.com/product#x'),
    );
    assert.ok(msg.html.includes('R 1,250.00'), 'must use the shared formatRand (thousands separator, 2 decimals) -- previously hand-rolled and wrong');
    assert.ok(!msg.html.includes('R 1250.00'), 'must not use the old unformatted ad hoc output');
    assert.ok(msg.html.includes(encodeURIComponent('tok en/1')), 'unsubscribe link must URL-encode the token');
  }));

test('sendRestockEmail omits the price line entirely when no price is known', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendRestockEmail({ email: 'buyer@example.com', token: 't1' }, { name: 'Mystery Item' }, 'https://example.com/x'));
    assert.ok(!msg.html.includes(' — R'));
  }));

test('sendInvoiceEmail subject distinguishes paid from unpaid', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const unpaid = await capture.last(sendInvoiceEmail(order()));
    assert.match(unpaid.subject, /^Lapanza 3D — Invoice/);
    assert.ok(!unpaid.subject.includes('Paid in Full'));

    const capture2 = captureSentMail();
    const paid = await capture2.last(sendInvoiceEmail(order(), { paid: true }));
    assert.match(paid.subject, /Paid in Full/);
  }));

test('sendLowStockAlert goes to the owner notification address, not a customer, and falls back the SKU display', () =>
  withScratchCwd(async () => {
    const settings = getSettings();
    const capture = captureSentMail();
    const msg = await capture.last(sendLowStockAlert({ name: 'PLA Blue 1kg', stockQty: 1, sku: '' }, 'https://example.com/admin/inventory'));
    assert.strictEqual(msg.to, settings.orderNotificationEmail);
    assert.ok(msg.html.includes('(none)'), 'a missing SKU must show a clear placeholder, not blank/undefined');
  }));

test('sendClientVerificationEmail and sendClientPasswordResetEmail both link to their given URL and go to the client\'s email', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const verify = await capture.last(sendClientVerificationEmail({ name: 'Sam', email: 'sam@example.com' }, 'https://example.com/verify/abc'));
    assert.strictEqual(verify.to, 'sam@example.com');
    assert.ok(verify.html.includes('https://example.com/verify/abc'));

    const capture2 = captureSentMail();
    const reset = await capture2.last(sendClientPasswordResetEmail({ name: 'Sam', email: 'sam@example.com' }, 'https://example.com/reset/abc'));
    assert.ok(reset.html.includes('https://example.com/reset/abc'));
    assert.ok(reset.html.includes('1 hour'), 'reset email must state its expiry -- this wording is fixed, not admin-editable');
  }));

test('sendDuplicateRegistrationEmail uses its fixed, non-admin-editable subject and wording', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendDuplicateRegistrationEmail({ name: 'Sam', email: 'sam@example.com' }, 'https://example.com'));
    assert.strictEqual(msg.subject, 'Your account is already set up');
    assert.ok(msg.html.includes('https://example.com/account.html'));
  }));

test('sendNewsletterConfirmationEmail includes both the confirm and unsubscribe links', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendNewsletterConfirmationEmail('reader@example.com', 'https://example.com/confirm/1', 'https://example.com/unsub/1'));
    assert.strictEqual(msg.to, 'reader@example.com');
    assert.ok(msg.html.includes('https://example.com/confirm/1'));
    assert.ok(msg.html.includes('https://example.com/unsub/1'));
  }));

test('sendNewsletterCampaignEmail sends html+text with an unsubscribe footer, or text-only when no HTML body is given', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const withHtml = await capture.last(sendNewsletterCampaignEmail('Sale!', 'Plain body', '<p>Rich body</p>', 'reader@example.com', 'https://example.com/unsub/1'));
    assert.ok(withHtml.html.includes('Rich body'));
    assert.ok(withHtml.html.includes('https://example.com/unsub/1'));
    assert.ok(withHtml.text.includes('Plain body'));
    assert.ok(withHtml.text.includes('https://example.com/unsub/1'));

    const capture2 = captureSentMail();
    const textOnly = await capture2.last(sendNewsletterCampaignEmail('Sale!', 'Plain body', '', 'reader@example.com', 'https://example.com/unsub/1'));
    assert.strictEqual(textOnly.html, undefined, 'no HTML body means no html field at all, not an empty one');
  }));

test('sendDesignRequestStatusEmail maps status codes to their display label and includes admin notes only when present', () =>
  withScratchCwd(async () => {
    const capture = captureSentMail();
    const msg = await capture.last(sendDesignRequestStatusEmail({ name: 'Priya', email: 'priya@example.com', description: 'A custom bracket' }, 'in_progress'));
    assert.match(msg.subject, /in progress/);
    assert.ok(!msg.html.includes('Note from us'));

    const capture2 = captureSentMail();
    const withNotes = await capture2.last(
      sendDesignRequestStatusEmail({ name: 'Priya', email: 'priya@example.com', description: 'A custom bracket', adminNotes: 'Needs a bigger bed' }, 'finalized'),
    );
    assert.match(withNotes.subject, /finalized/);
    assert.ok(withNotes.html.includes('Needs a bigger bed'));
  }));

test('owner-facing notification emails (new order, cancelled order, new design request) all go to settings.orderNotificationEmail and escape client-supplied data', () =>
  withScratchCwd(async () => {
    const settings = getSettings();
    const dangerousOrder = order({ client: { name: '<b>Evil</b>', email: 'evil@example.com' } });

    const capture = captureSentMail();
    const newOrder = await capture.last(sendNewOrderNotificationEmail(dangerousOrder));
    assert.strictEqual(newOrder.to, settings.orderNotificationEmail);
    assert.ok(newOrder.html.includes('&lt;b&gt;Evil&lt;/b&gt;'));
    assert.ok(!newOrder.html.includes('<b>Evil</b>'));

    const capture2 = captureSentMail();
    const cancelled = await capture2.last(sendOrderCancelledNotificationEmail(dangerousOrder, 'Cancelled by customer'));
    assert.strictEqual(cancelled.to, settings.orderNotificationEmail);
    assert.ok(cancelled.html.includes('Cancelled by customer'));

    const capture3 = captureSentMail();
    const newRequest = await capture3.last(sendNewDesignRequestNotificationEmail({ name: '<b>Evil</b>', email: 'evil@example.com', phone: '0821234567', description: 'Bracket' }));
    assert.strictEqual(newRequest.to, settings.orderNotificationEmail);
    assert.ok(newRequest.html.includes('&lt;b&gt;Evil&lt;/b&gt;'));
  }));

test('sendOperationalAlertEmail prefixes the subject with a warning glyph and goes to the owner', () =>
  withScratchCwd(async () => {
    const settings = getSettings();
    const capture = captureSentMail();
    const msg = await capture.last(sendOperationalAlertEmail('Backup failed', 'The nightly backup job threw an error.'));
    assert.strictEqual(msg.subject, '⚠ Backup failed');
    assert.strictEqual(msg.to, settings.orderNotificationEmail);
    assert.ok(msg.html.includes('The nightly backup job threw an error.'));
  }));
