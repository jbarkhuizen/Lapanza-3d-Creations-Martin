import crypto from 'crypto';
import https from 'https';

// Payfast sandbox demo credentials (Payfast's own published test values,
// safe to commit -- these only work against the sandbox gateway, never
// live). Real merchant credentials must come from env vars; never hardcode
// them here. See https://developers.payfast.co.za for the current values
// if these ever change.
const SANDBOX_MERCHANT_ID = '10000100';
const SANDBOX_MERCHANT_KEY = '46f0cd694581a';

// A function, not frozen top-level constants -- reads process.env fresh on
// every call rather than capturing it once at module-import time. This
// matters because .env is loaded via process.loadEnvFile() at the top of
// index.js's entry sequence, but ESM import statements all execute before
// any other code in the importing file, including that loadEnvFile() call
// -- a frozen `const MODE = process.env.PAYFAST_MODE...` evaluated at this
// module's own import time would freeze to pre-.env values regardless of
// where the loadEnvFile() call appears in index.js's source.
//
// Sandbox and live are separate, mode-gated credential sets (PAYFAST_SANDBOX_*
// vs PAYFAST_*) rather than one set of env vars reused for both -- real
// merchant credentials for both modes typically sit permanently in .env
// while MODE just gets toggled, and a Payfast *sandbox* merchant account
// (dashboard-visible, own passphrase) is a different, separate account from
// the live one, not a stand-in value for it. If sandbox mode fell back to
// reading the live vars, a real live credential could leak into a sandbox
// request; PAYFAST_SANDBOX_MERCHANT_ID defaults to Payfast's shared public
// demo account (10000100) when no personal sandbox account is configured.
function getConfig() {
  const mode = process.env.PAYFAST_MODE === 'live' ? 'live' : 'sandbox';
  if (mode === 'live') {
    return {
      mode,
      merchantId: process.env.PAYFAST_MERCHANT_ID || SANDBOX_MERCHANT_ID,
      merchantKey: process.env.PAYFAST_MERCHANT_KEY || SANDBOX_MERCHANT_KEY,
      passphrase: process.env.PAYFAST_PASSPHRASE || '',
    };
  }
  return {
    mode,
    merchantId: process.env.PAYFAST_SANDBOX_MERCHANT_ID || SANDBOX_MERCHANT_ID,
    merchantKey: process.env.PAYFAST_SANDBOX_MERCHANT_KEY || SANDBOX_MERCHANT_KEY,
    passphrase: process.env.PAYFAST_SANDBOX_PASSPHRASE || '',
  };
}

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
// or 'payfast_eft' -- Payfast's `payment_method` field skips straight to
// that method on their hosted page instead of showing the full method
// picker (which would also show options like Zapper/Mobicred that are
// explicitly out of scope for this build). Payfast's own valid codes are
// 'cc' (credit card) and 'ef' (EFT) -- NOT 'eft' -- see
// https://developers.payfast.co.za/docs#quickstart's Payment Methods table.
// An unrecognized value here silently fell through to Payfast's own
// fallback/first-available method instead of erroring, which is how a
// customer choosing "Instant EFT" ended up on a Mobicred page instead.
// siteUrl and apiUrl are deliberately separate: siteUrl is where the
// customer's browser gets sent back to (the static site -- checkout.html/
// checkout-complete.html), apiUrl is where Payfast's server-to-server ITN
// webhook must reach (this backend). They're the same host today, but once
// the static site and this backend live on different domains (the static
// site has no way to proxy /api/payfast/itn through to wherever this
// backend actually runs), building notify_url from siteUrl would silently
// break payment confirmation entirely -- Payfast would be POSTing to a URL
// with no backend behind it.
export function buildPayfastRedirect({ order, siteUrl, apiUrl, paymentMethod }) {
  const config = getConfig();
  const urls = PAYFAST_URLS[config.mode];
  const pfMethod = paymentMethod === 'payfast_eft' ? 'ef' : 'cc';
  const amount = (order.total).toFixed(2);

  const orderedPairs = [
    ['merchant_id', config.merchantId],
    ['merchant_key', config.merchantKey],
    ['return_url', `${siteUrl}/checkout-complete.html?order=${order.id}`],
    ['cancel_url', `${siteUrl}/checkout.html?cancelled=${order.id}`],
    ['notify_url', `${apiUrl}/api/payfast/itn`],
    ['name_first', order.client?.firstName || order.client?.name || 'Customer'],
    ['name_last', order.client?.lastName || ''],
    ['email_address', order.client?.email || ''],
    ['m_payment_id', order.id],
    ['amount', amount],
    ['item_name', `Lapanza 3D order ${order.id.slice(0, 8)}`],
    ['custom_str1', order.id],
    ['payment_method', pfMethod],
  ];

  const signature = buildSignature(orderedPairs, config.passphrase);
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
    // Without this, an unresponsive Payfast endpoint leaves this promise
    // (and the ITN handler's background work) hanging indefinitely.
    req.setTimeout(10_000, () => req.destroy(new Error('Payfast validate request timed out')));
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
  const config = getConfig();
  const { signature, ...fields } = parsedBody;
  // Use the field order as received (Object.keys on a POST-decoded body
  // preserves insertion order, i.e. the order Payfast sent them in) --
  // re-sorting would break the signature check.
  const orderedPairs = Object.entries(fields);
  const expectedSignature = buildSignature(orderedPairs, config.passphrase);
  const signatureValid = expectedSignature === signature;

  const urls = PAYFAST_URLS[config.mode];
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
