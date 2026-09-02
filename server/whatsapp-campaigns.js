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

function countOptedInRecipients(db) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM clients WHERE whatsapp_opt_in = 1 AND phone IS NOT NULL AND TRIM(phone) != ''")
    .get().n;
}

// Best-effort per-recipient, same shape as newsletter-campaigns.js's
// sendCampaign -- one failed send (including "not configured" if Meta
// credentials are still missing) tallies as a failure rather than aborting
// the whole run. Stamped 'sending' at the start (not just 'approved' ->
// 'sent' at the end) so a concurrent read while a large run is still in
// flight -- the whole point of queueCampaign below -- shows accurate
// state instead of looking untouched.
export async function sendCampaign(id, db = getDb()) {
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'approved') throw new Error('Only an approved campaign can be sent');
  db.prepare("UPDATE whatsapp_campaigns SET status = 'sending' WHERE id = ?").run(id);

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

// Guards against the same campaign being queued twice concurrently (e.g. a
// second click before the row re-renders without its Send button) -- kept
// as a module-level Set, same convention as newsletter-campaigns.js's
// identically-named guard.
const activeCampaigns = new Set();

// Fire-and-forget dispatch, same shape as newsletter-campaigns.js's
// queueCampaign and for the same reason: the route handler must not await
// the full per-recipient send loop -- for a large opted-in list that's a
// long-running request with no benefit to the admin waiting on it, and
// risks a reverse-proxy/browser timeout the newsletter side already
// avoids. Validates and stamps 'sending' synchronously so the HTTP
// response can return immediately with an accurate optimistic status.
export function queueCampaign(id, db = getDb()) {
  if (activeCampaigns.has(id)) throw new Error('This campaign is already sending');
  const campaign = getCampaign(id, db);
  if (!campaign) return null;
  if (campaign.status !== 'approved') throw new Error('Only an approved campaign can be sent');
  const pendingCount = countOptedInRecipients(db);
  activeCampaigns.add(id);
  // The .catch is load-bearing: a throw that escapes sendCampaign's
  // per-recipient try/catch (the recipients query, the final UPDATE, a
  // failed getCampaign re-read) would otherwise be an unhandled rejection
  // outside any request context -- Node >=15 terminates the whole process
  // on that, taking the storefront down too -- and the campaign would be
  // stranded at 'sending' forever, a status sendCampaign refuses to
  // re-enter (its own status check only accepts 'approved').
  void sendCampaign(id, db)
    .catch((error) => {
      console.error(`WhatsApp campaign ${id} send failed:`, error.message);
      try {
        db.prepare("UPDATE whatsapp_campaigns SET status = 'approved' WHERE id = ? AND status = 'sending'").run(id);
      } catch {
        // DB itself unusable -- nothing safer left to do than log above.
      }
    })
    .finally(() => activeCampaigns.delete(id));
  return { ...campaign, status: 'sending', pendingCount };
}
