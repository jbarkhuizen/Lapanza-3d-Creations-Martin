import { randomUUID } from 'crypto';
import { getDb } from './db.js';

// Same "computed at read time, never stored" pattern as filaments.js's
// rowToColour -- remaining/%left are always derived from rolls_available x
// the per-roll spec minus cumulative used_g/used_m, so there's one source
// of truth (see db.js's in_house_filament comment).
function rowToFilament(row) {
  if (!row) return null;
  const totalG = (row.rolls_available || 0) * (row.weight_g || 0);
  const totalM = (row.rolls_available || 0) * (row.roll_length_m || 0);
  const remainingG = Math.max(0, totalG - (row.used_g || 0));
  const remainingM = Math.max(0, totalM - (row.used_m || 0));
  return {
    id: row.id,
    filamentType: row.filament_type,
    colorName: row.color_name,
    rollsAvailable: row.rolls_available,
    weightG: row.weight_g,
    rollLengthM: row.roll_length_m,
    costPerRollRand: row.cost_per_roll_rand,
    costPerG: row.weight_g > 0 ? row.cost_per_roll_rand / row.weight_g : 0,
    usedG: row.used_g,
    usedM: row.used_m,
    remainingG,
    remainingM,
    percentLeft: totalG > 0 ? Math.max(0, Math.min(1, remainingG / totalG)) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listInHouseFilament(db = getDb()) {
  return db.prepare('SELECT * FROM in_house_filament ORDER BY filament_type ASC, color_name ASC').all().map(rowToFilament);
}

export function getInHouseFilament(id, db = getDb()) {
  return rowToFilament(db.prepare('SELECT * FROM in_house_filament WHERE id = ?').get(id));
}

export function createInHouseFilament(data, db = getDb()) {
  if (!data.filamentType || !String(data.filamentType).trim()) throw new Error('Filament type is required');
  if (!data.colorName || !String(data.colorName).trim()) throw new Error('Color name is required');
  const filamentType = String(data.filamentType).trim();
  const colorName = String(data.colorName).trim();
  // Case-insensitive so "PLA"/"Black" and "pla"/"black" count as the same
  // roll -- there was no check at all before, so the same combo could be
  // (and was) added more than once with no warning.
  const existing = db
    .prepare('SELECT id FROM in_house_filament WHERE LOWER(filament_type) = LOWER(?) AND LOWER(color_name) = LOWER(?)')
    .get(filamentType, colorName);
  if (existing) throw new Error(`"${filamentType} — ${colorName}" already exists — add rolls to the existing entry instead of creating a duplicate`);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO in_house_filament (id, filament_type, color_name, rolls_available, weight_g, roll_length_m, cost_per_roll_rand, created_at, updated_at)
     VALUES (@id, @filament_type, @color_name, @rolls_available, @weight_g, @roll_length_m, @cost_per_roll_rand, @created_at, @updated_at)`,
  ).run({
    id,
    filament_type: filamentType,
    color_name: colorName,
    rolls_available: Math.max(0, Math.round(Number(data.rollsAvailable) || 0)),
    weight_g: Math.max(0, Math.round(Number(data.weightG) || 0)),
    roll_length_m: Math.max(0, Number(data.rollLengthM) || 0),
    cost_per_roll_rand: Math.max(0, Math.round(Number(data.costPerRollRand) || 0)),
    created_at: now,
    updated_at: now,
  });
  return getInHouseFilament(id, db);
}

export function updateInHouseFilament(id, data, db = getDb()) {
  const existing = db.prepare('SELECT * FROM in_house_filament WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE in_house_filament SET filament_type = @filament_type, color_name = @color_name, rolls_available = @rolls_available,
      weight_g = @weight_g, roll_length_m = @roll_length_m, cost_per_roll_rand = @cost_per_roll_rand, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id,
    filament_type: data.filamentType !== undefined ? String(data.filamentType).trim() : existing.filament_type,
    color_name: data.colorName !== undefined ? String(data.colorName).trim() : existing.color_name,
    rolls_available: data.rollsAvailable !== undefined ? Math.max(0, Math.round(Number(data.rollsAvailable) || 0)) : existing.rolls_available,
    weight_g: data.weightG !== undefined ? Math.max(0, Math.round(Number(data.weightG) || 0)) : existing.weight_g,
    roll_length_m: data.rollLengthM !== undefined ? Math.max(0, Number(data.rollLengthM) || 0) : existing.roll_length_m,
    cost_per_roll_rand: data.costPerRollRand !== undefined ? Math.max(0, Math.round(Number(data.costPerRollRand) || 0)) : existing.cost_per_roll_rand,
    updated_at: new Date().toISOString(),
  });
  return getInHouseFilament(id, db);
}

// print_job_filaments.in_house_filament_id has no ON DELETE clause, so a
// filament that's been used in a logged job can't be deleted while that
// history exists (SQLite raises a foreign-key constraint error) -- caught
// here and turned into a clear message instead of a raw 500.
export function deleteInHouseFilament(id, db = getDb()) {
  try {
    const result = db.prepare('DELETE FROM in_house_filament WHERE id = ?').run(id);
    return result.changes > 0;
  } catch (err) {
    if (/FOREIGN KEY constraint failed/.test(err.message || '')) {
      throw new Error('Cannot delete — this filament has been used in a logged print job.');
    }
    throw err;
  }
}

// Called when a print job using this filament is logged (not on validate --
// see print-jobs.js). The only writer of used_g/used_m.
export function incrementInHouseFilamentUsage(id, { usedG = 0, usedM = 0 }, db = getDb()) {
  const result = db
    .prepare('UPDATE in_house_filament SET used_g = used_g + ?, used_m = used_m + ?, updated_at = ? WHERE id = ?')
    .run(Number(usedG) || 0, Number(usedM) || 0, new Date().toISOString(), id);
  return result.changes > 0;
}
