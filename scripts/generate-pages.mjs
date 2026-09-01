/**
 * Regenerates all HTML pages from catalog data while preserving the site layout.
 * Run: npm run generate
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parsePrice, formatItemPrice } from '../server/money.js';
import { itemAnchorId } from '../server/item-anchor.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filaments = JSON.parse(fs.readFileSync(path.join(root, 'src/data/filaments.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(root, 'src/data/categories.json'), 'utf8'));

// SITE-027: this script has no DB access, only the JSON exports export.js
// already syncs on every publish -- read the threshold from there rather
// than duplicating a second hardcoded default that could drift from the
// admin-configurable one in settings-defaults.js. Missing/invalid falls
// back to that same default (3) so a fresh checkout without a synced
// settings.json yet (or the unit test below, which never writes one)
// still generates valid pages.
let LOW_STOCK_THRESHOLD = 3;
// SITE-010: same reasoning as the threshold above -- real figures from the
// business owner, admin-editable, read from the synced JSON since this
// script has no DB access. Defaults here must match settings-defaults.js.
let PRINT_LEAD_TIME_DAYS = '3-5';
let FILAMENT_DISPATCH_DAYS = '1-2';
let VOLUME_DISCOUNTS = [];
// #130: car-part brands, admin-configurable (Settings). name -> page slug.
let CAR_PART_BRANDS = [{ name: 'GWM' }, { name: 'Landrover' }];
try {
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'src/data/settings.json'), 'utf8'));
  const configured = Number(settings.lowStockThreshold);
  if (Number.isFinite(configured) && configured > 0) LOW_STOCK_THRESHOLD = configured;
  if (settings.printLeadTimeDays) PRINT_LEAD_TIME_DAYS = settings.printLeadTimeDays;
  if (settings.filamentDispatchDays) FILAMENT_DISPATCH_DAYS = settings.filamentDispatchDays;
  if (Array.isArray(settings.carPartBrands) && settings.carPartBrands.length) CAR_PART_BRANDS = settings.carPartBrands.filter((x) => x && x.active !== false && x.name);
  if (Array.isArray(settings.volumeDiscounts)) VOLUME_DISCOUNTS = settings.volumeDiscounts.filter((t) => t && t.active !== false && Number(t.minQty) > 0 && Number(t.pct) > 0);
} catch {
  /* settings.json not synced yet -- use the defaults above */
}

// SITE-010: distinguishes ready-stock filament (real stockQty, dispatches
// fast) from made-to-order printed products (toys/homeware/phones/car
// parts -- no stock concept, always printed on demand) so shoppers don't
// expect filament-speed turnaround on a custom print, or vice versa.
// Backlog #60: shopper-facing note for configured volume tiers -- empty
// string when none are configured, so the feature is invisible until the
// owner sets real numbers in Settings.
function volumeDiscountNote() {
  if (!VOLUME_DISCOUNTS.length) return '';
  const tiers = [...VOLUME_DISCOUNTS].sort((a, b) => Number(a.minQty) - Number(b.minQty))
    .map((t) => `${t.minQty}+ rolls: ${t.pct}% off`).join(' · ');
  return `<div class="rounded-sm border border-charcoal/10 bg-linen/60 p-4 text-sm text-espresso/70 mb-8"><strong style="color:#2e6e46">Volume pricing</strong> — ${tiers}, applied automatically at checkout on filament.</div>`;
}

// Backlog #76 (SITE-042): purchase FAQ beside the buying actions, one
// flavour per page type. Every answer is either a fixed product fact
// (diameter, spool size), pulled live from admin-editable settings
// (dispatch/lead times), or restates the real published policies -- no
// invented claims. Emits matching FAQPage JSON-LD inline (valid in <body>).
function purchaseFaq(kind) {
  const faqs =
    kind === 'filament'
      ? [
          ['What diameter and spool size is your filament?', 'All filament is 1.75 mm diameter on 1 kg spools unless a product page says otherwise.'],
          ['How fast does filament ship?', `Ready stock dispatches within ${FILAMENT_DISPATCH_DAYS} business days of payment — PUDO Locker nationwide, Local Delivery around Centurion, or collect from us.`],
          ['What print settings should I use?', 'Each filament page lists its real print and bed temperatures under Specifications. Not sure which material suits your project? See our Materials Guide.'],
          ['Can I return filament?', 'Unopened, unused spools have a 7-day cooling-off period. Faulty or misdescribed items are covered for 6 months — see our Returns Policy.'],
        ]
      : [
          ['How long does a printed item take?', `Items are printed to order — allow ${PRINT_LEAD_TIME_DAYS} business days for production before dispatch or collection.`],
          ['Can I choose the colour or material?', "Usually, yes — use the item's Enquire link or the custom request box below and tell us what you'd like."],
          ["Can you print something that isn't listed?", 'That is half of what we do. Send a photo, sketch, file or part number through the custom design request and we will quote you.'],
          ['Can I return a custom print?', 'Custom-printed items cannot be returned for change of mind, but faulty or misdescribed items are covered for 6 months — see our Returns Policy.'],
        ];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  return `<div class="mt-12">
    <h2 class="font-serif text-xl mb-4 tracking-tight">Quick Questions</h2>
    <div class="stack gap-2">
      ${faqs
        .map(
          ([q, a]) => `<details class="border border-charcoal/10 rounded-sm px-4 py-3">
        <summary class="text-sm font-semibold cursor-pointer">${q}</summary>
        <p class="text-sm text-espresso/70 leading-relaxed mt-2">${a}</p>
      </details>`,
        )
        .join('')}
    </div>
    ${jsonLdScript(jsonLd)}
  </div>`;
}

function deliveryNote(kind) {
  const dispatch =
    kind === 'filament'
      ? `Ready stock — dispatched within ${FILAMENT_DISPATCH_DAYS} business days of payment.`
      : `Made to order — please allow ${PRINT_LEAD_TIME_DAYS} business days for production before dispatch.`;
  return `<div class="flex items-start gap-2.5 rounded-sm border border-charcoal/10 bg-linen/60 p-4 text-sm text-espresso/70 mb-8">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 mt-0.5"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
    <span>${dispatch} PUDO Locker ships nationwide across South Africa; Local Delivery covers the Centurion area — see Shipping Options at checkout for exact zones and pricing.</span>
  </div>`;
}

const SITE = {
  name: 'Lapanza 3D Creative Lab',
  whatsapp:
    'https://api.whatsapp.com/send?phone=27826639608&text=Hello%20Lapanza%2C%20I%20am%20contacting%20you%20from%20your%20new%203D%20site.',
  email: 'lapanzaonline@gmail.com',
  phone: '082 663 9608',
  phoneTel: '+27826639608',
  facebook: 'https://www.facebook.com/profile.php?id=61591435717039',
  instagram: 'https://www.instagram.com/lapanza_beauty_lifestyle/',
};

// Backlog #109 (SITE-075): canonical URLs, og:url, and structured data are
// emitted per page; robots.txt + sitemap.xml are written at the end of the
// run from the pages actually generated this pass.
const SITE_ORIGIN = 'https://www.lapanza3d.co.za';

// I3: og:image for a product detail page, built from the page's own gallery
// array (first photo) -- passed through head()'s existing `extra` slot for
// arbitrary additional <head> markup. Local /uploads/... paths are made
// absolute against SITE_ORIGIN the same way productDetailJsonLd's `image`
// field already does; an external http(s) URL is trusted as-is.
function ogImageTag(images) {
  const url = images && images[0];
  if (!url) return '';
  const absolute = /^https?:\/\//i.test(url) ? url : `${SITE_ORIGIN}/${String(url).replace(/^\//, '')}`;
  return `<meta property="og:image" content="${escapeAttr(absolute)}">`;
}

function jsonLdScript(data) {
  if (!data) return '';
  const list = Array.isArray(data) ? data : [data];
  // JSON-LD is metadata, not rendered HTML, but it still lands inside a
  // <script> tag -- escape the one sequence that could break out of it.
  return list.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n');
}

function head({ title, description, depth = 0, pagePath = '', extra = '', script = '/src/js/site.js', jsonLd = null }) {
  const prefix = '../'.repeat(depth);
  const canonical = `${SITE_ORIGIN}/${pagePath === 'index.html' ? '' : pagePath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#f7f3eb">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
${jsonLdScript(jsonLd)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..800&display=swap" rel="stylesheet">
<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">
<script>
(function(){try{var t=localStorage.getItem('lapanza-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();
</script>
${extra}
<script>window.__PAGE_DEPTH__=${depth};window.__PAGE_PATH__=${JSON.stringify(pagePath)};</script>
<script type="module" src="${prefix}${script.replace(/^\//, '')}"></script>
</head>`;
}

