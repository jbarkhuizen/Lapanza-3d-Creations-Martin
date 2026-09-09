import { randomUUID } from 'crypto';
import { getDb } from './db.js';

function nowIso() {
  return new Date().toISOString();
}

// ---- Platforms ----

function rowToPlatform(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    hasGroups: Boolean(row.has_groups),
    notes: row.notes,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPlatforms({ activeOnly } = {}, db = getDb()) {
  let rows = db.prepare('SELECT * FROM advert_platforms ORDER BY sort_order ASC, created_at ASC').all().map(rowToPlatform);
  if (activeOnly) rows = rows.filter((p) => p.active);
  return rows;
}

export function getPlatform(id, db = getDb()) {
  return rowToPlatform(db.prepare('SELECT * FROM advert_platforms WHERE id = ?').get(id));
}

export function createPlatform({ name, hasGroups, notes }, db = getDb()) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Platform name is required');
  const now = nowIso();
  const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM advert_platforms').get().m;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO advert_platforms (id, name, has_groups, notes, active, sort_order, created_at, updated_at)
     VALUES (@id, @name, @has_groups, @notes, 1, @sort_order, @created_at, @updated_at)`,
  ).run({
    id,
    name: cleanName,
    has_groups: hasGroups ? 1 : 0,
    notes: String(notes || '').trim().slice(0, 2000),
    sort_order: (maxSort ?? -1) + 1,
    created_at: now,
    updated_at: now,
  });
  return getPlatform(id, db);
}

export function updatePlatform(id, { name, hasGroups, notes, active }, db = getDb()) {
  const existing = db.prepare('SELECT * FROM advert_platforms WHERE id = ?').get(id);
  if (!existing) return null;
  const cleanName = name !== undefined ? String(name).trim() : existing.name;
  if (!cleanName) throw new Error('Platform name is required');
  db.prepare(
    `UPDATE advert_platforms SET name=@name, has_groups=@has_groups, notes=@notes, active=@active, updated_at=@updated_at WHERE id=@id`,
  ).run({
    id,
    name: cleanName,
    has_groups: hasGroups !== undefined ? (hasGroups ? 1 : 0) : existing.has_groups,
    notes: notes !== undefined ? String(notes).trim().slice(0, 2000) : existing.notes,
    active: active !== undefined ? (active ? 1 : 0) : existing.active,
    updated_at: nowIso(),
  });
  return getPlatform(id, db);
}

// Retiring (active:false) is the normal way to stop using a platform without
// losing its history -- hard delete is only allowed once nothing actually
// depends on it, same "don't silently orphan real data" rule this codebase
// applies everywhere else (deleteAdmin refusing the last admin, deleteColour
// refusing an active special, etc).
export function deletePlatform(id, db = getDb()) {
  const advertCount = db.prepare('SELECT COUNT(*) AS n FROM adverts WHERE platform_id = ?').get(id).n;
  if (advertCount > 0) throw new Error('Cannot delete -- this platform has scheduled adverts. Retire it (mark inactive) instead.');
  const result = db.prepare('DELETE FROM advert_platforms WHERE id = ?').run(id);
  return result.changes > 0; // groups cascade via ON DELETE CASCADE
}

// ---- Platform groups (Facebook Groups / WhatsApp Groups today, any
// has_groups platform going forward) ----

const VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function normalizeDays(days) {
  const list = Array.isArray(days) ? days : [];
  return VALID_DAYS.filter((d) => list.includes(d)).join(',');
}

function rowToGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    platformId: row.platform_id,
    groupName: row.group_name,
    allowedDays: row.allowed_days ? row.allowed_days.split(',').filter(Boolean) : [],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPlatformGroups(platformId, db = getDb()) {
  return db.prepare('SELECT * FROM advert_platform_groups WHERE platform_id = ? ORDER BY group_name ASC').all(platformId).map(rowToGroup);
}

export function getPlatformGroup(id, db = getDb()) {
  return rowToGroup(db.prepare('SELECT * FROM advert_platform_groups WHERE id = ?').get(id));
}

export function createPlatformGroup(platformId, { groupName, allowedDays, notes }, db = getDb()) {
  const platform = db.prepare('SELECT id FROM advert_platforms WHERE id = ?').get(platformId);
  if (!platform) throw new Error('Platform not found');
  const cleanName = String(groupName || '').trim();
  if (!cleanName) throw new Error('Group name is required');
  const now = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO advert_platform_groups (id, platform_id, group_name, allowed_days, notes, created_at, updated_at)
     VALUES (@id, @platform_id, @group_name, @allowed_days, @notes, @created_at, @updated_at)`,
  ).run({
    id,
    platform_id: platformId,
    group_name: cleanName,
    allowed_days: normalizeDays(allowedDays),
    notes: String(notes || '').trim().slice(0, 2000),
    created_at: now,
    updated_at: now,
  });
  return getPlatformGroup(id, db);
}

export function updatePlatformGroup(id, { groupName, allowedDays, notes }, db = getDb()) {
  const existing = db.prepare('SELECT * FROM advert_platform_groups WHERE id = ?').get(id);
  if (!existing) return null;
  const cleanName = groupName !== undefined ? String(groupName).trim() : existing.group_name;
  if (!cleanName) throw new Error('Group name is required');
  db.prepare(
    `UPDATE advert_platform_groups SET group_name=@group_name, allowed_days=@allowed_days, notes=@notes, updated_at=@updated_at WHERE id=@id`,
  ).run({
    id,
    group_name: cleanName,
    allowed_days: allowedDays !== undefined ? normalizeDays(allowedDays) : existing.allowed_days,
    notes: notes !== undefined ? String(notes).trim().slice(0, 2000) : existing.notes,
    updated_at: nowIso(),
  });
  return getPlatformGroup(id, db);
}

