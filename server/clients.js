import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'crypto';
import { getDb } from './db.js';

const VERIFICATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1h -- shorter than verification since it's re-requestable any time

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
    // Backlog #24: preferred PUDO locker, admin-recorded.
    pudoRelevant: Boolean(row.pudo_relevant),
    pudoLockerName: row.pudo_locker_name || '',
    pudoLockerAddress: row.pudo_locker_address || '',
    pudoLockerSuburb: row.pudo_locker_suburb || '',
    pudoLockerCity: row.pudo_locker_city || '',
    pudoLockerPostalCode: row.pudo_locker_postal_code || '',
    createdAt: row.created_at,
    // Registered-account fields (Phase 2) -- password_hash itself is never
    // exposed on the mapped object, only whether one exists.
    hasAccount: Boolean(row.password_hash),
    emailVerified: Boolean(row.email_verified),
    disabled: Boolean(row.disabled),
    // Phase 3 -- discountPct only ever applied on manually-created orders
    // (orders.js's createManualOrder), never automatically at checkout.
    discountPct: row.discount_pct,
    discountNote: row.discount_note,
    source: row.source,
    // Phase 4
    lastLoginAt: row.last_login_at,
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
    emailMarketingOptIn: Boolean(row.email_marketing_opt_in),
    emailMarketingOptedInAt: row.email_marketing_opted_in_at,
    emailMarketingConsentSource: row.email_marketing_consent_source,
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
  // Walk-in clients can have no email (owner decision 2026-09-03) -- an
  // empty string must never match another empty-email client, or every
  // walk-in would silently merge into one record.
  const trimmed = String(email || '').trim();
  if (!trimmed) return null;
  return rowToClient(db.prepare('SELECT * FROM clients WHERE LOWER(email) = LOWER(?)').get(trimmed));
}

function insertClient(db, data) {
  const id = randomUUID();
  const clientCode = nextClientCode(db);
  const emailMarketingOptIn = Boolean(data.emailMarketingOptIn);
  const emailMarketingConsentSource = String(data.emailMarketingConsentSource || '').trim();
  if (emailMarketingOptIn && !emailMarketingConsentSource) throw new Error('Email marketing consent source is required');
  // `name` is kept as a single display field (used by admin list, packing
  // slip, order emails) regardless of whether the caller sent firstName/
  // lastName (checkout) or just name (admin's own client form).
  const name = data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim();
  db.prepare(
    `INSERT INTO clients (id, client_code, name, first_name, last_name, business_name, email, phone, street, suburb, city, province, postal_code, country, discount_pct, discount_note, source, whatsapp_opt_in, email_marketing_opt_in, email_marketing_opted_in_at, email_marketing_consent_source, email_marketing_token, created_at)
     VALUES (@id, @client_code, @name, @first_name, @last_name, @business_name, @email, @phone, @street, @suburb, @city, @province, @postal_code, @country, @discount_pct, @discount_note, @source, @whatsapp_opt_in, @email_marketing_opt_in, @email_marketing_opted_in_at, @email_marketing_consent_source, @email_marketing_token, @created_at)`,
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
    whatsapp_opt_in: data.whatsappOptIn ? 1 : 0,
    email_marketing_opt_in: emailMarketingOptIn ? 1 : 0,
    email_marketing_opted_in_at: emailMarketingOptIn ? new Date().toISOString() : null,
    email_marketing_consent_source: emailMarketingOptIn ? emailMarketingConsentSource : '',
    email_marketing_token: emailMarketingOptIn ? randomBytes(32).toString('hex') : null,
    created_at: new Date().toISOString(),
  });
  return getClient(id, db);
}

// Email is optional here (owner decision 2026-09-03): walk-in customers
// captured directly in the admin centre often have none. Online checkout
// and account registration still require it at their own entry points.
export function createClient(data, db = getDb()) {
  const tx = db.transaction((d) => insertClient(db, d));
  return tx(data);
}