function shellStart({ depth = 0, homeHeader = false } = {}) {
  const prefix = '../'.repeat(depth);
  if (homeHeader) {
    return `
<body class="font-sans antialiased">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="site-grain" aria-hidden="true"></div>

  <header class="fixed top-0 left-0 right-0 md:left-72 z-40 nav-blur border-b border-charcoal/5">
    <div class="max-w-7xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between gap-4">
      <a href="${prefix}index.html" class="md:hidden brand-mark font-serif text-xl tracking-tight font-semibold">Lapanza <span class="mark-3d">3D</span></a>
      <nav class="hidden md:flex items-center gap-10 text-sm font-medium tracking-wide" aria-label="Primary">
        <a href="${prefix}story.html" class="hover:text-terracotta transition-colors">Our Story</a>
        <a href="#range" class="hover:text-terracotta transition-colors">Shop the range</a>
        <a href="#contact" class="hover:text-terracotta transition-colors">Contact</a>
      </nav>
      <div class="flex items-center gap-2 ml-auto">
        <button type="button" class="theme-toggle-btn md:hidden" data-theme-toggle aria-label="Toggle dark mode">
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/></svg>
        </button>
        <button type="button" onclick="toggleDrawer()"
                class="md:hidden border-2 border-charcoal rounded-full px-4 py-2 text-xs uppercase tracking-wide font-semibold"
                aria-controls="sidebar-drawer" aria-expanded="false">
          Menu
        </button>
        <a href="${SITE.whatsapp}"
           class="hidden md:inline-block text-sm font-semibold bg-charcoal text-cream rounded-full px-5 py-2 hover:bg-terracotta transition-colors"
           target="_blank" rel="noopener noreferrer">
          Get in touch
        </a>
      </div>
    </div>
  </header>

  <div id="sidebar-drawer" class="hidden md:hidden fixed inset-0 z-50 bg-cream overflow-y-auto px-6 py-6">
    <div class="flex justify-end mb-4">
      <button type="button" onclick="toggleDrawer(false)"
              class="border-2 border-charcoal rounded-full px-4 py-2 text-xs uppercase tracking-wide font-semibold">Close</button>
    </div>
    <nav data-site-nav class="site-sidebar text-sm" aria-label="Catalogue"></nav>
  </div>

  <div class="md:flex">
    <aside class="hidden md:block w-72 shrink-0 border-r border-charcoal/10 sticky top-0 h-screen overflow-y-auto px-6 pt-10 pb-10" aria-label="Catalogue">
      <nav data-site-nav class="site-sidebar text-sm"></nav>
    </aside>
    <div class="flex-1 min-w-0" id="main">`;
  }

  return `
<body class="font-sans antialiased">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="site-grain" aria-hidden="true"></div>

  <div class="md:hidden sticky top-0 z-30 nav-blur border-b border-charcoal/10 flex items-center justify-between px-4 py-3 gap-2">
    <a href="${prefix}index.html" class="brand-mark font-serif text-lg tracking-tight font-semibold">Lapanza <span class="mark-3d">3D</span></a>
    <div class="flex items-center gap-2">
      <button type="button" class="theme-toggle-btn" data-theme-toggle aria-label="Toggle dark mode">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/></svg>
      </button>
      <button type="button" onclick="toggleDrawer()" class="border-2 border-charcoal/20 rounded-full px-3 py-1.5 text-xs uppercase tracking-wide font-semibold">Menu</button>
    </div>
  </div>
  <div id="sidebar-drawer" class="hidden md:hidden bg-cream border-b border-charcoal/10 px-6 py-4">
    <nav data-site-nav class="site-sidebar text-sm" aria-label="Catalogue"></nav>
  </div>

  <div class="md:flex">
    <aside class="aside-panel hidden md:block w-72 shrink-0 min-h-screen sticky top-0 px-6 py-10 overflow-y-auto" aria-label="Catalogue">
      <nav data-site-nav class="site-sidebar text-sm"></nav>
    </aside>`;
}

