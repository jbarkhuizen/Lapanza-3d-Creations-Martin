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

export function publicDir() {
  return path.join(process.cwd(), 'public');
}
