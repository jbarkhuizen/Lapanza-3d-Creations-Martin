import { randomUUID } from 'crypto';
import { getDb } from './db.js';

function rowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientCode: row.client_code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    street: row.street,
    suburb: row.suburb,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    country: row.country,
    createdAt: row.created_at,
  };
}

function nextClientCode(db) {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(client_code, 5) AS INTEGER)) AS maxNum FROM clients").get();
  const next = (row.maxNum || 0) + 1;
  return `CLI-${String(next).padStart(6, '0')}`;
}

export function listClients({ q } = {}, db = getDb()) {
  let rows = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) =>
      [r.name, r.email, r.client_code].filter(Boolean).some((v) => v.toLowerCase().includes(needle)),
    );
  }
  return rows.map(rowToClient);
}

export function getClient(id, db = getDb()) {
  return rowToClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
}

export function findClientByEmail(email, db = getDb()) {
  return rowToClient(db.prepare('SELECT * FROM clients WHERE LOWER(email) = LOWER(?)').get(String(email || '').trim()));
}

function insertClient(db, data) {
  const id = randomUUID();
  const clientCode = nextClientCode(db);
  db.prepare(
    `INSERT INTO clients (id, client_code, name, email, phone, street, suburb, city, province, postal_code, country, created_at)
     VALUES (@id, @client_code, @name, @email, @phone, @street, @suburb, @city, @province, @postal_code, @country, @created_at)`,
  ).run({
    id,
    client_code: clientCode,
    name: data.name || '',
    email: String(data.email || '').trim(),
    phone: data.phone || '',
    street: data.street || '',
    suburb: data.suburb || '',
    city: data.city || '',
    province: data.province || '',
    postal_code: data.postalCode || '',
    country: data.country || 'South Africa',
    created_at: new Date().toISOString(),
  });
  return getClient(id, db);
}

export function createClient(data, db = getDb()) {
  if (!data.email || !String(data.email).trim()) throw new Error('Email is required');
  const tx = db.transaction((d) => insertClient(db, d));
  return tx(data);
}

export function updateClient(id, data, db = getDb()) {
  const existing = getClient(id, db);
  if (!existing) return null;
  const email = data.email !== undefined ? String(data.email).trim() : existing.email;
  if (!email) throw new Error('Email is required');
  db.prepare(
    `UPDATE clients SET name = @name, email = @email, phone = @phone, street = @street, suburb = @suburb,
      city = @city, province = @province, postal_code = @postal_code, country = @country WHERE id = @id`,
  ).run({
    id,
    name: data.name ?? existing.name,
    email,
    phone: data.phone ?? existing.phone,
    street: data.street ?? existing.street,
    suburb: data.suburb ?? existing.suburb,
    city: data.city ?? existing.city,
    province: data.province ?? existing.province,
    postal_code: data.postalCode ?? existing.postalCode,
    country: data.country ?? existing.country,
  });
  return getClient(id, db);
}

// Checkout entry point (B.3): matches an existing client by email
// (case-insensitive) and reuses it, or creates a new one -- both inside one
// transaction so the code-generation SELECT MAX + INSERT in insertClient
// can't race with a concurrent checkout picking the same next client_code.
export function findOrCreateClientForCheckout(data, db = getDb()) {
  const email = String(data.email || '').trim();
  if (!email) throw new Error('Email is required');
  const tx = db.transaction((d) => {
    const existing = findClientByEmail(email, db);
    if (existing) return existing;
    return insertClient(db, d);
  });
  return tx(data);
}

export function listOrdersForClient(clientId, db = getDb()) {
  return db.prepare('SELECT id, status, total, created_at FROM orders WHERE client_id = ? ORDER BY created_at DESC').all(clientId);
}
