import { randomUUID, randomBytes } from 'crypto';
import { getDb } from './db.js';

const VALID_STATUSES = ['new', 'in_progress', 'finalized'];

function rowToDesignRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    description: row.description,
    budgetNote: row.budget_note,
    referenceImagePath: row.reference_image_path,
    referenceImageOriginalName: row.reference_image_original_name,
    referenceFilePath: row.reference_file_path,
    referenceFileOriginalName: row.reference_file_original_name,
    // Phase-5 structured capture (#81)
    serviceType: row.service_type || '',
    intendedUse: row.intended_use || '',
    dimensions: row.dimensions || '',
    quantity: row.quantity ?? 1,
    materialPref: row.material_pref || '',
    colourPref: row.colour_pref || '',
    finishPref: row.finish_pref || '',
    urgency: row.urgency || '',
    deliveryPref: row.delivery_pref || '',
    statusToken: row.status_token,
    // #87 quote fields
    quoteAmount: row.quote_amount,
    quoteTerms: row.quote_terms || '',
    quotedAt: row.quoted_at,
    quoteStatus: row.quote_status || '',
    quoteOrderId: row.quote_order_id,
    quoteDepositPct: row.quote_deposit_pct ?? 100,
    status: row.status,
    adminNotes: row.admin_notes,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDesignRequests({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM design_requests WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM design_requests ORDER BY created_at DESC').all();
  return rows.map(rowToDesignRequest);
}

export function getDesignRequest(id, db = getDb()) {
  return rowToDesignRequest(db.prepare('SELECT * FROM design_requests WHERE id = ?').get(id));
}

export function createDesignRequest(data, db = getDb()) {
  if (!data.name || !String(data.name).trim()) throw new Error('Name is required');
  if (!data.email || !String(data.email).trim()) throw new Error('Email is required');
  if (!data.phone || !String(data.phone).trim()) throw new Error('Phone is required');
  if (!data.description || !String(data.description).trim()) throw new Error('Description is required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO design_requests (id, client_id, name, email, phone, description, budget_note,
       service_type, intended_use, dimensions, quantity, material_pref, colour_pref, finish_pref, urgency, delivery_pref, status_token,
       reference_image_path, reference_image_original_name, reference_file_path, reference_file_original_name, status, admin_notes, created_at, updated_at)
     VALUES (@id, @client_id, @name, @email, @phone, @description, @budget_note,
       @service_type, @intended_use, @dimensions, @quantity, @material_pref, @colour_pref, @finish_pref, @urgency, @delivery_pref, @status_token,
       @reference_image_path, @reference_image_original_name, @reference_file_path, @reference_file_original_name, 'new', '', @created_at, @updated_at)`,
  ).run({
    id,
    client_id: data.clientId || null,
    name: data.name || '',
    email: String(data.email).trim(),
    phone: data.phone || '',
    description: String(data.description).trim(),
    budget_note: data.budgetNote || '',
    service_type: data.serviceType === 'design_for_me' ? 'design_for_me' : 'print_my_model',
    intended_use: String(data.intendedUse || '').slice(0, 300),
    dimensions: String(data.dimensions || '').slice(0, 200),
    quantity: Math.max(1, Math.round(Number(data.quantity) || 1)),
    material_pref: String(data.materialPref || '').slice(0, 100),
    colour_pref: String(data.colourPref || '').slice(0, 100),
    finish_pref: String(data.finishPref || '').slice(0, 100),
    urgency: String(data.urgency || '').slice(0, 100),
    delivery_pref: String(data.deliveryPref || '').slice(0, 100),
    status_token: randomBytes(24).toString('hex'),
    reference_image_path: data.referenceImagePath || null,
    reference_image_original_name: data.referenceImageOriginalName || null,
    reference_file_path: data.referenceFilePath || null,
    reference_file_original_name: data.referenceFileOriginalName || null,
    created_at: now,
    updated_at: now,
  });
  // #82: multi-file uploads land in the child table (legacy two-column
  // storage stays readable for pre-existing rows).
  const insertFile = db.prepare(
    'INSERT INTO design_request_files (id, design_request_id, kind, file_path, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const f of Array.isArray(data.files) ? data.files : []) {
    insertFile.run(randomUUID(), id, f.kind === 'image' ? 'image' : 'file', f.filePath, f.originalName || '', now);
  }
  return getDesignRequest(id, db);
}

export function listDesignRequestFiles(designRequestId, db = getDb()) {
  return db
    .prepare('SELECT id, kind, file_path AS filePath, original_name AS originalName FROM design_request_files WHERE design_request_id = ? ORDER BY created_at ASC')
    .all(designRequestId);
}

// #86: guest status lookup by token -- returns only what a customer may
// see (never admin_notes).
export function getDesignRequestByToken(token, db = getDb()) {
  const row = db.prepare('SELECT * FROM design_requests WHERE status_token = ?').get(String(token || ''));
  if (!row) return null;
  const r = rowToDesignRequest(row);
  return {
    id: r.id, status: r.status, createdAt: r.createdAt, finalizedAt: r.finalizedAt,
    serviceType: r.serviceType, description: r.description,
    quoteAmount: r.quoteAmount, quoteTerms: r.quoteTerms, quoteStatus: r.quoteStatus, quotedAt: r.quotedAt,
    quoteDepositPct: r.quoteDepositPct,
  };
}

export function updateDesignRequest(id, data, db = getDb()) {
  const existing = getDesignRequest(id, db);
  if (!existing) return null;
  const status = data.status !== undefined ? data.status : existing.status;
  if (!VALID_STATUSES.includes(status)) throw new Error(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
  // Same auto-stamp-on-completion shape as todos.js's actualFixDate: only
  // set the moment status first becomes 'finalized', never overwritten by a
  // later save (re-saving an already-finalized request keeps its original
  // finalized date), and cleared back to null if the status is ever moved
  // off finalized again (re-opening a request shouldn't keep a stale date).
  let finalizedAt = data.finalizedAt !== undefined ? data.finalizedAt : existing.finalizedAt;
  if (status === 'finalized' && !finalizedAt) finalizedAt = new Date().toISOString();
  else if (status !== 'finalized') finalizedAt = null;
  db.prepare(
    `UPDATE design_requests SET name = @name, phone = @phone, description = @description, budget_note = @budget_note,
      reference_image_path = @reference_image_path, reference_image_original_name = @reference_image_original_name,
      reference_file_path = @reference_file_path, reference_file_original_name = @reference_file_original_name,
      status = @status, admin_notes = @admin_notes, finalized_at = @finalized_at, updated_at = @updated_at WHERE id = @id`,
  ).run({
    id,
    name: data.name ?? existing.name,
    phone: data.phone ?? existing.phone,
    description: data.description ?? existing.description,
    budget_note: data.budgetNote ?? existing.budgetNote,
    reference_image_path: data.referenceImagePath ?? existing.referenceImagePath,
    reference_image_original_name: data.referenceImageOriginalName ?? existing.referenceImageOriginalName,
    reference_file_path: data.referenceFilePath ?? existing.referenceFilePath,
    reference_file_original_name: data.referenceFileOriginalName ?? existing.referenceFileOriginalName,
    status,
    admin_notes: data.adminNotes ?? existing.adminNotes,
    finalized_at: finalizedAt,
    updated_at: new Date().toISOString(),
  });
  return getDesignRequest(id, db);
}

// #87: the quote lifecycle. Setting a quote (re)stamps quoted_at and puts
// quote_status at 'quoted'; accepting is only valid FROM 'quoted' and
// records the order that payment now rides on. Amounts are whole rand,
// same convention as orders.total. depositPct is locked onto the row here
// (not read live from settings later) -- which tier is actually valid to
// pick from is a settings.quoteDepositOptions concern, checked by the
// caller (server/index.js), not this module.
export function setDesignRequestQuote(id, { amount, terms, depositPct }, db = getDb()) {
  const existing = getDesignRequest(id, db);
  if (!existing) return null;
  const value = Math.round(Number(amount));
  if (!Number.isFinite(value) || value <= 0) throw new Error('Quote amount must be a positive rand value');
  const pct = depositPct === undefined ? 100 : Math.round(Number(depositPct));
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) throw new Error('Deposit percent must be between 1 and 100');
  db.prepare(
    "UPDATE design_requests SET quote_amount = ?, quote_terms = ?, quote_deposit_pct = ?, quoted_at = ?, quote_status = 'quoted', updated_at = ? WHERE id = ?",
  ).run(value, String(terms || '').slice(0, 2000), pct, new Date().toISOString(), new Date().toISOString(), id);
  return getDesignRequest(id, db);
}

// #94: derives the customer-visible payment stage from the quote lifecycle
// plus the linked order's REAL status -- deliberately not a stored value,
// so "Order Paid" becomes true the instant the Payfast ITN marks that order
// paid, with no extra write-back step to keep in sync. orderStatus is
// whatever the caller already looked up for quote_order_id (or null/undefined
// if there's no linked order yet); this function does no DB access itself.
export function deriveQuoteStage(quoteStatus, orderStatus) {
  if (quoteStatus === 'quoted') return 'quoted';
  if (quoteStatus !== 'accepted') return null;
  return ['paid', 'shipped', 'completed'].includes(orderStatus) ? 'order_paid' : 'order_placed';
}

export function acceptDesignRequestQuote(token, orderId, db = getDb()) {
  const row = db.prepare('SELECT * FROM design_requests WHERE status_token = ?').get(String(token || ''));
  if (!row) throw new Error('Request not found');
  if (row.quote_status !== 'quoted') throw new Error('This request has no open quote to accept');
  db.prepare(
    "UPDATE design_requests SET quote_status = 'accepted', quote_order_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?",
  ).run(orderId, new Date().toISOString(), row.id);
  return getDesignRequest(row.id, db);
}

export function deleteDesignRequest(id, db = getDb()) {
  const result = db.prepare('DELETE FROM design_requests WHERE id = ?').run(id);
  return result.changes > 0;
}

// Backlog #90 (SITE-056/057): POPIA retention -- uploaded design files
// auto-delete N months after a request is FINALIZED. Only the binary files
// go (deleted from disk via the injectable deleteFile, path columns nulled);
// the request row and its text stay as the business record. Requests still
// new/in_progress are never touched regardless of age. Returns the pruned
// request ids so the caller can audit-log the batch.
export function pruneExpiredDesignFiles(retentionMonths, deleteFile, db = getDb()) {
  const months = Math.max(1, Math.round(Number(retentionMonths) || 12));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const rows = db
    .prepare(
      `SELECT id, reference_image_path, reference_file_path FROM design_requests
       WHERE status = 'finalized' AND finalized_at IS NOT NULL AND finalized_at < ?
         AND (reference_image_path IS NOT NULL OR reference_file_path IS NOT NULL)`,
    )
    .all(cutoff.toISOString());
  // Multi-file rows (#82) expire on the same clock.
  const fileRows = db
    .prepare(
      `SELECT f.id, f.file_path, f.design_request_id FROM design_request_files f
       JOIN design_requests r ON r.id = f.design_request_id
       WHERE r.status = 'finalized' AND r.finalized_at IS NOT NULL AND r.finalized_at < ?`,
    )
    .all(cutoff.toISOString());
  const pruned = new Set();
  for (const f of fileRows) {
    deleteFile(f.file_path);
    db.prepare('DELETE FROM design_request_files WHERE id = ?').run(f.id);
    pruned.add(f.design_request_id);
  }
  for (const row of rows) {
    if (row.reference_image_path) deleteFile(row.reference_image_path);
    if (row.reference_file_path) deleteFile(row.reference_file_path);
    db.prepare(
      'UPDATE design_requests SET reference_image_path = NULL, reference_file_path = NULL, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), row.id);
    pruned.add(row.id);
  }
  return [...pruned];
}

export { VALID_STATUSES as DESIGN_REQUEST_STATUSES };