function footer({ depth = 0, home = false } = {}) {
  const prefix = '../'.repeat(depth);
  if (home) {
    return `
  <footer class="border-t-2 border-charcoal py-14">
    <div class="max-w-7xl mx-auto px-6 md:px-10 grid md:grid-cols-4 gap-10 items-start">
      <div class="font-serif text-xl font-semibold">Lapanza <span class="text-terracotta italic">3D</span></div>
      <a href="${prefix}story.html" class="text-sm text-espresso/70 hover:text-terracotta transition-colors">Our Story</a>
      <div class="text-sm text-espresso/70 space-y-1">
        <p>&copy; <span data-year>${SITE.year || 2026}</span> Lapanza 3D Creative Lab</p>
        <p>${SITE.email} · ${SITE.phone}</p>
      </div>
      <div class="flex md:justify-end gap-4 text-sm">
        <a href="${SITE.facebook}" target="_blank" rel="noopener noreferrer" class="hover:text-terracotta transition-colors">Facebook</a>
        <a href="${SITE.instagram}" target="_blank" rel="noopener noreferrer" class="hover:text-terracotta transition-colors">Instagram</a>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-6 md:px-10 mt-8 pt-6 border-t border-charcoal/10 flex flex-wrap gap-x-5 gap-y-2 text-xs text-espresso/55">
      <a href="${prefix}terms.html" class="hover:text-terracotta transition-colors">Terms &amp; Conditions</a>
      <a href="${prefix}privacy.html" class="hover:text-terracotta transition-colors">Privacy Policy</a>
      <a href="${prefix}returns.html" class="hover:text-terracotta transition-colors">Returns &amp; Refunds</a>
    </div>
  </footer>
    </div>
  </div>
</body>
</html>`;
  }

  return `
  </div>

  <footer class="border-t border-charcoal/10 py-10 md:pl-72">
    <div class="mx-auto max-w-5xl px-6 sm:px-10 lg:px-16 xl:px-24 text-xs text-espresso/60 flex flex-wrap gap-4 justify-between">
      <span>&copy; <span data-year>2026</span> Lapanza 3D Creative Lab</span>
      <span>${SITE.email} &middot; ${SITE.phone}</span>
    </div>
    <div class="mx-auto max-w-5xl px-6 sm:px-10 lg:px-16 xl:px-24 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-espresso/55">
      <a href="${prefix}terms.html" class="hover:text-terracotta transition-colors">Terms &amp; Conditions</a>
      <a href="${prefix}privacy.html" class="hover:text-terracotta transition-colors">Privacy Policy</a>
      <a href="${prefix}returns.html" class="hover:text-terracotta transition-colors">Returns &amp; Refunds</a>
    </div>
  </footer>
</body>
</html>`;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function addToCartButton({ productId, name, price, image, weight, extraClass = 'w-full' }) {
  // Weight is grams end to end (matches filament_colours.weight_g /
  // order_items.weight / cart.js) so the cart's total-weight math and the
  // server's shipping-bracket matching agree with what's shown here.
  return `<button type="button" class="${extraClass} mt-2 text-xs font-semibold bg-charcoal text-cream rounded-full px-3 py-2 hover:bg-terracotta transition-colors"
            data-add-to-cart
            data-product-id="${escapeAttr(productId)}"
            data-name="${escapeAttr(name)}"
            data-price="${parsePrice(price)}"
            data-weight="${Number(weight) || 0}"
            data-image="${escapeAttr(image || '')}">Add to Cart</button>`;
}

// Found 2026-08-27: 106 of 107 filament colours in the live DB carry an
// `imageUrl` pointing at a file that was never actually uploaded (a bulk
// catalog import on 2026-08-17 seeded the expected filename as metadata
// without the binary ever landing in public/uploads/filaments -- confirmed
// missing on both the VPS and local dev, not a deletion). Truthiness alone
// was enough to render a broken <img> instead of the "Photo coming soon"
// placeholder that already exists for a colour with no imageUrl at all --
// this closes that gap by checking the file is actually there before
// trusting the reference, so a stale/broken path degrades the same way a
// genuinely absent one always has.
// Backlog #106: emit a <picture> with WebP srcset when responsive variants
// exist on disk (server/images.js writes <name>-480.webp / <name>-960.webp
// next to every upload; scripts/generate-image-variants.mjs backfilled the
// existing library). Falls back to the plain <img> for external URLs or
// photos without variants -- output is never worse than before.
function responsiveImg(url, alt, className) {
  const plain = `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" class="${className}" loading="lazy">`;
  if (!url || /^https?:\/\//i.test(url)) return plain;
  const parsed = path.parse(url);
  const variants = [480, 960]
    .filter((w) => fs.existsSync(path.join(root, 'public', parsed.dir, `${parsed.name}-${w}.webp`)))
    .map((w) => ({ w, url: `${parsed.dir}/${parsed.name}-${w}.webp` }));
  if (!variants.length) return plain;
  const srcset = variants.map((v) => `${escapeAttr(v.url)} ${v.w}w`).join(', ');
  // Cards render ~230-300px wide; give the browser real numbers so it picks
  // the 480 variant on virtually every screen.
  return `<picture><source type="image/webp" srcset="${srcset}" sizes="(min-width: 768px) 300px, 45vw">${plain}</picture>`;
}

// #95: renders 1-5 photos as a scroll-snap strip with dot indicators.
// 'compact' (card carousel, no thumbnail strip) vs 'full' (detail-page
// hero, adds a clickable thumbnail strip below the dots). The actual
// swipe/drag behavior is pure CSS scroll-snap; src/js/product-gallery.js
// only keeps the dots in sync via IntersectionObserver and handles
// dot/thumbnail clicks -- see that file for the JS half.
function productGalleryHtml({ images, alt, mode = 'compact' }) {
  const list = (images && images.length ? images : []).slice(0, 5);
  if (!list.length) {
    return `<div class="w-full aspect-square rounded-sm bg-gradient-to-br from-linen to-cream flex items-center justify-center border border-charcoal/10"><span class="text-espresso/35 text-[0.65rem] uppercase tracking-[0.2em]">Photo coming soon</span></div>`;
  }
  const slides = list
    .map((url, i) => `<div class="gallery-slide" data-gallery-slide="${i}">${responsiveImg(url, alt, 'w-full aspect-square object-cover')}</div>`)
    .join('');
  const dots = list.length > 1
    ? `<div class="gallery-dots" role="tablist">${list.map((_, i) => `<button type="button" class="gallery-dot" data-gallery-dot="${i}" aria-label="Photo ${i + 1} of ${list.length}"></button>`).join('')}</div>`
    : '';
  const thumbs = mode === 'full' && list.length > 1
    ? `<div class="gallery-thumb-strip">${list.map((url, i) => `<button type="button" class="gallery-thumb-btn" data-gallery-thumb="${i}">${responsiveImg(url, alt, 'w-full h-full object-cover')}</button>`).join('')}</div>`
    : '';
  return `<div class="product-gallery" data-gallery data-gallery-mode="${mode}">
            <div class="gallery-track">${slides}</div>
            ${dots}
            ${thumbs}
          </div>`;
}

// Backlog #66 (SITE-032): standardized fulfilment label per category item.
// Vocabulary is fixed here, not admin-editable (same enum discipline as
// order/todo statuses): stocked units ship fast; an available item without
// stock is printed on demand; unavailable means what it says. Filament
// swatches keep their own richer stock messaging (In stock / Only N left).
function fulfilmentLabel(item) {
  if (item.available === false) return `<p class="text-[0.65rem] uppercase tracking-[0.12em] font-bold text-espresso/40 mb-3">Currently Unavailable</p>`;
  if (Number(item.stockQty) > 0) return `<p class="text-[0.65rem] uppercase tracking-[0.12em] font-bold text-forest mb-3" style="color:#2e6e46">Ready to Ship</p>`;
  // Zero stock reads "Out of Stock", not the old "Printed to Order": the
  // server reserves stock at order creation for EVERY item kind and hard-
  // rejects a zero-stock line, so a buyable-looking made-to-order card was a
  // dead end the customer only discovered after filling in the whole
  // checkout form (launch-audit blocker #4). The Enquire link stays.
  return `<p class="text-[0.65rem] uppercase tracking-[0.12em] font-bold text-terracotta mb-3">Out of Stock</p>`;
}

// Backlog #50 (SITE-016): reusable "why buy from Lapanza" strip, placed on
// catalogue pages near the buying decision. Every claim is factual and
// self-maintaining -- dispatch/lead-time figures come from the same
// admin-editable settings the delivery notes read, so wording can never
// drift from what the business actually promises. Homepage and checkout
// already carry their own variants (family-run blurb, trust badges).
function valueProps(kind) {
  const speed =
    kind === 'filament'
      ? `Ready stock — dispatched in ${FILAMENT_DISPATCH_DAYS} business days`
      : `Printed to order in ${PRINT_LEAD_TIME_DAYS} business days`;
  const props = [
    ['Family-run local lab', 'Real people in Centurion, not a print farm'],
    [speed, 'PUDO nationwide, Local Delivery or collect'],
    ['Secure Payfast checkout', 'Card or Instant EFT — we never see card details'],
    ['Custom work welcome', 'Upload a file or idea for a quote any time'],
  ];
  return `<div class="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
    ${props
      .map(
        ([title, sub]) => `<div class="border border-charcoal/10 rounded-sm bg-linen/40 p-4">
          <p class="text-sm font-semibold mb-1">${title}</p>
          <p class="text-xs text-espresso/55 leading-relaxed">${sub}</p>
        </div>`,
      )
      .join('')}
  </div>`;
}

function imageFileExists(url) {
  if (!url) return false;
  // Category items can still carry a plain external URL from before the
  // upload feature existed -- only a local /uploads/... path is ours to
  // verify; trust an http(s) URL as-is (no network call at build time).
  if (/^https?:\/\//i.test(url)) return true;
  try {
    return fs.existsSync(path.join(root, 'public', url));
  } catch {
    return false;
  }
}

// C2: gallery-first image resolution, shared by listing cards, cart button
// thumbnails, and JSON-LD image fields -- mirrors the DB-backed
// colourGalleryPaths()/itemGalleryPaths() fallback (real gallery photos
// first, else the legacy single-photo field, else none) but operates on the
// `images`/`imageUrl` fields this script reads straight from
// filaments.json/categories.json (export.js already populated `images` from
// those same DB helpers). Only the admin gallery panel's own read-only
// fallback (I1, admin/admin.js) is a separate implementation, since it has
// no filesystem to check against.
function galleryFirstImages(entity) {
  if (entity?.images?.length) return entity.images;
  if (entity?.imageUrl && imageFileExists(entity.imageUrl)) return [entity.imageUrl];
  return [];
}

// Meta descriptions used to be a hard .slice(0, 155) that cut mid-word,
// mid-sentence ("…corn starch or sugarcane. It") on 12 of the 20 filament
// pages -- prefer ending at the last complete sentence that fits, fall back
// to the last whole word plus an ellipsis.
function metaDescription(text, max = 155) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (sentenceEnd > max * 0.5) return window.slice(0, sentenceEnd + 1);
  const wordEnd = window.lastIndexOf(' ');
  return `${window.slice(0, wordEnd > 0 ? wordEnd : max).replace(/[,;:.\s]+$/, '')}…`;
}

function stockMessage(stockQty) {
  const qty = Number(stockQty) || 0;
  if (qty <= 0) return { label: 'Out of stock', className: 'text-terracotta font-semibold' };
  if (qty <= LOW_STOCK_THRESHOLD) return { label: `Only ${qty} left`, className: 'text-terracotta font-semibold' };
  return { label: 'In stock', className: 'text-espresso/50' };
}

function colourCards(colours, filament) {
  if (!colours?.length) return '';
  return colours
    .filter((c) => c.listed !== false)
    .map((c) => {
      const stock = stockMessage(c.stockQty);
      const galleryImages = galleryFirstImages(c);
      return `<div id="${itemAnchorId(c.sku, c.name)}" class="swatch-card border border-charcoal/10 rounded-sm p-4" data-colour-name="${c.name}" data-price="${escapeAttr(String(parsePrice(c.price) || 0))}" data-instock="${Number(c.stockQty) > 0 ? 1 : 0}">
                  <a href="${colourDetailSlug(filament.slug, c.sku)}.html" class="block mb-3" aria-label="View ${escapeAttr(c.name)} details">
                    ${productGalleryHtml({ images: galleryImages, alt: c.name, mode: 'compact' })}
                  </a>
                  <p class="font-medium mb-1 tracking-tight">${c.name}</p>
                  <p class="text-espresso/45 text-[0.7rem] mb-2 font-mono">${c.sku}</p>
                  <p class="text-terracotta font-semibold">${c.price}</p>
                  <p class="text-[0.72rem] mt-0.5 ${stock.className}">${stock.label}</p>
                  ${Number(c.stockQty) <= 0 ? `<button type="button" class="restock-notify text-xs font-semibold text-terracotta hover:underline mt-1" data-restock-product="filament:${escapeAttr(filament.slug)}:${escapeAttr(c.sku)}">Email me when it's back</button>` : ''}
                  ${Number(c.stockQty) > 0 ? addToCartButton({
                    productId: `filament:${filament.slug}:${c.sku}`,
                    name: `${filament.name} — ${c.name}`,
                    price: c.price,
                    image: galleryImages[0] || '',
                    weight: c.shippingWeightG ?? c.weightG,
                  }) : ''}
                </div>`;
    })
    .join('\n');
}

function specsBlock(specs) {
  if (!specs?.length) {
    return `<p class="text-espresso/50 text-sm mb-10 italic">Spec sheet not yet available for this type — WhatsApp us for print guidance.</p>`;
  }
  const rows = specs
    .map(
      (s) => `<div class="flex justify-between border-b border-charcoal/10 py-3 last:border-0"><span class="text-espresso/55 text-sm">${s.label}</span><span class="font-semibold tracking-tight">${s.value}</span></div>`,
    )
    .join('\n');
  return `<div class="mb-12"><h2 class="font-serif text-xl mb-4 tracking-tight">Specifications</h2><div class="spec-panel max-w-md">${rows}</div></div>`;
}

// GWM/Landrover only. Model checkboxes come from the DISTINCT models
// actually present across this page's own (listed) items -- not the full
// admin-managed carPartModels list -- so a checkbox is never shown for a
// model with zero matching parts on this particular page, and the filter
// self-maintains as items/models change without needing a rebuild-time
// dependency on Settings beyond what's already baked into each item.
function partFilterBar(items) {
  const list = (Array.isArray(items) ? items : []).filter((item) => item.listed !== false);
  // Count per model (not just list the distinct names) so each dropdown
  // option can show how many parts fit it, e.g. "P300 (4)" -- single-select,
  // not multi: in practice a car-parts item here fits one specific model,
  // and a dropdown reads cleaner than a checkbox list of one.
  const counts = new Map();
  list.forEach((item) => (item.models || []).forEach((m) => counts.set(m, (counts.get(m) || 0) + 1)));
  const models = [...counts.keys()].sort();
  const options = models.map((m) => `<option value="${escapeAttr(m)}">${escapeAttr(m)} (${counts.get(m)})</option>`).join('');
  return `
      <div id="part-filter-bar" class="mb-8 p-5 bg-linen border-2 border-charcoal/10 rounded-sm">
        <input type="search" id="part-search" placeholder="Search parts by name, description or designer…"
               class="w-full mb-4 px-4 py-2.5 border-2 border-charcoal/15 rounded-sm bg-cream text-sm focus:outline-none focus:border-terracotta" />
        ${models.length ? `<select id="part-model-filter" class="px-4 py-2.5 border-2 border-charcoal/15 rounded-sm bg-cream text-sm focus:outline-none focus:border-terracotta">
          <option value="">All models</option>
          ${options}
        </select>` : ''}
      </div>`;
}

function catalogueItems(label, items, categorySlug, depth = 0) {
  const all = Array.isArray(items) ? items : [];
  const list = all.filter((item) => item.listed !== false);
  if (!list.length) return cataloguePlaceholders(label);

  return list
    .map((item, i) => {
      const meta = [item.material, item.size, item.finish].filter(Boolean).join(' · ');
      // Car-parts only (GWM/Landrover) -- absent on every other category's
      // items, so this line simply never renders for them.
      const fitment = [item.creator ? `Design: ${item.creator}` : '', item.models?.length ? `Fits: ${item.models.join(', ')}` : '']
        .filter(Boolean)
        .join(' · ');
      const galleryImages = galleryFirstImages(item);
      const img = productGalleryHtml({ images: galleryImages, alt: item.name, mode: 'compact' });
      const name = item.name || `${label} piece`;
      // Category items don't always have an admin-set sku (it's optional,
      // unlike filament colour skus which are unique in the DB) — fall back
      // to a build-time index so the productId is still stable across a
      // regen as long as item order doesn't change.
      // Stock gates the button (launch-audit #4): the server's
      // reserveStockForOrder throws on a zero-stock line no matter what the
      // page showed, so rendering Add to Cart for it just moves the
      // rejection to the worst possible moment.
      const canAddToCart = item.price && item.available !== false && Number(item.stockQty) > 0;
      // Read by src/js/car-parts-filter.js -- only meaningful on GWM/Landrover
      // pages (the only ones with a search/model filter bar rendered), but
      // harmless to include everywhere: cheap, and keeps this function from
      // needing to special-case categorySlug.
      const searchIndex = [item.name, item.details, item.creator].filter(Boolean).join(' ').toLowerCase();
      const modelList = (item.models || []).join('|');
      return `<article id="${itemAnchorId(item.sku, item.name || i)}" class="group border border-charcoal/10 rounded-sm overflow-hidden hover:border-terracotta transition-colors" data-search="${escapeAttr(searchIndex)}" data-models="${escapeAttr(modelList)}">
              <a href="${'../'.repeat(depth)}products/${itemDetailSlug(categorySlug, item, i)}.html" class="block aspect-square bg-gradient-to-br from-linen to-cream flex items-center justify-center border-b border-charcoal/10 overflow-hidden" aria-label="View ${escapeAttr(item.name)} details">
                ${img}
              </a>
              <div class="p-4">
                <h3 class="font-serif text-lg mb-1">${name}</h3>
                <p class="text-espresso/60 text-sm mb-2">${item.details || 'Custom printed to order.'}</p>
                ${meta ? `<p class="text-espresso/45 text-xs mb-2">${meta}</p>` : ''}
                ${fitment ? `<p class="text-espresso/45 text-xs mb-2">${fitment}</p>` : ''}
                ${item.price ? `<p class="text-terracotta font-semibold mb-1">${formatItemPrice(item.price)}</p>` : ''}
                ${fulfilmentLabel(item)}
                <a href="${SITE.whatsapp}" class="text-sm font-semibold text-terracotta hover:underline" target="_blank" rel="noopener noreferrer">Enquire</a>
                ${
                  canAddToCart
                    ? addToCartButton({
                        productId: `category:${categorySlug}:${item.sku || i}`,
                        name,
                        price: item.price,
                        image: galleryImages[0] || '',
                        weight: item.shippingWeight ?? item.weight,
                      })
                    : ''
                }
              </div>
            </article>`;
    })
    .join('\n');
}

function cataloguePlaceholders(label) {
  return Array.from({ length: 6 })
    .map(
      () => `<article class="group border border-charcoal/10 rounded-sm overflow-hidden hover:border-terracotta transition-colors">
              <div class="aspect-square bg-gradient-to-br from-linen to-cream flex items-center justify-center border-b border-charcoal/10">
                <span class="text-espresso/35 text-xs uppercase tracking-[0.2em]">Photo coming soon</span>
              </div>
              <div class="p-4">
                <h3 class="font-serif text-lg mb-1">${label} piece</h3>
                <p class="text-espresso/60 text-sm mb-3">Custom printed to order — material, size and finish on request.</p>
                <a href="${SITE.whatsapp}" class="text-sm font-semibold text-terracotta hover:underline" target="_blank" rel="noopener noreferrer">Enquire</a>
              </div>
            </article>`,
    )
    .join('\n');
}

// Filament/category detail pages were the one spot admins/customers reported
// feeling stuck -- the breadcrumb's "Home" link is small and easy to miss,
// mobile hides the sidebar catalogue nav behind the hamburger Menu button,
// and a long colour/product grid pushes that breadcrumb well off-screen by
// the time you're done browsing. A real button-styled link, repeated at the
// top AND the bottom of the page, fixes both without depending on browser
// history (a shared/bookmarked link has none) or the sidebar being visible.
function backToHomeButton({ depth, label = '← Back to Home' }) {
  return `<a href="${'../'.repeat(depth)}index.html" class="inline-flex text-sm font-semibold border-2 border-charcoal rounded-full px-5 py-2.5 hover:bg-charcoal hover:text-cream transition-colors">${label}</a>`;
}

const writtenPages = [];
// I5: separate sets of just this run's colour/item DETAIL page filenames
// (populated by generateColourDetailPage/generateItemDetailPage below),
// distinct from writtenPages above which also includes listing pages --
// used at the end of the run to prune stale detail pages that are no
// longer part of the catalogue (see pruneStaleDetailPages()).
const writtenColourDetailFiles = new Set();
const writtenItemDetailFiles = new Set();
function write(file, content) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  if (file.endsWith('.html')) writtenPages.push(file);
  console.log('wrote', file);
}

// Shared JSON-LD builders (#109). Breadcrumbs come from the same
// "Home / Toys" crumb strings the visible breadcrumb renders from, so the
// markup can never disagree with what's on screen.
function breadcrumbJsonLd(crumbString, pagePath) {
  const parts = String(crumbString || '').split('/').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: parts.map((label, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: label,
      ...(i === 0 ? { item: `${SITE_ORIGIN}/` } : i === parts.length - 1 ? { item: `${SITE_ORIGIN}/${pagePath}` } : {}),
    })),
  };
}

function productListJsonLd({ pagePath, listName, products }) {
  // Prices are stored as display strings ("R 299.00", "R350") -- strip to
  // the numeric value for the Offer.
  const parsePrice = (p) => Number(String(p ?? '').replace(/[^\d.]/g, ''));
  const visible = products
    .map((p) => ({ ...p, price: parsePrice(p.price) }))
    .filter((p) => p.name && p.price > 0);
  if (!visible.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    itemListElement: visible.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name,
        ...(p.imageUrl ? { image: `${SITE_ORIGIN}/${String(p.imageUrl).replace(/^\//, '')}` } : {}),
        ...(p.sku ? { sku: p.sku } : {}),
        offers: {
          '@type': 'Offer',
          price: String(Number(p.price)),
          priceCurrency: 'ZAR',
          availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/MadeToOrder',
          url: `${SITE_ORIGIN}/${pagePath}`,
        },
      },
    })),
  };
}

// #95: single-product JSON-LD for a detail page, same field names/casing
// as the 'item' object inside productListJsonLd's ItemList above, just not
// wrapped in one.
function productDetailJsonLd({ name, images, sku, price, inStock, url }) {
  if (!name || !(price > 0)) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    ...(images && images.length ? { image: images.map((i) => `${SITE_ORIGIN}/${String(i).replace(/^\//, '')}`) } : {}),
    ...(sku ? { sku } : {}),
    offers: {
      '@type': 'Offer',
      price: String(Number(price)),
      priceCurrency: 'ZAR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/MadeToOrder',
      url,
    },
  };
}

