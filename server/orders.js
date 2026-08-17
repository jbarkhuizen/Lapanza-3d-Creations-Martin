import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { findOrCreateClientForCheckout, getClient } from './clients.js';
import { matchShippingForWeight, getShippingOption } from './shipping.js';
import { readCategoryProducts } from './export.js';

// 'cancelled' is reachable two ways: automatically (see cancelStalePendingOrders
// below) and now also as an explicit admin action (updateOrderStatus) --
// per user instruction this reverses the original "automatic-only" design.
const ALLOWED_STATUSES = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled'];
const ALLOWED_PAYMENT_METHODS = ['payfast_card', 'payfast_eft', 'manual_eft', 'cash_on_collection'];
const ALLOWED_SHIPPING_METHODS = ['courier', 'own_courier', 'collect'];

function parseRand(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Never trust client-submitted price/weight for a payment amount -- a
// checkout POST could be hand-crafted to claim any price. Every cart line
// is re-resolved here against the current authoritative source (SQLite for
// filament colours, catalog.json for category items) using only the
// productId, which encodes which system + lookup key to use (see the
// `filament:{slug}:{sku}` / `category:{slug}:{sku-or-index}` format
// generate-pages.mjs writes into each Add to Cart button's data-product-id).
export function resolveProductSnapshot(productId, db = getDb()) {
  const raw = String(productId || '');
  if (raw.startsWith('filament:')) {
    const sku = raw.split(':').slice(2).join(':');
    // sku is UNIQUE across all filament_colours (DB constraint), so it alone
    // is enough to look up the authoritative row -- the slug segment in
    // productId is only there for display/debugging.
    const row = db
      .prepare(
        `SELECT fc.*, ft.name AS filament_name FROM filament_colours fc
         JOIN filament_types ft ON ft.id = fc.filament_type_id
         WHERE fc.sku = ?`,
      )
      .get(sku);
    if (!row) return null;
    return {
      productId,
      name: `${row.filament_name} — ${row.name}`,
      price: row.price_rand,
      // Shipping weight, not the item's own weight_g -- see db.js's
      // ensureCheckoutColumns comment for why these are separate.
      weight: row.shipping_weight_g ?? row.weight_g,
    };
  }
  if (raw.startsWith('category:')) {
    const rest = raw.split(':').slice(1);
    const slug = rest[0];
    const skuOrIndex = rest.slice(1).join(':');
    const category = readCategoryProducts().find((c) => c.slug === slug);
    if (!category) return null;
    const items = category.items || [];
    const item = skuOrIndex && items.some((i) => i.sku === skuOrIndex)
      ? items.find((i) => i.sku === skuOrIndex)
      : items[Number(skuOrIndex)];
    if (!item || item.available === false) return null;
    return {
      productId,
      name: item.name || category.name,
      price: parseRand(item.price),
      weight: Number(item.shippingWeight ?? item.weight) || 0,
    };
  }
  return null;
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    subtotal: row.subtotal,
    shippingOptionId: row.shipping_option_id,
    shippingPrice: row.shipping_price,
    shippingMethod: row.shipping_method,
    total: row.total,
    totalWeight: row.total_weight,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    trackingNumber: row.tracking_number,
    confirmationEmailSentAt: row.confirmation_email_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    price: row.price,
    quantity: row.quantity,
    weight: row.weight,
  };
}

export function getOrderItems(orderId, db = getDb()) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(rowToItem);
}

export function getOrder(id, db = getDb()) {
  const order = rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  if (!order) return null;
  return {
    ...order,
    client: getClient(order.clientId, db),
    items: getOrderItems(id, db),
    shippingOption: order.shippingOptionId ? getShippingOption(order.shippingOptionId, db) : null,
    transactions: db.prepare('SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY created_at ASC').all(id),
  };
}

export function listOrders({ status, q } = {}, db = getDb()) {
  let rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(rowToOrder);
  if (status) rows = rows.filter((o) => o.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    const clients = new Map(db.prepare('SELECT id, name, email, client_code FROM clients').all().map((c) => [c.id, c]));
    rows = rows.filter((o) => {
      const c = clients.get(o.clientId);
      return [o.id, c?.name, c?.email, c?.client_code].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
    });
  }
  return rows;
}

