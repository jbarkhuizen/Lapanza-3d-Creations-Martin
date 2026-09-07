import { randomUUID } from 'crypto';
import { getDb } from './db.js';

// Owner request (2026-09-07): the Expenses module -- capture business spend
// (printer purchases, consumables, filament buys) as supplier invoices with
// line items, then read it back against order income on the Financial
// Overview. Replaces the flat Purchase History page: its rows are migrated
// into one-line expense invoices on boot (see migratePurchasesToExpenses).
//
// Money is stored as REAL rand with cents (unlike catalog prices, which are
// integer rand by convention): supplier invoices carry cents, and the
// overview must reconcile against real card statements.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function rowToExpense(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplier: row.supplier,
    purchaseDate: row.purchase_date,
    paymentMethod: row.payment_method,
    notes: row.notes,
    total: row.total,
    sourcePurchaseId: row.source_purchase_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    expenseId: row.expense_id,
    description: row.description,
    category: row.category,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: round2(row.quantity * row.unit_price),
  };
}

// Items are validated + normalized once here for both create and update.
// Category is free text from the admin's configurable list -- an empty one
// is allowed (shows as Uncategorised) so migrated Purchase History rows and
// quick captures never block on classification.
function normalizeItems(items) {
  const list = (Array.isArray(items) ? items : [])
    .map((i) => ({
      description: cleanText(i.description, 300),
      category: cleanText(i.category, 100),
      quantity: Math.max(0.01, round2(i.quantity ?? 1)),
      unitPrice: Math.max(0, round2(i.unitPrice)),
    }))
    .filter((i) => i.description);
  if (!list.length) throw new Error('An expense needs at least one line item with a description');
  return list;
}

function insertItems(db, expenseId, items) {
  const stmt = db.prepare(
    'INSERT INTO expense_items (id, expense_id, description, category, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of items) stmt.run(randomUUID(), expenseId, item.description, item.category, item.quantity, item.unitPrice);
}

export function getExpense(id, db = getDb()) {
  const expense = rowToExpense(db.prepare('SELECT * FROM expense_invoices WHERE id = ?').get(id));
  if (!expense) return null;
  expense.items = db.prepare('SELECT * FROM expense_items WHERE expense_id = ? ORDER BY rowid').all(id).map(rowToItem);
  return expense;
}

export function listExpenses({ q, category, from, to } = {}, db = getDb()) {
  let expenses = db.prepare('SELECT * FROM expense_invoices ORDER BY purchase_date DESC, created_at DESC').all().map(rowToExpense);
  const itemsByExpense = new Map();
  db.prepare('SELECT * FROM expense_items ORDER BY rowid').all().forEach((row) => {
    const list = itemsByExpense.get(row.expense_id) || [];
    list.push(rowToItem(row));
    itemsByExpense.set(row.expense_id, list);
  });
  expenses.forEach((e) => { e.items = itemsByExpense.get(e.id) || []; });
  if (from) expenses = expenses.filter((e) => (e.purchaseDate || '') >= from);
  if (to) expenses = expenses.filter((e) => (e.purchaseDate || '') <= `${to}~`); // '~' sorts after any date suffix
  if (category) expenses = expenses.filter((e) => e.items.some((i) => i.category === category));
  if (q) {
    const needle = String(q).toLowerCase();
    expenses = expenses.filter((e) =>
      [e.supplier, e.paymentMethod, e.notes, ...e.items.map((i) => `${i.description} ${i.category}`)]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(needle)),
    );
  }
  return expenses;
}

export function createExpense(data, db = getDb()) {
  const supplier = cleanText(data.supplier, 200);
  if (!supplier) throw new Error('Service provider / supplier is required');
  const items = normalizeItems(data.items);
  const total = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const id = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO expense_invoices (id, supplier, purchase_date, payment_method, notes, total, source_purchase_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      supplier,
      cleanText(data.purchaseDate, 30) || now.slice(0, 10),
      cleanText(data.paymentMethod, 100),
      cleanText(data.notes, 1000),
      total,
      data.sourcePurchaseId || null,
      now,
      now,
    );
    insertItems(db, id, items);
  });
  tx();
  return getExpense(id, db);
}

