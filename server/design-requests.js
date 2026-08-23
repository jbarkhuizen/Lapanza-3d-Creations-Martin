import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const VALID_STATUSES = ['new', 'in_review', 'quoted', 'accepted', 'rejected', 'completed'];

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
    status: row.status,
    adminNotes: row.admin_notes,
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
  if (!data.email || !String(data.email).trim()) throw new Error('Email is required');
  if (!data.description || !String(data.description).trim()) throw new Error('Description is required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO design_requests (id, client_id, name, email, phone, description, budget_note, reference_image_path, reference_image_original_name, reference_file_path, reference_file_original_name, status, admin_notes, created_at, updated_at)
     VALUES (@id, @client_id, @name, @email, @phone, @description, @budget_note, @reference_image_path, @reference_image_original_name, @reference_file_path, @reference_file_original_name, 'new', '', @created_at, @updated_at)`,
  ).run({
    id,
    client_id: data.clientId || null,
    name: data.name || '',
    email: String(data.email).trim(),
    phone: data.phone || '',
    description: String(data.description).trim(),
    budget_note: data.budgetNote || '',
    reference_image_path: data.referenceImagePath || null,
    reference_image_original_name: data.referenceImageOriginalName || null,
    reference_file_path: data.referenceFilePath || null,
    reference_file_original_name: data.referenceFileOriginalName || null,
    created_at: now,
    updated_at: now,
  });
  return getDesignRequest(id, db);
}

export function updateDesignRequest(id, data, db = getDb()) {
  const existing = getDesignRequest(id, db);
  if (!existing) return null;
  const status = data.status !== undefined ? data.status : existing.status;
  if (!VALID_STATUSES.includes(status)) throw new Error(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
  db.prepare(
    `UPDATE design_requests SET name = @name, phone = @phone, description = @description, budget_note = @budget_note,
      reference_image_path = @reference_image_path, reference_image_original_name = @reference_image_original_name,
      reference_file_path = @reference_file_path, reference_file_original_name = @reference_file_original_name,
      status = @status, admin_notes = @admin_notes, updated_at = @updated_at WHERE id = @id`,
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
    updated_at: new Date().toISOString(),
  });
  return getDesignRequest(id, db);
}

export function deleteDesignRequest(id, db = getDb()) {
  const result = db.prepare('DELETE FROM design_requests WHERE id = ?').run(id);
  return result.changes > 0;
}

export { VALID_STATUSES as DESIGN_REQUEST_STATUSES };