function generateFilamentPage(f) {
  const note = f.colourNote
    ? `<p class="text-espresso/50 text-xs mt-4">${f.colourNote}</p>`
    : '';
  const listedColours = (f.colours || []).filter((c) => c.listed !== false);
  const colours =
    listedColours.length > 0
      ? `<div>
          <h2 class="font-serif text-xl mb-5 tracking-tight">Colours</h2>
          ${
            listedColours.length > 3
              ? `<div id="colour-filter-bar" class="flex flex-wrap items-center gap-3 mb-5">
            <input id="colour-search" type="search" placeholder="Filter colours…" aria-label="Filter colours" class="border border-charcoal/20 rounded-sm px-3 py-2 text-sm bg-transparent w-44" />
            <label class="flex items-center gap-2 text-sm text-espresso/70"><input id="colour-instock" type="checkbox" class="accent-terracotta" /> In stock only</label>
            <select id="colour-sort" aria-label="Sort colours" class="border border-charcoal/20 rounded-sm px-3 py-2 text-sm bg-transparent">
              <option value="">Default order</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
          <p id="colour-filter-empty" class="hidden text-espresso/50 text-sm py-6">No colours match your filter.</p>`
              : ''
          }
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-4" id="colour-grid">${colourCards(listedColours, f)}</div>
          ${note}
        </div>`
      : `<div class="border border-dashed border-charcoal/20 rounded-sm p-6 text-sm text-espresso/60">
          Colour list available on request — <a class="text-terracotta font-semibold hover:underline" href="${SITE.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp us</a> for the full swatch.
        </div>`;

  const filamentPagePath = `filament/${f.slug}.html`;
  const html = `${head({
    title: `${f.name} — Lapanza 3D Creative Lab`,
    description: metaDescription(f.description),
    depth: 1,
    pagePath: filamentPagePath,
    jsonLd: [
      breadcrumbJsonLd(`Home / Filament / ${f.name}`, filamentPagePath),
      productListJsonLd({
        pagePath: filamentPagePath,
        listName: `${f.name} filament colours`,
        products: listedColours.map((c) => ({ name: `${f.name} — ${c.name}`, price: c.price, sku: c.sku, imageUrl: galleryFirstImages(c)[0] || '', inStock: Number(c.stockQty) > 0 })),
      }),
    ].filter(Boolean),
  })}
${shellStart({ depth: 1 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="../index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span> <span class="text-espresso/70">Filament</span> <span class="mx-1.5 opacity-40">/</span> <span class="text-espresso/70">${f.name}</span>
      </nav>
      <div class="mb-6">${backToHomeButton({ depth: 1 })}</div>

      <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
        <h1 class="font-serif text-4xl md:text-6xl tracking-[-0.03em]">${f.name}</h1>
        <a href="${SITE.whatsapp}" target="_blank" rel="noopener noreferrer"
           class="text-[0.65rem] font-bold uppercase tracking-[0.18em] border-2 border-charcoal rounded-full px-4 py-2.5 hover:bg-charcoal hover:text-cream transition-colors">Order / enquire</a>
      </div>
      <p class="text-espresso/75 leading-relaxed max-w-2xl mb-12 text-lg">${f.description}</p>
      ${deliveryNote('filament')}
      ${volumeDiscountNote()}
      ${specsBlock(f.specs)}
      ${colours}
      ${valueProps('filament')}
      ${purchaseFaq('filament')}
      <div class="mt-14 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth: 1 })}</div>
      </div>
    </main>
${footer({ depth: 1 })}`;
  write(`filament/${f.slug}.html`, html);
}

