import nodemailer from 'nodemailer';

const FROM_ADDRESS = process.env.GMAIL_USER || 'lapanzaoline@gmail.com';

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

function formatRand(value) {
  return `R${Number(value || 0).toFixed(0)}`;
}

// TODO: placeholder banking details -- real account info was not provided
// for this build. Replace before any Manual EFT order actually goes out,
// or customers will be told to pay into a fake account.
const BANKING_DETAILS = `Bank: [REPLACE ME]
Account name: Lapanza 3D Creative Lab
Account number: [REPLACE ME]
Branch code: [REPLACE ME]
Reference: use your order number above`;

function buildOrderEmailBody(order) {
  const lines = order.items
    .map((i) => `  ${i.quantity} x ${i.productName} — ${formatRand(i.price)} each = ${formatRand(i.price * i.quantity)}`)
    .join('\n');
  const paymentLabels = {
    manual_eft: `Manual EFT\n\n${BANKING_DETAILS}\n`,
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

export { FROM_ADDRESS };
