// Backlog #106: one-off (re-runnable) backfill of responsive WebP variants
// for the existing photo library. Additive only -- originals are never
// modified or deleted. Safe to re-run: existing variants are regenerated
// in place, "-480"/"-960" files themselves are skipped as sources.
//
//   node scripts/generate-image-variants.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateImageVariants } from '../server/images.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['public/uploads/filaments', 'public/uploads/category-items'];
const SOURCE_EXT = /\.(jpe?g|png|webp)$/i;
const IS_VARIANT = /-(480|960)\.webp$/i;

let made = 0;
let scanned = 0;
for (const rel of DIRS) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!SOURCE_EXT.test(file) || IS_VARIANT.test(file)) continue;
    scanned += 1;
    const out = await generateImageVariants(path.join(dir, file));
    made += out.length;
  }
}
console.log(`scanned ${scanned} source images, wrote ${made} variants`);
