import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

test('generate-pages renders an <img> for a colour with imageUrl, placeholder text otherwise', () => {
  const filamentsPath = path.join(root, 'src', 'data', 'filaments.json');
  const backup = fs.readFileSync(filamentsPath, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genpages-test-'));

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
            { name: 'With Photo', sku: 'SKU-1', price: 'R299', imageUrl: '/uploads/filaments/white.jpg' },
            { name: 'No Photo', sku: 'SKU-2', price: 'R299' },
          ],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.match(html, /<img src="\/uploads\/filaments\/white\.jpg"/);
    assert.match(html, /Photo coming soon/);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('generate-pages renders an in-stock count for stocked colours, "Out of stock" for zero/missing stock', () => {
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
            { name: 'Plenty', sku: 'SKU-1', price: 'R299', stockQty: 12 },
            { name: 'Zero', sku: 'SKU-2', price: 'R299', stockQty: 0 },
            { name: 'Unset', sku: 'SKU-3', price: 'R299' },
          ],
        },
      ]),
    );

    execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-pages.mjs')], { cwd: root });

    const html = fs.readFileSync(path.join(root, 'filament', 'test-pla.html'), 'utf8');
    assert.match(html, /12 in stock/);
    // A colour with 0 stock and one with no stockQty field at all must both
    // read "Out of stock" -- undefined is not a truthy stock count.
    assert.strictEqual((html.match(/Out of stock/g) || []).length, 2);
  } finally {
    fs.writeFileSync(filamentsPath, backup);
    fs.rmSync(path.join(root, 'filament', 'test-pla.html'), { force: true });
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
    fs.writeFileSync(categoriesPath, backup);
  }
});
