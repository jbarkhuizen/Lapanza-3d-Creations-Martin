#!/usr/bin/env node
/**
 * Lapanza 3D — single startup file
 * Installs dependencies (if needed) and launches:
 *   - Public site  → http://localhost:5173
 *   - Admin portal → http://localhost:8787/admin/
 *
 * Usage:
 *   node start.mjs
 *   double-click start.bat (Windows)
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function log(msg) {
  console.log(`\n▸ ${msg}`);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureNode() {
  const v = process.versions.node;
  const major = Number(v.split('.')[0]);
  if (major < 18) {
    console.error(`Node.js 18+ required (found ${v}). Install from https://nodejs.org`);
    process.exit(1);
  }
  log(`Node ${v}`);
}

function ensureDeps() {
  const marker = join(root, 'node_modules', 'vite', 'package.json');
  if (!existsSync(marker)) {
    log('Installing dependencies (first run)…');
    run(npmCmd, ['install']);
  } else {
    log('Dependencies already installed');
  }
}

function startDev() {
  log('Starting public site  → http://localhost:5173');
  log('Starting admin portal → http://localhost:8787/admin/');
  console.log('  Admin password: lapanza-admin');
  console.log('  Press Ctrl+C to stop.\n');
  const child = spawn(npmCmd, ['run', 'dev:all'], {
    stdio: 'inherit',
    shell: isWin,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

try {
  ensureNode();
  ensureDeps();
  startDev();
} catch (err) {
  console.error('\nStartup failed:', err.message || err);
  process.exit(1);
}
