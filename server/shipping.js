import { randomUUID } from 'crypto';
import { getDb } from './db.js';

function rowToOption(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    optionType: row.option_type,
    minWeight: row.min_weight,
    maxWeight: row.max_weight,
    price: row.price,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function overlaps(a, b) {
  const aMax = a.maxWeight ?? Infinity;
  const bMax = b.maxWeight ?? Infinity;
  return a.minWeight <= bMax && b.minWeight <= aMax;
}

// C.2 / Phase 3: only active brackets need to be deterministic against each
// other -- an inactive bracket overlapping an active one is fine, it just
// isn't eligible for matching (see matchShippingForWeight). 'fixed' options
// (Phase 3 -- PUDO lockers, local delivery zones) are named flat-price picks,
// not weight brackets, so they're excluded from the overlap check entirely:
// multiple fixed options are meant to coexist and be chosen by name.
function findOverlap(db, candidate, excludeId) {
  if (candidate.optionType === 'fixed') return null;
  const others = db.prepare("SELECT * FROM shipping_options WHERE active = 1 AND option_type = 'auto_weight' AND id != ?").all(excludeId || '');
  return others.map(rowToOption).find((o) => overlaps(candidate, o)) || null;
}

export function listShippingOptions({ activeOnly, optionType } = {}, db = getDb()) {
  const clauses = [];
  const params = [];
  if (activeOnly) clauses.push('active = 1');
  if (optionType) {
    clauses.push('option_type = ?');
    params.push(optionType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM shipping_options ${where} ORDER BY min_weight ASC, name ASC`).all(...params);
  return rows.map(rowToOption);
}

export function getShippingOption(id, db = getDb()) {
  return rowToOption(db.prepare('SELECT * FROM shipping_options WHERE id = ?').get(id));
}

function toCandidate(data, existing) {
  const optionType = data.optionType ?? existing?.optionType ?? 'auto_weight';
  // 'fixed' options don't use weight brackets -- min/max are stored but
  // ignored by both the overlap check and matchShippingForWeight.
  const minWeight = optionType === 'fixed' ? 0 : Number(data.minWeight ?? existing?.minWeight ?? 0);
  const maxWeightRaw = data.maxWeight !== undefined ? data.maxWeight : existing?.maxWeight;
  const maxWeight = optionType === 'fixed' || maxWeightRaw === null || maxWeightRaw === '' || maxWeightRaw === undefined ? null : Number(maxWeightRaw);
  const active = data.active !== undefined ? Boolean(data.active) : (existing ? existing.active : true);
  return { optionType, minWeight, maxWeight, active };
}

export function createShippingOption(data, db = getDb()) {
  const candidate = toCandidate(data, null);
  if (candidate.maxWeight != null && candidate.maxWeight < candidate.minWeight) {
    throw new Error('Max weight must be greater than or equal to min weight');
  }
  if (candidate.active) {
    const clash = findOverlap(db, candidate);
    if (clash) throw new Error(`Overlaps active bracket "${clash.name}" (${clash.minWeight}-${clash.maxWeight ?? '∞'}g)`);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO shipping_options (id, name, option_type, min_weight, max_weight, price, active, created_at, updated_at)
     VALUES (@id, @name, @option_type, @min_weight, @max_weight, @price, @active, @created_at, @updated_at)`,
  ).run({
    id,
    name: data.name || 'Shipping option',
    option_type: candidate.optionType,
    min_weight: candidate.minWeight,
    max_weight: candidate.maxWeight,
    price: Number(data.price) || 0,
    active: candidate.active ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  return getShippingOption(id, db);
}

export function updateShippingOption(id, data, db = getDb()) {
  const existing = getShippingOption(id, db);
  if (!existing) return null;
  const candidate = toCandidate(data, existing);
  if (candidate.maxWeight != null && candidate.maxWeight < candidate.minWeight) {
    throw new Error('Max weight must be greater than or equal to min weight');
  }
  if (candidate.active) {
    const clash = findOverlap(db, candidate, id);
    if (clash) throw new Error(`Overlaps active bracket "${clash.name}" (${clash.minWeight}-${clash.maxWeight ?? '∞'}g)`);
  }
  db.prepare(
    `UPDATE shipping_options SET name = @name, option_type = @option_type, min_weight = @min_weight, max_weight = @max_weight,
      price = @price, active = @active, updated_at = @updated_at WHERE id = @id`,
  ).run({
    id,
    name: data.name ?? existing.name,
    option_type: candidate.optionType,
    min_weight: candidate.minWeight,
    max_weight: candidate.maxWeight,
    price: data.price != null ? Number(data.price) : existing.price,
    active: candidate.active ? 1 : 0,
    updated_at: new Date().toISOString(),
  });
  return getShippingOption(id, db);
}

export function deleteShippingOption(id, db = getDb()) {
  const result = db.prepare('DELETE FROM shipping_options WHERE id = ?').run(id);
  return result.changes > 0;
}

// C.3: fallback behavior when no active bracket covers the weight -- returns
// null rather than guessing (defaulting to the cheapest/most-expensive/free
// bracket would silently misquote shipping). Callers (checkout) must turn a
// null into a clear "no shipping available for this weight, contact us"
// response instead of proceeding.
export function matchShippingForWeight(totalWeightG, db = getDb()) {
  const options = listShippingOptions({ activeOnly: true, optionType: 'auto_weight' }, db);
  const w = Number(totalWeightG) || 0;
  return options.find((o) => w >= o.minWeight && (o.maxWeight == null || w <= o.maxWeight)) || null;
}
