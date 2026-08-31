// #115: seeds the e2e scratch database DIRECTLY (module layer, no HTTP) so
// the built pages' product IDs resolve at checkout. Deliberately NOT via
// the admin API: the colour-create route triggers publishCatalog(), which
// would regenerate pages and rebuild dist/ from the near-empty scratch DB —
// clobbering the real checked-in generated files mid-test-run (a known
// incident class in this repo; see AI_HANDOFF's DATA_DIR/near-miss notes).
// Run with DATA_DIR pointing at the scratch dir; cwd must be the repo root
// (getDb resolves the DB via DATA_DIR, so only the DB is touched).
import fs from 'fs';
import { createFilament, addColour } from '../server/filaments.js';

const filaments = JSON.parse(fs.readFileSync('src/data/filaments.json', 'utf8'));
const pla = filaments.find((f) => f.slug === 'pla');
const colour = pla.colours.find((c) => c.listed !== false);
const price = Number(String(colour.price).replace(/[^\d.]/g, ''));

// Idempotent: Playwright restarts the worker after a test failure and
// re-runs beforeAll -> this script must tolerate an already-seeded DB.
import('../server/db.js').then(() => {});
const { listFilaments } = await import('../server/filaments.js');
if (listFilaments().some((f) => f.slug === pla.slug)) {
  console.log('already seeded');
  process.exit(0);
}
const created = createFilament({ name: pla.name, slug: pla.slug, status: 'published' });
addColour(created.id, {
  name: colour.name,
  sku: colour.sku,
  priceRand: price,
  weightG: colour.weightG || 1000,
  stockQty: 10,
});
console.log(`seeded ${pla.slug}/${colour.sku}`);
