import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { sendNewsletterCampaignEmail } from './mailer.js';

const activeCampaigns = new Set();

function rowToCampaign(row, db = getDb()) {
  if (!row) return null;
  const recipients = db.prepare(`
    SELECT status, COUNT(*) AS count FROM newsletter_campaign_recipients WHERE campaign_id = ? GROUP BY status
  `).all(row.id);
  const counts = Object.fromEntries(recipients.map((item) => [item.status, item.count]));
  return {
    id: row.id, subject: row.subject, bodyText: row.body_text, status: row.status,
    createdAt: row.created_at, approvedAt: row.approved_at, sentAt: row.sent_at,
    sentCount: row.sent_count, failedCount: row.failed_count,
    selectedCount: (counts.selected || 0) + (counts.failed || 0) + (counts.sent || 0),
    recipientStatusCounts: counts,
  };
}

export function listEligibleRecipients(db = getDb()) {
  const suppressed = new Set(db.prepare('SELECT LOWER(email) AS email FROM newsletter_suppressions').all().map((row) => row.email));
  const recipients = [
    ...db.prepare("SELECT id, email FROM newsletter_subscribers WHERE status = 'confirmed'").all()
      .map((row) => ({ key: `subscriber:${row.id}`, email: row.email, name: '', sourceType: 'subscriber', sourceId: row.id, unsubscribeToken: db.prepare('SELECT token FROM newsletter_subscribers WHERE id = ?').get(row.id).token })),
    ...db.prepare("SELECT id, email, name, email_marketing_token FROM clients WHERE email_marketing_opt_in = 1 AND email_marketing_token IS NOT NULL AND TRIM(email_marketing_consent_source) <> ''").all()
      .map((row) => ({ key: `client:${row.id}`, email: row.email, name: row.name, sourceType: 'client', sourceId: row.id, unsubscribeToken: row.email_marketing_token })),
  ];
  const seen = new Set();
  return recipients.filter((item) => {
    const email = item.email.trim().toLowerCase();
    if (suppressed.has(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function requestedRecipients(keys, db) {
  const wanted = new Set(Array.isArray(keys) ? keys : []);
  const recipients = listEligibleRecipients(db).filter((item) => wanted.has(item.key));
  if (!recipients.length || recipients.length !== wanted.size) throw new Error('Select one or more eligible marketing recipients');
  return recipients;
}

export function listCampaigns(db = getDb()) {
  return db.prepare('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC').all().map((row) => rowToCampaign(row, db));
}

export function getCampaign(id, db = getDb()) {
  return rowToCampaign(db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').get(id), db);
}

export function listCampaignRecipients(id, db = getDb()) {
  return db.prepare(`
    SELECT email, display_name AS displayName, source_type AS sourceType, status, selected_at AS selectedAt,
      sent_at AS sentAt, failure_reason AS failureReason
    FROM newsletter_campaign_recipients WHERE campaign_id = ? ORDER BY email
  `).all(id);
}

export function createCampaign(data, db = getDb()) {
  if (!data.subject || !String(data.subject).trim()) throw new Error('Subject is required');
  if (!data.bodyText || !String(data.bodyText).trim()) throw new Error('Body is required');
  const recipients = requestedRecipients(data.recipientKeys, db);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO newsletter_campaigns (id, subject, body_text, status, created_at) VALUES (?, ?, ?, 'draft', ?)`)
      .run(id, String(data.subject).trim(), String(data.bodyText).trim(), now);
    const insert = db.prepare(`
      INSERT INTO newsletter_campaign_recipients
        (id, campaign_id, recipient_key, email, display_name, source_type, source_id, unsubscribe_token, status, selected_at)
      VALUES (@id, @campaign_id, @recipient_key, @email, @display_name, @source_type, @source_id, @unsubscribe_token, 'selected', @selected_at)
    `);
    recipients.forEach((recipient) => insert.run({
      id: randomUUID(), campaign_id: id, recipient_key: recipient.key, email: recipient.email,
      display_name: recipient.name, source_type: recipient.sourceType, source_id: recipient.sourceId,
      unsubscribe_token: recipient.unsubscribeToken, selected_at: now,
    }));
  })();
  return getCampaign(id, db);
}

export function approveCampaign(id, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'draft') throw new Error('Only a draft campaign can be approved');
  if (!campaign.selectedCount) throw new Error('A campaign needs selected recipients before approval');
  db.prepare("UPDATE newsletter_campaigns SET status = 'approved', approved_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return getCampaign(id, db);
}

export async function sendTestCampaign(id, toEmail, { siteUrl }, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (!toEmail || !String(toEmail).trim()) throw new Error('Test email address is required');
  await sendNewsletterCampaignEmail(`[TEST] ${campaign.subject}`, campaign.bodyText, String(toEmail).trim(), `${siteUrl}/`);
  return campaign;
}

export async function sendCampaign(id, { siteUrl }, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (!['approved', 'partial'].includes(campaign.status)) throw new Error('Only an approved or partial campaign can be sent');
  db.prepare("UPDATE newsletter_campaigns SET status = 'sending' WHERE id = ?").run(id);
  const recipients = db.prepare(`
    SELECT * FROM newsletter_campaign_recipients WHERE campaign_id = ? AND status IN ('selected', 'failed')
  `).all(id);
  for (const recipient of recipients) {
    try {
      await sendNewsletterCampaignEmail(campaign.subject, campaign.bodyText, recipient.email, `${siteUrl}/api/newsletter/unsubscribe?token=${recipient.unsubscribe_token}`);
      db.prepare("UPDATE newsletter_campaign_recipients SET status = 'sent', sent_at = ?, failure_reason = '' WHERE id = ?")
        .run(new Date().toISOString(), recipient.id);
    } catch (error) {
      db.prepare("UPDATE newsletter_campaign_recipients SET status = 'failed', failure_reason = ? WHERE id = ?")
        .run(error.message || 'Delivery failed', recipient.id);
    }
  }
  const totals = db.prepare(`
    SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed FROM newsletter_campaign_recipients WHERE campaign_id = ?
  `).get(id);
  const status = totals.failed ? 'partial' : 'sent';
  db.prepare("UPDATE newsletter_campaigns SET status = ?, sent_at = ?, sent_count = ?, failed_count = ? WHERE id = ?")
    .run(status, new Date().toISOString(), totals.sent || 0, totals.failed || 0, id);
  return getCampaign(id, db);
}

export function queueCampaign(id, options, db = getDb()) {
  if (activeCampaigns.has(id)) throw new Error('This campaign is already sending');
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (!['approved', 'partial'].includes(campaign.status)) throw new Error('Only an approved or partial campaign can be sent');
  activeCampaigns.add(id);
  void sendCampaign(id, options, db).finally(() => activeCampaigns.delete(id));
  return { ...campaign, status: 'sending' };
}