export function deletePlatformGroup(id, db = getDb()) {
  return db.prepare('DELETE FROM advert_platform_groups WHERE id = ?').run(id).changes > 0;
}

// ---- Adverts ----

// Duration is inclusive of the start day (1 day = ends the same day it
// starts) -- matches how "runs for 2 days" reads in plain English. Uses
// Date.UTC throughout so the local server timezone (SAST, UTC+2) never
// shifts the computed date backward across midnight.
function computeEndDate(publishDate, durationDays) {
  const [y, m, d] = publishDate.split('-').map(Number);
  const days = Math.max(1, Number(durationDays) || 1);
  const end = new Date(Date.UTC(y, m - 1, d + (days - 1)));
  return end.toISOString().slice(0, 10);
}

function rowToAdvert(row) {
  if (!row) return null;
  return {
    id: row.id,
    platformId: row.platform_id,
    imagePath: row.image_path || '',
    caption: row.caption,
    publishDate: row.publish_date,
    publishTime: row.publish_time,
    durationDays: row.duration_days,
    endDate: computeEndDate(row.publish_date, row.duration_days),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Every list/detail view shows the platform's name, not just its id --
// attached here once rather than making every caller join it separately.
function attachPlatformName(advert, db) {
  if (!advert) return advert;
  const platform = db.prepare('SELECT name FROM advert_platforms WHERE id = ?').get(advert.platformId);
  return { ...advert, platformName: platform?.name || 'Unknown platform' };
}

// from/to (both YYYY-MM-DD, both optional) select adverts whose run window
// OVERLAPS the range at all -- an advert that started before `from` but is
// still running (endDate >= from) still belongs in the window, same as one
// that starts partway through and runs past `to`. This is what the Calendar
// page's -7/+21 day agenda calls with, but it's a generic date-range filter,
// not calendar-specific.
export function listAdverts({ from, to } = {}, db = getDb()) {
  let rows = db.prepare('SELECT * FROM adverts ORDER BY publish_date ASC, publish_time ASC').all().map(rowToAdvert);
  if (from) rows = rows.filter((a) => a.endDate >= from);
  if (to) rows = rows.filter((a) => a.publishDate <= to);
  return rows.map((a) => attachPlatformName(a, db));
}

export function getAdvert(id, db = getDb()) {
  return attachPlatformName(rowToAdvert(db.prepare('SELECT * FROM adverts WHERE id = ?').get(id)), db);
}

function assertValidAdvert({ platformId, publishDate, durationDays }, db) {
  if (!platformId) throw new Error('Platform is required');
  const platform = db.prepare('SELECT id FROM advert_platforms WHERE id = ?').get(platformId);
  if (!platform) throw new Error('Platform not found');
  if (!publishDate) throw new Error('Publish date is required');
  if (durationDays !== undefined && Number(durationDays) < 1) throw new Error('Duration must be at least 1 day');
}

export function createAdvert({ platformId, imagePath, caption, publishDate, publishTime, durationDays }, db = getDb()) {
  assertValidAdvert({ platformId, publishDate, durationDays }, db);
  const now = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO adverts (id, platform_id, image_path, caption, publish_date, publish_time, duration_days, created_at, updated_at)
     VALUES (@id, @platform_id, @image_path, @caption, @publish_date, @publish_time, @duration_days, @created_at, @updated_at)`,
  ).run({
    id,
    platform_id: platformId,
    image_path: imagePath || '',
    caption: String(caption || '').trim().slice(0, 2000),
    publish_date: publishDate,
    publish_time: publishTime || '',
    duration_days: Math.max(1, Number(durationDays) || 1),
    created_at: now,
    updated_at: now,
  });
  return getAdvert(id, db);
}

export function updateAdvert(id, { platformId, imagePath, caption, publishDate, publishTime, durationDays }, db = getDb()) {
  const existing = db.prepare('SELECT * FROM adverts WHERE id = ?').get(id);
  if (!existing) return null;
  const next = {
    platform_id: platformId !== undefined ? platformId : existing.platform_id,
    image_path: imagePath !== undefined ? imagePath : existing.image_path,
    caption: caption !== undefined ? String(caption).trim().slice(0, 2000) : existing.caption,
    publish_date: publishDate !== undefined ? publishDate : existing.publish_date,
    publish_time: publishTime !== undefined ? publishTime : existing.publish_time,
    duration_days: durationDays !== undefined ? Math.max(1, Number(durationDays) || 1) : existing.duration_days,
  };
  assertValidAdvert({ platformId: next.platform_id, publishDate: next.publish_date, durationDays: next.duration_days }, db);
  db.prepare(
    `UPDATE adverts SET platform_id=@platform_id, image_path=@image_path, caption=@caption, publish_date=@publish_date, publish_time=@publish_time, duration_days=@duration_days, updated_at=@updated_at WHERE id=@id`,
  ).run({ id, ...next, updated_at: nowIso() });
  return getAdvert(id, db);
}

export function deleteAdvert(id, db = getDb()) {
  return db.prepare('DELETE FROM adverts WHERE id = ?').run(id).changes > 0;
}
