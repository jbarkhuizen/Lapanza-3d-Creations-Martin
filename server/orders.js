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

// Bug: the admin Invoice History / Orders list never showed a client name --
// this only ever fetched the clients map for the `q` search filter, never
// attached it to the returned rows themselves, so `order.client` was always
// undefined here (unlike getOrder(), which does attach it via a real join).
// Always building the map now, regardless of whether `q` is present, fixes
// that at the one shared source every list consumer reads from.
export function listOrders({ status, q } = {}, db = getDb()) {
  let rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all().map(rowToOrder);
  if (status) rows = rows.filter((o) => o.status === status);
  const clients = new Map(db.prepare('SELECT id, name, email, client_code FROM clients').all().map((c) => [c.id, c]));
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((o) => {
      const c = clients.get(o.clientId);
      return [o.id, c?.name, c?.email, c?.client_code].filter(Boolean).some((v) => v.toLowerCase().includes(needle));
    });
  }
  return rows.map((o) => {
    const c = clients.get(o.clientId);
    return { ...o, client: c ? { name: c.name, email: c.email, clientCode: c.client_code } : null };
  });
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

  // Fast-path check only, using the read above -- surfaces an obvious
  // out-of-stock cart before the shipping-option lookup below runs, so a
  // customer sees the actually-relevant error first. This is NOT what
  // makes concurrent overselling safe -- reserveStockForOrder inside the
  // transaction below re-reads stock fresh and is the real, authoritative
  // guard (a stock change between this line and that one, e.g. a
  // concurrent order taking the last unit, is still caught there).
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

  // Backlog #60 (SITE-026): volume price breaks on filament. Configured
  // tiers (settings.volumeDiscounts, empty by default so the feature is
  // inert until the owner sets real numbers) apply the best matching
  // percentage to the FILAMENT portion of the cart only, keyed on total
  // filament-roll quantity. Applied server-side here -- the client-side
  // cart/checkout displays are estimates mirroring this same rule.
  const filamentQty = resolved.filter((i) => String(i.productId || '').startsWith('filament:')).reduce((sum, i) => sum + i.quantity, 0);
  const filamentSubtotal = resolved.filter((i) => String(i.productId || '').startsWith('filament:')).reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tiers = (getSettings(db).volumeDiscounts || []).filter((t) => t.active !== false && Number(t.minQty) > 0 && Number(t.pct) > 0);
  const bestTier = tiers.filter((t) => filamentQty >= Number(t.minQty)).sort((a, b) => Number(b.minQty) - Number(a.minQty))[0] || null;
  const discountPct = bestTier ? Math.min(100, Number(bestTier.pct)) : 0;
  const discountAmount = bestTier ? Math.round(filamentSubtotal * (discountPct / 100)) : 0;
  const total = Math.max(0, subtotal - discountAmount + shippingPrice);

  let clientDataUpdated = false;
  const tx = db.transaction(() => {
    const client = findOrCreateClientForCheckout(clientData, db);
    clientDataUpdated = Boolean(client._dataUpdated);
    const orderId = randomUUID();
    const invoiceNumber = nextInvoiceNumber(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO orders
        (id, invoice_number, client_id, status, subtotal, discount_pct, discount_amount, shipping_option_id, shipping_price, shipping_method, total, total_weight,
         payment_method, payment_status, tracking_number, created_at, updated_at)
       VALUES
        (@id, @invoice_number, @client_id, 'pending_payment', @subtotal, @discount_pct, @discount_amount, @shipping_option_id, @shipping_price, @shipping_method, @total, @total_weight,
         @payment_method, 'pending', '', @created_at, @updated_at)`,
    ).run({
      id: orderId,
      invoice_number: invoiceNumber,
      client_id: client.id,
      subtotal,
      discount_pct: discountPct,
      discount_amount: discountAmount,
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
    const lowStock = reserveStockForOrder(getOrder(orderId, db), db);
    return { orderId, lowStock };
  });

  const { orderId, lowStock } = tx();
  const order = getOrder(orderId, db);
  order._lowStock = lowStock;
  order._clientDataUpdated = clientDataUpdated;
  return order;
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
  { client: clientData, clientId, items, shippingMethod, shippingOptionId, shippingPrice: manualShippingPrice, discountPct, paymentMethod, alreadyPaid },
  db = getDb(),
) {
  if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Invalid payment method');
  if (shippingMethod != null && !ALLOWED_SHIPPING_METHODS.includes(shippingMethod)) throw new Error('Invalid shipping method');
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

  // Defaults preserve the old (pre-shippingMethod) behavior for any caller
  // that doesn't send one: a shippingOptionId implied 'fixed', nothing at
  // all implied 'courier'. A caller that does send shippingMethod (the New
  // Order UI, matching checkout's own vocabulary) gets the real method
  // stored, and own_courier/collect are always free -- same as online
  // checkout, regardless of any shippingOptionId/manual price also sent.
  const resolvedShippingMethod = shippingMethod || (shippingOptionId ? 'fixed' : 'courier');
  let shippingOption = null;
  let shippingPrice = 0;
  if (resolvedShippingMethod === 'own_courier' || resolvedShippingMethod === 'collect') {
    shippingOption = null;
    shippingPrice = 0;
  } else if (shippingOptionId) {
    shippingOption = getShippingOption(shippingOptionId, db);
    if (!shippingOption) throw new Error('Shipping option not found');
    shippingPrice = shippingOption.price;
  } else if (manualShippingPrice != null) {
    // Admin override -- e.g. courier picked but no matching weight bracket,
    // or a one-off delivery price agreed with the customer.
    shippingPrice = Math.max(0, Math.round(Number(manualShippingPrice) || 0));
  }

  const discountPctClamped = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const discountAmount = Math.round(subtotal * (discountPctClamped / 100));
  const total = Math.max(0, subtotal - discountAmount + shippingPrice);

  let clientDataUpdated = false;
  const tx = db.transaction(() => {
    const client = clientId ? getClient(clientId, db) : findOrCreateClientForCheckout(clientData, db);
    if (!client) throw new Error('Client not found');
    clientDataUpdated = Boolean(client._dataUpdated);
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
         @shipping_method, @total, @total_weight, @payment_method, @payment_status, '', @created_at, @updated_at)`,
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
      shipping_method: resolvedShippingMethod,
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
    // Reserved immediately regardless of alreadyPaid -- same reasoning as
    // online checkout's reserveStockForOrder, just without the hard block:
    // an admin entering a walk-in/WhatsApp sale is trusted, same as the
    // free-text line items/prices this function already accepts as-is.
    const lowStock = decrementStockForOrder(getOrder(orderId, db), db);
    return { orderId, lowStock };
  });

  const { orderId, lowStock } = tx();
  const order = getOrder(orderId, db);
  order._lowStock = lowStock;
  order._clientDataUpdated = clientDataUpdated;
  return order;
}

