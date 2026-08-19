import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { sendWhatsAppTemplate } from './whatsapp.js';

function rowToCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    templateName: row.template_name,
    templateParams: JSON.parse(row.template_params_json || '[]'),
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
  };
}

export function listCampaigns(db = getDb()) {
  return db.prepare('SELECT * FROM whatsapp_campaigns ORDER BY created_at DESC').all().map(rowToCampaign);
}

export function getCampaign(id, db = getDb()) {
  return rowToCampaign(db.prepare('SELECT * FROM whatsapp_campaigns WHERE id = ?').get(id));
}

export function createCampaign(data, db = getDb()) {
  if (!data.templateName || !String(data.templateName).trim()) throw new Error('Template name is required');
  const params = Array.isArray(data.templateParams) ? data.templateParams.slice(0, 4).map(String) : [];
  const id = randomUUID();
  db.prepare(
    `INSERT INTO whatsapp_campaigns (id, template_name, template_params_json, status, created_at)
     VALUES (@id, @template_name, @template_params_json, 'draft', @created_at)`,
  ).run({
    id,
    template_name: String(data.templateName).trim(),
    template_params_json: JSON.stringify(params),
    created_at: new Date().toISOString(),
  });
  return getCampaign(id, db);
}

export function approveCampaign(id, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'draft') throw new Error('Only a draft campaign can be approved');
  db.prepare("UPDATE whatsapp_campaigns SET status = 'approved', approved_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
  return getCampaign(id, db);
}

// Best-effort per-recipient, same shape as newsletter-campaigns.js's
// sendCampaign -- one failed send (including "not configured" if Meta
// credentials are still missing) tallies as a failure rather than aborting
// the whole run.
export async function sendCampaign(id, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'approved') throw new Error('Only an approved campaign can be sent');

  const recipients = db
    .prepare("SELECT phone FROM clients WHERE whatsapp_opt_in = 1 AND phone IS NOT NULL AND TRIM(phone) != ''")
    .all();
  let sentCount = 0;
  let failedCount = 0;
  for (const { phone } of recipients) {
    try {
      await sendWhatsAppTemplate({ to: phone, templateName: campaign.templateName, params: campaign.templateParams });
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  db.prepare(
    "UPDATE whatsapp_campaigns SET status = 'sent', sent_at = ?, sent_count = ?, failed_count = ? WHERE id = ?",
  ).run(new Date().toISOString(), sentCount, failedCount, id);
  return getCampaign(id, db);
}
