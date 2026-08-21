import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { getSettings } from './settings.js';
import { getInHouseFilament, incrementInHouseFilamentUsage } from './in-house-filament.js';
import { deletePrintJobFile as deleteUploadedFile } from './uploads.js';
import { readCategoryProducts } from './export.js';
import { getProduct, upsertProduct } from './store.js';

const MAX_FILAMENT_SLOTS = 4;
const STATUSES = ['Estimate', 'Printed'];

function rowToJob(row, filamentRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    itemName: row.item_name,
    totalGrams: row.total_grams,
    totalMeters: row.total_meters,
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
    // Purely computed (totalCost + markup) -- the floor, never overridden.
    // Labelled "Minimum Selling Price" in the admin UI.
    sellingPrice: row.selling_price,
    // Admin-editable, defaults to sellingPrice at creation if not supplied.
    // What actually gets used as the price if/when this job is listed for
    // sale (see listPrintJobForSale below).
    finalSellingPrice: row.final_selling_price,
    referenceFilePath: row.reference_file_path,
    referenceImagePath: row.reference_image_path,
    status: row.status,
    datePrinted: row.date_printed,
    createdAt: row.created_at,
    // Set once this job has been published as a category product -- see
    // listPrintJobForSale. Both null until then.
    listingCategoryId: row.listing_category_id,
    listingItemId: row.listing_item_id,
    filaments: filamentRows.map((f) => ({
      id: f.id,
      inHouseFilamentId: f.in_house_filament_id,
      grams: f.grams,
      meters: f.meters,
      cost: f.cost,
      slotOrder: f.slot_order,
    })),
  };
}

