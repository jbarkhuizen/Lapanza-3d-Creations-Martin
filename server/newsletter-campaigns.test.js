import { test } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';
import { openDb } from './db.js';
import { subscribe, confirm } from './newsletter.js';
import { listCampaigns, getCampaign, createCampaign, approveCampaign, sendCampaign } from './newsletter-campaigns.js';

test('createCampaign starts as a draft', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'New colours', bodyText: 'Check them out.' }, db);
  assert.strictEqual(campaign.status, 'draft');
  assert.strictEqual(campaign.subject, 'New colours');
  assert.deepStrictEqual(listCampaigns(db).map((c) => c.id), [campaign.id]);
  db.close();
});

test('createCampaign rejects a missing subject or body', () => {
  const db = openDb(':memory:');
  assert.throws(() => createCampaign({ subject: '', bodyText: 'x' }, db), /Subject/);
  assert.throws(() => createCampaign({ subject: 'x', bodyText: '' }, db), /Body/);
  db.close();
});

test('approveCampaign moves draft -> approved and rejects a second approval', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body' }, db);
  const approved = approveCampaign(campaign.id, db);
  assert.strictEqual(approved.status, 'approved');
  assert.ok(approved.approvedAt);
  assert.throws(() => approveCampaign(campaign.id, db), /draft/);
  db.close();
});

test('sendCampaign rejects a campaign that has not been approved', async () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body' }, db);
  await assert.rejects(() => sendCampaign(campaign.id, { siteUrl: 'http://localhost:5173' }, db), /approved/);
  db.close();
});

test('sendCampaign with no confirmed subscribers sends to nobody and still marks sent', async () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body' }, db);
  approveCampaign(campaign.id, db);
  const sent = await sendCampaign(campaign.id, { siteUrl: 'http://localhost:5173' }, db);
  assert.strictEqual(sent.status, 'sent');
  assert.strictEqual(sent.sentCount, 0);
  assert.strictEqual(sent.failedCount, 0);
  assert.ok(sent.sentAt);
  db.close();
});

test('sendCampaign tallies a failed send as failedCount rather than throwing (no mail transport configured in tests)', async () => {
  const db = openDb(':memory:');
  const { token } = subscribe('campaign-recipient@example.com', db);
  confirm(token, db);
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body' }, db);
  approveCampaign(campaign.id, db);
  const sent = await sendCampaign(campaign.id, { siteUrl: 'http://localhost:5173' }, db);
  assert.strictEqual(sent.status, 'sent');
  assert.strictEqual(sent.sentCount, 0);
  assert.strictEqual(sent.failedCount, 1);
  db.close();
});

test('sendCampaign only sends to confirmed subscribers, not pending or unsubscribed ones', async () => {
  const db = openDb(':memory:');
  // Pending -- never confirmed.
  subscribe('pending@example.com', db);
  // Confirmed then unsubscribed.
  const { token } = subscribe('gone@example.com', db);
  confirm(token, db);
  db.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed' WHERE email = 'gone@example.com'").run();

  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body' }, db);
  approveCampaign(campaign.id, db);
  const sent = await sendCampaign(campaign.id, { siteUrl: 'http://localhost:5173' }, db);
  // Neither the pending nor the unsubscribed row is a recipient, so the send
  // loop never runs and there's nothing to tally as sent or failed.
  assert.strictEqual(sent.sentCount, 0);
  assert.strictEqual(sent.failedCount, 0);
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
  assert.strictEqual(await sendCampaign(randomUUID(), { siteUrl: 'http://localhost:5173' }, db), null);
  db.close();
});
