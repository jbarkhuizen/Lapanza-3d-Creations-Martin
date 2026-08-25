import nodemailer from 'nodemailer';
import { getSettings } from './settings.js';
import { formatRand } from './money.js';

const FROM_ADDRESS = process.env.GMAIL_USER || 'lapanzaonline@gmail.com';

// Lazy singleton -- only created on first real send, so booting the server
// without GMAIL_APP_PASSWORD set (e.g. running tests) doesn't throw.
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) {
    throw new Error('GMAIL_APP_PASSWORD is not set — order confirmation email cannot be sent. Never use the real Gmail account password here; generate an app-specific password.');
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: FROM_ADDRESS, pass },
  });
  return transporter;
}

// Phase 3: real account details, pulled from Settings (bankName etc in
// settings-defaults.js) rather than hardcoded, so they can be changed from
// the admin Settings view without a code deploy.
function bankingDetails() {
  const s = getSettings();
  return `Bank: ${s.bankName}
Account name: ${s.bankAccountName}
Account number: ${s.bankAccountNumber}
Branch code: ${s.bankBranchCode}
Reference: use your order number above`;
}

function buildOrderEmailBody(order) {
  const lines = order.items
    .map((i) => `  ${i.quantity} x ${i.productName} — ${formatRand(i.price)} each = ${formatRand(i.price * i.quantity)}`)
    .join('\n');
  const paymentLabels = {
    manual_eft: `Manual EFT\n\n${bankingDetails()}\n`,
    cash_on_collection: 'Cash on Collection — pay when you collect your order in store.',
    payfast_card: 'Payfast (Card)',
    payfast_eft: 'Payfast (Instant EFT)',
  };
  const shippingLabels = {
    courier: order.shippingOption?.name || 'Our shipping',
    own_courier: "Customer's own courier (no delivery charge)",
    collect: 'Collect from store (no delivery charge)',
  };
  const paymentNote = `\nPayment method: ${paymentLabels[order.paymentMethod] || order.paymentMethod}\n`;

  return `Hi ${order.client?.name || 'there'},

Thanks for your order from Lapanza 3D Creative Lab.

Order reference: ${order.id}

Items:
${lines}

Subtotal: ${formatRand(order.subtotal)}
Shipping (${shippingLabels[order.shippingMethod] || order.shippingMethod}): ${formatRand(order.shippingPrice)}
Total: ${formatRand(order.total)}
${paymentNote}
We'll be in touch once your order is on its way.

— Lapanza 3D Creative Lab`;
}

// H.1/H.2: sends the confirmation email and returns whether it succeeded so
// the caller can decide whether to record confirmation_email_sent_at.
export async function sendOrderConfirmationEmail(order) {
  if (!order.client?.email) throw new Error('Order has no client email');
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: order.client.email,
    subject: `Lapanza 3D — Order confirmation ${order.id.slice(0, 8)}`,
    text: buildOrderEmailBody(order),
  });
}

// Low-stock alerts go to the shop owner, not a customer -- separate,
// overridable via env in case that address ever changes.
const LOW_STOCK_ALERT_TO = process.env.LOW_STOCK_ALERT_EMAIL || 'jbarkhuizen@gmail.com';

export async function sendLowStockAlert(item, replenishUrl) {
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: LOW_STOCK_ALERT_TO,
    subject: `Low stock: ${item.name} (${item.stockQty} left)`,
    text: `${item.name} is running low.

SKU: ${item.sku || '(none)'}
Remaining stock: ${item.stockQty}

Replenish: ${replenishUrl}`,
  });
}

// Phase 2: confirms the registrant owns the email address before their
// account can log in -- see clients.js's loginClient, which rejects
// unverified accounts outright.
export async function sendClientVerificationEmail(client, verifyUrl) {
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: client.email,
    subject: 'Lapanza 3D — verify your email',
    text: `Hi ${client.name || 'there'},

Thanks for creating an account with Lapanza 3D Creative Lab. Confirm your email address to finish setting it up:

${verifyUrl}

If you didn't request this, you can ignore this email.

— Lapanza 3D Creative Lab`,
  });
}

