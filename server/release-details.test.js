import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from './db.js';
import { buildReleaseDetails, getReleaseDetails, saveReleaseDetails } from './release-details.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('release details capture commits, changed files, and line statistics', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'release-details-'));
  const db = openDb(':memory:');
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.name', 'Release Test']);
    git(cwd, ['config', 'user.email', 'release@example.test']);
    fs.writeFileSync(path.join(cwd, 'feature.txt'), 'first line\n');
    git(cwd, ['add', 'feature.txt']);
    git(cwd, ['commit', '-m', 'Initial feature']);
    const first = git(cwd, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(cwd, 'feature.txt'), 'first line\nsecond line\n');
    fs.writeFileSync(path.join(cwd, 'notes.txt'), 'release notes\n');
    git(cwd, ['add', 'feature.txt', 'notes.txt']);
    git(cwd, ['commit', '-m', 'Expand feature', '-m', 'Adds release notes.']);
    const second = git(cwd, ['rev-parse', 'HEAD']);

    const details = buildReleaseDetails({ commitHash: second, previousCommitHash: first, cwd, db });
    assert.strictEqual(details.commitHash, second);
    assert.strictEqual(details.commits.length, 1);
    assert.strictEqual(details.commits[0].subject, 'Expand feature');
    assert.ok(details.files.some((file) => file.file === 'feature.txt'));
    assert.ok(details.files.some((file) => file.file === 'notes.txt'));
    assert.strictEqual(details.filesAdded, 2);
    assert.strictEqual(details.filesDeleted, 0);

    db.prepare(
      `INSERT INTO version_history (id, version_number, version_label, description, deployed_date, deployed_by, created_at)
       VALUES ('version-1', 1, '0.01', 'Test release', datetime('now'), 'test', datetime('now'))`,
    ).run();
    saveReleaseDetails('version-1', details, db);
    const stored = getReleaseDetails('version-1', db);
    assert.deepStrictEqual(stored.files, details.files);
    assert.strictEqual(stored.releaseNotes, details.releaseNotes);
  } finally {
    db.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