// Items are replaced wholesale -- the edit form always submits the full
// line list, and partial line patching buys nothing but bug surface.
export function updateExpense(id, data, db = getDb()) {
  const existing = getExpense(id, db);
  if (!existing) return null;
  const items = normalizeItems(data.items ?? existing.items);
  const total = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE expense_invoices SET supplier = ?, purchase_date = ?, payment_method = ?, notes = ?, total = ?, updated_at = ? WHERE id = ?`,
    ).run(
      cleanText(data.supplier ?? existing.supplier, 200) || existing.supplier,
      cleanText(data.purchaseDate ?? existing.purchaseDate, 30),
      cleanText(data.paymentMethod ?? existing.paymentMethod, 100),
      cleanText(data.notes ?? existing.notes, 1000),
      total,
      new Date().toISOString(),
      id,
    );
    db.prepare('DELETE FROM expense_items WHERE expense_id = ?').run(id);
    insertItems(db, id, items);
  });
  tx();
  return getExpense(id, db);
}

export function deleteExpense(id, db = getDb()) {
  return db.prepare('DELETE FROM expense_invoices WHERE id = ?').run(id).changes > 0;
}

// One-time (but idempotent, re-run safe) migration of the old flat
// Purchase History rows into one-line expense invoices. source_purchase_id
// marks rows already migrated, so re-running on every boot never
// duplicates. The purchases table itself is left untouched as a safety
// copy -- only its admin page and API routes are retired.
export function migratePurchasesToExpenses(db = getDb()) {
  const hasPurchases = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='purchases'")
    .get().n > 0;
  if (!hasPurchases) return 0;
  const pending = db.prepare(
    `SELECT p.* FROM purchases p
     WHERE NOT EXISTS (SELECT 1 FROM expense_invoices e WHERE e.source_purchase_id = p.id)`,
  ).all();
  for (const p of pending) {
    createExpense(
      {
        supplier: p.supplier || 'Unknown supplier',
        purchaseDate: (p.purchase_date || p.created_at || '').slice(0, 10),
        paymentMethod: p.payment_type || '',
        notes: p.status === 'outstanding' ? 'Migrated from Purchase History (was marked outstanding)' : 'Migrated from Purchase History',
        items: [{ description: p.goods || 'Purchase', category: '', quantity: 1, unitPrice: p.total_value }],
        sourcePurchaseId: p.id,
      },
      db,
    );
  }
  return pending.length;
}

// ---- Financial Overview ----
// Income = money actually received: orders whose payment_status is 'paid'
// (owner decision 2026-09-07 -- pending EFTs are excluded until paid, and
// cancelled orders never count). Order date (created_at) is the bucket key;
// expenses bucket on purchase_date. SA tax year runs 1 March -> end of
// February.

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function taxYearRange(startYear) {
  return { from: `${startYear}-03-01`, to: `${startYear + 1}-02-29`, label: `${startYear}/${String(startYear + 1).slice(2)}` };
}

export function getFinancialOverview({ months = 12 } = {}, db = getDb()) {
  const paidOrders = db
    .prepare("SELECT total, created_at FROM orders WHERE payment_status = 'paid' AND status != 'cancelled'")
    .all();
  const expenses = listExpenses({}, db);

  // Monthly income-vs-expenses series, oldest first, zero-filled.
  const series = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    series.push({ month: d.toISOString().slice(0, 7), income: 0, expenses: 0, net: 0 });
  }
  const byMonth = new Map(series.map((s) => [s.month, s]));
  for (const o of paidOrders) {
    const bucket = byMonth.get(monthKey(o.created_at));
    if (bucket) bucket.income = round2(bucket.income + o.total);
  }
  for (const e of expenses) {
    const bucket = byMonth.get(monthKey(e.purchaseDate));
    if (bucket) bucket.expenses = round2(bucket.expenses + e.total);
  }
  series.forEach((s) => { s.net = round2(s.income - s.expenses); });

  const windowFrom = series[0]?.month ? `${series[0].month}-01` : '';

  // Category + payment-method breakdowns over the same window.
  const categories = new Map();
  const paymentMethods = new Map();
  for (const e of expenses) {
    if ((e.purchaseDate || '') < windowFrom) continue;
    const method = e.paymentMethod || 'Unspecified';
    paymentMethods.set(method, round2((paymentMethods.get(method) || 0) + e.total));
    for (const item of e.items) {
      const cat = item.category || 'Uncategorised';
      categories.set(cat, round2((categories.get(cat) || 0) + item.lineTotal));
    }
  }

  // Current + previous SA tax year summaries.
  const currentStartYear = now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const taxYears = [currentStartYear, currentStartYear - 1].map((startYear) => {
    const range = taxYearRange(startYear);
    const income = round2(
      paidOrders.filter((o) => o.created_at.slice(0, 10) >= range.from && o.created_at.slice(0, 10) <= range.to).reduce((s, o) => s + o.total, 0),
    );
    const spend = round2(
      expenses.filter((e) => (e.purchaseDate || '') >= range.from && (e.purchaseDate || '') <= range.to).reduce((s, e) => s + e.total, 0),
    );
    return { ...range, income, expenses: spend, net: round2(income - spend) };
  });

  return {
    months: series,
    categories: [...categories.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
    paymentMethods: [...paymentMethods.entries()].map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total),
    taxYears,
  };
}
