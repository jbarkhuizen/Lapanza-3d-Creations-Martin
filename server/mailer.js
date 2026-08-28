import nodemailer from 'nodemailer';
import { getSettings } from './settings.js';
import { formatRand } from './money.js';
import { renderInvoiceHtml } from './invoice.js';
import { renderEmailShell, renderButton, escapeHtml, textToHtml, interpolate } from './email-template.js';

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

// Reads one template's admin-edited {subject, message} from Settings ->
// Communications, falling back to its default if the key is somehow absent
// (shouldn't happen -- getSettings() always merges DEFAULT_SETTINGS.emailTemplates
// in -- but a missing template must degrade to something sendable, not throw).
function emailTemplate(settings, key) {
  return settings.emailTemplates?.[key] || {};
}

function subjectFor(settings, key, vars) {
  return interpolate(emailTemplate(settings, key).subject, vars);
}

function messageHtmlFor(settings, key, vars) {
  return textToHtml(interpolate(emailTemplate(settings, key).message, vars));
}

// Phase 3: real account details, pulled from Settings (bankName etc in
// settings-defaults.js) rather than hardcoded, so they can be changed from
// the admin Settings view without a code deploy.
function bankingDetailsHtml(settings) {
  return `<p style="margin:0 0 16px;background:#efe7d8;border-radius:4px;padding:14px 18px;">
    <strong>Bank:</strong> ${escapeHtml(settings.bankName)}<br>
    <strong>Account name:</strong> ${escapeHtml(settings.bankAccountName)}<br>
    <strong>Account number:</strong> ${escapeHtml(settings.bankAccountNumber)}<br>
    <strong>Branch code:</strong> ${escapeHtml(settings.bankBranchCode)}<br>
    <strong>Reference:</strong> use your order number above
  </p>`;
}

function orderItemsTableHtml(order) {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e5dcc9;">${escapeHtml(i.productName)}</td><td style="padding:8px 0;border-bottom:1px solid #e5dcc9;text-align:center;">${i.quantity}</td><td style="padding:8px 0;border-bottom:1px solid #e5dcc9;text-align:right;">${formatRand(i.price * i.quantity)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
    <thead><tr><th style="text-align:left;padding-bottom:8px;border-bottom:2px solid #1a1612;">Item</th><th style="text-align:center;padding-bottom:8px;border-bottom:2px solid #1a1612;">Qty</th><th style="text-align:right;padding-bottom:8px;border-bottom:2px solid #1a1612;">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function orderTotalsHtml(order, settings) {
  const paymentLabels = {
    manual_eft: 'Manual EFT',
    cash_on_collection: 'Cash on Collection — pay when you collect your order in store.',
    payfast_card: 'Payfast (Card)',
    payfast_eft: 'Payfast (Instant EFT)',
  };
  const shippingLabels = {
    courier: order.shippingOption?.name || 'Our shipping',
    own_courier: "Customer's own courier (no delivery charge)",
    collect: 'Collect from store (no delivery charge)',
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
    <tr><td style="padding:2px 0;">Subtotal</td><td style="padding:2px 0;text-align:right;">${formatRand(order.subtotal)}</td></tr>
    <tr><td style="padding:2px 0;">Shipping (${escapeHtml(shippingLabels[order.shippingMethod] || order.shippingMethod)})</td><td style="padding:2px 0;text-align:right;">${formatRand(order.shippingPrice)}</td></tr>
    <tr><td style="padding:6px 0 0;font-weight:700;border-top:1px solid #e5dcc9;">Total</td><td style="padding:6px 0 0;text-align:right;font-weight:700;border-top:1px solid #e5dcc9;">${formatRand(order.total)}</td></tr>
  </table>
  <p style="margin:0 0 16px;"><strong>Payment method:</strong> ${escapeHtml(paymentLabels[order.paymentMethod] || order.paymentMethod)}</p>
  ${order.paymentMethod === 'manual_eft' ? bankingDetailsHtml(settings) : ''}`;
}

// H.1/H.2: sends the confirmation email and returns whether it succeeded so
// the caller can decide whether to record confirmation_email_sent_at.
// Editable via Settings -> Communications -> "Order confirmation". Tokens:
// {{name}}, {{orderRef}}.
export async function sendOrderConfirmationEmail(order) {
  if (!order.client?.email) throw new Error('Order has no client email');
  const settings = getSettings();
  const vars = { name: order.client?.name || 'there', orderRef: order.id.slice(0, 8) };
  const bodyHtml = `<p style="margin:0 0 16px;">Hi ${escapeHtml(vars.name)},</p>
    ${messageHtmlFor(settings, 'orderConfirmation', vars)}
    <p style="margin:0 0 16px;font-size:13px;color:#3b322b;">Order reference: <strong>${escapeHtml(vars.orderRef)}</strong></p>
    ${orderItemsTableHtml(order)}
    ${orderTotalsHtml(order, settings)}
    <p style="margin:0;">We'll be in touch once your order is on its way.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: order.client.email,
    subject: subjectFor(settings, 'orderConfirmation', vars),
    html: renderEmailShell({ settings, preheader: 'Thanks for your order', bodyHtml }),
  });
}

