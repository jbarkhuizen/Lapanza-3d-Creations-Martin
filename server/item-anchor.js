// Shared between scripts/generate-pages.mjs (writes the ids onto each
// card/swatch) and server/export.js (resolves a featured-product reference
// into a link pointing at one) -- must stay identical in both places or a
// featured product's link silently lands on the wrong element, or nothing.

// A stable per-item anchor id, built from whatever uniquely identifies the
// item on its own page (a SKU, or a build-time index/name fallback when no
// SKU exists -- category items don't always have one, unlike filament
// colours). Only needs to be unique within one generated page, not sitewide.
export function itemAnchorId(primary, fallback) {
  const raw = String(primary || fallback || 'item').trim();
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `item-${slug || 'item'}`;
}

// Matches scripts/generate-pages.mjs's categoryPages array -- car-parts
// categories live one directory down, everything else is flat at the root.
export function categoryPagePath(slug) {
  return slug === 'gwm' || slug === 'landrover' ? `car-parts/${slug}.html` : `${slug}.html`;
}

export function filamentPagePath(slug) {
  return `filament/${slug}.html`;
}
