import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSiteDirectory, getSiteOverview } from './site-overview.js';
import { openDb } from './db.js';

test('site directory inventory returns safe metadata and rejects paths outside its root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-overview-test-'));
  try {
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'readme.txt'), 'abc');
    const inventory = listSiteDirectory(root, { filesystemRoot: root });
    assert.strictEqual(inventory.entries.find((entry) => entry.name === 'nested').type, 'directory');
    assert.strictEqual(inventory.entries.find((entry) => entry.name === 'readme.txt').sizeBytes, 3);
    assert.throws(() => listSiteDirectory(path.dirname(root), { filesystemRoot: root }), /outside/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('directory browsing defaults its root to the app directory, not the whole drive', () => {
  // Regression: the default used to be path.parse(cwd).root -- i.e. / --
  // letting a logged-in admin enumerate /etc, /root, /home names and sizes.
  assert.throws(() => listSiteDirectory(path.dirname(process.cwd())), /outside/);
});

test('site overview includes the latest deployed release', () => {
  const db = openDb(':memory:');
  db.prepare(`
    INSERT INTO version_history (id, version_number, version_label, description, deployed_date, deployed_by, created_at)
    VALUES ('release-33', 33, '0.33', 'Newsletter analytics', '2026-08-25T07:32:37.479Z', 'deploy', '2026-08-25T07:32:37.479Z')
  `).run();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-overview-release-test-'));
  try {
    const overview = getSiteOverview({ appRoot: root, filesystemRoot: root, db });
    assert.deepStrictEqual(overview.application.latestRelease, {
      versionLabel: '0.33',
      description: 'Newsletter analytics',
      deployedAt: '2026-08-25T07:32:37.479Z',
    });
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