// D.5/D.6: creates the client (or attaches to an existing one) and the
// order + order_items in a single transaction so a failure partway through
// (e.g. a bad shipping option) can't leave an order with no items or a
// client with no order.
export function createOrder(
  { client: clientData, items: cartItems, shippingMethod = 'courier', shippingOptionId, paymentMethod },
  db = getDb(),
) {
  if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Invalid payment method');
  if (!ALLOWED_SHIPPING_METHODS.includes(shippingMethod)) throw new Error('Invalid shipping method');
  // Cash on Collection only makes sense when the order is actually being
  // collected -- otherwise there's no point at which cash changes hands.
  if (paymentMethod === 'cash_on_collection' && shippingMethod !== 'collect') {
    throw new Error('Cash on Collection is only available when collecting from the store.');
  }
  if (!Array.isArray(cartItems) || cartItems.length === 0) throw new Error('Cart is empty');

  const resolved = cartItems.map((line) => {
    const snap = resolveProductSnapshot(line.productId, db);
    if (!snap) throw new Error(`Product no longer available: ${line.productId}`);
    const quantity = Math.max(1, Number(line.quantity) || 1);
    return { ...snap, quantity };
  });

  const totalWeight = resolved.reduce((sum, i) => sum + i.weight * i.quantity, 0);
  const subtotal = resolved.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Only the 'courier' method actually charges shipping -- own_courier and
  // collect are both R0 from us (the customer either sends their own
  // courier to fetch it, or fetches it themselves).
  let shippingOption = null;
  if (shippingMethod === 'courier') {
    shippingOption = shippingOptionId ? getShippingOption(shippingOptionId, db) : matchShippingForWeight(totalWeight, db);
    if (!shippingOption) throw new Error('No shipping option available for this order weight — contact us to arrange shipping.');
    // The client picks from options the server already matched to the
    // cart's weight, but re-verify server-side rather than trusting
    // whatever id came back in the POST body -- a forged shippingOptionId
    // could otherwise pick an unrelated (cheaper, or inactive) bracket.
    const validMatch = matchShippingForWeight(totalWeight, db);
    if (!validMatch || validMatch.id !== shippingOption.id) {
      throw new Error('Selected shipping option does not match this order\'s weight.');
    }
  }

  const shippingPrice = shippingOption?.price || 0;
  const total = subtotal + shippingPrice;

  const tx = db.transaction(() => {
    const client = findOrCreateClientForCheckout(clientData, db);
    const orderId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO orders
        (id, client_id, status, subtotal, shipping_option_id, shipping_price, shipping_method, total, total_weight,
         payment_method, payment_status, tracking_number, created_at, updated_at)
       VALUES
        (@id, @client_id, 'pending_payment', @subtotal, @shipping_option_id, @shipping_price, @shipping_method, @total, @total_weight,
         @payment_method, 'pending', '', @created_at, @updated_at)`,
    ).run({
      id: orderId,
      client_id: client.id,
      subtotal,
      shipping_option_id: shippingOption?.id || null,
      shipping_price: shippingPrice,
      shipping_method: shippingMethod,
      total,
      total_weight: totalWeight,
      payment_method: paymentMethod,
      created_at: now,
      updated_at: now,
    });
    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, price, quantity, weight)
       VALUES (@id, @order_id, @product_id, @product_name, @price, @quantity, @weight)`,
    );
    for (const item of resolved) {
      insertItem.run({
        id: randomUUID(),
        order_id: orderId,
        product_id: item.productId,
        product_name: item.name,
        price: item.price,
        quantity: item.quantity,
        weight: item.weight,
      });
    }
    return orderId;
  });

  const orderId = tx();
  return getOrder(orderId, db);
}

// F.2: forward-only lifecycle, deliberately excludes 'cancelled' -- that
// transition is automatic-only (see jobs.js), never admin-triggered.
export function updateOrderStatus(id, status, db = getDb()) {
  if (!ALLOWED_STATUSES.includes(status)) throw new Error('Invalid status');
  const result = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  if (result.changes === 0) return null;
  return getOrder(id, db);
}

export function updateOrderTracking(id, trackingNumber, db = getDb()) {
  const result = db
    .prepare('UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?')
    .run(trackingNumber || '', new Date().toISOString(), id);
  if (result.changes === 0) return null;
  return getOrder(id, db);
}

export function markOrderPaid(id, db = getDb()) {
  const result = db
    .prepare("UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = ? WHERE id = ? AND status = 'pending_payment'")
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function markConfirmationEmailSent(id, db = getDb()) {
  db.prepare('UPDATE orders SET confirmation_email_sent_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

// E.3: idempotent by design -- (gateway, gateway_reference, status) has a
// UNIQUE index (see db.js), so a duplicate ITN for a reference already
// recorded at that exact status is silently ignored instead of inserting a
// second row. A *new* status for the same reference (e.g. a correction)
// still gets its own row, which is the desired audit trail.
export function recordPaymentTransaction({ orderId, gateway, gatewayReference, rawPayload, status }, db = getDb()) {
  try {
    db.prepare(
      `INSERT INTO payment_transactions (id, order_id, gateway, gateway_reference, raw_payload, status, created_at)
       VALUES (@id, @order_id, @gateway, @gateway_reference, @raw_payload, @status, @created_at)`,
    ).run({
      id: randomUUID(),
      order_id: orderId,
      gateway,
      gateway_reference: gatewayReference || null,
      raw_payload: rawPayload || '{}',
      status,
      created_at: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    if (/UNIQUE constraint failed/.test(err.message || '')) return false; // duplicate ITN, already recorded
    throw err;
  }
}

// G: only ever moves pending_payment -> cancelled, never touches paid/
// shipped/completed, and performs no gateway calls (no refund logic).
export function cancelStalePendingOrders(olderThanMs, db = getDb()) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stale = db.prepare("SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < ?").all(cutoff);
  const cancel = db.prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending_payment'");
  const now = new Date().toISOString();
  let count = 0;
  for (const row of stale) {
    const result = cancel.run(now, row.id);
    count += result.changes;
  }
  return count;
}
