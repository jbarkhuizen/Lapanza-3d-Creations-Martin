import fs from 'fs';
import { randomUUID } from 'crypto';

export function parsePriceToRand(priceStr) {
  if (typeof priceStr === 'number') return Math.round(priceStr);
  if (!priceStr) return 0;
  const match = String(priceStr).match(/\d+/);
  return match ? Math.round(parseFloat(match[0])) : 0;
}

export function migrateFromCatalogJson(db, catalogJsonPath) {
  if (!fs.existsSync(catalogJsonPath)) return { migrated: false, filamentTypeCount: 0 };

  const catalog = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'));
  const now = new Date().toISOString();
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const filamentProducts = products.filter((p) => p.kind === 'filament');
  const categoryProducts = products.filter((p) => p.kind !== 'filament');

  const insertType = db.prepare(`
    INSERT INTO filament_types
      (id, slug, name, description, colour_note, specs_json, seo_title, seo_description, internal_notes, status, featured, sort_order, created_at, updated_at)
    VALUES
      (@id, @slug, @name, @description, @colour_note, @specs_json, @seo_title, @seo_description, @internal_notes, @status, @featured, @sort_order, @created_at, @updated_at)
  `);
  const insertColour = db.prepare(`
    INSERT INTO filament_colours
      (id, filament_type_id, name, hex, sku, weight_g, roll_length_m, price_rand, stock_qty, image_path, notes, sort_order, created_at, updated_at)
    VALUES
      (@id, @filament_type_id, @name, @hex, @sku, @weight_g, @roll_length_m, @price_rand, @stock_qty, @image_path, @notes, @sort_order, @created_at, @updated_at)
  `);
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const txn = db.transaction(() => {
    filamentProducts.forEach((p, typeIndex) => {
      const typeId = randomUUID();
      insertType.run({
        id: typeId,
        slug: p.slug,
        name: p.name,
        description: p.description || '',
        colour_note: p.colourNote || '',
        specs_json: JSON.stringify(p.specs || []),
        seo_title: p.seoTitle || '',
        seo_description: p.seoDescription || '',
        internal_notes: p.internalNotes || '',
        status: p.status === 'draft' ? 'draft' : 'published',
        featured: p.featured ? 1 : 0,
        sort_order: p.sortOrder ?? typeIndex,
        created_at: p.createdAt || now,
        updated_at: p.updatedAt || now,
      });
      (p.colours || []).forEach((c, colourIndex) => {
        insertColour.run({
          id: randomUUID(),
          filament_type_id: typeId,
          name: c.name || '',
          hex: c.hex || '',
          sku: c.sku || `${p.slug}-${colourIndex}`,
          weight_g: 0,
          roll_length_m: null,
          price_rand: parsePriceToRand(c.price),
          stock_qty: c.inStock === false ? 0 : 1,
          image_path: null,
          notes: c.notes || '',
          sort_order: colourIndex,
          created_at: now,
          updated_at: now,
        });
      });
    });

    Object.entries(catalog.settings || {}).forEach(([key, value]) => {
      if (key === 'adminPassword' || key === 'adminPasswordHash') return;
      insertSetting.run(key, JSON.stringify(value));
    });
  });
  txn();

  fs.writeFileSync(
    catalogJsonPath,
    JSON.stringify({ version: catalog.version || 1, updatedAt: now, products: categoryProducts }, null, 2),
  );

  return { migrated: true, filamentTypeCount: filamentProducts.length };
}
