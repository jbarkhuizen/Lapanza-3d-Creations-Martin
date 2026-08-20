import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { findOrCreateClientForCheckout, getClient } from './clients.js';
import { matchShippingForWeight, getShippingOption } from './shipping.js';
import { readCategoryProducts } from './export.js';
import { getProduct, upsertProduct } from './store.js';
import { getSettings } from './settings.js';

// 'cancelled' is reachable two ways: automatically (see cancelStalePendingOrders
// below) and now also as an explicit admin action (updateOrderStatus) --
// per user instruction this reverses the original "automatic-only" design.
const ALLOWED_STATUSES = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled'];
const ALLOWED_PAYMENT_METHODS = ['payfast_card', 'payfast_eft', 'manual_eft', 'cash_on_collection'];
// 'fixed' (Phase 3): a named flat-price shipping_options row (option_type =
// 'fixed' -- PUDO lockers, local delivery zones) picked directly rather than
// weight-bracket-matched. Available to both online checkout and manual orders.
const ALLOWED_SHIPPING_METHODS = ['courier', 'own_courier', 'collect', 'fixed'];

// Phase 3: mirrors clients.js's nextClientCode() exactly -- MAX(CAST(SUBSTR(...)))
// scoped to callers already inside the same db.transaction() as the INSERT,
// so it can't race with a concurrent order under this project's synchronous
// single-connection SQLite model. 4-digit padding (INV-0001) matches the
// spreadsheet's existing format. This is a fresh, independent counter -- it
// does NOT know the spreadsheet already has invoices up to INV-0009, so the
// starting point is seeded from Settings (`invoiceNumberSeed`, default in
// settings-defaults.js) rather than hardcoded 1, letting the number continue
// from wherever the spreadsheet's real sequence actually left off.
function nextInvoiceNumber(db) {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(invoice_number, 5) AS INTEGER)) AS maxNum FROM orders WHERE invoice_number IS NOT NULL").get();
  if (row.maxNum) return `INV-${String(row.maxNum + 1).padStart(4, '0')}`;
  const seed = Number(getSettings(db).invoiceNumberSeed) || 1;
  return `INV-${String(seed).padStart(4, '0')}`;
}

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
      stockQty: row.stock_qty || 0,
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
      stockQty: Number(item.stockQty) || 0,
    };
  }
  return null;
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    clientId: row.client_id,
    status: row.status,
    subtotal: row.subtotal,
    discountPct: row.discount_pct,
    discountAmount: row.discount_amount,
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

  // Stock validation: block checkout if any item is out of stock
  const outOfStock = resolved.filter((item) => item.quantity > item.stockQty);
  if (outOfStock.length > 0) {
    const itemList = outOfStock.map((item) => `${item.name} (requested ${item.quantity}, ${item.stockQty} available)`).join('; ');
    throw new Error(`Out of stock: ${itemList}`);
  }

  const totalWeight = resolved.reduce((sum, i) => sum + i.weight * i.quantity, 0);
  const subtotal = resolved.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // 'courier' and 'fixed' both charge shipping -- own_courier and collect
  // are both R0 from us (the customer either sends their own courier to
  // fetch it, or fetches it themselves).
  let shippingOption = null;
  if (shippingMethod === 'fixed') {
    // Phase 3: a named flat-price option (PUDO locker, local delivery) --
    // price comes from the option itself, not weight-matched, but still
    // re-read from the DB server-side (never trust a client-submitted
    // price) and must actually be an active 'fixed' option.
    shippingOption = shippingOptionId ? getShippingOption(shippingOptionId, db) : null;
    if (!shippingOption || shippingOption.optionType !== 'fixed' || !shippingOption.active) {
      throw new Error('Selected shipping option is not available.');
    }
  } else if (shippingMethod === 'courier') {
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
    const invoiceNumber = nextInvoiceNumber(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO orders
        (id, invoice_number, client_id, status, subtotal, shipping_option_id, shipping_price, shipping_method, total, total_weight,
         payment_method, payment_status, tracking_number, created_at, updated_at)
       VALUES
        (@id, @invoice_number, @client_id, 'pending_payment', @subtotal, @shipping_option_id, @shipping_price, @shipping_method, @total, @total_weight,
         @payment_method, 'pending', '', @created_at, @updated_at)`,
    ).run({
      id: orderId,
      invoice_number: invoiceNumber,
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

// Phase 3: admin-only order creation for walk-in/WhatsApp/manual sales that
// never go through online checkout. Deliberately a separate function from
// createOrder() rather than a branch inside it -- the trust model is
// different (an authenticated admin's free-text line items and prices are
// trusted as-is, unlike online checkout's resolveProductSnapshot re-pricing
// of every line against the catalog) and mixing the two would make both
// harder to reason about. Still shares nextInvoiceNumber/getOrder/
// decrementStockForOrder so every order -- online or manual -- gets a real
// invoice number and the same stock-decrement behavior once paid.
export function createManualOrder(
  { client: clientData, clientId, items, shippingOptionId, shippingPrice: manualShippingPrice, discountPct, paymentMethod, alreadyPaid },
  db = getDb(),
) {
  if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Invalid payment method');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Order must have at least one item');

  const resolved = items.map((line) => {
    if (line.productId) {
      const snap = resolveProductSnapshot(line.productId, db);
      if (!snap) throw new Error(`Product no longer available: ${line.productId}`);
      const quantity = Math.max(1, Number(line.quantity) || 1);
      return { productId: line.productId, name: snap.name, price: snap.price, weight: snap.weight, quantity };
    }
    // Free-text line (a one-off custom job not in the catalog) -- price is
    // admin-entered and trusted as-is. No stock is tracked for these: the
    // synthetic `manual:` productId has no filament:/category: prefix, so
    // decrementStockForOrder's prefix checks skip it entirely.
    const description = String(line.description || '').trim();
    if (!description) throw new Error('Each line item needs either a product or a description');
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const price = Math.max(0, Math.round(Number(line.unitPrice) || 0));
    return { productId: `manual:${randomUUID()}`, name: description, price, weight: 0, quantity };
  });

  const subtotal = resolved.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const totalWeight = resolved.reduce((sum, i) => sum + i.weight * i.quantity, 0);

  let shippingOption = null;
  let shippingPrice = 0;
  if (shippingOptionId) {
    shippingOption = getShippingOption(shippingOptionId, db);
    if (!shippingOption) throw new Error('Shipping option not found');
    shippingPrice = shippingOption.price;
  } else if (manualShippingPrice != null) {
    shippingPrice = Math.max(0, Math.round(Number(manualShippingPrice) || 0));
  }

  const discountPctClamped = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const discountAmount = Math.round(subtotal * (discountPctClamped / 100));
  const total = Math.max(0, subtotal - discountAmount + shippingPrice);

  const tx = db.transaction(() => {
    const client = clientId ? getClient(clientId, db) : findOrCreateClientForCheckout(clientData, db);
    if (!client) throw new Error('Client not found');
    const orderId = randomUUID();
    const invoiceNumber = nextInvoiceNumber(db);
    const now = new Date().toISOString();
    const status = alreadyPaid ? 'paid' : 'pending_payment';
    const paymentStatus = alreadyPaid ? 'paid' : 'pending';
    db.prepare(
      `INSERT INTO orders
        (id, invoice_number, client_id, status, subtotal, discount_pct, discount_amount, shipping_option_id, shipping_price,
         shipping_method, total, total_weight, payment_method, payment_status, tracking_number, created_at, updated_at)
       VALUES
        (@id, @invoice_number, @client_id, @status, @subtotal, @discount_pct, @discount_amount, @shipping_option_id, @shipping_price,
         'fixed', @total, @total_weight, @payment_method, @payment_status, '', @created_at, @updated_at)`,
    ).run({
      id: orderId,
      invoice_number: invoiceNumber,
      client_id: client.id,
      status,
      subtotal,
      discount_pct: discountPctClamped,
      discount_amount: discountAmount,
      shipping_option_id: shippingOption?.id || null,
      shipping_price: shippingPrice,
      total,
      total_weight: totalWeight,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
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
    const lowStock = alreadyPaid ? decrementStockForOrder(getOrder(orderId, db), db) : [];
    return { orderId, lowStock };
  });

  const { orderId, lowStock } = tx();
  const order = getOrder(orderId, db);
  order._lowStock = lowStock;
  return order;
}

// F.2: forward-only lifecycle, deliberately excludes 'cancelled' -- that
// transition is automatic-only (see jobs.js), never admin-triggered.
// #3: decrements stock for every line item when an order is confirmed paid.
// Filament colours live in SQLite and are decremented inside the SAME
// db.transaction() as the status flip -- genuinely atomic, matches this
// project's better-sqlite3-is-synchronous-and-single-threaded concurrency
// model (see db.js). Category items live in catalog.json, a flat file that
// isn't part of the SQLite transaction -- that update happens immediately
// after and is logged on failure, but doesn't roll back the payment
// confirmation, since the payment is real regardless of whether the stock
// file write succeeds. True cross-system atomicity isn't achievable with a
// SQLite DB and a separate JSON file as two independent storage backends;
// this mirrors the same split already accepted in resolveProductSnapshot.
//
// Returns the inventory rows now at <=1 stock, for the caller to alert on.
function decrementStockForOrder(order, db) {
  const lowStock = [];
  const categoryUpdates = [];

  for (const item of order.items) {
    const productId = String(item.productId || '');
    if (productId.startsWith('filament:')) {
      const sku = productId.split(':').slice(2).join(':');
      const row = db.prepare('SELECT id, sku, stock_qty FROM filament_colours WHERE sku = ?').get(sku);
      if (!row) continue;
      const newQty = Math.max(0, row.stock_qty - item.quantity);
      db.prepare('UPDATE filament_colours SET stock_qty = ? WHERE id = ?').run(newQty, row.id);
      if (newQty <= 1) lowStock.push({ id: row.id, name: item.productName, sku: row.sku, stockQty: newQty });
    } else if (productId.startsWith('category:')) {
      const rest = productId.split(':').slice(1);
      categoryUpdates.push({ slug: rest[0], skuOrIndex: rest.slice(1).join(':'), quantity: item.quantity, productName: item.productName });
    }
  }

  for (const update of categoryUpdates) {
    try {
      const category = readCategoryProducts().find((c) => c.slug === update.slug);
      const product = category && getProduct(category.id);
      if (!product) continue;
      const items = product.items || [];
      const item = update.skuOrIndex && items.some((i) => i.sku === update.skuOrIndex)
        ? items.find((i) => i.sku === update.skuOrIndex)
        : items[Number(update.skuOrIndex)];
      if (!item) continue;
      const newQty = Math.max(0, (Number(item.stockQty) || 0) - update.quantity);
      item.stockQty = newQty;
      upsertProduct(product);
      if (newQty <= 1) lowStock.push({ id: item.id, name: update.productName, sku: item.sku, stockQty: newQty });
    } catch (err) {
      console.error(`Stock decrement failed for category item (order ${order.id}):`, err.message);
    }
  }

  return lowStock;
}

export function updateOrderStatus(id, status, db = getDb()) {
  if (!ALLOWED_STATUSES.includes(status)) throw new Error('Invalid status');
  let lowStock = [];
  const order = db.transaction(() => {
    const existing = db.prepare('SELECT status FROM orders WHERE id = ?').get(id);
    if (!existing) return null;
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    // Only decrement on the transition INTO paid, not every time an already-
    // paid order is re-saved as paid -- otherwise toggling the admin status
    // dropdown could decrement stock repeatedly for the same order.
    if (status === 'paid' && existing.status === 'pending_payment') {
      lowStock = decrementStockForOrder(getOrder(id, db), db);
    }
    return getOrder(id, db);
  })();
  if (order) order._lowStock = lowStock;
  return order;
}

export function updateOrderTracking(id, trackingNumber, db = getDb()) {
  const result = db
    .prepare('UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?')
    .run(trackingNumber || '', new Date().toISOString(), id);
  if (result.changes === 0) return null;
  return getOrder(id, db);
}

export function markOrderPaid(id, db = getDb()) {
  return db.transaction(() => {
    const result = db
      .prepare("UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = ? WHERE id = ? AND status = 'pending_payment'")
      .run(new Date().toISOString(), id);
    if (result.changes === 0) return { changed: false, lowStock: [] };
    const lowStock = decrementStockForOrder(getOrder(id, db), db);
    return { changed: true, lowStock };
  })();
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