// Sends the real numbered invoice (server/invoice.js's renderInvoiceHtml,
// the same template the admin's "Print invoice" route uses) as the email
// body -- called once at order placement (any payment method, `paid:
// false`) and again with `paid: true` once Payfast's ITN confirms COMPLETE,
// so the customer gets a proper invoice up front and a distinct "paid in
// full" one once money has actually moved, rather than just the order-
// confirmation email above. Kept as its own template (not the shared shell)
// since it doubles as the printable invoice -- see invoice.js's comment.
export async function sendInvoiceEmail(order, { paid = false } = {}) {
  if (!order.client?.email) throw new Error('Order has no client email');
  const subject = paid
    ? `Lapanza 3D — Payment received, Invoice ${order.invoiceNumber || order.id.slice(0, 8)} (Paid in Full)`
    : `Lapanza 3D — Invoice ${order.invoiceNumber || order.id.slice(0, 8)}`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: order.client.email,
    subject,
    html: renderInvoiceHtml(order, getSettings(), { paid }),
  });
}

// Low-stock alerts go to the shop owner, not a customer. Previously a
// separate hardcoded fallback (a personal address, LOW_STOCK_ALERT_EMAIL
// env override) independent of every other owner-facing notification --
// found 2026-08-28 to be the reason low-stock mail was landing in a
// personal inbox instead of the business one. Now reads the same single
// settings.orderNotificationEmail every other owner notification already
// uses (sendNewOrderNotificationEmail etc, just below), so there is
// exactly one place -- Settings -- that decides where operational email
// goes, not one env var plus a hardcoded fallback plus a DB setting.
// Editable via Settings -> Communications -> "Low stock alert". Tokens:
// {{itemName}}, {{stockQty}}, {{sku}}.
export async function sendLowStockAlert(item, replenishUrl) {
  const settings = getSettings();
  const vars = { itemName: item.name, stockQty: item.stockQty, sku: item.sku || '(none)' };
  const bodyHtml = `${messageHtmlFor(settings, 'lowStockAlert', vars)}
    <p style="margin:0 0 16px;font-size:14px;">
      <strong>SKU:</strong> ${escapeHtml(vars.sku)}<br>
      <strong>Remaining stock:</strong> ${escapeHtml(String(item.stockQty))}
    </p>
    ${renderButton('Replenish this item', replenishUrl)}`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: settings.orderNotificationEmail,
    subject: subjectFor(settings, 'lowStockAlert', vars),
    html: renderEmailShell({ settings, preheader: 'Low stock alert', bodyHtml }),
  });
}

// Phase 2: confirms the registrant owns the email address before their
// account can log in -- see clients.js's loginClient, which rejects
// unverified accounts outright. Editable via Settings -> Communications ->
// "Verify email". Tokens: {{name}}.
export async function sendClientVerificationEmail(client, verifyUrl) {
  const settings = getSettings();
  const vars = { name: client.name || 'there' };
  const bodyHtml = `<p style="margin:0 0 16px;">Hi ${escapeHtml(vars.name)},</p>
    ${messageHtmlFor(settings, 'emailVerification', vars)}
    ${renderButton('Verify Email', verifyUrl)}
    <p style="margin:0;font-size:13px;color:#3b322b;">If you didn't create this account, you can safely ignore this email.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: client.email,
    subject: subjectFor(settings, 'emailVerification', vars),
    html: renderEmailShell({ settings, preheader: 'Verify your email address', bodyHtml }),
  });
}

// Password recovery: link is single-use (server/clients.js clears
// reset_token on success) and expires in 1h -- see requestPasswordReset.
// Editable via Settings -> Communications -> "Password reset". Tokens:
// {{name}}. The expiry/ignore disclaimer stays fixed (not admin-editable)
// since it's a security-relevant statement, not just wording.
export async function sendClientPasswordResetEmail(client, resetUrl) {
  const settings = getSettings();
  const vars = { name: client.name || 'there' };
  const bodyHtml = `<p style="margin:0 0 16px;">Hi ${escapeHtml(vars.name)},</p>
    ${messageHtmlFor(settings, 'passwordReset', vars)}
    ${renderButton('Reset Password', resetUrl)}
    <p style="margin:0;font-size:13px;color:#3b322b;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: client.email,
    subject: subjectFor(settings, 'passwordReset', vars),
    html: renderEmailShell({ settings, preheader: 'Reset your password', bodyHtml }),
  });
}

