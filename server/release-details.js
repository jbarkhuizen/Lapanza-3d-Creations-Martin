import { execFileSync } from 'child_process';
import { getDb } from './db.js';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
}

function parseCommits(output) {
  if (!output) return [];
  return output
    .split('\x1e')
    .filter(Boolean)
    .map((record) => {
      const [hash, authorName, authorEmail, authoredAt, subject, body] = record.split('\x1f');
      return { hash, authorName, authorEmail, authoredAt, subject, body: body?.trim() || '' };
    });
}

function parseFiles(output) {
  if (!output) return [];
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, file] = line.split('\t');
      return {
        file,
        added: added === '-' ? 0 : Number(added),
        deleted: deleted === '-' ? 0 : Number(deleted),
      };
    });
}

function latestCommitHash(db) {
  return (
    db
      .prepare(
        `SELECT details.commit_hash
         FROM version_release_details details
         JOIN version_history versions ON versions.id = details.version_id
         WHERE details.commit_hash IS NOT NULL AND details.commit_hash != ''
         ORDER BY versions.version_number DESC
         LIMIT 1`,
      )
      .get()?.commit_hash || null
  );
}

export function buildReleaseDetails({ commitHash, previousCommitHash = null, cwd = process.cwd(), db = getDb() }) {
  const resolvedCommitHash = git(['rev-parse', commitHash], cwd);
  const previous = previousCommitHash || latestCommitHash(db);
  const range = previous ? `${previous}..${resolvedCommitHash}` : resolvedCommitHash;
  const commits = parseCommits(git(['log', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e', range], cwd));
  const files = parseFiles(
    git(previous ? ['diff', '--numstat', previous, resolvedCommitHash] : ['show', '--format=', '--numstat', resolvedCommitHash], cwd),
  );
  const releaseNotes = commits
    .map((commit) => [commit.subject, commit.body].filter(Boolean).join('\n\n'))
    .join('\n\n');

  return {
    commitHash: resolvedCommitHash,
    commitRange: range,
    releaseNotes,
    commits,
    files,
    filesAdded: files.reduce((total, file) => total + file.added, 0),
    filesDeleted: files.reduce((total, file) => total + file.deleted, 0),
    capturedAt: new Date().toISOString(),
  };
}

export function saveReleaseDetails(versionId, details, db = getDb()) {
  db.prepare(
    `INSERT INTO version_release_details (
       version_id, commit_hash, commit_range, release_notes, commits_json, files_json, files_added, files_deleted, captured_at
     ) VALUES (
       @versionId, @commitHash, @commitRange, @releaseNotes, @commitsJson, @filesJson, @filesAdded, @filesDeleted, @capturedAt
     )
     ON CONFLICT(version_id) DO UPDATE SET
       commit_hash = excluded.commit_hash,
       commit_range = excluded.commit_range,
       release_notes = excluded.release_notes,
       commits_json = excluded.commits_json,
       files_json = excluded.files_json,
       files_added = excluded.files_added,
       files_deleted = excluded.files_deleted,
       captured_at = excluded.captured_at`,
  ).run({
    versionId,
    commitHash: details.commitHash || null,
    commitRange: details.commitRange || null,
    releaseNotes: details.releaseNotes || '',
    commitsJson: JSON.stringify(details.commits || []),
    filesJson: JSON.stringify(details.files || []),
    filesAdded: details.filesAdded || 0,
    filesDeleted: details.filesDeleted || 0,
    capturedAt: details.capturedAt || new Date().toISOString(),
  });
}

export function getReleaseDetails(versionId, db = getDb()) {
  const row = db.prepare('SELECT * FROM version_release_details WHERE version_id = ?').get(versionId);
  if (!row) return null;
  return {
    versionId: row.version_id,
    commitHash: row.commit_hash,
    commitRange: row.commit_range,
    releaseNotes: row.release_notes,
    commits: JSON.parse(row.commits_json),
    files: JSON.parse(row.files_json),
    filesAdded: row.files_added,
    filesDeleted: row.files_deleted,
    capturedAt: row.captured_at,
  };
}
