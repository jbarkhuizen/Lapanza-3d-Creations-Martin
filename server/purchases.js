import { randomUUID } from 'crypto';
import { getDb } from './db.js';

function rowToPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplier: row.supplier,
    goods: row.goods,
    totalValue: row.total_value,
    status: row.status,
    paymentType: row.payment_type,
    purchaseDate: row.purchase_date,
    createdAt: row.created_at,
  };
}

export function listPurchases({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM purchases WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM purchases ORDER BY created_at DESC').all();
  return rows.map(rowToPurchase);
}

export function getPurchase(id, db = getDb()) {
  return rowToPurchase(db.prepare('SELECT * FROM purchases WHERE id = ?').get(id));
}

export function createPurchase(data, db = getDb()) {
  if (!data.supplier || !String(data.supplier).trim()) throw new Error('Supplier is required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO purchases (id, supplier, goods, total_value, status, payment_type, purchase_date, created_at)
     VALUES (@id, @supplier, @goods, @total_value, @status, @payment_type, @purchase_date, @created_at)`,
  ).run({
    id,
    supplier: String(data.supplier).trim(),
    goods: data.goods || '',
    total_value: Math.max(0, Math.round(Number(data.totalValue) || 0)),
    status: data.status === 'paid' ? 'paid' : 'outstanding',
    payment_type: data.paymentType || '',
    purchase_date: data.purchaseDate || now,
    created_at: now,
  });
  return getPurchase(id, db);
}

export function updatePurchase(id, data, db = getDb()) {
  const existing = getPurchase(id, db);
  if (!existing) return null;
  db.prepare(
    `UPDATE purchases SET supplier = @supplier, goods = @goods, total_value = @total_value,
      status = @status, payment_type = @payment_type, purchase_date = @purchase_date WHERE id = @id`,
  ).run({
    id,
    supplier: data.supplier ?? existing.supplier,
    goods: data.goods ?? existing.goods,
    total_value: data.totalValue != null ? Math.max(0, Math.round(Number(data.totalValue) || 0)) : existing.totalValue,
    status: data.status !== undefined ? (data.status === 'paid' ? 'paid' : 'outstanding') : existing.status,
    payment_type: data.paymentType ?? existing.paymentType,
    purchase_date: data.purchaseDate ?? existing.purchaseDate,
  });
  return getPurchase(id, db);
}

export function deletePurchase(id, db = getDb()) {
  const result = db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
  return result.changes > 0;
}
