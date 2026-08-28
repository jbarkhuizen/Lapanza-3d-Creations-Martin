import { randomUUID } from 'crypto';
import { getDb } from './db.js';

function rowToTestimonial(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerName: row.customer_name,
    displayName: row.display_name,
    consentGiven: Boolean(row.consent_given),
    consentNote: row.consent_note,
    testimonialDate: row.testimonial_date,
    quote: row.quote,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    imagePath: row.image_path,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTestimonials({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM testimonials WHERE status = ? ORDER BY sort_order ASC, created_at DESC').all(status)
    : db.prepare('SELECT * FROM testimonials ORDER BY sort_order ASC, created_at DESC').all();
  return rows.map(rowToTestimonial);
}

export function getTestimonial(id, db = getDb()) {
  return rowToTestimonial(db.prepare('SELECT * FROM testimonials WHERE id = ?').get(id));
}

// The actual privacy guard backlog #51 asked for -- enforced here, not just
// in the admin UI, so a testimonial can never end up 'published' without
// consent_given regardless of which code path writes it.
function assertPublishAllowed(status, consentGiven) {
  if (status === 'published' && !consentGiven) {
    throw new Error('Cannot publish a testimonial without recorded customer consent');
  }
}

export function createTestimonial(data, db = getDb()) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const consentGiven = Boolean(data.consentGiven);
  const status = data.status === 'published' ? 'published' : 'draft';
  assertPublishAllowed(status, consentGiven);
  db.prepare(
    `INSERT INTO testimonials (id, customer_name, display_name, consent_given, consent_note, testimonial_date, quote, link_url, link_label, image_path, status, sort_order, created_at, updated_at)
     VALUES (@id, @customer_name, @display_name, @consent_given, @consent_note, @testimonial_date, @quote, @link_url, @link_label, @image_path, @status, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    customer_name: (data.customerName || '').trim() || 'Unnamed customer',
    display_name: (data.displayName || '').trim() || (data.customerName || '').trim() || 'A happy customer',
    consent_given: consentGiven ? 1 : 0,
    consent_note: data.consentNote || '',
    testimonial_date: data.testimonialDate || null,
    quote: (data.quote || '').trim(),
    link_url: data.linkUrl || null,
    link_label: data.linkLabel || null,
    image_path: data.imagePath || null,
    status,
    sort_order: Number(data.sortOrder) || 0,
    created_at: now,
    updated_at: now,
  });
  return getTestimonial(id, db);
}

export function updateTestimonial(id, data, db = getDb()) {
  const existing = getTestimonial(id, db);
  if (!existing) return null;
  const consentGiven = data.consentGiven !== undefined ? Boolean(data.consentGiven) : existing.consentGiven;
  const status = data.status !== undefined ? (data.status === 'published' ? 'published' : 'draft') : existing.status;
  assertPublishAllowed(status, consentGiven);
  db.prepare(
    `UPDATE testimonials SET customer_name = @customer_name, display_name = @display_name, consent_given = @consent_given,
      consent_note = @consent_note, testimonial_date = @testimonial_date, quote = @quote, link_url = @link_url, link_label = @link_label,
      image_path = @image_path, status = @status, sort_order = @sort_order, updated_at = @updated_at WHERE id = @id`,
  ).run({
    id,
    customer_name: data.customerName !== undefined ? String(data.customerName).trim() || existing.customerName : existing.customerName,
    display_name: data.displayName !== undefined ? String(data.displayName).trim() || existing.displayName : existing.displayName,
    consent_given: consentGiven ? 1 : 0,
    consent_note: data.consentNote !== undefined ? data.consentNote : existing.consentNote,
    testimonial_date: data.testimonialDate !== undefined ? data.testimonialDate : existing.testimonialDate,
    quote: data.quote !== undefined ? String(data.quote).trim() || existing.quote : existing.quote,
    link_url: data.linkUrl !== undefined ? data.linkUrl : existing.linkUrl,
    link_label: data.linkLabel !== undefined ? data.linkLabel : existing.linkLabel,
    image_path: data.imagePath !== undefined ? data.imagePath : existing.imagePath,
    status,
    sort_order: data.sortOrder !== undefined ? Number(data.sortOrder) || 0 : existing.sortOrder,
    updated_at: new Date().toISOString(),
  });
  return getTestimonial(id, db);
}

export function deleteTestimonial(id, db = getDb()) {
  const result = db.prepare('DELETE FROM testimonials WHERE id = ?').run(id);
  return result.changes > 0;
}

// Public-safe subset only -- server/export.js's syncPublicJson() is the one
// caller. Deliberately excludes customerName (the real name, admin-internal
// record of who consent was obtained from) and consentNote -- only what the
// customer/admin actually agreed to show publicly ever leaves this module.
export function publicTestimonial(t) {
  return {
    id: t.id,
    displayName: t.displayName,
    quote: t.quote,
    date: t.testimonialDate,
    linkUrl: t.linkUrl || '',
    linkLabel: t.linkLabel || '',
    imageUrl: t.imagePath || '',
  };
}