export function updateClient(id, data, db = getDb()) {
  const existing = getClient(id, db);
  if (!existing) return null;
  // Empty email allowed (walk-in clients) -- see createClient above.
  const email = data.email !== undefined ? String(data.email).trim() : existing.email;
  const emailMarketingOptIn = data.emailMarketingOptIn !== undefined ? Boolean(data.emailMarketingOptIn) : existing.emailMarketingOptIn;
  const whatsappOptIn = data.whatsappOptIn !== undefined ? Boolean(data.whatsappOptIn) : existing.whatsappOptIn;
  const consentChanged = emailMarketingOptIn !== existing.emailMarketingOptIn;
  const emailMarketingConsentSource = String(data.emailMarketingConsentSource ?? existing.emailMarketingConsentSource ?? '').trim();
  if (emailMarketingOptIn && !emailMarketingConsentSource) throw new Error('Email marketing consent source is required');
  const existingMarketingToken = db.prepare('SELECT email_marketing_token FROM clients WHERE id = ?').get(id).email_marketing_token;
  db.prepare(
    `UPDATE clients SET name = @name, first_name = @first_name, last_name = @last_name, business_name = @business_name,
      email = @email, phone = @phone, whatsapp_opt_in = @whatsapp_opt_in, street = @street, suburb = @suburb,
      city = @city, province = @province, postal_code = @postal_code, country = @country,
      pudo_relevant = @pudo_relevant, pudo_locker_name = @pudo_locker_name, pudo_locker_address = @pudo_locker_address,
      pudo_locker_suburb = @pudo_locker_suburb, pudo_locker_city = @pudo_locker_city, pudo_locker_postal_code = @pudo_locker_postal_code,
      discount_pct = @discount_pct, discount_note = @discount_note, source = @source,
      email_marketing_opt_in = @email_marketing_opt_in, email_marketing_opted_in_at = @email_marketing_opted_in_at,
      email_marketing_consent_source = @email_marketing_consent_source, email_marketing_token = @email_marketing_token WHERE id = @id`,
  ).run({
    id,
    // When first/last change without an explicit name, recompose name from
    // them -- otherwise the displayed name goes stale (a manual-order
    // client update sends only firstName/lastName, and every list and
    // order-detail view renders `name`).
    name:
      data.name ??
      (data.firstName !== undefined || data.lastName !== undefined
        ? `${String(data.firstName ?? existing.firstName ?? '').trim()} ${String(data.lastName ?? existing.lastName ?? '').trim()}`.trim() || existing.name
        : existing.name),
    first_name: data.firstName ?? existing.firstName,
    last_name: data.lastName ?? existing.lastName,
    business_name: data.businessName ?? existing.businessName,
    email,
    phone: data.phone ?? existing.phone,
    whatsapp_opt_in: whatsappOptIn ? 1 : 0,
    street: data.street ?? existing.street,
    suburb: data.suburb ?? existing.suburb,
    city: data.city ?? existing.city,
    province: data.province ?? existing.province,
    postal_code: data.postalCode ?? existing.postalCode,
    country: data.country ?? existing.country,
    pudo_relevant: (data.pudoRelevant !== undefined ? Boolean(data.pudoRelevant) : existing.pudoRelevant) ? 1 : 0,
    pudo_locker_name: data.pudoLockerName ?? existing.pudoLockerName,
    pudo_locker_address: data.pudoLockerAddress ?? existing.pudoLockerAddress,
    pudo_locker_suburb: data.pudoLockerSuburb ?? existing.pudoLockerSuburb,
    pudo_locker_city: data.pudoLockerCity ?? existing.pudoLockerCity,
    pudo_locker_postal_code: data.pudoLockerPostalCode ?? existing.pudoLockerPostalCode,
    discount_pct: data.discountPct !== undefined ? Number(data.discountPct) || 0 : existing.discountPct,
    discount_note: data.discountNote ?? existing.discountNote,
    source: data.source ?? existing.source,
    email_marketing_opt_in: emailMarketingOptIn ? 1 : 0,
    email_marketing_opted_in_at: emailMarketingOptIn ? (consentChanged ? new Date().toISOString() : existing.emailMarketingOptedInAt) : null,
    email_marketing_consent_source: emailMarketingOptIn ? emailMarketingConsentSource : '',
    email_marketing_token: emailMarketingOptIn ? (consentChanged || !existingMarketingToken ? randomBytes(32).toString('hex') : existingMarketingToken) : null,
  });
  return getClient(id, db);
}

