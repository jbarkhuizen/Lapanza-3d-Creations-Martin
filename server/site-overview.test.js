import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSiteDirectory } from './site-overview.js';

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
