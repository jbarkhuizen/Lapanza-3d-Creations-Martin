import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { sendNewsletterCampaignEmail } from './mailer.js';

function rowToCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    subject: row.subject,
    bodyText: row.body_text,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
  };
}

export function listCampaigns(db = getDb()) {
  return db.prepare('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC').all().map(rowToCampaign);
}

export function getCampaign(id, db = getDb()) {
  return rowToCampaign(db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(id));
}

export function createCampaign(data, db = getDb()) {
  if (!data.subject || !String(data.subject).trim()) throw new Error('Subject is required');
  if (!data.bodyText || !String(data.bodyText).trim()) throw new Error('Body is required');
  const id = randomUUID();
  db.prepare(
    `INSERT INTO newsletter_campaigns (id, subject, body_text, status, created_at)
     VALUES (@id, @subject, @body_text, 'draft', @created_at)`,
  ).run({
    id,
    subject: String(data.subject).trim(),
    body_text: String(data.bodyText).trim(),
    created_at: new Date().toISOString(),
  });
  return getCampaign(id, db);
}

export function approveCampaign(id, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'draft') throw new Error('Only a draft campaign can be approved');
  db.prepare("UPDATE newsletter_campaigns SET status = 'approved', approved_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
  return getCampaign(id, db);
}

// Best-effort per-subscriber: one failed send (e.g. a bounced/invalid
// address) must not stop the rest of the run, so failures are tallied
// rather than thrown -- mirrors sendLowStockAlerts' fire-and-forget shape.
export async function sendCampaign(id, { siteUrl }, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'approved') throw new Error('Only an approved campaign can be sent');

  // Raw query (not newsletter.js's listSubscribers) because the send loop
  // needs each subscriber's token for their unsubscribe link -- a value
  // rowToSubscriber() deliberately omits since it also backs the admin list view.
  const recipients = db
    .prepare("SELECT email, token FROM newsletter_subscribers WHERE status = 'confirmed'")
    .all();
  let sentCount = 0;
  let failedCount = 0;
  for (const subscriber of recipients) {
    try {
      const unsubscribeUrl = `${siteUrl}/api/newsletter/unsubscribe?token=${subscriber.token}`;
      await sendNewsletterCampaignEmail(campaign.subject, campaign.bodyText, subscriber.email, unsubscribeUrl);
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  db.prepare(
    "UPDATE newsletter_campaigns SET status = 'sent', sent_at = ?, sent_count = ?, failed_count = ? WHERE id = ?",
  ).run(new Date().toISOString(), sentCount, failedCount, id);
  return getCampaign(id, db);
}
