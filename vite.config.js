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
  },
});
