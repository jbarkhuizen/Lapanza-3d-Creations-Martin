import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// C1: generate-pages.mjs's per-colour/per-item detail-page generator (#95)
// also writes into filament/ and products/ using whatever
// filaments.json/categories.json fixture a test below has temporarily
// swapped in -- restoring the JSON backup alone does not remove detail
// pages the fixture caused to be written (unlike the listing pages, which
// get overwritten back to real content the moment something regenerates
// with the real data restored). Real commits of this: 6e6429d left
// products/toys-shown-item-0.html and products/toys-external-photo-item-0
// .html tracked in git, and filament colour fixtures leaked the equivalent
// filament/test-pla-<sku>.html files untracked into the working tree on
// every run. Sweep by prefix so this can't recur regardless of which SKUs
// a given test uses.
function rmGeneratedDetailPages(dir, prefix) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(prefix) && name.endsWith('.html')) fs.rmSync(path.join(dir, name), { force: true });
  }
}

test('generate-pages renders an <img> for a colour whose imageUrl file actually exists, "Photo coming soon" for one with no imageUrl at all', () => {
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const backup = fs.readFileSync(filamentsPath, 'utf8');
  const fixtureImagePath = path.join(root, 'public', 'uploads', 'filaments', 'genpages-test-fixture.jpg');
  fs.mkdirSync(path.dirname(fixtureImagePath), { recursive: true });
  fs.writeFileSync(fixtureImagePath, 'fake-jpeg-bytes');

  try {
    fs.writeFileSync(
      filamentsPath,
      JSON.stringify([
        {
          slug: 'test-pla',
          name: 'Test PLA',
          description: 'A test filament',
          specs: [],
          colours: [
            { name: 'With Photo', sku: 'SKU-1', price: 'R299', imageUrl: '/uploads/filaments/genpages-test-fixture.jpg' },
            { name: 'No Photo', sku: 'SKU-2', price: 'R299' },
          ],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.match(html, /<img src="\/uploads\/filaments\/genpages-test-fixture\.jpg"/);
    assert.match(html, /Photo coming soon/);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(fixtureImagePath, { force: true });
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    rmGeneratedDetailPages(path.join(root, 'filament'), 'test-pla-');
  }
});

test('generate-pages falls back to "Photo coming soon" when imageUrl is set but the file does not exist on disk', () => {
  // Regression test for a real production bug (2026-08-27): 106 of 107
  // filament colours had an imageUrl pointing at a file that was never
  // actually uploaded (seeded as metadata by a bulk catalog import,
  // without the binary). Truthiness of imageUrl alone used to be enough to
  // render a broken <img> instead of ever falling back to this placeholder.
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const backup = fs.readFileSync(filamentsPath, 'utf8');

  try {
    fs.writeFileSync(
      filamentsPath,
      JSON.stringify([
        {
          slug: 'test-pla',
          name: 'Test PLA',
          description: 'A test filament',
          specs: [],
          colours: [{ name: 'Ghost Photo', sku: 'SKU-1', price: 'R299', imageUrl: '/uploads/filaments/does-not-exist-on-disk.jpg' }],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.doesNotMatch(html, /<img src="\/uploads\/filaments\/does-not-exist-on-disk\.jpg"/);
    assert.match(html, /Photo coming soon/);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    rmGeneratedDetailPages(path.join(root, 'filament'), 'test-pla-');
  }
});

test('generate-pages trusts an external http(s) imageUrl on a category item without checking the local filesystem', () => {
  const categoriesPath = path.join(root, 'src', 'data', 'categories.json');
  const backup = fs.readFileSync(categoriesPath, 'utf8');

  try {
    const categories = JSON.parse(backup);
    categories.toys = {
      name: 'Toys',
      description: 'Test',
      crumbs: 'Home / Toys',
      items: [{ name: 'External Photo Item', imageUrl: 'https://example.com/photo.jpg', price: 'R100', available: true, listed: true }],
    };
    fs.writeFileSync(categoriesPath, JSON.stringify(categories));

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'toys.html'), 'utf8');
    assert.match(html, /<img src="https:\/\/example\.com\/photo\.jpg"/);
  } finally {
    // Regenerating with the real data restored (below) already prunes the
    // products/toys-external-photo-item-0.html this test's fixture caused
    // to be written (see generate-pages.mjs's own I5 pruning), but remove
    // it explicitly too so this test's own output never depends on that
    // separate mechanism running correctly.
    rmGeneratedDetailPages(path.join(root, 'products'), 'toys-external-photo-item-');
    fs.writeFileSync(categoriesPath, backup);
    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });
  }
});

test('generate-pages shows "In stock" above the low-stock threshold, "Only N left" at/below it, "Out of stock" for zero/missing stock', () => {
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const settingsPath = path.join(root, 'src', 'data', 'settings.json');
  const filamentsBackup = fs.readFileSync(filamentsPath, 'utf8');
  const settingsBackup = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : null;

  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ lowStockThreshold: 3 }));
    fs.writeFileSync(
      filamentsPath,
      JSON.stringify([
        {
          slug: 'test-pla',
          name: 'Test PLA',
          description: 'A test filament',
          specs: [],
          colours: [
            { name: 'Plenty', sku: 'SKU-1', price: 'R299', stockQty: 12 },
            { name: 'Low', sku: 'SKU-2', price: 'R299', stockQty: 2 },
            { name: 'ExactlyAtThreshold', sku: 'SKU-3', price: 'R299', stockQty: 3 },
            { name: 'Zero', sku: 'SKU-4', price: 'R299', stockQty: 0 },
            { name: 'Unset', sku: 'SKU-5', price: 'R299' },
          ],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    // Above the threshold: no raw count shown, just a plain "In stock".
    assert.match(html, /In stock/);
    assert.doesNotMatch(html, /12 in stock/);
    // At or below the threshold: an urgency message with the real count.
    assert.match(html, /Only 2 left/);
    assert.match(html, /Only 3 left/);
    // A colour with 0 stock and one with no stockQty field at all must both
    // read "Out of stock" -- undefined is not a truthy stock count.
    assert.strictEqual((html.match(/Out of stock/g) || []).length, 2);
  } finally {
    fs.writeFileSync(filamentsPath, filamentsBackup);
    if (settingsBackup === null) fs.rmSync(settingsPath, { force: true });
    else fs.writeFileSync(settingsPath, settingsBackup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    rmGeneratedDetailPages(path.join(root, 'filament'), 'test-pla-');
  }
});

test('generate-pages excludes a colour marked listed:false from the filament page, keeps the rest', () => {
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const backup = fs.readFileSync(filamentsPath, 'utf8');

  try {
    fs.writeFileSync(
      filamentsPath,
      JSON.stringify([
        {
          slug: 'test-pla',
          name: 'Test PLA',
          description: 'A test filament',
          specs: [],
          colours: [
            { name: 'Shown Colour', sku: 'SKU-1', price: 'R299', listed: true },
            { name: 'Hidden Colour', sku: 'SKU-2', price: 'R299', listed: false },
          ],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.match(html, /Shown Colour/);
    assert.doesNotMatch(html, /Hidden Colour/);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    rmGeneratedDetailPages(path.join(root, 'filament'), 'test-pla-');
  }
});

test('generate-pages falls back to the "on request" note when every colour is unlisted', () => {
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const backup = fs.readFileSync(filamentsPath, 'utf8');

  try {
    fs.writeFileSync(
      filamentsPath,
      JSON.stringify([
        {
          slug: 'test-pla',
          name: 'Test PLA',
          description: 'A test filament',
          specs: [],
          colours: [{ name: 'Hidden Colour', sku: 'SKU-1', price: 'R299', listed: false }],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.doesNotMatch(html, /Hidden Colour/);
    assert.match(html, /Colour list available on request/);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    rmGeneratedDetailPages(path.join(root, 'filament'), 'test-pla-');
  }
});

test('generate-pages excludes a category item marked listed:false from its category page', () => {
  const categoriesPath = path.join(root, 'src', 'data', 'categories.json');
  const backup = fs.readFileSync(categoriesPath, 'utf8');

  try {
    fs.writeFileSync(
      categoriesPath,
      JSON.stringify({
        toys: {
          slug: 'toys',
          name: 'Toys',
          description: 'Toys',
          crumbs: 'Home / Toys',
          items: [
            { name: 'Shown Item', price: 'R150', listed: true },
            { name: 'Hidden Item', price: 'R150', listed: false },
          ],
        },
      }),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'toys.html'), 'utf8');
    assert.match(html, /Shown Item/);
    assert.doesNotMatch(html, /Hidden Item/);
  } finally {
    // toys.html is a real, git-tracked file (unlike filament/test-pla.html
    // above) -- restoring categories.json alone leaves it holding this
    // test's fixture content, so regenerate it from the real data too.
    // Same reasoning as the external-photo-item test above: remove the
    // fixture's own products/toys-shown-item-0.html explicitly rather than
    // relying solely on the regenerate call's I5 pruning to catch it.
    rmGeneratedDetailPages(path.join(root, 'products'), 'toys-shown-item-');
    fs.writeFileSync(categoriesPath, backup);
    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });
  }
});

test('generate-pages skips category pages missing from categories.json instead of crashing', () => {
  const categoriesPath = path.join(root, 'src', 'data', 'categories.json');
  const warningsPath = path.join(root, 'data', 'publish-warnings.json');
  const backup = fs.readFileSync(categoriesPath, 'utf8');

  try {
    // Simulates an unseeded/fresh catalog (server/export.js writes {} when
    // catalog.json has zero kind:'category' rows) — this used to crash the
    // whole publish with a TypeError partway through the category loop.
    fs.writeFileSync(categoriesPath, JSON.stringify({}));

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    assert.ok(fs.existsSync(path.join(root, 'story.html')), 'story.html should still be generated');

    const warnings = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));
    assert.deepStrictEqual(
      [...warnings.skippedCategories].sort(),
      ['gwm', 'homeware', 'landrover', 'phones', 'toys'],
    );
  } finally {
    // This fixture makes every category's items list empty for the run
    // above (categories.json = {}) -- generate-pages.mjs's own I5 pruning
    // (stale detail-page cleanup) sees zero items written to products/ that
    // run and would otherwise treat every real products/*.html file as
    // stale and delete it. Restoring categories.json alone leaves that
    // deletion in place; regenerate with the real data restored so the
    // real per-item detail pages come back before this test finishes.
    fs.writeFileSync(categoriesPath, backup);
    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });
  }
});
