import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from './db.js';
import { createBackup, listBackups, deleteBackup, getBackupPath, pruneOldBackups, syncOffsite } from './backups.js';

// Isolates BACKUPS_DIR to a fresh temp directory per test (same override
// mechanism paths.js documents for production disk-mount overrides) so
// these tests never touch the real dev backups folder.
function withTempBackupsDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-backups-test-'));
  const previous = process.env.BACKUPS_DIR;
  process.env.BACKUPS_DIR = dir;
  return Promise.resolve(fn(dir)).finally(() => {
    if (previous === undefined) delete process.env.BACKUPS_DIR;
    else process.env.BACKUPS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('createBackup writes a real, non-empty .db file and returns its metadata', async () => {
  await withTempBackupsDir(async (dir) => {
    const db = openDb(':memory:');
    const backup = await createBackup(db);
    assert.match(backup.filename, /^lapanza-backup-.*\.db$/);
    assert.ok(backup.sizeBytes > 0);
    assert.ok(backup.createdAt);
    assert.ok(fs.existsSync(path.join(dir, backup.filename)));
    db.close();
  });
});

test('listBackups returns newest first and only lists .db files', async () => {
  await withTempBackupsDir(async (dir) => {
    fs.writeFileSync(path.join(dir, 'not-a-backup.txt'), 'ignore me');
    const db = openDb(':memory:');
    const first = await createBackup(db);
    await new Promise((r) => setTimeout(r, 5));
    const second = await createBackup(db);
    db.close();

    const backups = listBackups();
    assert.strictEqual(backups.length, 2);
    assert.strictEqual(backups[0].filename, second.filename);
    assert.strictEqual(backups[1].filename, first.filename);
  });
});

test('deleteBackup removes an existing file, is a no-op for a missing one, rejects unsafe filenames', async () => {
  await withTempBackupsDir(async () => {
    const db = openDb(':memory:');
    const backup = await createBackup(db);
    db.close();

    assert.strictEqual(deleteBackup(backup.filename), true);
    assert.strictEqual(listBackups().length, 0);
    assert.strictEqual(deleteBackup('never-existed.db'), false);
    assert.throws(() => deleteBackup('../../etc/passwd'), /Invalid backup filename/);
    assert.throws(() => deleteBackup('sub/dir.db'), /Invalid backup filename/);
    assert.throws(() => deleteBackup(''), /Invalid backup filename/);
  });
});

test('getBackupPath resolves an existing backup, returns null for a missing one, rejects unsafe filenames', async () => {
  await withTempBackupsDir(async (dir) => {
    const db = openDb(':memory:');
    const backup = await createBackup(db);
    db.close();

    assert.strictEqual(getBackupPath(backup.filename), path.join(dir, backup.filename));
    assert.strictEqual(getBackupPath('never-existed.db'), null);
    assert.throws(() => getBackupPath('../escape.db'), /Invalid backup filename/);
  });
});

test('pruneOldBackups keeps only the most recent N, deletes the rest', async () => {
  await withTempBackupsDir(async () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createBackup(db);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 5));
    }
    db.close();

    assert.strictEqual(listBackups().length, 5);
    const removed = pruneOldBackups(2);
    assert.strictEqual(removed, 3);
    assert.strictEqual(listBackups().length, 2);
  });
});

test('pruneOldBackups is a no-op when there are fewer backups than the keep count', async () => {
  await withTempBackupsDir(async () => {
    const db = openDb(':memory:');
    await createBackup(db);
    db.close();

    assert.strictEqual(pruneOldBackups(30), 0);
    assert.strictEqual(listBackups().length, 1);
  });
});

test('syncOffsite throws a clear error when no remote is configured', () => {
  assert.throws(() => syncOffsite({ remote: undefined }), /BACKUP_RCLONE_REMOTE is not set/);
});

test('syncOffsite shells out to rclone sync with the backups dir and configured remote', async () => {
  await withTempBackupsDir(async (dir) => {
    const calls = [];
    const result = syncOffsite({ remote: 'gdrive:', dir, run: (cmd, args) => calls.push({ cmd, args }) });
    assert.strictEqual(result, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].cmd, 'rclone');
    assert.deepStrictEqual(calls[0].args, ['sync', dir, 'gdrive:']);
  });
});

test('syncOffsite propagates a failure from the underlying rclone call', async () => {
  await withTempBackupsDir(async (dir) => {
    assert.throws(
      () =>
        syncOffsite({
          remote: 'gdrive:',
          dir,
          run: () => {
            throw new Error('rclone: didn\'t find section in config file');
          },
        }),
      /didn't find section/,
    );
  });
});
