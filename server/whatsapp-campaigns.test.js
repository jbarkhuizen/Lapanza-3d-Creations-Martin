import { test } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';
import { openDb } from './db.js';
import { createClient } from './clients.js';
import { listCampaigns, getCampaign, createCampaign, approveCampaign, sendCampaign, queueCampaign } from './whatsapp-campaigns.js';

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

// #whatsapp-blocking-send: queueCampaign is what POST /api/whatsapp-
// campaigns/:id/send now calls instead of awaiting sendCampaign directly
// -- a large opted-in list used to make that a long-running request with
// no benefit to the admin waiting on it. Same shape as newsletter-
// campaigns.js's queueCampaign, mirrored below including its own crash
// regression test.

test('queueCampaign rejects a campaign that has not been approved, synchronously', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ templateName: 'new_drop' }, db);
  assert.throws(() => queueCampaign(campaign.id, db), /approved/);
  db.close();
});

test('queueCampaign returns immediately with status "sending" and the real opted-in recipient count', async () => {
  await withEnv({ WHATSAPP_ACCESS_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined }, async () => {
    const db = openDb(':memory:');
    seedOptedInClient(db, 'queued-recipient-1@example.com', '27821110001');
    seedOptedInClient(db, 'queued-recipient-2@example.com', '27821110002');
    createClient({ email: 'not-opted-in@example.com', phone: '27820000000' }, db); // must not count
    const campaign = createCampaign({ templateName: 'new_drop' }, db);
    approveCampaign(campaign.id, db);

    const queued = queueCampaign(campaign.id, db);
    assert.strictEqual(queued.status, 'sending');
    assert.strictEqual(queued.pendingCount, 2);
    // The route handler must be able to respond with this immediately --
    // it must not have to wait for the background send to finish.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finished = getCampaign(campaign.id, db);
    assert.strictEqual(finished.status, 'sent');
    assert.strictEqual(finished.sentCount + finished.failedCount, 2);
    db.close();
  });
});

test('queueCampaign rejects a second concurrent queue attempt on the same campaign while one is already sending', () => {
  const db = openDb(':memory:');
  seedOptedInClient(db, 'concurrent-recipient@example.com', '27821119999');
  const campaign = createCampaign({ templateName: 'new_drop' }, db);
  approveCampaign(campaign.id, db);
  queueCampaign(campaign.id, db); // marks it active synchronously, before its background send has a chance to finish
  assert.throws(() => queueCampaign(campaign.id, db), /already sending/);
  db.close();
});

test('queueCampaign returns null for an unknown id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(queueCampaign(randomUUID(), db), null);
  db.close();
});

test('a crash escaping sendCampaign inside queueCampaign is caught and re-opens the campaign as approved (re-sendable), never left stuck at "sending"', async () => {
  // Regression: queueCampaign fires sendCampaign as void ... .finally() --
  // without the .catch, a throw past the per-recipient try/catch (e.g. the
  // final totals UPDATE failing) becomes an unhandled rejection outside any
  // request context (process-fatal on Node >=15, taking the whole admin
  // backend down) and strands the campaign at 'sending', a status
  // sendCampaign refuses to re-enter (its own check only accepts 'approved').
  const db = openDb(':memory:');
  seedOptedInClient(db, 'crash-recipient@example.com', '27821118888');
  const campaign = createCampaign({ templateName: 'new_drop' }, db);
  approveCampaign(campaign.id, db);
  const failingDb = {
    prepare(sql) {
      if (sql.includes("SET status = 'sent'")) throw new Error('disk I/O error');
      return db.prepare(sql);
    },
  };
  const queued = queueCampaign(campaign.id, failingDb);
  assert.strictEqual(queued.status, 'sending');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(getCampaign(campaign.id, db).status, 'approved', 'the catch must re-open the crashed campaign as re-sendable, not leave it stuck at "sending"');
  db.close();
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
