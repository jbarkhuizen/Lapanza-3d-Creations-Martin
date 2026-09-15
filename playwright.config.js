// Backlog #115 (SITE-081): end-to-end smoke pack. Runs the REAL built
// storefront (`vite preview` over dist/) against the REAL Express backend
// with a scratch DATA_DIR database — the layer HTTP-level tests can't see
// (this project shipped a live 404 from a missing vite build entry that
// every unit/HTTP test passed over; see AI_HANDOFF).
//
// The backend's catalog-publish pipeline (server/index.js's
// publishCatalog(): syncPublicJson() + scripts/generate-pages.mjs +
// `npm run build`) writes real files relative to its own cwd --
// data/catalog.json, src/data/{filaments,categories,settings}.json,
// public/{site-settings,search-index}.json, public/sitemap.xml, and every
// top-level generated page (filament/*, products/*, car-parts/*, etc.),
// rewritten in place. DATA_DIR alone only isolates the SQLite DB; any admin
// action or checkout that reaches publishCatalog() during a test run (the
// Settings save, an order, a category edit...) used to mutate ALL of the
// above for real, in this actual checkout -- confirmed to leave 150-250
// tracked files modified/deleted after a single `npm run test:e2e` run,
// same failure class scripts/generate-pages.test.js had (see its own
// isolation fix). Backend node_modules resolves relative to the launched
// script's own on-disk path, not cwd, so a plain cwd override isn't enough
// on its own -- the backend needs to actually run from a scratch COPY of
// the repo tree (node_modules symlinked in, not copied: cheap, and keeps
// the exact installed/native build e.g. better-sqlite3's bindings).
//
// The frontend (`vite preview`) deliberately keeps the REAL repo as its
// cwd, unchanged: it serves the already-built, gitignored dist/ (not
// tracked, so not at risk), and the storefront spec's seeded SKU is read
// from -- and expected to already exist in -- that real build's data, not
// anything the backend's scratch copy produces.
import { defineConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

const scratchData = process.env.E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-e2e-'));
process.env.E2E_DATA_DIR = scratchData; // shared with the specs' seed step

// Excludes: node_modules (symlinked below, not copied -- keeps native
// bindings intact and the copy fast), dist (gitignored build output, not
// at risk and not needed -- the backend rebuilds its own scratch copy),
// test-results/playwright-report (this run's own output dir, would recurse
// into itself if included), data (must start EMPTY so the backend's own
// cwd-relative `data/` -- unrelated to DATA_DIR above, see server/store.js
// -- doesn't inherit a real, possibly non-empty local dev DB/catalog).
// Anchored to the FIRST path segment only -- an unanchored match would also
// catch src/data (real source content the backend needs, e.g. filaments.json)
// since "data" is a substring of that path too.
const SKIP_COPY = /^[\\/](node_modules|dist|test-results|playwright-report|data)(?:$|[\\/])/;
const backendRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-e2e-backend-'));
fs.cpSync(ROOT, backendRoot, {
  recursive: true,
  filter: (src) => !SKIP_COPY.test(src.slice(ROOT.length)),
});
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(backendRoot, 'node_modules'), 'dir');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one shared backend + seeded state -- keep runs deterministic
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node server/index.js',
      cwd: backendRoot,
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: false,
      env: { PORT: '8787', DATA_DIR: scratchData, NODE_ENV: 'test' },
      timeout: 30_000,
    },
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/index.html',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
