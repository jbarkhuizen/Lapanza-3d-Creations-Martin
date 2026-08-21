import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getDb } from './db.js';
import { backupsDir } from './paths.js';

function ensureBackupsDir() {
  const dir = backupsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Filesystem-safe timestamp (no colons) -- sorts correctly by filename too,
// which listBackups() relies on as a tiebreaker.
function backupFilename(date = new Date()) {
  return `lapanza-backup-${date.toISOString().replace(/[:.]/g, '-')}.db`;
}

function statBackup(dir, filename) {
  const stats = fs.statSync(path.join(dir, filename));
  return { filename, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() };
}

// A bare filename only -- no path separators or traversal segments. Every
// function below that takes a filename (not one it generated itself) must
// go through this before touching the filesystem.
function assertSafeFilename(filename) {
  if (!filename || typeof filename !== 'string' || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Invalid backup filename');
  }
}

// better-sqlite3's db.backup() uses SQLite's own online backup API -- safe
// to run against a live database in WAL mode, no need to stop the app or
// lock out writers for the duration.
export async function createBackup(db = getDb()) {
  const dir = ensureBackupsDir();
  const filename = backupFilename();
  await db.backup(path.join(dir, filename));
  return statBackup(dir, filename);
}

export function listBackups() {
  const dir = ensureBackupsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((filename) => statBackup(dir, filename))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.filename.localeCompare(a.filename));
}

export function deleteBackup(filename) {
  assertSafeFilename(filename);
  const filePath = path.join(ensureBackupsDir(), filename);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// Returns the absolute path for a download handler to stream, or null if
// the named backup doesn't exist.
export function getBackupPath(filename) {
  assertSafeFilename(filename);
  const filePath = path.join(ensureBackupsDir(), filename);
  return fs.existsSync(filePath) ? filePath : null;
}

// Keeps the most recent `keep` backups, deletes the rest -- called after
// every automated backup so the job is self-maintaining and never fills the
// disk on its own. Manual backups from the admin UI count toward this too;
// deliberately not exempted, since "manual" isn't a signal that a backup is
// more important to keep.
export function pruneOldBackups(keep = 30) {
  const stale = listBackups().slice(keep);
  for (const b of stale) deleteBackup(b.filename);
  return stale.length;
}

// On-disk backups above protect against bad data, a bad deploy, or human
// error -- but they live on the SAME disk as the live DB, so they're no
// help at all against that disk, or the whole VPS, failing outright. This
// mirrors the whole `backupsDir()` to a remote via rclone (not just the
// latest file), so the remote self-corrects to match local retention --
// whatever pruneOldBackups() removed locally also disappears remotely,
// rather than growing an ever-larger, never-pruned remote copy.
//
// Shells out to the `rclone` binary (via execFileSync -- array args, no
// shell string interpolation) rather than a Google API client library, so
// this app's own dependency tree doesn't grow just for one nightly
// directory copy; rclone already handles auth refresh, retries, and
// resumable uploads. `run` is injectable so tests can stub it out without
// a real rclone binary or network access.
//
// `remote` reads process.env directly in the default-parameter expression
// (not a module-load-time constant) -- default params re-evaluate on every
// call, but a top-level `const` would freeze to whatever was in
// process.env when this module was first imported, which is BEFORE
// index.js's process.loadEnvFile('.env') call runs (imports execute before
// the rest of that file's top-level code). Same reason mailer.js/payfast.js
// read their env vars lazily inside functions instead of module constants.
export function syncOffsite({ remote = process.env.BACKUP_RCLONE_REMOTE, dir = backupsDir(), run = execFileSync } = {}) {
  if (!remote) {
    throw new Error('BACKUP_RCLONE_REMOTE is not set — off-server backup sync is disabled. See docs/DEPLOY.md.');
  }
  run('rclone', ['sync', dir, remote]);
  return true;
}