// Password recovery: link is single-use (server/clients.js clears
// reset_token on success) and expires in 1h -- see requestPasswordReset.
export async function sendClientPasswordResetEmail(client, resetUrl) {
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: client.email,
    subject: 'Lapanza 3D — reset your password',
    text: `Hi ${client.name || 'there'},

We received a request to reset your Lapanza 3D Creative Lab account password. Click below to set a new one:

${resetUrl}

This link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.

— Lapanza 3D Creative Lab`,
  });
}

// Double opt-in: the same link opens/closes nothing else, it just flips
// status pending -> confirmed. The unsubscribe link uses the same token
// (see newsletter.js's newToken() comment) so it keeps working for the
// subscriber's whole lifetime, not just before they've confirmed.
export async function sendNewsletterConfirmationEmail(email, confirmUrl, unsubscribeUrl) {
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Lapanza 3D — confirm your newsletter signup',
    text: `Thanks for signing up to hear from Lapanza 3D Creative Lab.

Confirm your subscription:

${confirmUrl}

If you didn't request this, you can ignore this email — or unsubscribe here: ${unsubscribeUrl}

— Lapanza 3D Creative Lab`,
  });
}

// Section E: the actual campaign send, one call per confirmed subscriber.
// unsubscribeUrl carries that subscriber's own token (see newsletter.js's
// newToken() comment) so the link in every campaign email works regardless
// of which campaign it came from.
export async function sendNewsletterCampaignEmail(subject, bodyText, bodyHtml, toEmail, unsubscribeUrl) {
  const footerText = `\n\n— Lapanza 3D Creative Lab\n\nUnsubscribe: ${unsubscribeUrl}`;
  const footerHtml = `<p style="font:12px Arial,sans-serif;color:#6d655d;margin-top:28px">Lapanza 3D Creative Lab · <a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: toEmail,
    subject,
    text: `${bodyText}${footerText}`,
    html: bodyHtml ? `${bodyHtml}${footerHtml}` : undefined,
  });
}

const DESIGN_REQUEST_STATUS_LABELS = {
  new: 'received',
  in_review: 'under review',
  quoted: 'quoted',
  accepted: 'accepted',
  rejected: 'declined',
  completed: 'completed',
};

export async function sendDesignRequestStatusEmail(request, newStatus) {
  const label = DESIGN_REQUEST_STATUS_LABELS[newStatus] || newStatus;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: request.email,
    subject: `Lapanza 3D — your design request is now ${label}`,
    text: `Hi ${request.name || 'there'},

Your custom design request is now: ${label}.

${request.description}
${request.adminNotes ? `\nNote from us: ${request.adminNotes}\n` : ''}
We'll be in touch with any next steps.

— Lapanza 3D Creative Lab`,
  });
}

// Phase 4: owner-facing notifications, mirroring sendLowStockAlert's shape
// (goes to the shop owner, not a customer) but the recipient is
// admin-editable (settings.orderNotificationEmail) rather than env-only.
export async function sendNewOrderNotificationEmail(order) {
  const s = getSettings();
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: s.orderNotificationEmail,
    subject: `New order ${order.invoiceNumber || order.id.slice(0, 8)} — ${formatRand(order.total)}`,
    text: `New order placed.

Reference: ${order.invoiceNumber || order.id}
Client: ${order.client?.name || 'Unknown'} (${order.client?.email || 'no email'})
Total: ${formatRand(order.total)}
Payment method: ${order.paymentMethod}
Items: ${order.items?.length || 0}

View it in the admin portal.`,
  });
}

export async function sendNewDesignRequestNotificationEmail(request) {
  const s = getSettings();
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: s.orderNotificationEmail,
    subject: `New design request from ${request.name || request.email}`,
    text: `New custom design request submitted.

From: ${request.name || 'Unknown'} (${request.email})
Phone: ${request.phone || '—'}

Description:
${request.description}
${request.budgetNote ? `\nBudget note: ${request.budgetNote}\n` : ''}
View it in the admin portal.`,
  });
}

export { FROM_ADDRESS };