// #95: one real static page per colour, flat inside filament/ (see this
// plan's Global Constraints for why -- vite's htmlEntries() already
// auto-discovers new files here with zero config changes, unlike a nested
// path would need).
function colourDetailSlug(filamentSlug, sku) {
  const skuSlug = String(sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${filamentSlug}-${skuSlug}`;
}

function generateColourDetailPage(f, c) {
  const file = `filament/${colourDetailSlug(f.slug, c.sku)}.html`;
  const pagePath = file;
  const images = c.images && c.images.length ? c.images : (c.imageUrl ? [c.imageUrl] : []);
  const priceNum = parsePrice(c.price) || 0;
  const inStock = Number(c.stockQty) > 0;
  const title = `${f.name} — ${c.name} — Lapanza 3D Creative Lab`;
  const description = `${f.name} filament in ${c.name}. ${c.price || ''} — ${inStock ? 'in stock' : 'made to order'}. ${f.description || ''}`.trim();

  const html = `${head({
    title: escapeAttr(title),
    description: escapeAttr(description),
    depth: 1,
    pagePath,
    extra: ogImageTag(images),
    jsonLd: [
      breadcrumbJsonLd(`Home / Filament / ${f.name} / ${c.name}`, pagePath),
      productDetailJsonLd({
        name: `${f.name} — ${c.name}`,
        images,
        sku: c.sku,
        price: priceNum,
        inStock,
        url: `${SITE_ORIGIN}/${pagePath}`,
      }),
    ].filter(Boolean),
  })}
${shellStart({ depth: 1 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-5xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="../index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span>
        <a href="../filament/${f.slug}.html" class="hover:text-terracotta">${f.name}</a> <span class="mx-1.5 opacity-40">/</span>
        <span class="text-espresso/70">${c.name}</span>
      </nav>
      <div class="mb-6">${backToHomeButton({ depth: 1 })}</div>
      <div class="grid md:grid-cols-2 gap-10">
        <div>${productGalleryHtml({ images, alt: `${f.name} — ${c.name}`, mode: 'full' })}</div>
        <div>
          <p class="eyebrow mb-2">Filament · ${f.name}</p>
          <h1 class="font-serif text-3xl md:text-4xl tracking-[-0.03em] mb-3">${c.name}</h1>
          <p class="text-2xl font-semibold text-terracotta mb-4">${c.price || ''}</p>
          <p class="text-espresso/70 leading-relaxed mb-6">${f.description || ''}</p>
          <p class="text-sm ${inStock ? 'text-espresso/60' : 'text-terracotta'} mb-6">${inStock ? 'In stock' : 'Made to order'}</p>
          ${inStock ? addToCartButton({
            productId: `filament:${f.slug}:${c.sku}`,
            name: `${f.name} — ${c.name}`,
            price: c.price,
            image: images[0] || '',
            weight: c.shippingWeightG ?? c.weightG,
          }) : `<button type="button" class="restock-notify text-sm font-semibold text-terracotta hover:underline" data-restock-product="filament:${escapeAttr(f.slug)}:${escapeAttr(c.sku)}">Email me when it's back</button>`}
        </div>
      </div>
      <div class="mt-14 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth: 1 })}</div>
      </div>
    </main>
${footer({ depth: 1 })}`;
  write(file, html);
  writtenColourDetailFiles.add(file);
}

// #95: one real static page per category/car-parts item, all flattened
// into one new products/ directory (not nested under each category's own
// page) -- keeps vite's htmlEntries() registration to the single line
// added in Task 9 Step 1, regardless of how many categories exist.
function itemDetailSlug(categorySlug, item, index) {
  const namePart = String(item.name || `item-${index}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const skuPart = item.sku ? `-${String(item.sku).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : `-${index}`;
  return `${categorySlug}-${namePart}${skuPart}`;
}

function generateItemDetailPage(categorySlug, categoryName, item, index) {
  const file = `products/${itemDetailSlug(categorySlug, item, index)}.html`;
  const pagePath = file;
  const images = item.images && item.images.length ? item.images : (item.imageUrl ? [item.imageUrl] : []);
  const priceNum = parsePrice(item.price) || 0;
  const canAddToCart = item.price && item.available !== false && Number(item.stockQty) > 0;
  const meta = [item.material, item.size, item.finish].filter(Boolean).join(' · ');
  const fitment = [item.creator ? `Design: ${item.creator}` : '', item.models?.length ? `Fits: ${item.models.join(', ')}` : ''].filter(Boolean).join(' · ');
  const title = `${item.name} — ${categoryName} — Lapanza 3D Creative Lab`;
  const description = (item.details || `${item.name}, printed to order.`).slice(0, 300);

  const html = `${head({
    // Unlike filament/category copy (owner-controlled, no raw quotes seen so
    // far), item.details is free-form admin text and can contain a literal
    // " (e.g. a quoted testimonial) -- escapeAttr keeps head()'s
    // content="..." meta/og attributes from breaking the HTML parse.
    title: escapeAttr(title),
    description: escapeAttr(description),
    depth: 1,
    pagePath,
    extra: ogImageTag(images),
    jsonLd: [
      breadcrumbJsonLd(`Home / ${categoryName} / ${item.name}`, pagePath),
      productDetailJsonLd({
        name: item.name,
        images,
        sku: item.sku,
        price: priceNum,
        inStock: Number(item.stockQty) > 0,
        url: `${SITE_ORIGIN}/${pagePath}`,
      }),
    ].filter(Boolean),
  })}
${shellStart({ depth: 1 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-5xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="../index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span>
        <span class="text-espresso/70">${categoryName}</span> <span class="mx-1.5 opacity-40">/</span>
        <span class="text-espresso/70">${item.name}</span>
      </nav>
      <div class="mb-6">${backToHomeButton({ depth: 1 })}</div>
      <div class="grid md:grid-cols-2 gap-10">
        <div>${productGalleryHtml({ images, alt: item.name, mode: 'full' })}</div>
        <div>
          <p class="eyebrow mb-2">${categoryName}</p>
          <h1 class="font-serif text-3xl md:text-4xl tracking-[-0.03em] mb-3">${item.name}</h1>
          ${item.price ? `<p class="text-2xl font-semibold text-terracotta mb-4">${formatItemPrice(item.price)}</p>` : ''}
          <p class="text-espresso/70 leading-relaxed mb-4">${item.details || 'Custom printed to order.'}</p>
          ${meta ? `<p class="text-espresso/50 text-sm mb-2">${meta}</p>` : ''}
          ${fitment ? `<p class="text-espresso/50 text-sm mb-6">${fitment}</p>` : ''}
          ${fulfilmentLabel(item)}
          <a href="${SITE.whatsapp}" class="block text-sm font-semibold text-terracotta hover:underline mb-4" target="_blank" rel="noopener noreferrer">Enquire</a>
          ${canAddToCart ? addToCartButton({
            productId: `category:${categorySlug}:${item.sku || index}`,
            name: item.name,
            price: item.price,
            image: images[0] || '',
            weight: item.shippingWeight ?? item.weight,
          }) : ''}
        </div>
      </div>
      <div class="mt-14 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth: 1 })}</div>
      </div>
    </main>
${footer({ depth: 1 })}`;
  write(file, html);
  writtenItemDetailFiles.add(file);
}

function generateCategoryPage({ file, depth, pagePath, crumbs, name, description, kind, items, slug }) {
  const crumbHtml = crumbs
    .split(' / ')
    .map((part, i, arr) => {
      if (i === arr.length - 1) return `<span class="text-espresso/80">${part}</span>`;
      if (part === 'Home') return `<a href="${'../'.repeat(depth)}index.html" class="hover:text-terracotta">Home</a>`;
      if (part === 'Car Parts') return `<span>Car Parts</span>`;
      return part;
    })
    .join(' / ');

  // Car Parts pages get an extra link into the actual design-request form
  // (same form as the site-wide "Custom Design and Print Request" page) --
  // WhatsApp alone doesn't capture a reference photo/file, which matters
  // most for a part that needs to be designed and printed from scratch.
  const isCarParts = pagePath.startsWith('car-parts/');
  // Backlog #72: vehicle pages pass their brand as ?context= so the
  // design-request form can pre-seed the description (vehicle + part-number
  // prompt) -- see design-request-entry.js.
  const requestPartCta = isCarParts
    ? `<a href="${'../'.repeat(depth)}design-request.html?context=${encodeURIComponent(name)}" class="inline-flex text-sm font-semibold border-2 border-charcoal text-charcoal rounded-full px-5 py-2.5 hover:bg-charcoal hover:text-cream transition-colors">Request a ${escapeAttr(name)} part not listed</a>`
    : '';

  const body =
    kind === 'story'
      ? null
      : `${deliveryNote('made-to-order')}
      ${isCarParts ? partFilterBar(items) : ''}
      <div class="grid grid-cols-2 md:grid-cols-3 gap-5 catalogue-grid">${catalogueItems(name, items, slug, depth)}</div>
      ${isCarParts ? `<p id="part-filter-empty" class="hidden text-espresso/50 text-sm py-10 text-center">No parts match your search/filter.</p>` : ''}
      ${valueProps(kind === 'catalog' ? 'category' : kind)}
      ${purchaseFaq('category')}
      <div class="mt-14 p-7 md:p-8 bg-linen border-2 border-charcoal/10 rounded-sm brutal">
        <p class="eyebrow mb-3">Custom request</p>
        <p class="font-serif text-2xl mb-3 tracking-tight">Need something specific?</p>
        <p class="text-espresso/65 text-sm mb-5 max-w-md leading-relaxed">Send a photo, sketch or part number — we'll advise material, finish and turnaround.</p>
        <div class="flex flex-wrap gap-3">
          <a href="${SITE.whatsapp}" class="inline-flex text-sm font-semibold bg-charcoal text-cream rounded-full px-5 py-2.5 hover:bg-terracotta transition-colors" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>
          ${requestPartCta}
        </div>
      </div>`;

  if (kind === 'story') {
    const html = `${head({
      title: 'Our Story — Lapanza 3D Creative Lab',
      description: 'Meet the family-run creative lab behind Lapanza 3D — custom printing and SA filament in Centurion.',
      depth: 0,
      pagePath: 'story.html',
    })}
${shellStart({ depth: 0 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
      <p class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-10">${crumbHtml}</p>
      <p class="eyebrow mb-5">Our story</p>
      <h1 class="font-serif text-4xl md:text-6xl leading-[1.02] mb-12 max-w-2xl tracking-[-0.03em]">Built on craft,<br>not big-box runaround.</h1>

      <div class="grid md:grid-cols-12 gap-10 md:gap-8 mb-16">
        <div class="md:col-span-7 relative">
          <div class="rounded-sm overflow-hidden rotate-[-1.5deg] shadow-[12px_12px_0_0_#1a1612]">
            <img src="https://media.portmoni.com/resized/55789/3D_Items_for_Sale_0IBj8ny-thumbnail-600x600-95.jpg"
                 alt="Custom 3D printed items made by Lapanza"
                 class="w-full h-[360px] md:h-[440px] object-cover" loading="lazy" width="600" height="600">
          </div>
        </div>
        <div class="md:col-span-5 flex flex-col justify-center">
          <p class="text-espresso/85 leading-relaxed text-lg mb-5">
            Lapanza is a small, family-run creative lab. One-off custom piece, functional replacement
            part, or filament for your own workshop — we work with you from concept to final product.
          </p>
          <p class="text-espresso/65 leading-relaxed">
            Flexible solutions for individuals, hobbyists, small businesses and larger projects, with a
            wide range of colours and filament types to suit your application and style.
          </p>
        </div>
      </div>

      <div class="border-t-2 border-charcoal/10 pt-12">
        <p class="eyebrow mb-7">Who you're talking to</p>
        <div class="grid sm:grid-cols-2 gap-8 max-w-xl">
          <div class="border-l-2 border-terracotta pl-4">
            <p class="font-serif text-xl mb-1 tracking-tight">Johan Barkhuizen</p>
            <p class="text-espresso/55 text-sm">Director &amp; Owner</p>
          </div>
          <div class="border-l-2 border-terracotta pl-4">
            <p class="font-serif text-xl mb-1 tracking-tight">Linandi Barkhuizen</p>
            <p class="text-espresso/55 text-sm">Co-Owner</p>
          </div>
        </div>
        <p class="text-espresso/55 text-sm mt-10 leading-relaxed">23 Gladiator Rd, Pierre van Ryneveld, Centurion<br>By appointment</p>
      </div>
      </div>
    </main>
${footer({ depth: 0 })}`;
    write(file, html);
    return;
  }

  const html = `${head({
    title: `${name} — Lapanza 3D Creative Lab`,
    description,
    depth,
    pagePath,
    jsonLd: [
      breadcrumbJsonLd(crumbs, pagePath),
      productListJsonLd({
        pagePath,
        listName: name,
        products: (items || [])
          .filter((i) => i.listed !== false)
          .map((i) => ({ name: i.name, price: i.price, sku: i.sku, imageUrl: galleryFirstImages(i)[0] || '', inStock: Number(i.stockQty) > 0 && i.available !== false })),
      }),
    ].filter(Boolean),
  })}
${shellStart({ depth })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
      <nav class="text-xs text-espresso/50 mb-4" aria-label="Breadcrumb">${crumbHtml}</nav>
      <div class="mb-6">${backToHomeButton({ depth })}</div>
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
        <h1 class="font-serif text-4xl md:text-5xl">${name}</h1>
        <a href="${SITE.whatsapp}" target="_blank" rel="noopener noreferrer"
           class="text-xs font-semibold uppercase tracking-[0.15em] border-2 border-charcoal rounded-full px-4 py-2 hover:bg-charcoal hover:text-cream transition-colors">Enquire</a>
      </div>
      <p class="text-espresso/80 leading-relaxed max-w-2xl mb-10">${description}</p>
      ${body}
      <div class="mt-10 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth })}</div>
      </div>
    </main>
${footer({ depth })}`;
  write(file, html);
}

// Legal pages (Terms, Privacy, Returns) -- content lives as HTML fragments in
// src/data/legal/ (edited independently of this script, same reasoning as
// filaments.json/categories.json being separate data) and gets dropped into
// the same reading-column shell every catalog/story page uses, so they share
// nav/header/footer without duplicating that markup a fourth time.
function generateLegalPage({ file, title, description, lastUpdated }) {
  const bodyHtml = fs.readFileSync(path.join(root, 'src/data/legal', file), 'utf8');
  const html = `${head({
    title: `${title} — Lapanza 3D Creative Lab`,
    description,
    depth: 0,
    pagePath: file,
  })}
${shellStart({ depth: 0 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl">
      <p class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6"><a href="index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span> <span class="text-espresso/80">${title}</span></p>
      <h1 class="font-serif text-4xl md:text-5xl tracking-[-0.03em] mb-2">${title}</h1>
      <p class="text-espresso/45 text-sm mb-10">Last updated: ${lastUpdated}</p>
      <div class="legal-body max-w-none text-espresso/80 leading-relaxed space-y-8">${bodyHtml}</div>
      </div>
    </main>
${footer({ depth: 0 })}`;
  write(file, html);
}

// Handcrafted homepage lives in index.html — do not overwrite it here.
filaments.forEach(generateFilamentPage);
filaments.forEach((f) => {
  (f.colours || []).filter((c) => c.listed !== false).forEach((c) => generateColourDetailPage(f, c));
});
generateCategoryPage({ file: 'story.html', depth: 0, pagePath: 'story.html', crumbs: 'Home / Our Story', name: 'Our Story', description: '', kind: 'story' });

const LEGAL_LAST_UPDATED = '22 August 2026';
generateLegalPage({ file: 'terms.html', title: 'Terms & Conditions', description: 'Terms and conditions for buying from Lapanza 3D Creative Lab.', lastUpdated: LEGAL_LAST_UPDATED });
generateLegalPage({ file: 'privacy.html', title: 'Privacy Policy', description: 'How Lapanza 3D Creative Lab collects, uses and protects your personal information, in line with POPIA.', lastUpdated: LEGAL_LAST_UPDATED });
generateLegalPage({ file: 'returns.html', title: 'Returns & Refunds Policy', description: 'Returns, refunds and warranty policy for custom-printed products and filament from Lapanza 3D Creative Lab.', lastUpdated: LEGAL_LAST_UPDATED });

// Each entry pulls its data from categories[slug] (written by server/export.js
// from catalog.json's kind:'category' rows). That data is per-environment and
// admin-editable, so a slug can legitimately be missing (fresh checkout,
// category deleted, etc.) — skip and warn rather than crashing the whole
// publish partway through.
// #130: the car-parts entries come from the admin-configurable brand list
// (Settings -> Car-part brands) -- a new brand needs only its category
// created (+Category, parent car-parts, matching slug) and a publish.
// Deactivated brands stop generating/linking without touching their items.
const brandSlug = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const categoryPages = [
  { slug: 'toys', file: 'toys.html', depth: 0, pagePath: 'toys.html', description: 'Playful, durable 3D printed toys — printed locally to order in colours you choose.' },
  { slug: 'homeware', file: 'homeware.html', depth: 0, pagePath: 'homeware.html', description: 'Practical and decorative homeware — hooks, organisers, planters and more, printed to order.' },
  { slug: 'phones', file: 'phones.html', depth: 0, pagePath: 'phones.html', description: 'Phone cases, stands and accessories — fitted and finished for everyday use.' },
  ...CAR_PART_BRANDS.map((b) => {
    const slug = brandSlug(b.name);
    return { slug, file: `car-parts/${slug}.html`, depth: 1, pagePath: `car-parts/${slug}.html`, name: b.name };
  }),
];

const skippedCategories = [];
for (const page of categoryPages) {
  const category = categories[page.slug];
  if (!category) {
    console.warn(`generate-pages: skipping ${page.file} — no category data for slug "${page.slug}" in categories.json`);
    skippedCategories.push(page.slug);
    continue;
  }
  generateCategoryPage({
    file: page.file,
    depth: page.depth,
    pagePath: page.pagePath,
    crumbs: category.crumbs,
    name: page.name || category.name,
    description: page.description || category.description,
    kind: 'catalog',
    items: category.items,
    slug: page.slug,
  });
  (category.items || []).filter((item) => item.listed !== false).forEach((item, i) => generateItemDetailPage(page.slug, page.name || category.name, item, i));
}

// ---- I5: prune stale generated detail pages ----
// Renaming an item, changing its SKU, or unlisting it left the old
// products/*.html or filament/<slug>-<sku>.html file on disk forever --
// still reachable, still with a live Add to Cart button, even though
// nothing links to it any more. Compares this run's own written-detail-page
// sets (populated by generateColourDetailPage/generateItemDetailPage above)
// against what's actually on disk and removes the difference.
// Deliberately conservative: products/ holds ONLY generated item-detail
// pages -- no listing page or anything hand-written ever lives there -- so
// any .html file not written this run is stale. filament/ also holds the
// generated per-type LISTING pages (filament/pla.html) alongside detail
// pages, so a file there is only ever pruned when its name matches the
// `<filamentSlug>-<sku>` detail-page pattern for a filament that still
// exists in the catalogue -- a listing page (no trailing `-<sku>`) never
// matches that pattern and is never touched, and neither is any file this
// script didn't itself generate.
function pruneStaleDetailPages() {
  const pruneDir = (dir, writtenSet, isDetailPageCandidate) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      if (!name.endsWith('.html')) continue;
      const rel = `${dir}/${name}`;
      if (writtenSet.has(rel)) continue;
      if (!isDetailPageCandidate(name)) continue;
      fs.unlinkSync(path.join(abs, name));
      console.log('pruned stale detail page', rel);
    }
  };

  pruneDir('products', writtenItemDetailFiles, () => true);
  // A plain `${f.slug}-` prefix check alone is not enough: two real
  // filaments can have one slug be a genuine prefix of the other (e.g.
  // "pla" and "pla-hyper" both exist in the live catalogue), so
  // filament/pla-hyper.html -- pla-hyper's own current LISTING page --
  // would otherwise look exactly like a stale detail page belonging to
  // "pla" and get deleted. Exclude every currently-valid listing page name
  // explicitly, before ever consulting the prefix check.
  const filamentListingNames = new Set(filaments.map((f) => `${f.slug}.html`));
  pruneDir('filament', writtenColourDetailFiles, (name) => {
    if (filamentListingNames.has(name)) return false;
    const base = name.replace(/\.html$/, '');
    return filaments.some((f) => base.startsWith(`${f.slug}-`));
  });
}
pruneStaleDetailPages();

// Sidecar file so callers that spawn this script (e.g. POST /api/publish)
// can report skipped categories to the admin instead of a silent 200 —
// console.warn above only reaches this process's own stdout.
fs.writeFileSync(
  path.join(root, 'data', 'publish-warnings.json'),
  JSON.stringify({ skippedCategories, generatedAt: new Date().toISOString() }, null, 2),
);

// Remove old homepage name if still present
const legacyHome = path.join(root, 'premium.html');
if (fs.existsSync(legacyHome)) {
  fs.unlinkSync(legacyHome);
  console.log('removed premium.html (replaced by index.html)');
}

// ---- Material selection guide (#73 / SITE-039) ----
// Family-level guidance prose is authored here (plain language, flagged for
// owner review in the shipping commit); the comparison table is generated
// from the SAME specs the filament pages render, so it can never drift from
// the catalogue. Families only render when at least one of their types
// exists in the live catalogue.
{
  const FAMILIES = [
    {
      match: (s) => s.startsWith('pla') || s === 'silk-pla-plus' || s === 'eco-pla',
      name: 'PLA (all variants)',
      use: 'The everyday material: decor, toys, prototypes, organisers, anything indoors.',
      strengths: 'Easiest to print, sharpest detail, huge colour range, plant-based and low-odour.',
      limits: 'Softens from ±55°C — never for a car dashboard or dishwasher; brittle under sharp impact.',
    },
    {
      match: (s) => s.startsWith('petg'),
      name: 'PETG',
      use: 'Functional parts that see real use: brackets, containers, outdoor fittings, mechanical parts.',
      strengths: 'Tough, slightly flexible, water- and chemical-resistant, handles heat better than PLA.',
      limits: 'Strings more when printing; fine detail is a little softer than PLA.',
    },
    {
      match: (s) => s.startsWith('abs'),
      name: 'ABS',
      use: 'Heat-exposed and high-wear parts: automotive interior pieces, enclosures, clips.',
      strengths: 'Impact-tough, handles ±95°C, sandable and acetone-smoothable for a moulded finish.',
      limits: 'Needs an enclosed printer to avoid warping; prints with more odour.',
    },
    {
      match: (s) => s === 'asa',
      name: 'ASA',
      use: 'Outdoor parts living in the South African sun: exterior vehicle trim, garden fittings, signage brackets.',
      strengths: 'ABS toughness plus genuine UV resistance — colours and strength hold up outside.',
      limits: 'Same enclosure requirement as ABS.',
    },
    {
      match: (s) => s.startsWith('tpu'),
      name: 'TPU (flexible)',
      use: 'Anything that must bend or grip: phone cases, gaskets, protective bumpers, wheels.',
      strengths: 'Rubber-like flex (95A softer, 98A firmer), extremely abrasion- and impact-resistant.',
      limits: 'Prints slowly; fine detail and sharp corners are not its strength.',
    },
    {
      match: (s) => s.startsWith('pro-cpe'),
      name: 'CPE',
      use: 'Demanding functional/engineering parts; the HT variant for higher heat.',
      strengths: 'Chemically resistant, dimensionally stable, tougher than PETG under sustained load.',
      limits: 'Costs more; overkill for decorative prints.',
    },
    {
      match: (s) => s === 'sbs',
      name: 'SBS',
      use: 'Translucent decorative pieces and light guides.',
      strengths: 'Glass-like translucency, slightly flexible, low odour.',
      limits: 'Not for structural or heat-exposed parts.',
    },
  ];

  const COMPARE_LABELS = ['Print Temp', 'Bed Temp', 'Heat Distortion Temp', 'Tensile Strength', 'Elongation at Break'];
  const compareRows = filaments
    .filter((f) => (f.specs || []).some((s) => COMPARE_LABELS.includes(s.label)))
    .map((f) => {
      const spec = (label) => (f.specs || []).find((s) => s.label === label)?.value || '—';
      return `<tr class="border-t border-charcoal/10">
        <td class="px-3 py-2.5 font-medium"><a class="text-terracotta hover:underline" href="filament/${f.slug}.html">${f.name}</a></td>
        ${COMPARE_LABELS.map((l) => `<td class="px-3 py-2.5 text-espresso/70">${spec(l)}</td>`).join('')}
      </tr>`;
    })
    .join('');

  const familyBlocks = FAMILIES.filter((fam) => filaments.some((f) => fam.match(f.slug)))
    .map((fam) => {
      const members = filaments.filter((f) => fam.match(f.slug));
      const links = members.map((f) => `<a class="text-terracotta font-semibold hover:underline" href="filament/${f.slug}.html">${f.name}</a>`).join(' · ');
      return `<section class="mb-10">
        <h2 class="font-serif text-2xl tracking-tight mb-3">${fam.name}</h2>
        <dl class="stack gap-2 text-sm leading-relaxed">
          <div><dt class="font-semibold inline">Best for:</dt> <dd class="inline text-espresso/75">${fam.use}</dd></div>
          <div><dt class="font-semibold inline">Strengths:</dt> <dd class="inline text-espresso/75">${fam.strengths}</dd></div>
          <div><dt class="font-semibold inline">Limits:</dt> <dd class="inline text-espresso/75">${fam.limits}</dd></div>
        </dl>
        <p class="text-sm mt-2">In stock: ${links}</p>
      </section>`;
    })
    .join('');

  const guidePagePath = 'materials-guide.html';
  const html = `${head({
    title: 'Which 3D Printing Material? — Lapanza 3D Creative Lab',
    description: 'A practical guide to choosing between PLA, PETG, ABS, ASA, TPU and CPE filament — use cases, strengths, limits, and a full spec comparison.',
    depth: 0,
    pagePath: guidePagePath,
    jsonLd: [breadcrumbJsonLd('Home / Materials Guide', guidePagePath)],
  })}
${shellStart({ depth: 0 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span> <span class="text-espresso/70">Materials Guide</span>
      </nav>
      <h1 class="font-serif text-4xl md:text-5xl tracking-[-0.03em] mb-4">Which Material Should I Print In?</h1>
      <p class="text-espresso/70 leading-relaxed mb-10 max-w-xl">The honest short version: if it lives indoors and doesn't get hot, PLA. If it works for a living, PETG. If it lives in a car or outside, ABS or ASA. If it must bend, TPU. Details below — and if you're still unsure, <a class="text-terracotta font-semibold hover:underline" href="design-request.html">tell us what you're making</a> and we'll recommend.</p>
      ${familyBlocks}
      <h2 class="font-serif text-2xl tracking-tight mb-4 mt-14">Spec Comparison</h2>
      <p class="text-sm text-espresso/60 mb-4">Figures come straight from each filament's own listed specifications — the same numbers on the product pages.</p>
      <div class="overflow-x-auto border border-charcoal/10 rounded-sm">
        <table class="w-full text-sm min-w-[640px]">
          <thead class="bg-linen text-left"><tr><th class="px-3 py-2.5 font-semibold">Filament</th>${COMPARE_LABELS.map((l) => `<th class="px-3 py-2.5 font-semibold">${l}</th>`).join('')}</tr></thead>
          <tbody>${compareRows}</tbody>
        </table>
      </div>
      <div class="mt-12">${backToHomeButton({ depth: 0 })}</div>
      </div>
    </main>
${footer({ depth: 0 })}`;
  write(guidePagePath, html);
}

// ---- Local SEO landing pages (#110 / SITE-076) ----
// Three pages targeting real local search intent. Every claim is factual:
// counts come from the live catalogue, times/zones from the same settings
// the storefront renders. Copy flagged for owner review in the shipping
// commit. Generated (not hand-written) so sitemap + search index include
// them automatically and catalogue counts never go stale.
{
  const partCount = ['gwm', 'landrover'].reduce((sum, slug) => sum + (categories[slug]?.items || []).filter((i) => i.listed !== false).length, 0);
  const colourCount = filaments.reduce((sum, f) => sum + (f.colours || []).filter((c) => c.listed !== false).length, 0);
  const typeCount = filaments.length;

  const seoPage = ({ file, title, description, h1, body }) => {
    const html = `${head({ title, description, depth: 0, pagePath: file, jsonLd: [breadcrumbJsonLd(`Home / ${h1}`, file)] })}
${shellStart({ depth: 0 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span> <span class="text-espresso/70">${h1}</span>
      </nav>
      <h1 class="font-serif text-4xl md:text-5xl tracking-[-0.03em] mb-6">${h1}</h1>
      ${body}
      <div class="mt-12 flex flex-wrap gap-3">
        <a href="design-request.html" class="inline-flex text-sm font-semibold bg-charcoal text-cream rounded-full px-6 py-3 hover:bg-terracotta transition-colors">Upload a File for a Quote</a>
        <a href="${SITE.whatsapp}" class="inline-flex text-sm font-semibold border-2 border-charcoal rounded-full px-6 py-3 hover:bg-charcoal hover:text-cream transition-colors" target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a>
      </div>
      <div class="mt-10">${backToHomeButton({ depth: 0 })}</div>
      </div>
    </main>
${footer({ depth: 0 })}`;
    write(file, html);
  };

  const para = (t) => `<p class="text-espresso/75 leading-relaxed mb-5">${t}</p>`;

  seoPage({
    file: 'custom-3d-printing-centurion.html',
    title: 'Custom 3D Printing in Centurion & Pretoria — Lapanza 3D Creative Lab',
    description: 'Local custom 3D printing from Pierre van Ryneveld, Centurion — functional parts, replacements, prototypes and gifts, printed to order in PLA, PETG, ABS, ASA, TPU or CPE.',
    h1: 'Custom 3D Printing in Centurion & Pretoria',
    body:
      para(`Lapanza 3D Creative Lab is a family-run print workshop in Pierre van Ryneveld, Centurion. We design and print functional parts, replacement pieces, prototypes, toys and gifts to order — for customers around Centurion and Pretoria, and by courier across South Africa.`) +
      para(`Bring us a 3D file if you have one, or just a photo, sketch or broken part if you don't — designing the model for you is half of what we do. Production typically takes ${PRINT_LEAD_TIME_DAYS} business days; collect from us in Pierre van Ryneveld, use Local Delivery around Centurion, or ship nationwide via PUDO Locker.`) +
      para(`We print in every mainstream material — PLA for detail, PETG for working parts, ABS and ASA for heat and outdoor use, flexible TPU, and engineering-grade CPE. Not sure which fits your project? Our <a class="text-terracotta font-semibold hover:underline" href="materials-guide.html">Materials Guide</a> gives the honest short version, or just ask.`),
  });

  seoPage({
    file: 'filament-south-africa.html',
    title: '3D Printer Filament, Stocked in South Africa — Lapanza 3D Creative Lab',
    description: `${typeCount} filament types and ${colourCount} colours of SA-stocked 1.75mm filament — PLA, PETG, ABS, ASA, TPU and CPE with real specs, dispatched in ${FILAMENT_DISPATCH_DAYS} business days, PUDO nationwide.`,
    h1: '3D Printer Filament, Stocked in South Africa',
    body:
      para(`We stock ${typeCount} filament types across ${colourCount} listed colours — real local stock in Centurion, not import-wait listings. Everything is 1.75&nbsp;mm on 1&nbsp;kg spools, with genuine print/bed temperatures and mechanical specs published on every product page.`) +
      para(`Orders dispatch within ${FILAMENT_DISPATCH_DAYS} business days of payment: PUDO Locker to anywhere in South Africa, Local Delivery around Centurion, or collect from the workshop. Pay by card or Instant EFT through Payfast.`) +
      para(`Start with <a class="text-terracotta font-semibold hover:underline" href="filament/pla.html">PLA</a> for everyday printing, or use the <a class="text-terracotta font-semibold hover:underline" href="materials-guide.html">Materials Guide</a> to match a material to your project.`),
  });

  seoPage({
    file: 'vehicle-3d-printed-parts.html',
    title: '3D Printed Vehicle Parts — GWM & Land Rover — Lapanza 3D Creative Lab',
    description: `${partCount} listed 3D printed vehicle parts for GWM and Land Rover — clips, trims, brackets and hard-to-find replacements, printed to order in Centurion and shipped across South Africa.`,
    h1: '3D Printed Vehicle Parts — GWM & Land Rover',
    body:
      para(`Discontinued clip? Brittle trim piece the dealer no longer stocks? We keep ${partCount} listed vehicle parts for <a class="text-terracotta font-semibold hover:underline" href="car-parts/gwm.html">GWM</a> and <a class="text-terracotta font-semibold hover:underline" href="car-parts/landrover.html">Land Rover</a> — printable to order in materials chosen for the job, including heat-tolerant ABS and UV-stable ASA for parts that live in the sun.`) +
      para(`Every parts page has search and per-model filtering, and each part lists its material and fitment. Production takes ${PRINT_LEAD_TIME_DAYS} business days; parts ship nationwide via PUDO or can be collected in Centurion.`) +
      para(`Don't see your part — or drive something else entirely? Use the request route below with a photo or part number and we'll tell you if it's printable.`),
  });
}

// ---- search index (#39 / SITE-005) ----
// One compact entry per filament colour, category item, and navigable page;
// consumed client-side by src/js/search.js. Anchors use the exact same
// itemAnchorId scheme the cards themselves render with.
{
  const entries = [];
  for (const f of filaments) {
    entries.push({ t: 'Filament', n: `${f.name} filament`, s: '', k: 'filament', h: `filament/${f.slug}.html`, p: '' });
    for (const c of (f.colours || []).filter((c) => c.listed !== false)) {
      entries.push({
        t: 'Filament',
        n: `${f.name} — ${c.name}`,
        s: c.sku || '',
        k: `filament ${f.name}`,
        h: `filament/${f.slug}.html#${itemAnchorId(c.sku, c.name)}`,
        p: c.price || '',
      });
    }
  }
  for (const page of categoryPages) {
    const category = categories[page.slug];
    if (!category) continue;
    const label = page.name || category.name;
    for (const item of (category.items || []).filter((i) => i.listed !== false)) {
      entries.push({
        t: label,
        n: item.name,
        s: item.sku || '',
        k: [item.material, item.creator, ...(Array.isArray(item.models) ? item.models : [])].filter(Boolean).join(' '),
        h: `${page.pagePath}#${itemAnchorId(item.sku, item.name)}`,
        p: item.price ? formatItemPrice(item.price) : '',
      });
    }
  }
  for (const [n, h] of [
    ['Custom 3D Printing in Centurion & Pretoria', 'custom-3d-printing-centurion.html'],
    ['3D Printer Filament, Stocked in South Africa', 'filament-south-africa.html'],
    ['3D Printed Vehicle Parts — GWM & Land Rover', 'vehicle-3d-printed-parts.html'],
    ['Materials Guide — which filament to choose', 'materials-guide.html'],
    ['Our Story', 'story.html'],
    ['Get in Touch', 'get-in-touch.html'],
    ['3D Resources', 'resources.html'],
    ['Custom Design and Print Request', 'design-request.html'],
    ['My Account', 'account.html'],
    ['Toys', 'toys.html'],
    ['Homeware', 'homeware.html'],
    ['Phones', 'phones.html'],
    ...CAR_PART_BRANDS.map((b) => [`Car Parts — ${b.name}`, `car-parts/${brandSlug(b.name)}.html`]),
  ]) {
    entries.push({ t: 'Page', n, s: '', k: '', h, p: '' });
  }
  write('public/search-index.json', JSON.stringify(entries));
  console.log(`search index: ${entries.length} entries`);
}

// ---- robots.txt + sitemap.xml (#109 / SITE-075) ----
// The sitemap covers every page this run generated, plus the hand-written
// public pages (kept in step with vite.config.js's htmlEntries list).
// Checkout/account/cart are deliberately excluded (transactional, no search
// value); /admin and /api are disallowed outright.
const HAND_WRITTEN_PUBLIC_PAGES = ['index.html', 'get-in-touch.html', 'design-request.html', 'resources.html'];
const sitemapPages = [...new Set([...HAND_WRITTEN_PUBLIC_PAGES, ...writtenPages])]
  .filter((p) => !['checkout.html', 'account.html'].includes(p));
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPages
  .map((p) => `  <url><loc>${SITE_ORIGIN}/${p === 'index.html' ? '' : p}</loc><lastmod>${today}</lastmod></url>`)
  .join('\n')}
</urlset>
`;
write('public/sitemap.xml', sitemap);
write('public/robots.txt', `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout.html\nDisallow: /account.html\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);

console.log('\\nDone.');
