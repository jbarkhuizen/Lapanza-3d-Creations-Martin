import fs from 'fs';
import path from 'path';
import { listFilaments } from './filaments.js';
import { getSettings, publicSettings } from './settings.js';

function defaultPaths() {
  const root = process.cwd();
  return {
    catalogJsonPath: path.join(root, 'data', 'catalog.json'),
    filamentsSrc: path.join(root, 'src', 'data', 'filaments.json'),
    categoriesSrc: path.join(root, 'src', 'data', 'categories.json'),
    settingsSrc: path.join(root, 'src', 'data', 'settings.json'),
    settingsPublic: path.join(root, 'public', 'site-settings.json'),
  };
}

export function readCategoryProducts(catalogJsonPath = defaultPaths().catalogJsonPath) {
  if (!fs.existsSync(catalogJsonPath)) return [];
  const catalog = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8'));
  return (catalog.products || []).filter((p) => p.kind === 'category');
}

export function syncPublicJson(db, paths = defaultPaths()) {
  const filaments = listFilaments(db).map((f) => ({
    slug: f.slug,
    name: f.name,
    description: f.description,
    specs: f.specs,
    colourNote: f.colourNote,
    colours: f.colours.map((c) => ({
      name: c.name,
      sku: c.sku,
      price: `R${c.priceRand}`,
      weightG: c.weightG,
      shippingWeightG: c.shippingWeightG,
      rollLengthM: c.rollLengthM,
      stockQty: c.stockQty,
      imageUrl: c.imagePath || '',
    })),
  }));

  const categories = {};
  readCategoryProducts(paths.catalogJsonPath)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .forEach((p) => {
      categories[p.slug] = {
        slug: p.slug,
        name: p.name,
        description: p.description,
        crumbs: p.crumbs || `Home / ${p.name}`,
        ...(p.parent ? { parent: p.parent } : {}),
        items: (p.items || []).map((item) => ({
          name: item.name,
          details: item.details,
          material: item.material,
          size: item.size,
          finish: item.finish,
          price: item.price,
          sku: item.sku,
          imageUrl: item.imageUrl,
          weight: Number(item.weight) || 0,
          // Falls back to weight when unset, same as filament colours --
          // drives shipping-bracket matching, weight is just the spec.
          shippingWeight: item.shippingWeight != null && item.shippingWeight !== '' ? Number(item.shippingWeight) : Number(item.weight) || 0,
          stockQty: Number(item.stockQty) || 0,
          available: item.available !== false,
        })),
      };
    });

  const settings = publicSettings(getSettings(db));

  fs.writeFileSync(paths.filamentsSrc, JSON.stringify(filaments, null, 2));
  fs.writeFileSync(paths.categoriesSrc, JSON.stringify(categories, null, 2));
  fs.writeFileSync(paths.settingsSrc, JSON.stringify(settings, null, 2));
  fs.writeFileSync(paths.settingsPublic, JSON.stringify(settings, null, 2));
}

export { defaultPaths };