// Non-blocking decrement (floors at 0, never throws) -- used only by
// createManualOrder, where an admin's entry is trusted as-is. Online
// checkout uses the blocking reserveStockForOrder below instead.
// Filament colours live in SQLite and are decremented inside the SAME
// db.transaction() as the caller's order/order_items INSERT -- genuinely
// atomic, matches this project's better-sqlite3-is-synchronous-and-
// single-threaded concurrency model (see db.js). Category items live in
// catalog.json, a flat file that isn't part of the SQLite transaction --
// that update happens immediately after and is logged on failure, but
// doesn't roll back the order, since a manual order is real regardless of
// whether the stock file write succeeds. True cross-system atomicity isn't
// achievable with a SQLite DB and a separate JSON file as two independent
// storage backends; this mirrors the same split already accepted in
// resolveProductSnapshot.
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

// Online checkout only, called inside createOrder's transaction. This is
// what actually stops two concurrent checkouts each claiming the same last
// unit: reserving (decrementing) stock happens the instant the order
// exists, not later when it's paid -- so a second order for the same item
// re-reads stock fresh here and sees what the first one already took, not
// a stale pre-transaction read. Two-phase (validate every item first, THEN
// apply every decrement) so a multi-item order can't partially decrement
// item 1 before discovering item 3 is short -- either the whole order
// commits or none of it does, matching this function throwing inside the
// same db.transaction() the order/order_items INSERT already runs in.
function reserveStockForOrder(order, db) {
  const insufficient = [];
  const filamentRows = new Map(); // productId -> fresh row, so phase 2 skips re-querying
  const categoryEntries = new Map(); // productId -> { product, item }

  for (const item of order.items) {
    const productId = String(item.productId || '');
    if (productId.startsWith('filament:')) {
      const sku = productId.split(':').slice(2).join(':');
      const row = db.prepare('SELECT id, sku, stock_qty FROM filament_colours WHERE sku = ?').get(sku);
      if (!row) continue;
      filamentRows.set(item.productId, row);
      if (item.quantity > row.stock_qty) {
        insufficient.push({ name: item.productName, requested: item.quantity, available: row.stock_qty });
      }
    } else if (productId.startsWith('category:')) {
      const rest = productId.split(':').slice(1);
      const category = readCategoryProducts().find((c) => c.slug === rest[0]);
      const product = category && getProduct(category.id);
      const items = product?.items || [];
      const skuOrIndex = rest.slice(1).join(':');
      const catItem = skuOrIndex && items.some((i) => i.sku === skuOrIndex)
        ? items.find((i) => i.sku === skuOrIndex)
        : items[Number(skuOrIndex)];
      if (!catItem) continue;
      categoryEntries.set(item.productId, { product, item: catItem });
      const available = Number(catItem.stockQty) || 0;
      if (item.quantity > available) {
        insufficient.push({ name: item.productName, requested: item.quantity, available });
      }
    }
  }

  if (insufficient.length > 0) {
    const itemList = insufficient.map((i) => `${i.name} (requested ${i.requested}, ${i.available} available)`).join('; ');
    throw new Error(`Out of stock: ${itemList}`);
  }

  const lowStock = [];
  for (const item of order.items) {
    const row = filamentRows.get(item.productId);
    if (row) {
      const newQty = row.stock_qty - item.quantity;
      db.prepare('UPDATE filament_colours SET stock_qty = ? WHERE id = ?').run(newQty, row.id);
      if (newQty <= 1) lowStock.push({ id: row.id, name: item.productName, sku: row.sku, stockQty: newQty });
      continue;
    }
    const cat = categoryEntries.get(item.productId);
    if (cat) {
      const newQty = (Number(cat.item.stockQty) || 0) - item.quantity;
      cat.item.stockQty = newQty;
      upsertProduct(cat.product);
      if (newQty <= 1) lowStock.push({ id: cat.item.id, name: item.productName, sku: cat.item.sku, stockQty: newQty });
    }
  }
  return lowStock;
}

