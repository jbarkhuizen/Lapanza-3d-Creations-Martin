#!/usr/bin/env node
// Run by deploy/deploy-app.sh after every deploy -- see the comment on
// server/version-history.js's recordVersion() for why this is the only
// way a version_history row gets created (no manual admin entry anymore).
// Runs directly against the SQLite file (server/db.js's getDb() resolves
// the path from cwd, matching where this always runs from: the app root),
// not over HTTP, so it needs no admin session/auth.
import { execFileSync } from 'child_process';
import { getDb } from '../server/db.js';
import { recordVersion } from '../server/version-history.js';
import { buildReleaseDetails, saveReleaseDetails } from '../server/release-details.js';

function latestCommitSummary() {
  const subject = execFileSync('git', ['log', '-1', '--pretty=%s']).toString().trim();
  const hash = execFileSync('git', ['log', '-1', '--pretty=%h']).toString().trim();
  return `${subject} (${hash})`;
}

function latestCommitHash() {
  return execFileSync('git', ['log', '-1', '--pretty=%H']).toString().trim();
}

const description = process.argv[2] || latestCommitSummary();
const db = getDb();
const releaseDetails = buildReleaseDetails({ commitHash: latestCommitHash(), db });
const result = db.transaction(() => {
  const version = recordVersion(description, 'deploy', db);
  saveReleaseDetails(version.id, releaseDetails, db);
  return version;
})();
console.log(`Recorded V${result.version_label} — ${result.description}`);
