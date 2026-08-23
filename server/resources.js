import { randomUUID } from 'crypto';
import { getDb } from './db.js';

function rowToResource(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    imagePath: row.image_path,
    imageOriginalName: row.image_original_name,
    filePath: row.file_path,
    fileOriginalName: row.file_original_name,
    printSettings: row.print_settings,
    filamentType: row.filament_type,
    dimensions: row.dimensions,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listResources({ activeOnly } = {}, db = getDb()) {
  const rows = activeOnly
    ? db.prepare('SELECT * FROM resources WHERE active = 1 ORDER BY sort_order ASC, created_at DESC').all()
    : db.prepare('SELECT * FROM resources ORDER BY sort_order ASC, created_at DESC').all();
  return rows.map(rowToResource);
}

export function getResource(id, db = getDb()) {
  return rowToResource(db.prepare('SELECT * FROM resources WHERE id = ?').get(id));
}

export function createResource(data, db = getDb()) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO resources (id, title, description, image_path, image_original_name, file_path, file_original_name, print_settings, filament_type, dimensions, active, sort_order, created_at, updated_at)
     VALUES (@id, @title, @description, @image_path, @image_original_name, @file_path, @file_original_name, @print_settings, @filament_type, @dimensions, @active, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    title: data.title || 'Untitled resource',
    description: data.description || '',
    image_path: data.imagePath || null,
    image_original_name: data.imageOriginalName || null,
    file_path: data.filePath || null,
    file_original_name: data.fileOriginalName || null,
    print_settings: data.printSettings || '',
    filament_type: data.filamentType || '',
    dimensions: data.dimensions || '',
    active: data.active !== false ? 1 : 0,
    sort_order: Number(data.sortOrder) || 0,
    created_at: now,
    updated_at: now,
  });
  return getResource(id, db);
}

export function updateResource(id, data, db = getDb()) {
  const existing = getResource(id, db);
  if (!existing) return null;
  db.prepare(
    `UPDATE resources SET title = @title, description = @description, image_path = @image_path, image_original_name = @image_original_name,
      file_path = @file_path, file_original_name = @file_original_name,
      print_settings = @print_settings, filament_type = @filament_type, dimensions = @dimensions,
      active = @active, sort_order = @sort_order, updated_at = @updated_at WHERE id = @id`,
  ).run({
    id,
    title: data.title ?? existing.title,
    description: data.description ?? existing.description,
    image_path: data.imagePath !== undefined ? data.imagePath : existing.imagePath,
    image_original_name: data.imageOriginalName !== undefined ? data.imageOriginalName : existing.imageOriginalName,
    file_path: data.filePath !== undefined ? data.filePath : existing.filePath,
    file_original_name: data.fileOriginalName !== undefined ? data.fileOriginalName : existing.fileOriginalName,
    print_settings: data.printSettings ?? existing.printSettings,
    filament_type: data.filamentType ?? existing.filamentType,
    dimensions: data.dimensions ?? existing.dimensions,
    active: data.active !== undefined ? (data.active ? 1 : 0) : (existing.active ? 1 : 0),
    sort_order: data.sortOrder ?? existing.sortOrder,
    updated_at: new Date().toISOString(),
  });
  return getResource(id, db);
}

export function deleteResource(id, db = getDb()) {
  const result = db.prepare('DELETE FROM resources WHERE id = ?').run(id);
  return result.changes > 0;
}
