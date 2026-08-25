import { randomUUID } from 'crypto';
import { getDb } from './db.js';

// Pre-release versions use "<major>.<minor two-digit>" (e.g. "0.01").
// V1.0 is deliberately reserved for the first official release; later
// maintenance releases continue as V1.01, V1.02, and so on.
function nextLabel(db) {
  // version_number tiebreaks created_at -- two rows can land on the same
  // millisecond in a fast test/CI run, but version_number is always
  // strictly monotonic per insert, so it alone decides "most recent" then.
  const last = db.prepare('SELECT version_label FROM version_history ORDER BY created_at DESC, version_number DESC LIMIT 1').get();
  const match = last?.version_label ? /^(\d+)\.(\d{1,2})$/.exec(last.version_label) : null;
  if (!match) return '0.01';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (minor === 99) return `${major + 1}.0`;
  if (minor === 0) return `${major}.01`;
  return `${major}.${String(minor + 1).padStart(2, '0')}`;
}

export function listVersions(db = getDb()) {
  return db.prepare('SELECT * FROM version_history ORDER BY created_at DESC, version_number DESC').all();
}

export function getVersion(id, db = getDb()) {
  return db.prepare('SELECT * FROM version_history WHERE id = ?').get(id) || null;
}

// The only way a row gets created -- see scripts/record-deploy-version.mjs,
// invoked automatically by deploy/deploy-app.sh after every deploy.
// deployedBy defaults to 'deploy' but stays a parameter so a test (or any
// future non-deploy caller) can be explicit about it.
export function recordVersion(description, deployedBy = 'deploy', db = getDb()) {
  if (!description || typeof description !== 'string') {
    throw new Error('description required');
  }
  const label = nextLabel(db);
  const latest = db.prepare('SELECT MAX(version_number) as max FROM version_history').get();
  const versionNumber = (latest.max || 0) + 1;
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO version_history (id, version_number, version_label, description, deployed_date, deployed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, versionNumber, label, description, now, deployedBy, now);
  return { id, version_number: versionNumber, version_label: label, description, deployed_date: now, deployed_by: deployedBy };
}
