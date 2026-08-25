import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { subscribe, confirm } from './newsletter.js';
import { approveCampaign, createCampaign, getCampaign, getCampaignAnalytics, listCampaignRecipients, listEligibleRecipients, sendCampaign } from './newsletter-campaigns.js';

function recipientKey(db, email = 'campaign-recipient@example.com') {
  const { subscriber, token } = subscribe(email, db);
  confirm(token, db);
  return `subscriber:${subscriber.id}`;
}

test('campaign snapshots selected eligible recipients at creation', () => {
  const db = openDb(':memory:');
  const key = recipientKey(db);
  const campaign = createCampaign({ subject: 'New colours', bodyText: 'Check them out.', recipientKeys: [key] }, db);
  assert.strictEqual(campaign.status, 'draft');
  assert.strictEqual(campaign.selectedCount, 1);
  assert.strictEqual(listCampaignRecipients(campaign.id, db)[0].status, 'selected');
  db.close();
});

test('campaign rejects an unselected or ineligible recipient', () => {
  const db = openDb(':memory:');
  assert.throws(() => createCampaign({ subject: 'x', bodyText: 'y', recipientKeys: [] }, db), /eligible/);
  assert.throws(() => createCampaign({ subject: 'x', bodyText: 'y', recipientKeys: ['client:unknown'] }, db), /eligible/);
  db.close();
});

test('approved campaign cannot be approved twice', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body', recipientKeys: [recipientKey(db)] }, db);
  assert.strictEqual(approveCampaign(campaign.id, db).status, 'approved');
  assert.throws(() => approveCampaign(campaign.id, db), /draft/);
  db.close();
});

test('failed Gmail delivery is retained per recipient and leaves a partial campaign', async () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body', recipientKeys: [recipientKey(db)] }, db);
  approveCampaign(campaign.id, db);
  const sent = await sendCampaign(campaign.id, { siteUrl: 'http://localhost:5173' }, db);
  assert.strictEqual(sent.status, 'partial');
  assert.strictEqual(sent.failedCount, 1);
  assert.strictEqual(listCampaignRecipients(campaign.id, db)[0].status, 'failed');
  db.close();
});

test('suppressed addresses are excluded from future eligible recipient lists', () => {
  const db = openDb(':memory:');
  recipientKey(db, 'blocked@example.com');
  db.prepare("INSERT INTO newsletter_suppressions (email, reason, created_at) VALUES ('blocked@example.com', 'unsubscribe', 'now')").run();
  assert.strictEqual(listEligibleRecipients(db).some((recipient) => recipient.email === 'blocked@example.com'), false);
  db.close();
});

test('campaign analytics aggregates audience and final delivery outcomes', () => {
  const db = openDb(':memory:');
  const campaign = createCampaign({ subject: 'Subj', bodyText: 'Body', recipientKeys: [recipientKey(db)] }, db);
  db.prepare("UPDATE newsletter_campaign_recipients SET status = 'sent', sent_at = 'now' WHERE campaign_id = ?").run(campaign.id);

  const analytics = getCampaignAnalytics(db);
  assert.deepStrictEqual(
    { campaignCount: analytics.campaignCount, audienceCount: analytics.audienceCount, acceptedCount: analytics.acceptedCount, failedCount: analytics.failedCount, pendingCount: analytics.pendingCount, acceptanceRate: analytics.acceptanceRate },
    { campaignCount: 1, audienceCount: 1, acceptedCount: 1, failedCount: 0, pendingCount: 0, acceptanceRate: 100 },
  );
  assert.deepStrictEqual(analytics.bySource, [{ sourceType: 'subscriber', audienceCount: 1, acceptedCount: 1, failedCount: 0 }]);
  db.close();
});
