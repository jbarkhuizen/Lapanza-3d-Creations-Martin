import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDb } from './db.js';
import { backupsDir, uploadsDir, dataDir } from './paths.js';

// execFile (async), not execFileSync -- syncOffsite now makes two rclone
// calls instead of one (DB backups, then uploads), and uploads is real
// photo content that can take much longer to transfer than the tiny
// incremental DB backup diff the first call moves. Synchronous meant this
// blocked Node's entire single-threaded event loop for the whole
// duration -- every other request to the admin backend (site included,
// since it's the same process) queued behind it. Found this the hard way
// immediately after shipping the uploads-copy addition: the admin API
// went unresponsive for the better part of a minute during the very next
// scheduled sync.
const execFileAsync = promisify(execFile);

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

// Each .db backup gets a paired snapshot of data/catalog.json under the
// same timestamp. The category-item catalog (toys/homeware/phones/car-parts
// prices, SKUs, stock) lives ONLY in that one gitignored JSON file -- not in
// SQLite -- so until this pairing existed the backup job protected the
// database while the other half of the product data had no copy anywhere.
// The pair rides along to the offsite remote for free: syncOffsite() rclone-
// syncs the whole backups dir, not just *.db.
function catalogSnapshotName(dbFilename) {
  return dbFilename.replace(/\.db$/, '.catalog.json');
}

// better-sqlite3's db.backup() uses SQLite's own online backup API -- safe
// to run against a live database in WAL mode, no need to stop the app or
// lock out writers for the duration.
export async function createBackup(db = getDb()) {
  const dir = ensureBackupsDir();
  const filename = backupFilename();
  await db.backup(path.join(dir, filename));
  const catalogSource = path.join(dataDir(), 'catalog.json');
  const catalogIncluded = fs.existsSync(catalogSource);
  if (catalogIncluded) {
    fs.copyFileSync(catalogSource, path.join(dir, catalogSnapshotName(filename)));
  }
  return { ...statBackup(dir, filename), catalogIncluded };
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
  const dir = ensureBackupsDir();
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  // Remove the paired catalog snapshot too, so pruneOldBackups never
  // strands orphaned .catalog.json files that nothing lists or rotates.
  const catalogPath = path.join(dir, catalogSnapshotName(filename));
  if (filename.endsWith('.db') && fs.existsSync(catalogPath)) fs.unlinkSync(catalogPath);
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
// Appends an "uploads" subfolder onto whatever the DB backups remote is --
// same rclone remote/config, just a sibling destination, so there's no
// separate BACKUP_RCLONE_REMOTE-style env var to configure for this.
function uploadsRemoteFor(remote) {
  return remote.endsWith('/') || remote.endsWith(':') ? `${remote}uploads` : `${remote}/uploads`;
}

// closes backlog #132: public/uploads/ (filament colour photos, category
// item photos, design-request/print-job/3D-resource uploads) is real,
// manually-created business content with no local rotation of its own --
// unlike data/backups/ above, there was previously NO copy of it anywhere
// but this one disk. Discovered the hard way on 2026-08-27 when an AI
// assistant's own `git stash -u` + drop destroyed 106 filament colour
// photos, recoverable only by luck (a dangling git object that hadn't
// been garbage-collected yet, not any actual backup).
//
// Deliberately `copy`, never `sync`, and deliberately a SEPARATE try/catch
// from the DB sync above: `sync` makes the destination exactly match the
// source, including deletions -- for the DB backups dir that's correct
// (mirrors pruneOldBackups' own deliberate deletions), but for uploads it
// would silently propagate an accidental local deletion (this exact
// incident) to the offsite copy too, defeating the entire point. `copy`
// only ever adds/updates, so a file removed locally stays safe offsite
// until someone explicitly removes it there as well. A failure here must
// never be reported as "the backup failed" when the DB sync above (what
// every existing caller already depends on) already succeeded.
export async function syncOffsite({ remote = process.env.BACKUP_RCLONE_REMOTE, dir = backupsDir(), uploads = uploadsDir(), run = execFileAsync } = {}) {
  if (!remote) {
    throw new Error('BACKUP_RCLONE_REMOTE is not set — off-server backup sync is disabled. See docs/DEPLOY.md.');
  }
  await run('rclone', ['sync', dir, remote]);
  try {
    await run('rclone', ['copy', uploads, uploadsRemoteFor(remote)]);
  } catch (err) {
    console.error('Offsite uploads copy failed (DB backup sync above still succeeded):', err.message);
  }
  return true;
}