// Fields worth comparing to decide whether a matched client record is
// actually stale -- deliberately excludes name (that's the match key
// itself in the by-name path) and marketing-consent fields (those have
// their own opt-in semantics, not a "did the customer's info change" one).
const RECONCILE_FIELDS = ['email', 'businessName', 'phone', 'street', 'suburb', 'city', 'province', 'postalCode'];

function clientDataDiffers(existing, data) {
  return RECONCILE_FIELDS.some((key) => {
    if (data[key] === undefined) return false;
    return String(data[key] || '').trim().toLowerCase() !== String(existing[key] || '').trim().toLowerCase();
  });
}

// Checkout entry point (B.3): matches an existing client and reuses it (an
// exact email match first -- the strongest signal, since email is also the
// account login -- and only when that fails, an exact first+last name
// match against a *single* existing client, so two different customers who
// happen to share a name are never silently merged), or creates a new one.
// A match whose other details (phone/address/business name/a changed
// email under the same name) no longer agree with what's on file gets
// updated in place, flagged via the transient client._dataUpdated (see
// orders.js's matching _lowStock convention) so the checkout route can
// surface a brief "Updating Client Data" notice rather than silently
// overwriting what's on file. Everything below runs inside one transaction
// so the code-generation SELECT MAX + INSERT in insertClient can't race
// with a concurrent checkout picking the same next client_code.
export function findOrCreateClientForCheckout(data, db = getDb(), { requireEmail = true } = {}) {
  const email = String(data.email || '').trim();
  // Online checkout keeps email mandatory (invoices/confirmations need it);
  // createManualOrder passes requireEmail: false for walk-in customers.
  // findClientByEmail already refuses empty lookups, so a no-email client
  // can only ever be matched by the exact first+last name fallback below.
  if (!email && requireEmail) throw new Error('Email is required');
  const tx = db.transaction((d) => {
    let existing = findClientByEmail(email, db);
    if (!existing) {
      const firstName = String(d.firstName || '').trim();
      const lastName = String(d.lastName || '').trim();
      if (firstName && lastName) {
        const nameMatches = db
          .prepare('SELECT * FROM clients WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)')
          .all(firstName, lastName);
        if (nameMatches.length === 1) existing = rowToClient(nameMatches[0]);
      }
    }
    if (!existing) return insertClient(db, d);
    const updated = clientDataDiffers(existing, d) ? updateClient(existing.id, d, db) : existing;
    updated._dataUpdated = updated !== existing;
    return updated;
  });
  return tx(data);
}

