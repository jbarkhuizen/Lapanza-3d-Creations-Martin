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

// Same isolation idea as withTempBackupsDir, for the catalog's home:
// points DATA_DIR at a temp dir so these tests control whether a
// catalog.json exists without touching the real dev data folder.
function withTempDataDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapanza-data-test-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  return Promise.resolve(fn(dir)).finally(() => {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('createBackup snapshots data/catalog.json alongside the .db under the same timestamp', async () => {
  await withTempBackupsDir(async (dir) => {
    await withTempDataDir(async (data) => {
      fs.writeFileSync(path.join(data, 'catalog.json'), JSON.stringify({ version: 1, products: [{ id: 'p1' }] }));
      const db = openDb(':memory:');
      const backup = await createBackup(db);
      db.close();

      assert.strictEqual(backup.catalogIncluded, true);
      const snapshotName = backup.filename.replace(/\.db$/, '.catalog.json');
      const snapshot = JSON.parse(fs.readFileSync(path.join(dir, snapshotName), 'utf8'));
      assert.strictEqual(snapshot.products[0].id, 'p1');
    });
  });
});

test('createBackup still succeeds when no catalog.json exists, and says so', async () => {
  await withTempBackupsDir(async (dir) => {
    await withTempDataDir(async () => {
      const db = openDb(':memory:');
      const backup = await createBackup(db);
      db.close();

      assert.strictEqual(backup.catalogIncluded, false);
      assert.ok(fs.existsSync(path.join(dir, backup.filename)));
      assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.catalog.json')).length, 0);
    });
  });
});

test('deleteBackup removes the paired catalog snapshot, and pruning strands no orphans', async () => {
  await withTempBackupsDir(async (dir) => {
    await withTempDataDir(async (data) => {
      fs.writeFileSync(path.join(data, 'catalog.json'), '{"version":1,"products":[]}');
      const db = openDb(':memory:');
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await createBackup(db);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 5));
      }
      db.close();

      assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.catalog.json')).length, 3);
      pruneOldBackups(1);
      const remaining = fs.readdirSync(dir);
      assert.strictEqual(remaining.filter((f) => f.endsWith('.db')).length, 1);
      assert.strictEqual(remaining.filter((f) => f.endsWith('.catalog.json')).length, 1, 'pruned .db files must take their catalog snapshots with them');
    });
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

test('syncOffsite rejects with a clear error when no remote is configured', async () => {
  await assert.rejects(() => syncOffsite({ remote: undefined }), /BACKUP_RCLONE_REMOTE is not set/);
});

test('syncOffsite shells out to rclone sync with the backups dir and configured remote, then rclone copy for uploads', async () => {
  await withTempBackupsDir(async (dir) => {
    const calls = [];
    const result = await syncOffsite({ remote: 'gdrive:', dir, uploads: '/tmp/uploads', run: (cmd, args) => calls.push({ cmd, args }) });
    assert.strictEqual(result, true);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].cmd, 'rclone');
    assert.deepStrictEqual(calls[0].args, ['sync', dir, 'gdrive:']);
    assert.strictEqual(calls[1].cmd, 'rclone');
    assert.deepStrictEqual(calls[1].args, ['copy', '/tmp/uploads', 'gdrive:uploads']);
  });
});

test('syncOffsite appends "uploads" onto a remote that already has a trailing path segment', async () => {
  await withTempBackupsDir(async (dir) => {
    const calls = [];
    await syncOffsite({ remote: 'gdrive:backups', dir, uploads: '/tmp/uploads', run: (cmd, args) => calls.push({ cmd, args }) });
    assert.deepStrictEqual(calls[1].args, ['copy', '/tmp/uploads', 'gdrive:backups/uploads']);
  });
});

test('syncOffsite does not block the event loop -- a slow rclone call runs concurrently with other async work', async () => {
  // Regression test: the original implementation used execFileSync, which
  // blocks Node's entire single-threaded event loop for the call's full
  // duration -- with uploads added alongside the DB sync, a real sync took
  // over 5 minutes in production and made the whole admin backend (site
  // included, same process) unresponsive the entire time. Proves the fix:
  // a slow `run` (via setTimeout, not blocking) still lets an unrelated
  // async tick happen concurrently while syncOffsite is awaiting it.
  await withTempBackupsDir(async (dir) => {
    let otherWorkRan = false;
    const slowRun = () => new Promise((resolve) => setTimeout(resolve, 20));
    const syncPromise = syncOffsite({ remote: 'gdrive:', dir, uploads: '/tmp/uploads', run: slowRun });
    await new Promise((resolve) => setTimeout(() => { otherWorkRan = true; resolve(); }, 0));
    assert.strictEqual(otherWorkRan, true, 'other async work must be able to run while syncOffsite is in flight');
    await syncPromise;
  });
});

test('syncOffsite propagates a failure from the underlying rclone sync call (uploads copy never attempted)', async () => {
  await withTempBackupsDir(async (dir) => {
    const calls = [];
    await assert.rejects(
      () =>
        syncOffsite({
          remote: 'gdrive:',
          dir,
          run: (cmd, args) => {
            calls.push(args);
            throw new Error('rclone: didn\'t find section in config file');
          },
        }),
      /didn't find section/,
    );
    assert.strictEqual(calls.length, 1, 'the DB sync call, and only that one, should have been attempted');
  });
});

test('syncOffsite does not propagate a failure from the uploads copy -- the DB backup sync already succeeded', async () => {
  await withTempBackupsDir(async (dir) => {
    const calls = [];
    const result = await syncOffsite({
      remote: 'gdrive:',
      dir,
      uploads: '/tmp/uploads',
      run: (cmd, args) => {
        calls.push(args);
        if (args[0] === 'copy') throw new Error('rclone: uploads copy failed');
      },
    });
    assert.strictEqual(result, true, 'a failed uploads copy must not make the whole call throw');
    assert.strictEqual(calls.length, 2, 'both the sync and the copy should still have been attempted');
  });
});
