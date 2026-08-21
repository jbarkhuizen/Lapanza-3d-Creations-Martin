#!/usr/bin/env node
// One-time import of historical print-job records (pre-dating this app's
// Print Job Costing feature) from a TSV export of the spreadsheet that used
// to track this. Run once: `node scripts/import-historical-print-jobs.mjs
// path/to/file.tsv`. Safe to re-run against a fresh/empty print_jobs table;
// NOT idempotent against a table that already has rows from a prior run of
// this script (it doesn't check for duplicates) -- don't run it twice
// against the same database.
//
// Deliberately bypasses createPrintJob()/resolveSlots() (import writes
// print_jobs/print_job_filaments rows directly) for two reasons:
//  1. Several historical jobs have more than MAX_FILAMENT_SLOTS (4) filament
//     colours (e.g. one job used 5) -- a real historical fact, and nothing
//     on the read side enforces a slot-count cap, only the live "Log a
//     print job" form's fixed 4 inputs. Rejecting those jobs outright would
//     just lose real records for an artificial reason.
//  2. Per explicit instruction: this import must NOT touch current
//     in-house-filament stock (incrementInHouseFilamentUsage) -- these
//     grams were already physically used in the past; today's roll counts
//     already reflect that reality, so decrementing again would
//     double-subtract. createPrintJob() always decrements; this script
//     never does.
//
// Row format (14 tab-separated fields, header lines already stripped):
//   itemFile, filamentName, modelM, modelG, supportM, supportG, purgeM,
//   purgeG, towerM, towerG, hrs, min, totalM, totalG
// Only itemFile, filamentName, hrs, min, totalM, totalG are used -- the
// model/support/purge/tower breakdown has no equivalent column in this
// schema (print_job_filaments only tracks grams/metres per slot), and
// totalM/totalG already correctly sum whatever breakdown existed for that
// row regardless of how many of the middle columns were blank.

import fs from 'fs';
import { randomUUID } from 'crypto';
import { getDb } from '../server/db.js';
import { getSettings } from '../server/settings.js';
import { computeJobCost } from '../server/print-jobs.js';
import { createInHouseFilament, listInHouseFilament } from '../server/in-house-filament.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/import-historical-print-jobs.mjs <path-to.tsv>');
  process.exit(1);
}

// Longest/most-specific first -- "Dual PLA"/"Silk PLA" must be checked
// before the bare "PLA" fallback, or they'd match as PLA with a stray
// "Dual"/"Silk" left stuck onto the front of the colour name.
const TYPE_KEYWORDS = ['Dual PLA', 'Silk PLA', 'PETG', 'PLA'];

// Strips known brand/reseller prefixes this spreadsheet used ("Generic ",
// "SA Filament: " -- sometimes with a stray double space, "Creality
// Soleyin Ultra "), then splits what's left into {type, color}. Anything
// that doesn't start with a known type keyword after stripping (e.g. "Dove
// White", "Multi Colour Rainbow", a bare "Black") defaults to type PLA
// with the whole remainder as the colour -- matches how this shop's real
// in-house filament list is already named (type + colour only, no brand).
function normalizeFilamentName(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^(Generic|SA Filament:|Creality Soleyin Ultra)\s*/i, '').trim();
  if (!s) return null;
  for (const keyword of TYPE_KEYWORDS) {
    if (s.toLowerCase().startsWith(keyword.toLowerCase())) {
      const color = s.slice(keyword.length).replace(/^[\s-]+/, '').trim();
      return { type: keyword, color: color || 'Unknown' };
    }
  }
  return { type: 'PLA', color: s };
}

function parseRows(tsvText) {
  return tsvText
    .split(/\r?\n/)
    .slice(2) // header + units rows
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const f = line.split('\t');
      return {
        itemFile: (f[0] || '').trim(),
        filamentName: (f[1] || '').trim(),
        hrs: Number(f[f.length - 4]) || 0,
        min: Number(f[f.length - 3]) || 0,
        totalM: Number(f[f.length - 2]) || 0,
        totalG: Number(f[f.length - 1]) || 0,
      };
    });
}

// Non-blank itemFile starts a new job; blank means "another filament slot
// for the job above" -- per explicit instruction, a REPEATED non-blank name
// (e.g. "PS5+Controller+Stand.3mf" appearing twice) is two separate jobs,
// not one merged job, so this needs no extra special-casing: the grouping
// rule already produces that on its own.
function groupIntoJobs(rows) {
  const jobs = [];
  let current = null;
  for (const row of rows) {
    if (row.itemFile) {
      current = { itemName: row.itemFile, rows: [] };
      jobs.push(current);
    }
    if (!current) continue; // shouldn't happen -- first row always has a name
    current.rows.push(row);
  }
  return jobs;
}

