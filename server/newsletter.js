import { randomUUID, randomBytes } from 'crypto';
import { getDb } from './db.js';

function rowToSubscriber(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    subscribedAt: row.subscribed_at,
    confirmedAt: row.confirmed_at,
    unsubscribedAt: row.unsubscribed_at,
  };
}

// The same token is reused for both the confirm link and the unsubscribe
// link that goes in every future newsletter send -- confirm only succeeds
// while status is 'pending', unsubscribe works from any status, so one
// token can safely serve both purposes for the subscriber's whole lifetime.
function newToken() {
  return randomBytes(32).toString('hex');
}

// Returns { subscriber, token, alreadyConfirmed }. Idempotent: re-subscribing
// an already-confirmed email is a no-op (no new email sent); a pending or
// previously-unsubscribed email gets a fresh token and a new confirmation
// email goes out.
export function subscribe(email, db = getDb()) {
  const normalized = String(email || '').trim();
  if (!normalized) throw new Error('Email is required');
  const existing = db.prepare('SELECT * FROM newsletter_subscribers WHERE LOWER(email) = LOWER(?)').get(normalized);

  if (existing && existing.status === 'confirmed') {
    return { subscriber: rowToSubscriber(existing), token: existing.token, alreadyConfirmed: true };
  }

  const token = newToken();
  if (existing) {
    db.prepare(
      "UPDATE newsletter_subscribers SET status = 'pending', token = ?, unsubscribed_at = NULL WHERE id = ?",
    ).run(token, existing.id);
    return { subscriber: rowToSubscriber(getSubscriberById(existing.id, db)), token, alreadyConfirmed: false };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO newsletter_subscribers (id, email, status, token, subscribed_at)
     VALUES (@id, @email, 'pending', @token, @subscribed_at)`,
  ).run({ id, email: normalized, token, subscribed_at: new Date().toISOString() });
  return { subscriber: rowToSubscriber(getSubscriberById(id, db)), token, alreadyConfirmed: false };
}

function getSubscriberById(id, db = getDb()) {
  return db.prepare('SELECT * FROM newsletter_subscribers WHERE id = ?').get(id);
}

export function confirm(token, db = getDb()) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM newsletter_subscribers WHERE token = ? AND status = 'pending'").get(token);
  if (!row) return null;
  db.prepare("UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id,
  );
  return rowToSubscriber(getSubscriberById(row.id, db));
}

export function unsubscribe(token, db = getDb()) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM newsletter_subscribers WHERE token = ?').get(token);
  if (!row) return null;
  db.prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id,
  );
  return rowToSubscriber(getSubscriberById(row.id, db));
}

export function unsubscribeMarketing(token, db = getDb()) {
  const subscriber = unsubscribe(token, db);
  if (subscriber) {
    db.prepare('INSERT OR IGNORE INTO newsletter_suppressions (email, reason, created_at) VALUES (?, ?, ?)')
      .run(subscriber.email, 'unsubscribe', new Date().toISOString());
    return subscriber;
  }
  const client = db.prepare('SELECT id, email FROM clients WHERE email_marketing_token = ? AND email_marketing_opt_in = 1').get(token);
  if (!client) return null;
  db.transaction(() => {
    db.prepare("UPDATE clients SET email_marketing_opt_in = 0, email_marketing_opted_in_at = NULL, email_marketing_consent_source = '', email_marketing_token = NULL WHERE id = ?").run(client.id);
    db.prepare('INSERT OR IGNORE INTO newsletter_suppressions (email, reason, created_at) VALUES (?, ?, ?)')
      .run(client.email, 'unsubscribe', new Date().toISOString());
  })();
  return { id: client.id, email: client.email };
}

export function listSubscribers({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM newsletter_subscribers WHERE status = ? ORDER BY subscribed_at DESC').all(status)
    : db.prepare('SELECT * FROM newsletter_subscribers ORDER BY subscribed_at DESC').all();
  return rows.map(rowToSubscriber);
}
