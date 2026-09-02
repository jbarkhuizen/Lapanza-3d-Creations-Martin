import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function htmlEntries() {
  const entries = {
    main: resolve(__dirname, 'index.html'),
    story: resolve(__dirname, 'story.html'),
    toys: resolve(__dirname, 'toys.html'),
    homeware: resolve(__dirname, 'homeware.html'),
    phones: resolve(__dirname, 'phones.html'),
    checkout: resolve(__dirname, 'checkout.html'),
    checkoutComplete: resolve(__dirname, 'checkout-complete.html'),
    resources: resolve(__dirname, 'resources.html'),
    designRequest: resolve(__dirname, 'design-request.html'),
    getInTouch: resolve(__dirname, 'get-in-touch.html'),
    materialsGuide: resolve(__dirname, 'materials-guide.html'),
    designRequestStatus: resolve(__dirname, 'design-request-status.html'),
    seoCustomPrinting: resolve(__dirname, 'custom-3d-printing-centurion.html'),
    seoFilamentSa: resolve(__dirname, 'filament-south-africa.html'),
    seoVehicleParts: resolve(__dirname, 'vehicle-3d-printed-parts.html'),
    account: resolve(__dirname, 'account.html'),
    notFound: resolve(__dirname, '404.html'),
    terms: resolve(__dirname, 'terms.html'),
    privacy: resolve(__dirname, 'privacy.html'),
    returns: resolve(__dirname, 'returns.html'),
  };

  for (const dir of ['filament', 'car-parts', 'products']) {
    const abs = resolve(__dirname, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs).filter((f) => f.endsWith('.html'))) {
      const key = `${dir}-${file.replace(/\.html$/, '')}`;
      entries[key] = resolve(abs, file);
    }
  }
  // Every root-level *.html becomes an entry automatically — a new
  // generated category page (dynamic categories, 2026-09-02) or any future
  // root page can no longer 404 in production because it wasn't hand-listed
  // above (the trap that bit three times). The explicit names stay for
  // their stable chunk keys; this scan only adds what they missed.
  const claimed = new Set(Object.values(entries));
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.html'))) {
    const abs = resolve(__dirname, file);
    if (!claimed.has(abs)) entries[`root-${file.replace(/\.html$/, '')}`] = abs;
  }
  return entries;
}

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: htmlEntries(),
    },
  },
  server: {
    open: '/index.html',
    port: 5173,
    // The public site (this dev server, 5173) and the admin/checkout API
    // (server/index.js, 8787) are two separate processes -- proxying /api
    // here is what lets checkout.html's relative fetch('/api/...') calls
    // reach the Express server instead of 404ing against Vite itself.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  // #115: `vite preview` serves the built dist/ for the Playwright smoke
  // pack -- same /api proxy reasoning as the dev server above, plus
  // /uploads (nginx handles both in production).
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
    },
  },
});