// Double opt-in: the same link opens/closes nothing else, it just flips
// status pending -> confirmed. The unsubscribe link uses the same token
// (see newsletter.js's newToken() comment) so it keeps working for the
// subscriber's whole lifetime, not just before they've confirmed. Editable
// via Settings -> Communications -> "Newsletter confirmation".
export async function sendNewsletterConfirmationEmail(email, confirmUrl, unsubscribeUrl) {
  const settings = getSettings();
  const bodyHtml = `${messageHtmlFor(settings, 'newsletterConfirm', {})}
    ${renderButton('Confirm Subscription', confirmUrl)}
    <p style="margin:0;font-size:13px;color:#3b322b;">If you didn't request this, you can ignore this email, or <a href="${escapeHtml(unsubscribeUrl)}" style="color:#c24b28;">unsubscribe here</a>.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: email,
    subject: subjectFor(settings, 'newsletterConfirm', {}),
    html: renderEmailShell({ settings, preheader: 'Confirm your subscription', bodyHtml }),
  });
}

// Section E: the actual campaign send, one call per confirmed subscriber.
// unsubscribeUrl carries that subscriber's own token (see newsletter.js's
// newToken() comment) so the link in every campaign email works regardless
// of which campaign it came from. Not part of the Settings -> Communications
// templates -- a campaign is authored fresh per send in the admin's
// newsletter composer, not a fixed reusable template.
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
  in_progress: 'in progress',
  finalized: 'finalized',
};

// Editable via Settings -> Communications -> "Design request status".
// Tokens: {{name}}, {{status}}.
export async function sendDesignRequestStatusEmail(request, newStatus) {
  const settings = getSettings();
  const label = DESIGN_REQUEST_STATUS_LABELS[newStatus] || newStatus;
  const vars = { name: request.name || 'there', status: label };
  const bodyHtml = `<p style="margin:0 0 16px;">Hi ${escapeHtml(vars.name)},</p>
    ${messageHtmlFor(settings, 'designRequestStatus', vars)}
    <p style="margin:0 0 16px;background:#efe7d8;border-radius:4px;padding:14px 18px;font-size:14px;">${escapeHtml(request.description)}</p>
    ${request.adminNotes ? `<p style="margin:0 0 16px;font-size:14px;"><strong>Note from us:</strong> ${escapeHtml(request.adminNotes)}</p>` : ''}
    <p style="margin:0;">We'll be in touch with any next steps.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: request.email,
    subject: subjectFor(settings, 'designRequestStatus', vars),
    html: renderEmailShell({ settings, preheader: `Your design request is now ${label}`, bodyHtml }),
  });
}

