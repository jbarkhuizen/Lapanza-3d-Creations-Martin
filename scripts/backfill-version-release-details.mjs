#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { getDb } from '../server/db.js';
import { listVersions } from '../server/version-history.js';
import { buildReleaseDetails, saveReleaseDetails } from '../server/release-details.js';

function commitHashFromDescription(description) {
  return /\(([0-9a-f]{7,40})\)\s*$/.exec(description || '')?.[1] || null;
}

function resolveCommit(hash) {
  return execFileSync('git', ['rev-parse', hash], { encoding: 'utf8' }).trim();
}

const force = process.argv.includes('--force');
const db = getDb();
const versions = [...listVersions(db)].reverse();
let previousCommitHash = null;
let captured = 0;
let skipped = 0;

for (const version of versions) {
  const existing = db.prepare('SELECT version_id FROM version_release_details WHERE version_id = ?').get(version.id);
  const commitHash = commitHashFromDescription(version.description);

  if (existing && !force) {
    skipped += 1;
    if (commitHash) previousCommitHash = resolveCommit(commitHash);
    continue;
  }

  if (!commitHash) {
    saveReleaseDetails(
      version.id,
      {
        commitHash: null,
        commitRange: null,
        releaseNotes: 'Baseline before automated release tracking.',
        commits: [],
        files: [],
        filesAdded: 0,
        filesDeleted: 0,
      },
      db,
    );
  } else {
    const resolvedCommitHash = resolveCommit(commitHash);
    const details = buildReleaseDetails({ commitHash: resolvedCommitHash, previousCommitHash, db });
    saveReleaseDetails(version.id, details, db);
    previousCommitHash = resolvedCommitHash;
  }
  captured += 1;
}

console.log(`Release-detail backfill complete: captured ${captured}, skipped ${skipped}.`);