// Production costing -- mirrors the spreadsheet's Cost Calculator math.
// Computing a job's cost/minimum-selling-price never touches storefront
// pricing on its own. The only bridge to the storefront is the explicit,
// admin-triggered listPrintJobForSale/updatePrintJobListing pair further
// down -- everything above that stays internal-only. `slots` is 1-4
// { inHouseFilamentId, grams, meters } entries; each is priced from its own
// in_house_filament.costPerG (not a single shared filament like the
// original single-material design).
export function computeJobCost(input, settings, resolvedSlots) {
  const totalGrams = resolvedSlots.reduce((sum, s) => sum + (Number(s.grams) || 0), 0);
  const totalMeters = resolvedSlots.reduce((sum, s) => sum + (Number(s.meters) || 0), 0);
  const slotCosts = resolvedSlots.map((s) => round2((Number(s.grams) || 0) * (s.costPerG || 0)));
  const filamentCost = round2(slotCosts.reduce((sum, c) => sum + c, 0));

  const printTimeHours = (Number(input.printTimeMinutes) || 0) / 60;
  const powerCost = round2(printTimeHours * (Number(settings.printerPowerDraw) || 0) * (Number(settings.electricityRate) || 0));

  const designHours = Number(input.designHours) || 0;
  const setupHours = Number(input.setupHours) || 0;
  const postProcessingHours = Number(input.postProcessingHours) || 0;
  const labourCost = round2(
    designHours * (Number(settings.designRate) || 0) +
      setupHours * (Number(settings.setupRate) || 0) +
      postProcessingHours * (Number(settings.postProcessingRate) || 0),
  );

  const runningCost = round2((filamentCost + powerCost) * (Number(settings.runningCostsPct) || 0));
  const totalCost = round2(filamentCost + powerCost + labourCost + runningCost);

  // Fraction, not a 0-100 percentage (0.20 = 20%) -- matches the
  // spreadsheet's own convention for both Markup % and Running Costs %.
  const markupPct = input.markupPct != null ? Number(input.markupPct) || 0 : Number(settings.markupPct) || 0;
  const markupAmount = round2(totalCost * markupPct);
  const sellingPrice = round2(totalCost + markupAmount);

  return {
    totalGrams,
    totalMeters,
    slotCosts,
    filamentCost,
    powerCost,
    labourCost,
    runningCost,
    totalCost,
    markupPct,
    markupAmount,
    sellingPrice,
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Validates and resolves 1-4 filament slots against in_house_filament,
// attaching each slot's costPerG. Shared by both the validate (preview) and
// the real create path, so they can never disagree about what's valid.
function resolveSlots(items, db) {
  const list = Array.isArray(items) ? items.filter((s) => s && s.inHouseFilamentId) : [];
  if (list.length < 1) throw new Error('At least one filament is required');
  if (list.length > MAX_FILAMENT_SLOTS) throw new Error(`At most ${MAX_FILAMENT_SLOTS} filaments are allowed per job`);
  return list.map((s, idx) => {
    const filament = getInHouseFilament(s.inHouseFilamentId, db);
    if (!filament) throw new Error('Selected in-house filament not found');
    return {
      inHouseFilamentId: filament.id,
      name: `${filament.filamentType} — ${filament.colorName}`,
      grams: Math.max(0, Number(s.grams) || 0),
      meters: Math.max(0, Number(s.meters) || 0),
      costPerG: filament.costPerG,
      slotOrder: idx,
    };
  });
}

// Computes the cost breakdown WITHOUT writing anything -- the "Validate"
// button uses this so the admin can check usage/costs before committing to
// Log Job (which does write, and decrements in-house stock).
export function previewPrintJobCost(data, db = getDb()) {
  const settings = getSettings(db);
  const slots = resolveSlots(data.filaments, db);
  const cost = computeJobCost(data, settings, slots);
  return {
    ...cost,
    filaments: slots.map((s, i) => ({ inHouseFilamentId: s.inHouseFilamentId, name: s.name, grams: s.grams, meters: s.meters, cost: cost.slotCosts[i] })),
  };
}

export function listPrintJobs({ status } = {}, db = getDb()) {
  const rows = status
    ? db.prepare('SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM print_jobs ORDER BY created_at DESC').all();
  return rows.map((r) => rowToJob(r, db.prepare('SELECT * FROM print_job_filaments WHERE print_job_id = ? ORDER BY slot_order ASC').all(r.id)));
}

export function getPrintJob(id, db = getDb()) {
  const row = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
  if (!row) return null;
  return rowToJob(row, db.prepare('SELECT * FROM print_job_filaments WHERE print_job_id = ? ORDER BY slot_order ASC').all(id));
}

// Computes and stores a snapshot of the cost breakdown at save time (see
// computeJobCost's comment), then decrements each used filament's
// used_g/used_m so In-House Filament's "Remaining" reflects it.
export function createPrintJob(data, db = getDb()) {
  if (!data.itemName || !String(data.itemName).trim()) throw new Error('Item name is required');
  const settings = getSettings(db);
  const slots = resolveSlots(data.filaments, db);
  const cost = computeJobCost(data, settings, slots);

  // Defaults to the computed minimum if not supplied/invalid -- covers the
  // common case of just accepting the calculated price without typing it
  // again, while still letting an admin override it (rounding up, charging
  // more for a popular design, etc).
  const finalSellingPriceInput = Number(data.finalSellingPrice);
  const finalSellingPrice = Number.isFinite(finalSellingPriceInput) && finalSellingPriceInput > 0 ? finalSellingPriceInput : cost.sellingPrice;

  const id = randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO print_jobs
        (id, item_name, total_grams, total_meters, print_time_minutes, design_hours, setup_hours, post_processing_hours,
         markup_pct, filament_cost, power_cost, labour_cost, running_cost, total_cost, markup_amount, selling_price,
         final_selling_price, status, date_printed, created_at)
       VALUES
        (@id, @item_name, @total_grams, @total_meters, @print_time_minutes, @design_hours, @setup_hours, @post_processing_hours,
         @markup_pct, @filament_cost, @power_cost, @labour_cost, @running_cost, @total_cost, @markup_amount, @selling_price,
         @final_selling_price, @status, @date_printed, @created_at)`,
    ).run({
      id,
      item_name: String(data.itemName).trim(),
      total_grams: cost.totalGrams,
      total_meters: cost.totalMeters,
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
      final_selling_price: finalSellingPrice,
      selling_price: cost.sellingPrice,
      status: data.status === 'Estimate' ? 'Estimate' : 'Printed',
      date_printed: data.datePrinted || now,
      created_at: now,
    });

    const insertSlot = db.prepare(
      `INSERT INTO print_job_filaments (id, print_job_id, in_house_filament_id, grams, meters, cost, slot_order)
       VALUES (@id, @print_job_id, @in_house_filament_id, @grams, @meters, @cost, @slot_order)`,
    );
    slots.forEach((slot, i) => {
      insertSlot.run({
        id: randomUUID(),
        print_job_id: id,
        in_house_filament_id: slot.inHouseFilamentId,
        grams: slot.grams,
        meters: slot.meters,
        cost: cost.slotCosts[i],
        slot_order: slot.slotOrder,
      });
      incrementInHouseFilamentUsage(slot.inHouseFilamentId, { usedG: slot.grams, usedM: slot.meters }, db);
    });

    return id;
  });

  const jobId = tx();
  return getPrintJob(jobId, db);
}

export function updatePrintJob(id, data, db = getDb()) {
  const existing = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
  if (!existing) return null;
  const status = data.status !== undefined && STATUSES.includes(data.status) ? data.status : existing.status;
  const finalSellingPrice =
    data.finalSellingPrice !== undefined && Number(data.finalSellingPrice) > 0
      ? Number(data.finalSellingPrice)
      : existing.final_selling_price;
  db.prepare('UPDATE print_jobs SET status = ?, final_selling_price = ? WHERE id = ?').run(status, finalSellingPrice, id);
  return getPrintJob(id, db);
}

// A print job's name/photo/weight are trusted as-is here (same reasoning
// as createManualOrder's free-text items) -- this is an internal admin
// publishing something they already costed, not a public form re-resolving
// against an existing catalog entry. Throws (rather than returning null)
// for every "can't list this" case, so the admin UI's toast shows a real
// reason instead of a generic 404/400.
export function listPrintJobForSale(id, { categorySlug, stockQty } = {}, db = getDb()) {
  const job = getPrintJob(id, db);
  if (!job) return null;
  if (job.listingItemId) throw new Error('Already listed for sale -- use "Update listing" instead.');
  const price = Number(job.finalSellingPrice) || 0;
  if (price <= 0) throw new Error('Set a Final Selling Price before listing this for sale.');

  const category = readCategoryProducts().find((c) => c.slug === categorySlug);
  if (!category) throw new Error('Category not found');
  const product = getProduct(category.id);
  if (!product) throw new Error('Category not found');

  const item = {
    id: randomUUID(),
    name: job.itemName,
    details: '',
    material: '',
    size: '',
    finish: '',
    price: String(price),
    sku: generateListingSku(job.itemName),
    imageUrl: job.referenceImagePath || '',
    // Grams -- matches filament_colours.weight_g and every other weight
    // field end to end. Shipping weight defaults to the same figure; an
    // admin can adjust it later from the catalog editor if packaging
    // differs, same as any other category item.
    weight: job.totalGrams,
    shippingWeight: job.totalGrams,
    available: true,
    sortOrder: (product.items || []).length,
    stockQty: Math.max(0, Number(stockQty) || 0),
  };
  product.items = [...(product.items || []), item];
  upsertProduct(product, db);

  db.prepare('UPDATE print_jobs SET listing_category_id = ?, listing_item_id = ? WHERE id = ?').run(product.id, item.id, id);
  return getPrintJob(id, db);
}

// "Printed 3 more" -- bumps the stock quantity (or price) on the already-
// linked category item, rather than listPrintJobForSale creating a second,
// disconnected duplicate product for the same design.
export function updatePrintJobListing(id, { stockQty, price } = {}, db = getDb()) {
  const job = getPrintJob(id, db);
  if (!job) return null;
  if (!job.listingItemId) throw new Error('This job has not been listed for sale yet.');
  const product = getProduct(job.listingCategoryId);
  if (!product) throw new Error('The linked category no longer exists.');
  const item = (product.items || []).find((i) => i.id === job.listingItemId);
  if (!item) throw new Error('The linked listing no longer exists.');

  if (stockQty !== undefined) item.stockQty = Math.max(0, Number(stockQty) || 0);
  if (price !== undefined && price !== '' && Number(price) > 0) item.price = String(Number(price));
  upsertProduct(product, db);
  return getPrintJob(id, db);
}

function generateListingSku(name) {
  const slug =
    String(name || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item';
  return `PRINT-${slug}-${randomUUID().slice(0, 6)}`.toUpperCase();
}

export function setPrintJobImage(id, imagePath, db = getDb()) {
  const existing = db.prepare('SELECT reference_image_path FROM print_jobs WHERE id = ?').get(id);
  if (!existing) return null;
  if (existing.reference_image_path) deleteUploadedFile(existing.reference_image_path);
  db.prepare('UPDATE print_jobs SET reference_image_path = ? WHERE id = ?').run(imagePath, id);
  return getPrintJob(id, db);
}

export function setPrintJobFile(id, filePath, db = getDb()) {
  const existing = db.prepare('SELECT reference_file_path FROM print_jobs WHERE id = ?').get(id);
  if (!existing) return null;
  if (existing.reference_file_path) deleteUploadedFile(existing.reference_file_path);
  db.prepare('UPDATE print_jobs SET reference_file_path = ? WHERE id = ?').run(filePath, id);
  return getPrintJob(id, db);
}

export function deletePrintJob(id, db = getDb()) {
  const existing = getPrintJob(id, db);
  if (!existing) return false;
  deleteUploadedFile(existing.referenceImagePath);
  deleteUploadedFile(existing.referenceFilePath);
  db.prepare('DELETE FROM print_jobs WHERE id = ?').run(id);
  return true;
}

export { MAX_FILAMENT_SLOTS, STATUSES as PRINT_JOB_STATUSES };