export function listOrdersForClient(clientId, db = getDb()) {
  return db.prepare('SELECT id, invoice_number, status, total, created_at, tracking_number FROM orders WHERE client_id = ? ORDER BY created_at DESC').all(clientId);
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
  if (row.disabled) return { ok: false, reason: 'disabled' };
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

// Registered Users' "Disable"/"Enable" toggle -- distinct from
// deleteOrRevokeClient: reversible, and blocks login (loginClient checks
// this before the verified check) without touching password_hash, order
// history, or the account record itself. Requires an existing account,
// same guard deleteOrRevokeClient's callers rely on elsewhere.
export function setClientDisabled(id, disabled, db = getDb()) {
  const row = getClientRow(id, db);
  if (!row) return null;
  db.prepare('UPDATE clients SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  return getClient(id, db);
}

// Admin override for a customer who never got/clicked the verification
// email -- skips the token entirely rather than faking one, since there's
// no real link being confirmed here.
export function manuallyVerifyClient(id, db = getDb()) {
  const row = getClientRow(id, db);
  if (!row) return null;
  if (!row.password_hash) throw new Error('This client has no account to verify');
  db.prepare(
    'UPDATE clients SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
  ).run(id);
  return getClient(id, db);
}

// Issues a fresh token (old one, if any, is overwritten) for the admin
// "resend verification email" action -- separate from registerClient's
// inline token generation since this fires for an already-existing account,
// not a new signup.
export function regenerateVerificationToken(id, db = getDb()) {
  const row = getClientRow(id, db);
  if (!row) return null;
  if (!row.password_hash) throw new Error('This client has no account to verify');
  if (row.email_verified) throw new Error('This client is already verified');
  const token = newVerificationToken();
  const tokenExpires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE clients SET verification_token = ?, verification_token_expires = ? WHERE id = ?').run(
    token,
    tokenExpires,
    id,
  );
  return { client: getClient(id, db), token };
}

// Issues a reset token for an existing registered account. Returns null for
// an unknown email or a guest-only row (no password_hash) -- caller must not
// let that distinguish the two cases in the HTTP response/email sent, so an
// attacker can't use "forgot password" to discover which emails have
// accounts. Deliberately doesn't check email_verified: receiving this email
// is itself proof of ownership, same strength as the verification link, so
// it's also how someone who never finished verifying gets unstuck.
export function requestPasswordReset(email, db = getDb()) {
  const row = db.prepare('SELECT * FROM clients WHERE LOWER(email) = LOWER(?)').get(String(email || '').trim());
  if (!row || !row.password_hash) return null;
  const token = randomBytes(32).toString('hex');
  const tokenExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE clients SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, tokenExpires, row.id);
  return { client: getClient(row.id, db), token };
}

// Returns the updated client on success, or null if the token is missing,
// unknown, or expired. Also marks the account verified -- clicking a link
// mailed to that address is proof of ownership either way.
export function resetClientPassword(token, newPassword, db = getDb()) {
  if (!newPassword || String(newPassword).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (!token) return null;
  const row = db.prepare('SELECT * FROM clients WHERE reset_token = ?').get(token);
  if (!row) return null;
  if (!row.reset_token_expires || new Date(row.reset_token_expires).getTime() < Date.now()) {
    return null;
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare(
    'UPDATE clients SET password_hash = ?, email_verified = 1, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
  ).run(passwordHash, row.id);
  return getClient(row.id, db);
}

// A client with real order history can't be hard-deleted (orders.client_id
// is a foreign key) -- and shouldn't be, since that history is the actual
// business record. Instead this revokes just their account/login, dropping
// them back to a guest-checkout row (same shape registerClient() upgrades
// from) while a client with zero orders is removed outright.
export function deleteOrRevokeClient(id, db = getDb()) {
  const row = getClientRow(id, db);
  if (!row) return null;
  const orderCount = db.prepare('SELECT COUNT(*) c FROM orders WHERE client_id = ?').get(id).c;
  if (orderCount > 0) {
    db.prepare(
      'UPDATE clients SET password_hash = NULL, email_verified = 0, verification_token = NULL, verification_token_expires = NULL WHERE id = ?',
    ).run(id);
    return { deleted: false, revoked: true };
  }
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return { deleted: true, revoked: false };
}

// Folds a duplicate client record into another: every order and design
// request the source ever placed is reassigned to the target (so the
// target's order history becomes the merged history — the whole point of
// merging), then the now-empty source row is deleted outright. Unlike
// deleteOrRevokeClient, this never falls back to a revoke-only path,
// because the source can no longer have any order referencing it by the
// time the delete runs — the reassignment above already moved them all.
// page_views.client_id is deliberately left pointing at the old id: it's
// anonymous visit analytics, not part of anyone's order/service history,
// and reassigning it would misattribute the source's real browsing history
// to the target.
export function mergeClients(sourceId, targetId, db = getDb()) {
  if (sourceId === targetId) throw new Error('Cannot merge a client into itself');
  const source = getClientRow(sourceId, db);
  const target = getClientRow(targetId, db);
  if (!source || !target) throw new Error('Client not found');

  const tx = db.transaction(() => {
    db.prepare('UPDATE orders SET client_id = ? WHERE client_id = ?').run(targetId, sourceId);
    db.prepare('UPDATE design_requests SET client_id = ? WHERE client_id = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM clients WHERE id = ?').run(sourceId);
  });
  tx();
  return getClient(targetId, db);
}
