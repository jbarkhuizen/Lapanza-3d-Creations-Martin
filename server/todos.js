import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export const TODO_CATEGORIES = ['Bug', 'Feature', 'Enhancement', 'Tech Debt'];
// 'Discarded' (2026-08-28): distinct from "Won't Fix" -- Won't Fix means a
// real decision not to build a still-valid idea; Discarded means the item
// itself is no longer applicable (superseded, already covered elsewhere, or
// describes something the site no longer needs) -- a backlog-hygiene
// classification, not a scope/priority call.
export const TODO_STATUSES = ['Backlog', 'In Progress', 'Done', "Won't Fix", 'Claude Fix', 'Discarded'];
export const TODO_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

function rowToTodo(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    category: row.category,
    priority: row.priority,
    name: row.name,
    description: row.description,
    status: row.status,
    plannedFixDate: row.planned_fix_date,
    actualFixDate: row.actual_fix_date,
    dateAdded: row.date_added,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

export function listTodos(db = getDb()) {
  return db.prepare('SELECT * FROM todo_items ORDER BY date_added DESC, number DESC').all().map(rowToTodo);
}

export function getTodo(id, db = getDb()) {
  return rowToTodo(db.prepare('SELECT * FROM todo_items WHERE id = ?').get(id));
}

function nextNumber(db) {
  const row = db.prepare('SELECT MAX(number) AS max FROM todo_items').get();
  return (row.max || 0) + 1;
}

// Open to anyone with an admin session -- same trust model as every other
// write in this admin (no separate "Claude" identity/API key; this
// assistant adds items the same way an admin would, through this same
// authenticated path).
export function createTodo(data, db = getDb()) {
  if (!data.name || !String(data.name).trim()) throw new Error('Name is required');
  const category = TODO_CATEGORIES.includes(data.category) ? data.category : 'Feature';
  const status = TODO_STATUSES.includes(data.status) ? data.status : 'Backlog';
  const priority = TODO_PRIORITIES.includes(data.priority) ? data.priority : 'Medium';
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO todo_items (id, number, category, priority, name, description, status, planned_fix_date, actual_fix_date, date_added, created_at, updated_at, created_by)
     VALUES (@id, @number, @category, @priority, @name, @description, @status, @planned_fix_date, @actual_fix_date, @date_added, @created_at, @updated_at, @created_by)`,
  ).run({
    id,
    number: nextNumber(db),
    category,
    priority,
    name: String(data.name).trim(),
    description: data.description || '',
    status,
    planned_fix_date: data.plannedFixDate || null,
    actual_fix_date: data.actualFixDate || null,
    date_added: data.dateAdded || now,
    created_at: now,
    updated_at: now,
    created_by: data.createdBy || null,
  });
  return getTodo(id, db);
}

// No delete route exists for this table -- items are append-only (edit +
// status changes only), same philosophy as version_history: a mistaken or
// duplicate entry gets marked "Won't Fix" with a note explaining why,
// rather than erased, so the list stays an honest record of everything
// ever considered.
export function updateTodo(id, data, db = getDb()) {
  const existing = getTodo(id, db);
  if (!existing) return null;
  const category = data.category !== undefined && TODO_CATEGORIES.includes(data.category) ? data.category : existing.category;
  const status = data.status !== undefined && TODO_STATUSES.includes(data.status) ? data.status : existing.status;
  const priority = data.priority !== undefined && TODO_PRIORITIES.includes(data.priority) ? data.priority : existing.priority;
  // Auto-stamps actualFixDate the moment status becomes Done or Claude Fix,
  // unless the caller already supplied one -- covers the common case of an
  // admin (or Claude) just flipping the status dropdown without separately
  // filling in a date.
  let actualFixDate = data.actualFixDate !== undefined ? data.actualFixDate : existing.actualFixDate;
  if ((status === 'Done' || status === 'Claude Fix') && !actualFixDate) {
    actualFixDate = new Date().toISOString();
  }
  db.prepare(
    `UPDATE todo_items SET category = @category, priority = @priority, name = @name, description = @description, status = @status,
      planned_fix_date = @planned_fix_date, actual_fix_date = @actual_fix_date, updated_at = @updated_at WHERE id = @id`,
  ).run({
    id,
    category,
    priority,
    name: data.name !== undefined && String(data.name).trim() ? String(data.name).trim() : existing.name,
    description: data.description ?? existing.description,
    status,
    planned_fix_date: data.plannedFixDate !== undefined ? data.plannedFixDate : existing.plannedFixDate,
    actual_fix_date: actualFixDate,
    updated_at: new Date().toISOString(),
  });
  return getTodo(id, db);
}
