import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildPayfastRedirect, verifyItn } from './payfast.js';

const ORDER = { id: 'order-1', total: 379, client: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } };

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    // Object.assign would stringify `undefined` to the literal string
    // "undefined" (process.env coerces all values to strings), which is
    // truthy -- breaks any test relying on a var being genuinely unset.
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test('sandbox mode ignores the live merchant_id env var entirely', () => {
  withEnv({ PAYFAST_MODE: 'sandbox', PAYFAST_MERCHANT_ID: 'a-real-live-merchant-id', PAYFAST_SANDBOX_MERCHANT_ID: undefined }, () => {
    const result = buildPayfastRedirect({ order: ORDER, siteUrl: 'http://localhost', paymentMethod: 'payfast_card' });
    const fields = Object.fromEntries(result.fields);
    assert.strictEqual(fields.merchant_id, '10000100', 'sandbox must fall back to the public demo account, never the live merchant_id');
    assert.match(result.actionUrl, /^https:\/\/sandbox\.payfast\.co\.za/);
  });
});

test('sandbox mode uses a configured personal sandbox account when set', () => {
  withEnv(
    { PAYFAST_MODE: 'sandbox', PAYFAST_SANDBOX_MERCHANT_ID: '10053144', PAYFAST_SANDBOX_MERCHANT_KEY: 'd5yqp7y0lf6en' },
    () => {
      const result = buildPayfastRedirect({ order: ORDER, siteUrl: 'http://localhost', paymentMethod: 'payfast_card' });
      const fields = Object.fromEntries(result.fields);
      assert.strictEqual(fields.merchant_id, '10053144');
      assert.strictEqual(fields.merchant_key, 'd5yqp7y0lf6en');
    },
  );
});

test('live mode uses the real env-provided credentials', () => {
  withEnv({ PAYFAST_MODE: 'live', PAYFAST_MERCHANT_ID: 'a-real-merchant-id' }, () => {
    const result = buildPayfastRedirect({ order: ORDER, siteUrl: 'https://example.com', paymentMethod: 'payfast_eft' });
    const fields = Object.fromEntries(result.fields);
    assert.strictEqual(fields.merchant_id, 'a-real-merchant-id');
    assert.strictEqual(fields.payment_method, 'ef');
    assert.match(result.actionUrl, /^https:\/\/www\.payfast\.co\.za/);
  });
});

test('buildPayfastRedirect splits client name into name_first/name_last', () => {
  const result = buildPayfastRedirect({ order: ORDER, siteUrl: 'http://localhost', paymentMethod: 'payfast_card' });
  const fields = Object.fromEntries(result.fields);
  assert.strictEqual(fields.name_first, 'Jane');
  assert.strictEqual(fields.name_last, 'Doe');
});

function signFields(fields) {
  const paramString = Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, '+')}`)
    .join('&');
  return crypto.createHash('md5').update(paramString).digest('hex');
}

test('verifyItn: signature check passes for a correctly-signed payload and rejects a tampered one', async () => {
  const fields = { m_payment_id: 'order-1', pf_payment_id: '999', payment_status: 'COMPLETE', amount_gross: '379.00' };
  const validPayload = { ...fields, signature: signFields(fields) };
  const validResult = await verifyItn(new URLSearchParams(validPayload).toString(), validPayload, 379, '127.0.0.1');
  assert.strictEqual(validResult.signatureValid, true);
  assert.strictEqual(validResult.amountValid, true);

  const tamperedPayload = { ...fields, signature: 'deadbeef' };
  const tamperedResult = await verifyItn(new URLSearchParams(tamperedPayload).toString(), tamperedPayload, 379, '127.0.0.1');
  assert.strictEqual(tamperedResult.signatureValid, false);
  assert.strictEqual(tamperedResult.valid, false);
});

test('verifyItn: a blank optional field (e.g. an unset custom_str) is still included in the signature check, not dropped', async () => {
  // Regression test for a real production bug: Payfast's own reference PHP
  // implementation builds the signature string from every posted field
  // except `signature`, unconditionally -- including ones with an empty
  // value, which still contribute a bare `key=` to the string rather than
  // being omitted. buildSignature() used to filter those out for BOTH the
  // outbound redirect and inbound ITN paths; correct for the former (we
  // choose what to send), wrong for the latter (Payfast decides what it
  // sends us, and does include blanks). custom_str1-5 are commonly sent
  // blank on a real ITN when unused.
  const fields = { m_payment_id: 'order-1', pf_payment_id: '999', payment_status: 'COMPLETE', amount_gross: '379.00', custom_str1: '', custom_str2: '' };
  const payload = { ...fields, signature: signFields(fields) };
  // Not asserting on result.valid here -- it also requires serverConfirmed,
  // a real network round-trip to Payfast's own /validate endpoint that a
  // fabricated test payload/order id can never genuinely pass. signatureValid
  // is the one deterministic, network-independent piece this test can prove.
  const result = await verifyItn(new URLSearchParams(payload).toString(), payload, 379, '127.0.0.1');
  assert.strictEqual(result.signatureValid, true);
});

test('verifyItn: amount mismatch is rejected even with a valid signature', async () => {
  const fields = { m_payment_id: 'order-1', payment_status: 'COMPLETE', amount_gross: '1.00' };
  const payload = { ...fields, signature: signFields(fields) };
  const result = await verifyItn(new URLSearchParams(payload).toString(), payload, 379, '127.0.0.1');
  assert.strictEqual(result.signatureValid, true);
  assert.strictEqual(result.amountValid, false, 'a payload claiming R1 for a R379 order must not validate');
  assert.strictEqual(result.valid, false);
});