function run() {
  const db = getDb();
  const tsvText = fs.readFileSync(inputPath, 'utf8');
  const rows = parseRows(tsvText);
  const jobs = groupIntoJobs(rows);
  const settings = getSettings(db);

  // Cache normalized "type|color" -> in_house_filament id, built once and
  // reused across every job so the same colour appearing in many jobs
  // resolves to the same row instead of being auto-created repeatedly.
  const existing = listInHouseFilament(db);
  const filamentCache = new Map();
  for (const f of existing) filamentCache.set(`${f.filamentType.toLowerCase()}|${f.colorName.toLowerCase()}`, f);
  const created = [];

  function resolveFilament(type, color) {
    const key = `${type.toLowerCase()}|${color.toLowerCase()}`;
    if (filamentCache.has(key)) return filamentCache.get(key);
    // R0 cost/roll -- no cost basis exists in this historical data; the
    // admin fills in the real cost/roll afterward, same as any other
    // filament they add. rollsAvailable 0 -- there's no current physical
    // stock implied by importing history, just a catalog entry so this
    // job's filament slot has a valid, nameable reference.
    const f = createInHouseFilament({ filamentType: type, colorName: color, rollsAvailable: 0, weightG: 1000, rollLengthM: 335, costPerRollRand: 0 }, db);
    filamentCache.set(key, f);
    created.push(f);
    return f;
  }

  const insertJob = db.prepare(
    `INSERT INTO print_jobs
      (id, item_name, total_grams, total_meters, print_time_minutes, design_hours, setup_hours, post_processing_hours,
       markup_pct, filament_cost, power_cost, labour_cost, running_cost, total_cost, markup_amount, selling_price,
       final_selling_price, status, date_printed, created_at)
     VALUES
      (@id, @item_name, @total_grams, @total_meters, @print_time_minutes, 0, 0, 0,
       @markup_pct, @filament_cost, @power_cost, 0, @running_cost, @total_cost, @markup_amount, @selling_price,
       @final_selling_price, 'Printed', @date_printed, @date_printed)`,
  );
  const insertSlot = db.prepare(
    `INSERT INTO print_job_filaments (id, print_job_id, in_house_filament_id, grams, meters, cost, slot_order)
     VALUES (@id, @print_job_id, @in_house_filament_id, @grams, @meters, @cost, @slot_order)`,
  );

  const now = new Date().toISOString();
  let jobCount = 0;
  let slotCount = 0;
  let skippedEmptyName = 0;

  const importAll = db.transaction(() => {
    for (const job of jobs) {
      const printTimeMinutes = job.rows.reduce((sum, r) => sum + r.hrs * 60 + r.min, 0);
      const slots = [];
      for (const row of job.rows) {
        if (!row.filamentName) {
          if (row.totalG > 0 || row.totalM > 0) {
            const f = resolveFilament('PLA', 'Unknown');
            slots.push({ filament: f, grams: row.totalG, meters: row.totalM });
          }
          continue;
        }
        const norm = normalizeFilamentName(row.filamentName);
        if (!norm) {
          skippedEmptyName += 1;
          continue;
        }
        const f = resolveFilament(norm.type, norm.color);
        slots.push({ filament: f, grams: row.totalG, meters: row.totalM });
      }

      const cost = computeJobCost(
        { printTimeMinutes },
        settings,
        slots.map((s) => ({ grams: s.grams, meters: s.meters, costPerG: s.filament.costPerG })),
      );

      const jobId = randomUUID();
      insertJob.run({
        id: jobId,
        item_name: job.itemName,
        total_grams: cost.totalGrams,
        total_meters: cost.totalMeters,
        print_time_minutes: printTimeMinutes,
        markup_pct: cost.markupPct,
        filament_cost: cost.filamentCost,
        power_cost: cost.powerCost,
        running_cost: cost.runningCost,
        total_cost: cost.totalCost,
        markup_amount: cost.markupAmount,
        selling_price: cost.sellingPrice,
        final_selling_price: cost.sellingPrice,
        date_printed: now,
      });

      slots.forEach((s, i) => {
        insertSlot.run({
          id: randomUUID(),
          print_job_id: jobId,
          in_house_filament_id: s.filament.id,
          grams: s.grams,
          meters: s.meters,
          cost: cost.slotCosts[i],
          slot_order: i,
        });
      });

      jobCount += 1;
      slotCount += slots.length;
    }
  });

  importAll();

  console.log(`Imported ${jobCount} print jobs (${slotCount} filament-slot rows total).`);
  console.log(`Auto-created ${created.length} new in-house filament entries (R0 cost/roll -- fill in real cost per roll):`);
  created.forEach((f) => console.log(`  - ${f.filamentType} / ${f.colorName}`));
  if (skippedEmptyName) console.log(`Skipped ${skippedEmptyName} filament row(s) with no name and zero usage.`);
}

run();
