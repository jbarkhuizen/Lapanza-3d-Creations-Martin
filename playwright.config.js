// Backlog #115 (SITE-081): end-to-end smoke pack. Runs the REAL built
// storefront (`vite preview` over dist/) against the REAL Express backend
// with a scratch DATA_DIR database — the layer HTTP-level tests can't see
// (this project shipped a live 404 from a missing vite build entry that
// every unit/HTTP test passed over; see AI_HANDOFF).
//
// CAUTION (local runs): the backend writes generated files relative to its
// cwd. In CI the workspace is throwaway; locally, `npm run test:e2e` will
// touch src/data/*.json + generated HTML in your checkout — reset them
// afterwards (git checkout -- .) or run only in CI. The known DATA_DIR
// caveat is deliberate here: only the DB is isolated.
import { defineConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const scratchData = process.env.E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-e2e-'));
process.env.E2E_DATA_DIR = scratchData; // shared with the specs' seed step

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