// Symmetric inverse of decrementStockForOrder/reserveStockForOrder -- adds
// back whatever an order's creation reserved, when that order is cancelled
// (either automatically, via cancelStalePendingOrders, or by an admin, via
// updateOrderStatus) instead of ever being fulfilled. No floor/cap needed:
// adding back exactly what was taken can't overflow past where stock
// started, regardless of which of the two functions above did the taking.
function restoreStockForOrder(order, db) {
  for (const item of order.items) {
    const productId = String(item.productId || '');
    if (productId.startsWith('filament:')) {
      const sku = productId.split(':').slice(2).join(':');
      const row = db.prepare('SELECT id, stock_qty FROM filament_colours WHERE sku = ?').get(sku);
      if (!row) continue;
      db.prepare('UPDATE filament_colours SET stock_qty = ? WHERE id = ?').run(row.stock_qty + item.quantity, row.id);
    } else if (productId.startsWith('category:')) {
      try {
        const rest = productId.split(':').slice(1);
        const category = readCategoryProducts().find((c) => c.slug === rest[0]);
        const product = category && getProduct(category.id);
        if (!product) continue;
        const items = product.items || [];
        const skuOrIndex = rest.slice(1).join(':');
        const catItem = skuOrIndex && items.some((i) => i.sku === skuOrIndex)
          ? items.find((i) => i.sku === skuOrIndex)
          : items[Number(skuOrIndex)];
        if (!catItem) continue;
        catItem.stockQty = (Number(catItem.stockQty) || 0) + item.quantity;
        upsertProduct(product);
      } catch (err) {
        console.error(`Stock restore failed for category item (order ${order.id}):`, err.message);
      }
    }
  }
}

