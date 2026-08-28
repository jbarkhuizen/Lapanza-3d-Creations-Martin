import fs from 'fs';
import path from 'path';
import { listFilaments } from './filaments.js';
import { getSettings, publicSettings } from './settings.js';
import { formatRand, formatItemPrice } from './money.js';
import { itemAnchorId, categoryPagePath, filamentPagePath } from './item-anchor.js';
import { listTestimonials, publicTestimonial } from './testimonials.js';

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

// A featured-product entry only stores a productId (settings.featuredProducts,
// same scheme the cart already uses -- see src/js/cart.js), never a
// name/price/link -- resolved fresh here on every publish so it can never go
// stale. A productId that no longer matches anything (item deleted, SKU
// changed) is dropped rather than breaking the homepage. The category-item
// SKU-or-index fallback must match catalogueItems() in
// scripts/generate-pages.mjs exactly (listed items only, in the same order)
// or the resolved href lands on the wrong anchor.
function resolveFeaturedProducts(refs, filaments, categories) {
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((r) => r.active !== false)
    .map((r) => {
      const parts = String(r.productId || '').split(':');
      if (parts[0] === 'filament' && parts.length === 3) {
        const [, slug, sku] = parts;
        const filament = filaments.find((f) => f.slug === slug);
        const colour = filament?.colours.find((c) => c.sku === sku);
        if (!filament || !colour) return null;
        return {
          productId: r.productId,
          name: `${filament.name} — ${colour.name}`,
          price: colour.price,
          image: colour.imageUrl || '',
          href: `${filamentPagePath(slug)}#${itemAnchorId(colour.sku, colour.name)}`,
        };
      }
      if (parts[0] === 'category' && parts.length === 3) {
        const [, slug, skuOrIndex] = parts;
        const category = categories[slug];
        const listedItems = (category?.items || []).filter((it) => it.listed !== false);
        const item = listedItems.find((it, i) => (it.sku || String(i)) === skuOrIndex);
        if (!category || !item) return null;
        return {
          productId: r.productId,
          name: item.name,
          price: formatItemPrice(item.price),
          image: item.imageUrl || '',
          href: `${categoryPagePath(slug)}#${itemAnchorId(item.sku, item.name)}`,
        };
      }
      return null;
    })
    .filter(Boolean);
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
      price: formatRand(c.priceRand),
      weightG: c.weightG,
      shippingWeightG: c.shippingWeightG,
      rollLengthM: c.rollLengthM,
      stockQty: c.stockQty,
      imageUrl: c.imagePath || '',
      listed: c.listed !== false,
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
          // Car-parts fields (GWM/Landrover) -- sourceUrl deliberately
          // omitted, it's an admin-only reference, not customer-facing.
          creator: item.creator || '',
          models: Array.isArray(item.models) ? item.models : [],
          weight: Number(item.weight) || 0,
          // Falls back to weight when unset, same as filament colours --
          // drives shipping-bracket matching, weight is just the spec.
          shippingWeight: item.shippingWeight != null && item.shippingWeight !== '' ? Number(item.shippingWeight) : Number(item.weight) || 0,
          stockQty: Number(item.stockQty) || 0,
          available: item.available !== false,
          listed: item.listed !== false,
        })),
      };
    });

  const settings = publicSettings(getSettings(db));
  settings.featuredProducts = resolveFeaturedProducts(settings.featuredProducts, filaments, categories);
  // Backlog #51: published testimonials, public-safe subset only (never the
  // real customer_name/consent_note -- see testimonials.js's
  // publicTestimonial()). Not a real settings key/DB row, just rides along
  // in the same site-settings.json write the homepage already fetches at
  // runtime, same pattern as featuredProducts above.
  settings.testimonials = listTestimonials({ status: 'published' }, db).map(publicTestimonial);

  fs.writeFileSync(paths.filamentsSrc, JSON.stringify(filaments, null, 2));
  fs.writeFileSync(paths.categoriesSrc, JSON.stringify(categories, null, 2));
  fs.writeFileSync(paths.settingsSrc, JSON.stringify(settings, null, 2));
  fs.writeFileSync(paths.settingsPublic, JSON.stringify(settings, null, 2));
}

export { defaultPaths };
