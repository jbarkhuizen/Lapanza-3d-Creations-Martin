/**
 * Regenerates all HTML pages from catalog data while preserving the site layout.
 * Run: npm run generate
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filaments = JSON.parse(fs.readFileSync(path.join(root, 'src/data/filaments.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(root, 'src/data/categories.json'), 'utf8'));

const SITE = {
  name: 'Lapanza 3D Creative Lab',
  whatsapp:
    'https://api.whatsapp.com/send?phone=27826639608&text=Hello%20Lapanza%2C%20I%20am%20contacting%20you%20from%20your%20new%203D%20site.',
  email: 'lapanzaonline@gmail.com',
  phone: '082 663 9608',
  phoneTel: '+27826639608',
  facebook: 'https://www.facebook.com/Lapanzaloeferox',
  instagram: 'https://www.instagram.com/lapanza_beauty_lifestyle/',
};

function head({ title, description, depth = 0, pagePath = '', extra = '', script = '/src/js/site.js' }) {
  const prefix = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#f7f3eb">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
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

function parsePrice(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
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

function colourCards(colours, filament) {
  if (!colours?.length) return '';
  return colours
    .filter((c) => c.listed !== false)
    .map(
      (c) => `<div class="swatch-card border border-charcoal/10 rounded-sm p-4" data-colour-name="${c.name}">
                  ${
                    c.imageUrl
                      ? `<img src="${c.imageUrl}" alt="${c.name}" class="w-full aspect-square object-cover rounded-sm mb-3" loading="lazy">`
                      : `<div class="w-full aspect-square rounded-sm mb-3 bg-gradient-to-br from-linen to-cream flex items-center justify-center border border-charcoal/10"><span class="text-espresso/35 text-[0.65rem] uppercase tracking-[0.2em]">Photo coming soon</span></div>`
                  }
                  <p class="font-medium mb-1 tracking-tight">${c.name}</p>
                  <p class="text-espresso/45 text-[0.7rem] mb-2 font-mono">${c.sku}</p>
                  <p class="text-terracotta font-semibold">${c.price}</p>
                  <p class="text-[0.72rem] mt-0.5 ${c.stockQty > 0 ? 'text-espresso/50' : 'text-terracotta font-semibold'}">${c.stockQty > 0 ? `${c.stockQty} in stock` : 'Out of stock'}</p>
                  ${addToCartButton({
                    productId: `filament:${filament.slug}:${c.sku}`,
                    name: `${filament.name} — ${c.name}`,
                    price: c.price,
                    image: c.imageUrl,
                    weight: c.shippingWeightG ?? c.weightG,
                  })}
                </div>`,
    )
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

function catalogueItems(label, items, categorySlug) {
  const all = Array.isArray(items) ? items : [];
  const list = all.filter((item) => item.listed !== false);
  if (!list.length) return cataloguePlaceholders(label);

  return list
    .map((item, i) => {
      const meta = [item.material, item.size, item.finish].filter(Boolean).join(' · ');
      const img = item.imageUrl
        ? `<img src="${item.imageUrl}" alt="${item.name}" class="w-full h-full object-cover" loading="lazy">`
        : `<span class="text-espresso/35 text-xs uppercase tracking-[0.2em]">Photo coming soon</span>`;
      const name = item.name || `${label} piece`;
      // Category items don't always have an admin-set sku (it's optional,
      // unlike filament colour skus which are unique in the DB) — fall back
      // to a build-time index so the productId is still stable across a
      // regen as long as item order doesn't change.
      const canAddToCart = item.price && item.available !== false;
      return `<article class="group border border-charcoal/10 rounded-sm overflow-hidden hover:border-terracotta transition-colors">
              <div class="aspect-square bg-gradient-to-br from-linen to-cream flex items-center justify-center border-b border-charcoal/10 overflow-hidden">
                ${img}
              </div>
              <div class="p-4">
                <h3 class="font-serif text-lg mb-1">${name}</h3>
                <p class="text-espresso/60 text-sm mb-2">${item.details || 'Custom printed to order.'}</p>
                ${meta ? `<p class="text-espresso/45 text-xs mb-2">${meta}</p>` : ''}
                ${item.price ? `<p class="text-terracotta font-semibold mb-3">${item.price}</p>` : ''}
                <a href="${SITE.whatsapp}" class="text-sm font-semibold text-terracotta hover:underline" target="_blank" rel="noopener noreferrer">Enquire</a>
                ${
                  canAddToCart
                    ? addToCartButton({
                        productId: `category:${categorySlug}:${item.sku || i}`,
                        name,
                        price: item.price,
                        image: item.imageUrl,
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

function write(file, content) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  console.log('wrote', file);
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
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">${colourCards(listedColours, f)}</div>
          ${note}
        </div>`
      : `<div class="border border-dashed border-charcoal/20 rounded-sm p-6 text-sm text-espresso/60">
          Colour list available on request — <a class="text-terracotta font-semibold hover:underline" href="${SITE.whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp us</a> for the full swatch.
        </div>`;

  const html = `${head({
    title: `${f.name} — Lapanza 3D Creative Lab`,
    description: f.description.slice(0, 155),
    depth: 1,
    pagePath: `filament/${f.slug}.html`,
  })}
${shellStart({ depth: 1 })}
    <main id="main" class="flex-1 min-w-0 px-6 sm:px-10 lg:px-16 xl:px-24 py-12 md:py-20">
      <div class="mx-auto w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl">
      <nav class="text-[0.7rem] uppercase tracking-[0.14em] text-espresso/45 mb-6" aria-label="Breadcrumb">
        <a href="../index.html" class="hover:text-terracotta">Home</a> <span class="mx-1.5 opacity-40">/</span> <a href="../index.html#range" class="hover:text-terracotta">Filament</a> <span class="mx-1.5 opacity-40">/</span> <span class="text-espresso/70">${f.name}</span>
      </nav>
      <div class="mb-6">${backToHomeButton({ depth: 1 })}</div>

      <div class="flex flex-wrap items-end justify-between gap-4 mb-5">
        <h1 class="font-serif text-4xl md:text-6xl tracking-[-0.03em]">${f.name}</h1>
        <a href="${SITE.whatsapp}" target="_blank" rel="noopener noreferrer"
           class="text-[0.65rem] font-bold uppercase tracking-[0.18em] border-2 border-charcoal rounded-full px-4 py-2.5 hover:bg-charcoal hover:text-cream transition-colors">Order / enquire</a>
      </div>
      <p class="text-espresso/75 leading-relaxed max-w-2xl mb-12 text-lg">${f.description}</p>
      ${specsBlock(f.specs)}
      ${colours}
      <div class="mt-14 pt-8 border-t border-charcoal/10">${backToHomeButton({ depth: 1 })}</div>
      </div>
    </main>
${footer({ depth: 1 })}`;
  write(`filament/${f.slug}.html`, html);
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
  const requestPartCta = isCarParts
    ? `<a href="${'../'.repeat(depth)}design-request.html" class="inline-flex text-sm font-semibold border-2 border-charcoal text-charcoal rounded-full px-5 py-2.5 hover:bg-charcoal hover:text-cream transition-colors">Request a part to be designed &amp; printed</a>`
    : '';

  const body =
    kind === 'story'
      ? null
      : `<div class="grid grid-cols-2 md:grid-cols-3 gap-5">${catalogueItems(name, items, slug)}</div>
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
const categoryPages = [
  { slug: 'toys', file: 'toys.html', depth: 0, pagePath: 'toys.html', description: 'Playful, durable 3D printed toys — printed locally to order in colours you choose.' },
  { slug: 'homeware', file: 'homeware.html', depth: 0, pagePath: 'homeware.html', description: 'Practical and decorative homeware — hooks, organisers, planters and more, printed to order.' },
  { slug: 'phones', file: 'phones.html', depth: 0, pagePath: 'phones.html', description: 'Phone cases, stands and accessories — fitted and finished for everyday use.' },
  { slug: 'gwm', file: 'car-parts/gwm.html', depth: 1, pagePath: 'car-parts/gwm.html', name: 'GWM' },
  { slug: 'landrover', file: 'car-parts/landrover.html', depth: 1, pagePath: 'car-parts/landrover.html', name: 'Landrover' },
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
}

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

console.log('\\nDone.');
