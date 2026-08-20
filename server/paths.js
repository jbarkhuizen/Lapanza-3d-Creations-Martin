import path from 'path';

// Functions, not frozen constants -- resolved per call against the CURRENT
// process.cwd() (matching db.js's existing pattern), which several tests
// rely on via process.chdir() to isolate cwd-scoped state between test
// blocks. A constant computed once at import time would freeze to whatever
// cwd was active on first import and silently break that isolation.
//
// Overridable via env for hosts with a separate persistent-disk mount (e.g.
// Render: set DATA_DIR=/data, UPLOADS_DIR=/data/uploads so the SQLite file
// and uploaded images survive redeploys instead of living on the app's
// ephemeral local filesystem). Defaults match this project's existing local
// dev layout, so nothing changes for anyone not setting these.
export function dataDir() {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}

export function uploadsDir() {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), 'public', 'uploads');
}

// Deliberately its own override (not nested under DATA_DIR) so a host can
// point backups at a separate disk/volume from the live DB -- defeats the
// purpose of a backup if both live on the same disk that just failed.
export function backupsDir() {
  return process.env.BACKUPS_DIR || path.join(process.cwd(), 'data', 'backups');
}

export function publicDir() {
  return path.join(process.cwd(), 'public');
}