// Phase 4: owner-facing notifications, mirroring sendLowStockAlert's shape
// (goes to the shop owner, not a customer) but the recipient is
// admin-editable (settings.orderNotificationEmail) rather than env-only.
// Editable via Settings -> Communications -> "New order notification".
// Tokens: {{orderRef}}, {{total}}, {{clientName}}, {{clientEmail}},
// {{paymentMethod}}, {{itemCount}}.
export async function sendNewOrderNotificationEmail(order) {
  const settings = getSettings();
  const vars = {
    orderRef: order.invoiceNumber || order.id.slice(0, 8),
    total: formatRand(order.total),
    clientName: order.client?.name || 'Unknown',
    clientEmail: order.client?.email || 'no email',
    paymentMethod: order.paymentMethod,
    itemCount: order.items?.length || 0,
  };
  const bodyHtml = `${messageHtmlFor(settings, 'newOrderNotification', vars)}
    <p style="margin:0 0 16px;font-size:14px;">
      <strong>Reference:</strong> ${escapeHtml(String(vars.orderRef))}<br>
      <strong>Client:</strong> ${escapeHtml(vars.clientName)} (${escapeHtml(vars.clientEmail)})<br>
      <strong>Total:</strong> ${escapeHtml(vars.total)}<br>
      <strong>Payment method:</strong> ${escapeHtml(vars.paymentMethod)}<br>
      <strong>Items:</strong> ${escapeHtml(String(vars.itemCount))}
    </p>
    <p style="margin:0;font-size:13px;color:#3b322b;">View it in the admin portal.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: settings.orderNotificationEmail,
    subject: subjectFor(settings, 'newOrderNotification', vars),
    html: renderEmailShell({ settings, preheader: 'New order placed', bodyHtml }),
  });
}

// Fires on either cancellation path -- a customer's own self-service cancel
// (POST /api/client/orders/:id/cancel) or the 7-day auto-cancel job
// (jobs.js's startAutoCancelJob) -- `reason` is the only thing that tells
// them apart in the email body. Editable via Settings -> Communications ->
// "Order cancelled notification". Tokens: {{orderRef}}, {{total}},
// {{clientName}}, {{clientEmail}}, {{reason}}.
export async function sendOrderCancelledNotificationEmail(order, reason) {
  const settings = getSettings();
  const vars = {
    orderRef: order.invoiceNumber || order.id.slice(0, 8),
    total: formatRand(order.total),
    clientName: order.client?.name || 'Unknown',
    clientEmail: order.client?.email || 'no email',
    reason,
  };
  const bodyHtml = `${messageHtmlFor(settings, 'orderCancelledNotification', vars)}
    <p style="margin:0 0 16px;font-size:14px;">
      <strong>Reference:</strong> ${escapeHtml(String(vars.orderRef))}<br>
      <strong>Client:</strong> ${escapeHtml(vars.clientName)} (${escapeHtml(vars.clientEmail)})<br>
      <strong>Total:</strong> ${escapeHtml(vars.total)}<br>
      <strong>Reason:</strong> ${escapeHtml(String(reason))}
    </p>
    <p style="margin:0;font-size:13px;color:#3b322b;">View it in the admin portal.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: settings.orderNotificationEmail,
    subject: subjectFor(settings, 'orderCancelledNotification', vars),
    html: renderEmailShell({ settings, preheader: 'Order cancelled', bodyHtml }),
  });
}

// Editable via Settings -> Communications -> "New design request
// notification". Tokens: {{name}}, {{email}}, {{phone}}.
export async function sendNewDesignRequestNotificationEmail(request) {
  const settings = getSettings();
  const vars = { name: request.name || request.email, email: request.email, phone: request.phone || '—' };
  const bodyHtml = `${messageHtmlFor(settings, 'newDesignRequestNotification', vars)}
    <p style="margin:0 0 16px;font-size:14px;">
      <strong>From:</strong> ${escapeHtml(vars.name)} (${escapeHtml(vars.email)})<br>
      <strong>Phone:</strong> ${escapeHtml(vars.phone)}
    </p>
    <p style="margin:0 0 16px;background:#efe7d8;border-radius:4px;padding:14px 18px;font-size:14px;">${escapeHtml(request.description)}</p>
    ${request.budgetNote ? `<p style="margin:0 0 16px;font-size:14px;"><strong>Budget note:</strong> ${escapeHtml(request.budgetNote)}</p>` : ''}
    <p style="margin:0;font-size:13px;color:#3b322b;">View it in the admin portal.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: settings.orderNotificationEmail,
    subject: subjectFor(settings, 'newDesignRequestNotification', vars),
    html: renderEmailShell({ settings, preheader: 'New design request', bodyHtml }),
  });
}

// Backlog #120: operational alerts (backup/payment/checkout failures,
// security spikes -- see server/alerts.js, the one caller). Deliberately
// separate from the emailTemplate()-driven functions above: fixed wording,
// not admin-editable via Settings -> Communications (an urgent diagnostic
// message shouldn't be softenable/loseable by an edit) -- only whether it
// fires at all is admin-controlled, from Settings -> Operational Alerts.
export async function sendOperationalAlertEmail(subject, messageText) {
  const settings = getSettings();
  const bodyHtml = `<p style="margin:0 0 16px;font-weight:700;color:#c24b28;">Operational Alert</p>
    ${textToHtml(messageText)}
    <p style="margin:16px 0 0;font-size:13px;color:#3b322b;">Sent automatically by the Lapanza 3D system. Manage these alerts in admin Settings &rarr; Operational Alerts.</p>`;
  await getTransporter().sendMail({
    from: FROM_ADDRESS,
    to: settings.orderNotificationEmail,
    subject: `⚠ ${subject}`,
    html: renderEmailShell({ settings, preheader: subject, bodyHtml }),
  });
}

export { FROM_ADDRESS };