export function updateOrderStatus(id, status, db = getDb()) {
  if (!ALLOWED_STATUSES.includes(status)) throw new Error('Invalid status');
  const order = db.transaction(() => {
    const existing = db.prepare('SELECT status FROM orders WHERE id = ?').get(id);
    if (!existing) return null;
    // Stock is reserved the instant an order is created (reserveStockForOrder
    // / decrementStockForOrder), not on this paid transition -- so paying no
    // longer touches stock at all. Only a transition INTO cancelled releases
    // it back, and only once (same idempotency reasoning the old paid-guard
    // used) so re-saving an already-cancelled order can't double-restore.
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      restoreStockForOrder(getOrder(id, db), db);
    }
    // Keep payment_status in lockstep with the workflow status for manual
    // admin transitions (Invoice History's "Pending / Payment received"
    // picker sets status through this same function) -- paid/shipped/
    // completed all imply payment has been received; pending_payment
    // implies it hasn't. 'cancelled' deliberately leaves payment_status
    // untouched: a cancelled order might have been paid or unpaid already,
    // and cancelling shouldn't assert either way.
    const now = new Date().toISOString();
    if (status === 'paid' || status === 'shipped' || status === 'completed') {
      db.prepare('UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?').run(status, 'paid', now, id);
    } else if (status === 'pending_payment') {
      db.prepare('UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?').run(status, 'pending', now, id);
    } else {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
    return getOrder(id, db);
  })();
  return order;
}

// Invoice History's "delete" action -- unlike cancellation (which keeps the
// row as a permanent record, per every other status transition in this
// file), this genuinely removes it. Only 'pending_payment' and 'paid'
// orders still have stock reserved against them (reserveStockForOrder ran
// at creation and nothing has released it yet) -- 'shipped'/'completed'
// stock has already physically left, and a 'cancelled' order already had
// its stock restored by whichever cancellation path got it there, so
// restoring again here would overcount. No confirmation/undo at this layer
// -- that's the caller's (admin.js) job, same as every other destructive
// action in this codebase.
export function deleteOrder(id, db = getDb()) {
  const order = getOrder(id, db);
  if (!order) return false;
  const tx = db.transaction(() => {
    if (order.status === 'pending_payment' || order.status === 'paid') {
      restoreStockForOrder(order, db);
    }
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    db.prepare('DELETE FROM payment_transactions WHERE order_id = ?').run(id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  });
  tx();
  return true;
}

export function updateOrderTracking(id, trackingNumber, db = getDb()) {
  const result = db
    .prepare('UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?')
    .run(trackingNumber || '', new Date().toISOString(), id);
  if (result.changes === 0) return null;
  return getOrder(id, db);
}

// lowStock is always [] now -- kept in the return shape so callers (the
// Payfast ITN handler) don't need changing. Stock was already reserved
// when the order was created; paying doesn't touch it.
export function markOrderPaid(id, db = getDb()) {
  return db.transaction(() => {
    const result = db
      .prepare("UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = ? WHERE id = ? AND status = 'pending_payment'")
      .run(new Date().toISOString(), id);
    return { changed: result.changes > 0, lowStock: [] };
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
// Releases each order's reserved stock back via restoreStockForOrder --
// otherwise an abandoned/failed checkout would permanently lock up
// whatever it reserved at creation, never coming back for sale.
// Returns the cancelled orders themselves (not just a count) so the caller
// (jobs.js's auto-cancel job) can send an owner-notification email for each
// one -- those email calls must happen after this transaction-per-order
// commits, never inside it (better-sqlite3 transactions are synchronous).
export function cancelStalePendingOrders(olderThanMs, db = getDb()) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stale = db.prepare("SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < ?").all(cutoff);
  const cancelOne = db.transaction((orderId) => {
    const order = getOrder(orderId, db);
    if (!order || order.status !== 'pending_payment') return null;
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?").run(new Date().toISOString(), orderId);
    restoreStockForOrder(order, db);
    return order;
  });
  const cancelled = [];
  for (const row of stale) {
    const order = cancelOne(row.id);
    if (order) cancelled.push(order);
  }
  return cancelled;
}

// Client self-service cancel -- deliberately narrower than the admin
// updateOrderStatus route: enforces both ownership (returns null for a
// missing order OR one that belongs to a different client -- same response
// either way, so this can't be used to probe which order ids exist) and
// status (only reachable from pending_payment, the same restriction
// cancelStalePendingOrders enforces automatically for the timed job).
export function cancelOrderByClient(orderId, clientId, db = getDb()) {
  const order = getOrder(orderId, db);
  if (!order || order.clientId !== clientId) return null;
  if (order.status !== 'pending_payment') {
    throw new Error('Only orders awaiting payment can be cancelled');
  }
  return updateOrderStatus(orderId, 'cancelled', db);
}
