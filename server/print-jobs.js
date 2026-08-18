import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { getSettings } from './settings.js';
import { incrementFilamentUsage } from './filaments.js';

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemName: row.item_name,
    filamentColourId: row.filament_colour_id,
    modelG: row.model_g,
    supportG: row.support_g,
    purgeG: row.purge_g,
    towerG: row.tower_g,
    printTimeMinutes: row.print_time_minutes,
    designHours: row.design_hours,
    setupHours: row.setup_hours,
    postProcessingHours: row.post_processing_hours,
    markupPct: row.markup_pct,
    filamentCost: row.filament_cost,
    powerCost: row.power_cost,
    labourCost: row.labour_cost,
    runningCost: row.running_cost,
    totalCost: row.total_cost,
    markupAmount: row.markup_amount,
    sellingPrice: row.selling_price,
    status: row.status,
    datePrinted: row.date_printed,
    createdAt: row.created_at,
  };
}

// Internal-only production costing -- mirrors the spreadsheet's Cost
// Calculator math. Never touches storefront product pricing (Phase 3 design
// decision #7). filamentColour is the plain object shape filaments.js's
// getFilament()/rowToColour returns (needs priceRand + weightG to derive a
// cost-per-gram); pass null when no filament was picked (cost stays 0 for
// that component, matching a job with e.g. only labour/post-processing).
export function computeJobCost(input, settings, filamentColour) {
  const modelG = Number(input.modelG) || 0;
  const supportG = Number(input.supportG) || 0;
  const purgeG = Number(input.purgeG) || 0;
  const towerG = Number(input.towerG) || 0;
  const totalFilamentG = modelG + supportG + purgeG + towerG;

  const costPerG = filamentColour && filamentColour.weightG > 0 ? filamentColour.priceRand / filamentColour.weightG : 0;
  const filamentCost = totalFilamentG * costPerG;

  const printTimeHours = (Number(input.printTimeMinutes) || 0) / 60;
  const powerCost = printTimeHours * (Number(settings.printerPowerDraw) || 0) * (Number(settings.electricityRate) || 0);

  const designHours = Number(input.designHours) || 0;
  const setupHours = Number(input.setupHours) || 0;
  const postProcessingHours = Number(input.postProcessingHours) || 0;
  const labourCost =
    designHours * (Number(settings.designRate) || 0) +
    setupHours * (Number(settings.setupRate) || 0) +
    postProcessingHours * (Number(settings.postProcessingRate) || 0);

  const runningCost = (filamentCost + powerCost) * (Number(settings.runningCostsPct) || 0);
  const totalCost = filamentCost + powerCost + labourCost + runningCost;

  // Fraction, not a 0-100 percentage (0.20 = 20%) -- matches the
  // spreadsheet's own convention for both Markup % and Running Costs %.
  const markupPct = input.markupPct != null ? Number(input.markupPct) || 0 : Number(settings.markupPct) || 0;
  const markupAmount = totalCost * markupPct;
  const sellingPrice = totalCost + markupAmount;

  return {
    totalFilamentG,
    filamentCost: round2(filamentCost),
    powerCost: round2(powerCost),
    labourCost: round2(labourCost),
    runningCost: round2(runningCost),
    totalCost: round2(totalCost),
    markupPct,
    markupAmount: round2(markupAmount),
    sellingPrice: round2(sellingPrice),
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function listPrintJobs({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM print_jobs ORDER BY created_at DESC').all();
  return rows.map(rowToJob);
}

export function getPrintJob(id, db = getDb()) {
  return rowToJob(db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id));
}

// Computes and stores a snapshot of the cost breakdown at save time (see
// computeJobCost's comment), then decrements the picked filament colour's
// used_m/used_g so Stock Management's "Remaining" column reflects it.
export function createPrintJob(data, db = getDb()) {
  if (!data.itemName || !String(data.itemName).trim()) throw new Error('Item name is required');
  const settings = getSettings(db);
  const filamentColour = data.filamentColourId
    ? db.prepare('SELECT * FROM filament_colours WHERE id = ?').get(data.filamentColourId)
    : null;
  const filamentForCost = filamentColour ? { priceRand: filamentColour.price_rand, weightG: filamentColour.weight_g } : null;
  const cost = computeJobCost(data, settings, filamentForCost);

  const id = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO print_jobs
        (id, item_name, filament_colour_id, model_g, support_g, purge_g, tower_g, print_time_minutes,
         design_hours, setup_hours, post_processing_hours, markup_pct, filament_cost, power_cost, labour_cost,
         running_cost, total_cost, markup_amount, selling_price, status, date_printed, created_at)
       VALUES
        (@id, @item_name, @filament_colour_id, @model_g, @support_g, @purge_g, @tower_g, @print_time_minutes,
         @design_hours, @setup_hours, @post_processing_hours, @markup_pct, @filament_cost, @power_cost, @labour_cost,
         @running_cost, @total_cost, @markup_amount, @selling_price, @status, @date_printed, @created_at)`,
    ).run({
      id,
      item_name: String(data.itemName).trim(),
      filament_colour_id: data.filamentColourId || null,
      model_g: Number(data.modelG) || 0,
      support_g: Number(data.supportG) || 0,
      purge_g: Number(data.purgeG) || 0,
      tower_g: Number(data.towerG) || 0,
      print_time_minutes: Number(data.printTimeMinutes) || 0,
      design_hours: Number(data.designHours) || 0,
      setup_hours: Number(data.setupHours) || 0,
      post_processing_hours: Number(data.postProcessingHours) || 0,
      markup_pct: cost.markupPct,
      filament_cost: cost.filamentCost,
      power_cost: cost.powerCost,
      labour_cost: cost.labourCost,
      running_cost: cost.runningCost,
      total_cost: cost.totalCost,
      markup_amount: cost.markupAmount,
      selling_price: cost.sellingPrice,
      status: data.status === 'planned' ? 'planned' : 'printed',
      date_printed: data.datePrinted || now,
      created_at: now,
    });
    if (filamentColour) {
      incrementFilamentUsage(filamentColour.id, { usedM: 0, usedG: cost.totalFilamentG }, db);
    }
    return id;
  });

  const jobId = tx();
  return getPrintJob(jobId, db);
}

export function updatePrintJob(id, data, db = getDb()) {
  const existing = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare('UPDATE print_jobs SET status = ? WHERE id = ?').run(
    data.status !== undefined ? data.status : existing.status,
    id,
  );
  return getPrintJob(id, db);
}

export function deletePrintJob(id, db = getDb()) {
  const result = db.prepare('DELETE FROM print_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}
