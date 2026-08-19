import { test } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';
import { openDb } from './db.js';
import { createClient } from './clients.js';
import { listCampaigns, getCampaign, createCampaign, approveCampaign, sendCampaign } from './whatsapp-campaigns.js';

// Seeds a client and opts it in for WhatsApp updates -- createClient() itself
// has no whatsapp_opt_in parameter (Phase 2 predates that column), so the
// opt-in flag is set directly the same way the checkout opt-in endpoint does.
function seedOptedInClient(db, email, phone) {
  const client = createClient({ email, phone }, db);
  db.prepare('UPDATE clients SET whatsapp_opt_in = 1 WHERE id = ?').run(client.id);
  return client;
}

// process.env assignment stringifies everything, so `undefined` would
// otherwise become the literal string "undefined" instead of unsetting the
// var -- explicit delete is required to actually simulate "not configured".
function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test('createCampaign starts as a draft and keeps only the first 4 template params', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ templateName: 'new_drop', templateParams: ['a', 'b', 'c', 'd', 'e'] }, db);
  assert.strictEqual(campaign.status, 'draft');
  assert.deepStrictEqual(campaign.templateParams, ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(listCampaigns(db).map((c) => c.id), [campaign.id]);
  db.close();
});

test('createCampaign rejects a missing template name', () => {
  const db = openDb(':memory:');
  assert.throws(() => createCampaign({ templateName: '' }, db), /Template name/);
  db.close();
});

test('approveCampaign moves draft -> approved and rejects a second approval', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ templateName: 'new_drop' }, db);
  const approved = approveCampaign(campaign.id, db);
  assert.strictEqual(approved.status, 'approved');
  assert.throws(() => approveCampaign(campaign.id, db), /draft/);
  db.close();
});

test('sendCampaign rejects a campaign that has not been approved', async () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ templateName: 'new_drop' }, db);
  await assert.rejects(() => sendCampaign(campaign.id, db), /approved/);
  db.close();
});

test('sendCampaign tallies a failed send when Meta credentials are not configured', async () => {
  await withEnv({ WHATSAPP_ACCESS_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined }, async () => {
    const db = openDb(':memory:');
    seedOptedInClient(db, 'wa-recipient@example.com', '27821234567');
    const campaign = createCampaign({ templateName: 'new_drop' }, db);
    approveCampaign(campaign.id, db);
    const sent = await sendCampaign(campaign.id, db);
    assert.strictEqual(sent.status, 'sent');
    assert.strictEqual(sent.sentCount, 0);
    assert.strictEqual(sent.failedCount, 1);
    db.close();
  });
});

test('sendCampaign only sends to clients who are whatsapp_opt_in with a phone number', async () => {
  await withEnv({ WHATSAPP_ACCESS_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined }, async () => {
    const db = openDb(':memory:');
    createClient({ email: 'not-opted-in@example.com', phone: '27820000000' }, db); // opted out
    const optedInNoPhone = createClient({ email: 'no-phone@example.com' }, db);
    db.prepare('UPDATE clients SET whatsapp_opt_in = 1 WHERE id = ?').run(optedInNoPhone.id);
    seedOptedInClient(db, 'valid-recipient@example.com', '27821111111');

    const campaign = createCampaign({ templateName: 'new_drop' }, db);
    approveCampaign(campaign.id, db);
    const sent = await sendCampaign(campaign.id, db);
    // Only the one client with both whatsapp_opt_in=1 AND a phone number is
    // a valid recipient, so exactly one send attempt is made (and fails,
    // since Meta credentials aren't configured in this test).
    assert.strictEqual(sent.sentCount + sent.failedCount, 1);
    db.close();
  });
});

test('sendCampaign sends successfully when Meta credentials are configured and the API call succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.test' }] }) });
  try {
    await withEnv({ WHATSAPP_ACCESS_TOKEN: 'test-token', WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id' }, async () => {
      const db = openDb(':memory:');
      seedOptedInClient(db, 'success-recipient@example.com', '27822222222');
      const campaign = createCampaign({ templateName: 'new_drop', templateParams: ['PLA Hyper'] }, db);
      approveCampaign(campaign.id, db);
      const sent = await sendCampaign(campaign.id, db);
      assert.strictEqual(sent.status, 'sent');
      assert.strictEqual(sent.sentCount, 1);
      assert.strictEqual(sent.failedCount, 0);
      db.close();
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('getCampaign returns null for an unknown id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(getCampaign(randomUUID(), db), null);
  db.close();
});

test('approveCampaign and sendCampaign return null for an unknown id', async () => {
  const db = openDb(':memory:');
  assert.strictEqual(approveCampaign(randomUUID(), db), null);
  assert.strictEqual(await sendCampaign(randomUUID(), db), null);
  db.close();
});
