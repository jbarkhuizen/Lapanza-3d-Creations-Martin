import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export const POTENTIAL_MARKET_STATUSES = ['Initial Load', 'Active', 'Inactive', 'Opt Out'];

function rowToContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    surname: row.surname,
    email: row.email,
    mobileNumber: row.mobile_number,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPotentialMarketContacts({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM potential_market_contacts WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM potential_market_contacts ORDER BY created_at DESC').all();
  return rows.map(rowToContact);
}

export function getPotentialMarketContact(id, db = getDb()) {
  return rowToContact(db.prepare('SELECT * FROM potential_market_contacts WHERE id = ?').get(id));
}

function normalizeStatus(status, fallback) {
  return POTENTIAL_MARKET_STATUSES.includes(status) ? status : fallback;
}

export function createPotentialMarketContact(data, db = getDb()) {
  if (!data.name || !String(data.name).trim()) throw new Error('Name is required');
  if (!data.surname || !String(data.surname).trim()) throw new Error('Surname is required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO potential_market_contacts (id, name, surname, email, mobile_number, status, created_at, updated_at)
     VALUES (@id, @name, @surname, @email, @mobile_number, @status, @created_at, @updated_at)`,
  ).run({
    id,
    name: String(data.name).trim(),
    surname: String(data.surname).trim(),
    email: (data.email || '').trim(),
    mobile_number: (data.mobileNumber || '').trim(),
    status: normalizeStatus(data.status, 'Initial Load'),
    created_at: now,
    updated_at: now,
  });
  return getPotentialMarketContact(id, db);
}

export function updatePotentialMarketContact(id, data, db = getDb()) {
  const existing = getPotentialMarketContact(id, db);
  if (!existing) return null;
  const name = data.name !== undefined ? String(data.name).trim() || existing.name : existing.name;
  const surname = data.surname !== undefined ? String(data.surname).trim() || existing.surname : existing.surname;
  if (!name) throw new Error('Name is required');
  if (!surname) throw new Error('Surname is required');
  db.prepare(
    `UPDATE potential_market_contacts SET name = @name, surname = @surname, email = @email,
      mobile_number = @mobile_number, status = @status, updated_at = @updated_at WHERE id = @id`,
  ).run({
    id,
    name,
    surname,
    email: data.email !== undefined ? data.email : existing.email,
    mobile_number: data.mobileNumber !== undefined ? data.mobileNumber : existing.mobileNumber,
    status: data.status !== undefined ? normalizeStatus(data.status, existing.status) : existing.status,
    updated_at: new Date().toISOString(),
  });
  return getPotentialMarketContact(id, db);
}

export function deletePotentialMarketContact(id, db = getDb()) {
  const result = db.prepare('DELETE FROM potential_market_contacts WHERE id = ?').run(id);
  return result.changes > 0;
}
