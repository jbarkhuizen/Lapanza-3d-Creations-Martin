// Backlog #43 (SITE-009): back-in-stock notifications, email-only for now
// (the WhatsApp channel stays dormant until #7's Meta setup exists).
//
// Consent model: subscribing IS the consent -- a single-purpose,
// self-requested alert for one product, with a one-click unsubscribe token
// in every email, mirroring the newsletter's POPIA discipline. Deliberately
// NOT tied to email_marketing_opt_in: asking "tell me when this is back" is
// not newsletter consent, and vice versa.
//
// Notification trigger: processRestockNotifications() re-resolves every
// un-notified subscription against the live catalog (the same
// resolveProductSnapshot checkout prices with) and emails the ones whose
// product is purchasable again. It's called after every catalog publish and
// order-cancel stock restore, plus a daily safety-net job -- cheap, since
// pending subscriptions are few and each check is one indexed lookup.
import { randomUUID, randomBytes } from 'crypto';
import { getDb } from './db.js';
import { resolveProductSnapshot } from './orders.js';

function rowToSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    email: row.email,
    token: row.token,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
  };
}

export function subscribeRestock(productId, email, db = getDb()) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanProduct = String(productId || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('A valid email address is required');
  if (!cleanProduct) throw new Error('Product is required');
  // The product must at least resolve -- but being currently IN stock is
  // fine (it may sell out before the customer returns); the notification
  // logic only fires for a product that is out and comes back.
  const existing = db.prepare('SELECT * FROM restock_subscriptions WHERE product_id = ? AND email = ?').get(cleanProduct, cleanEmail);
  if (existing) {
    // Re-subscribing after an old notified alert renews intent; an
    // un-notified duplicate is a no-op rather than an error (the customer
    // clicked twice -- they're subscribed either way).
    if (existing.notified_at) {
      db.prepare('UPDATE restock_subscriptions SET notified_at = NULL, created_at = ? WHERE id = ?').run(new Date().toISOString(), existing.id);
    }
    return rowToSubscription(db.prepare('SELECT * FROM restock_subscriptions WHERE id = ?').get(existing.id));
  }
  const row = {
    id: randomUUID(),
    product_id: cleanProduct,
    email: cleanEmail,
    token: randomBytes(24).toString('hex'),
    notified_at: null,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    'INSERT INTO restock_subscriptions (id, product_id, email, token, notified_at, created_at) VALUES (@id, @product_id, @email, @token, @notified_at, @created_at)',
  ).run(row);
  return rowToSubscription(row);
}

export function unsubscribeRestock(token, db = getDb()) {
  const result = db.prepare('DELETE FROM restock_subscriptions WHERE token = ?').run(String(token || ''));
  return result.changes > 0;
}

export function listPendingRestockSubscriptions(db = getDb()) {
  return db.prepare('SELECT * FROM restock_subscriptions WHERE notified_at IS NULL ORDER BY created_at ASC').all().map(rowToSubscription);
}

// sendFn is injectable for tests (defaults wired in index.js to the real
// mailer). Marks notified_at only AFTER a successful send, so a failed SMTP
// attempt leaves the subscription pending for the next trigger/daily job.
export async function processRestockNotifications(sendFn, db = getDb()) {
  const pending = listPendingRestockSubscriptions(db);
  let sent = 0;
  for (const sub of pending) {
    const snapshot = resolveProductSnapshot(sub.productId, db);
    if (!snapshot || snapshot.stockQty <= 0) continue;
    try {
      await sendFn(sub, snapshot);
      db.prepare('UPDATE restock_subscriptions SET notified_at = ? WHERE id = ?').run(new Date().toISOString(), sub.id);
      sent += 1;
    } catch (err) {
      console.error(`restock: notification failed for ${sub.productId} -> ${sub.email}:`, err.message);
    }
  }
  return sent;
}
