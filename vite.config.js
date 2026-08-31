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
    terms: resolve(__dirname, 'terms.html'),
    privacy: resolve(__dirname, 'privacy.html'),
    returns: resolve(__dirname, 'returns.html'),
  };

  for (const dir of ['filament', 'car-parts']) {
    const abs = resolve(__dirname, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs).filter((f) => f.endsWith('.html'))) {
      const key = `${dir}-${file.replace(/\.html$/, '')}`;
      entries[key] = resolve(abs, file);
    }
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
});
