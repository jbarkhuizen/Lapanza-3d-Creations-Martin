import crypto from 'crypto';
import https from 'https';

// Payfast sandbox demo credentials (Payfast's own published test values,
// safe to commit -- these only work against the sandbox gateway, never
// live). Real merchant credentials must come from env vars; never hardcode
// them here. See https://developers.payfast.co.za for the current values
// if these ever change.
const SANDBOX_MERCHANT_ID = '10000100';
const SANDBOX_MERCHANT_KEY = '46f0cd694581a';

const MODE = process.env.PAYFAST_MODE === 'live' ? 'live' : 'sandbox';
const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || SANDBOX_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || SANDBOX_MERCHANT_KEY;
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE || '';

export const PAYFAST_URLS = {
  sandbox: { process: 'https://sandbox.payfast.co.za/eng/process', validate: 'https://sandbox.payfast.co.za/eng/query/validate', host: 'sandbox.payfast.co.za' },
  live: { process: 'https://www.payfast.co.za/eng/process', validate: 'https://www.payfast.co.za/eng/query/validate', host: 'www.payfast.co.za' },
};

// Payfast's backend is PHP and expects PHP's urlencode() output, which
// differs from JS's encodeURIComponent(): spaces become '+' (not %20), and
// !'()* are percent-escaped (encodeURIComponent leaves them raw). Getting
// this wrong is the #1 documented cause of "signature mismatch" errors --
// see https://developers.payfast.co.za, and community reports confirming
// PHP's urlencode is what the signature must match byte-for-byte.
function phpUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Signature = MD5 of the fields in a FIXED order (Payfast's docs are
// inconsistent about "alphabetical" vs "submission order" -- submission
// order is correct per current guidance), PHP-urlencoded, joined with '&',
// passphrase appended last (sandbox mode with an empty passphrase omits it
// entirely rather than sending an empty &passphrase= pair).
function buildSignature(orderedPairs, passphrase) {
  const parts = orderedPairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${phpUrlEncode(v)}`);
  if (passphrase) parts.push(`passphrase=${phpUrlEncode(passphrase)}`);
  const paramString = parts.join('&');
  return crypto.createHash('md5').update(paramString).digest('hex');
}

// E.1: builds the hosted-checkout redirect. paymentMethod is 'payfast_card'
// or 'payfast_eft' -- Payfast's `payment_method` field (cc/eft) skips
// straight to that method on their hosted page instead of showing the
// full method picker (which would also show options like Zapper that are
// explicitly out of scope for this build).
export function buildPayfastRedirect({ order, siteUrl, paymentMethod }) {
  const urls = PAYFAST_URLS[MODE];
  const pfMethod = paymentMethod === 'payfast_eft' ? 'eft' : 'cc';
  const amount = (order.total).toFixed(2);

  const orderedPairs = [
    ['merchant_id', MERCHANT_ID],
    ['merchant_key', MERCHANT_KEY],
    ['return_url', `${siteUrl}/checkout-complete.html?order=${order.id}`],
    ['cancel_url', `${siteUrl}/checkout.html?cancelled=${order.id}`],
    ['notify_url', `${siteUrl}/api/payfast/itn`],
    ['name_first', order.client?.name || 'Customer'],
    ['email_address', order.client?.email || ''],
    ['m_payment_id', order.id],
    ['amount', amount],
    ['item_name', `Lapanza 3D order ${order.id.slice(0, 8)}`],
    ['custom_str1', order.id],
    ['payment_method', pfMethod],
  ];

  const signature = buildSignature(orderedPairs, PASSPHRASE);
  return {
    actionUrl: urls.process,
    // Rendered as hidden form fields in this exact order by the caller --
    // order doesn't affect Payfast's own re-verification (they recompute
    // from the posted field *names*, not position), but keeping request-
    // building/signing/rendering in lockstep avoids any doubt.
    fields: [...orderedPairs.filter(([, v]) => v !== undefined && v !== null && v !== ''), ['signature', signature]],
  };
}

function postForm(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body;
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let out = '';
        res.on('data', (chunk) => (out += chunk));
        res.on('end', () => resolve(out.trim()));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// E.3: full ITN verification per Payfast's documented steps. Signature and
// the server-to-server validate call are the two we can get 100% correct
// deterministically, so they're hard gates. Payfast also documents an ITN
// source-IP whitelist, but that list isn't guaranteed to still match what's
// hardcoded from memory here and changes over time on Payfast's side -- an
// out-of-date list would silently start rejecting real payments, which is
// worse than skipping it, so source IP is logged for visibility only, not
// enforced. Amount is checked against the order's own total, not trusted
// from the payload.
export async function verifyItn(rawBody, parsedBody, expectedAmount, sourceIp) {
  const { signature, ...fields } = parsedBody;
  // Use the field order as received (Object.keys on a POST-decoded body
  // preserves insertion order, i.e. the order Payfast sent them in) --
  // re-sorting would break the signature check.
  const orderedPairs = Object.entries(fields);
  const expectedSignature = buildSignature(orderedPairs, PASSPHRASE);
  const signatureValid = expectedSignature === signature;

  const urls = PAYFAST_URLS[MODE];
  let serverConfirmed = false;
  try {
    const response = await postForm(urls.host, '/eng/query/validate', rawBody);
    serverConfirmed = response === 'VALID';
  } catch (err) {
    console.error('Payfast validate call failed:', err.message);
  }

  const amountValid = Math.abs(Number(fields.amount_gross) - Number(expectedAmount)) < 0.01;

  console.log(`Payfast ITN from ${sourceIp || 'unknown IP'} for order ${fields.m_payment_id}: signature=${signatureValid} serverConfirmed=${serverConfirmed} amountValid=${amountValid}`);

  return {
    valid: signatureValid && serverConfirmed && amountValid,
    signatureValid,
    serverConfirmed,
    amountValid,
    paymentStatus: fields.payment_status,
    orderId: fields.m_payment_id,
    pfPaymentId: fields.pf_payment_id,
  };
}

export { MODE as PAYFAST_MODE };
