import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'crypto';
import { getDb } from './db.js';

const VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function rowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientCode: row.client_code,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    businessName: row.business_name,
    email: row.email,
    phone: row.phone,
    street: row.street,
    suburb: row.suburb,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    country: row.country,
    createdAt: row.created_at,
    // Registered-account fields (Phase 2) -- password_hash itself is never
    // exposed on the mapped object, only whether one exists.
    hasAccount: Boolean(row.password_hash),
    emailVerified: Boolean(row.email_verified),
    // Phase 3 -- discountPct only ever applied on manually-created orders
    // (orders.js's createManualOrder), never automatically at checkout.
    discountPct: row.discount_pct,
    discountNote: row.discount_note,
    source: row.source,
    // Phase 4
    lastLoginAt: row.last_login_at,
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
  };
}

function nextClientCode(db) {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(client_code, 5) AS INTEGER)) AS maxNum FROM clients").get();
  const next = (row.maxNum || 0) + 1;
  return `CLI-${String(next).padStart(6, '0')}`;
}

export function listClients({ q, registeredOnly } = {}, db = getDb()) {
  let rows = registeredOnly
    ? db.prepare('SELECT * FROM clients WHERE password_hash IS NOT NULL ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
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
  // `name` is kept as a single display field (used by admin list, packing
  // slip, order emails) regardless of whether the caller sent firstName/
  // lastName (checkout) or just name (admin's own client form).
  const name = data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim();
  db.prepare(
    `INSERT INTO clients (id, client_code, name, first_name, last_name, business_name, email, phone, street, suburb, city, province, postal_code, country, discount_pct, discount_note, source, created_at)
     VALUES (@id, @client_code, @name, @first_name, @last_name, @business_name, @email, @phone, @street, @suburb, @city, @province, @postal_code, @country, @discount_pct, @discount_note, @source, @created_at)`,
  ).run({
    id,
    client_code: clientCode,
    name,
    first_name: data.firstName || '',
    last_name: data.lastName || '',
    business_name: data.businessName || '',
    email: String(data.email || '').trim(),
    phone: data.phone || '',
    street: data.street || '',
    suburb: data.suburb || '',
    city: data.city || '',
    province: data.province || '',
    postal_code: data.postalCode || '',
    country: data.country || 'South Africa',
    discount_pct: Number(data.discountPct) || 0,
    discount_note: data.discountNote || '',
    source: data.source || '',
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
    `UPDATE clients SET name = @name, first_name = @first_name, last_name = @last_name, business_name = @business_name,
      email = @email, phone = @phone, street = @street, suburb = @suburb,
      city = @city, province = @province, postal_code = @postal_code, country = @country,
      discount_pct = @discount_pct, discount_note = @discount_note, source = @source WHERE id = @id`,
  ).run({
    id,
    name: data.name ?? existing.name,
    first_name: data.firstName ?? existing.firstName,
    last_name: data.lastName ?? existing.lastName,
    business_name: data.businessName ?? existing.businessName,
    email,
    phone: data.phone ?? existing.phone,
    street: data.street ?? existing.street,
    suburb: data.suburb ?? existing.suburb,
    city: data.city ?? existing.city,
    province: data.province ?? existing.province,
    postal_code: data.postalCode ?? existing.postalCode,
    country: data.country ?? existing.country,
    discount_pct: data.discountPct !== undefined ? Number(data.discountPct) || 0 : existing.discountPct,
    discount_note: data.discountNote ?? existing.discountNote,
    source: data.source ?? existing.source,
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
  return db.prepare('SELECT id, invoice_number, status, total, created_at FROM orders WHERE client_id = ? ORDER BY created_at DESC').all(clientId);
}

// ---- Phase 2: client accounts ----
// A `clients` row becomes a real account once password_hash is set; a row
// with password_hash IS NULL is still just a guest-checkout record. This
// lets someone who already checked out as a guest later "claim" that same
// record by registering with the same email, rather than ending up with two
// disconnected identities.

function newVerificationToken() {
  return randomBytes(32).toString('hex');
}

// Registers a new account, or attaches auth to an existing guest-only
// client row that matches the email. Returns the (unverified) client and
// the raw verification token the caller needs to email out -- the token is
// never returned from any other function, so it can't leak via a later
// /api/client/me-style read.
export function registerClient(data, db = getDb()) {
  const email = String(data.email || '').trim();
  if (!email) throw new Error('Email is required');
  if (!data.password || String(data.password).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const passwordHash = bcrypt.hashSync(data.password, 10);
  const token = newVerificationToken();
  const tokenExpires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();

  const tx = db.transaction(() => {
    const existingRow = db.prepare('SELECT * FROM clients WHERE LOWER(email) = LOWER(?)').get(email);
    if (existingRow && existingRow.password_hash) {
      throw new Error('An account with this email already exists — log in instead');
    }
    if (existingRow) {
      db.prepare(
        'UPDATE clients SET password_hash = ?, email_verified = 0, verification_token = ?, verification_token_expires = ? WHERE id = ?',
      ).run(passwordHash, token, tokenExpires, existingRow.id);
      return existingRow.id;
    }
    const created = insertClient(db, data);
    db.prepare(
      'UPDATE clients SET password_hash = ?, email_verified = 0, verification_token = ?, verification_token_expires = ? WHERE id = ?',
    ).run(passwordHash, token, tokenExpires, created.id);
    return created.id;
  });
  const clientId = tx();
  return { client: getClient(clientId, db), token };
}

// Returns the verified client, or null if the token is missing/expired.
export function verifyClientEmail(token, db = getDb()) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM clients WHERE verification_token = ?').get(token);
  if (!row) return null;
  if (!row.verification_token_expires || new Date(row.verification_token_expires).getTime() < Date.now()) {
    return null;
  }
  db.prepare(
    'UPDATE clients SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
  ).run(row.id);
  return getClient(row.id, db);
}

// Returns { ok: true, client } on success, or { ok: false, reason } so the
// route can tell "wrong credentials" apart from "not verified yet" without a
// second query -- 'invalid' covers unknown email/no account/wrong password
// alike, deliberately not distinguishing those from each other to avoid
// leaking which emails have accounts.
export function loginClient(email, password, db = getDb()) {
  const row = db.prepare('SELECT * FROM clients WHERE LOWER(email) = LOWER(?)').get(String(email || '').trim());
  if (!row || !row.password_hash || !bcrypt.compareSync(password, row.password_hash)) {
    return { ok: false, reason: 'invalid' };
  }
  if (!row.email_verified) return { ok: false, reason: 'unverified' };
  db.prepare('UPDATE clients SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return { ok: true, client: rowToClient(getClientRow(row.id, db)) };
}

function getClientRow(id, db) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

// Phase 4: public checkout opt-in prompt sets this after order success --
// email-matched as a lightweight guard since it only toggles a consent
// flag, not real auth (see server/index.js's PATCH /api/client/:id/marketing-preferences).
export function setWhatsAppOptIn(id, email, optIn, db = getDb()) {
  const result = db
    .prepare('UPDATE clients SET whatsapp_opt_in = ? WHERE id = ? AND LOWER(email) = LOWER(?)')
    .run(optIn ? 1 : 0, id, String(email || '').trim());
  return result.changes > 0;
}
