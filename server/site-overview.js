import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { backupsDir, dataDir, uploadsDir } from './paths.js';
import { getDb } from './db.js';

const VIRTUAL_PATHS = new Set(['/proc', '/sys', '/dev', '/run']);
const directoryCache = new Map();

function bytes(value) {
  return Number.isFinite(value) ? value : null;
}

function stat(pathname) {
  try {
    const item = fs.statSync(pathname);
    return { sizeBytes: item.size, modifiedAt: item.mtime.toISOString() };
  } catch {
    return { sizeBytes: null, modifiedAt: null };
  }
}

function sizeMap(directory) {
  if (process.platform === 'win32') return new Map();
  const output = spawnSync('du', ['-x', '-B1', '--max-depth=1', directory], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
  }).stdout || '';
  return new Map(output.split('\n').flatMap((line) => {
    const match = line.match(/^(\d+)\t(.+)$/);
    return match ? [[path.resolve(match[2]), Number(match[1])]] : [];
  }));
}

function assertBrowsable(pathname, filesystemRoot) {
  const resolved = path.resolve(pathname);
  const relative = path.relative(filesystemRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside the filesystem inventory');
  if ([...VIRTUAL_PATHS].some((blocked) => resolved === blocked || resolved.startsWith(`${blocked}${path.sep}`))) {
    throw new Error('Virtual system paths are not browsable');
  }
  return resolved;
}

// Browsing is clamped to the app's own directory, not the drive root it
// previously defaulted to -- a storefront admin (or anyone holding a stolen
// session) has no business enumerating /etc, /root, or /home, even
// names-and-sizes only. Disk-usage totals in getSiteOverview still read the
// volume root via statfs; that returns numbers, not directory contents.
export function listSiteDirectory(requestedPath, { filesystemRoot = process.cwd() } = {}) {
  const directory = assertBrowsable(requestedPath || filesystemRoot, filesystemRoot);
  const cached = directoryCache.get(directory);
  if (cached && Date.now() - cached.createdAt < 30_000) return cached.value;
  const sizes = sizeMap(directory);
  let unreadableEntries = 0;
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      try {
        const details = fs.lstatSync(fullPath);
        const isDirectory = entry.isDirectory() && !entry.isSymbolicLink();
        return {
          name: entry.name,
          path: fullPath,
          type: entry.isSymbolicLink() ? 'symlink' : isDirectory ? 'directory' : 'file',
          sizeBytes: isDirectory ? bytes(sizes.get(path.resolve(fullPath))) : details.size,
          modifiedAt: details.mtime.toISOString(),
          browsable: isDirectory && ![...VIRTUAL_PATHS].some((blocked) => fullPath === blocked),
        };
      } catch {
        unreadableEntries += 1;
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1))
    .slice(0, 1_000);
  const value = {
    path: directory,
    parentPath: directory === filesystemRoot ? null : path.dirname(directory),
    entries,
    unreadableEntries,
    truncated: entries.length === 1_000,
  };
  directoryCache.set(directory, { createdAt: Date.now(), value });
  return value;
}

export function getSiteOverview({ appRoot = process.cwd(), filesystemRoot = path.parse(appRoot).root, db = getDb() } = {}) {
  const storage = fs.statfsSync(filesystemRoot);
  const diskTotalBytes = Number(storage.blocks) * Number(storage.bsize);
  const diskFreeBytes = Number(storage.bfree) * Number(storage.bsize);
  const backupDirectory = backupsDir();
  const backupFiles = fs.existsSync(backupDirectory)
    ? fs.readdirSync(backupDirectory).filter((file) => file.endsWith('.db'))
    : [];
  const appPaths = [
    ['Application', appRoot],
    ['Database directory', dataDir()],
    ['Uploads', uploadsDir()],
    ['Backups', backupDirectory],
    ['Dependencies', path.join(appRoot, 'node_modules')],
  ].map(([label, pathname]) => ({ label, path: pathname, ...stat(pathname) }));
  const latestRelease = db.prepare(`
    SELECT version_label AS versionLabel, description, deployed_date AS deployedAt
    FROM version_history
    ORDER BY created_at DESC, version_number DESC
    LIMIT 1
  `).get() || null;
  return {
    system: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      architecture: os.arch(),
      uptimeSeconds: os.uptime(),
      nodeVersion: process.version,
      cpuCount: os.cpus().length,
      memoryTotalBytes: os.totalmem(),
      memoryFreeBytes: os.freemem(),
    },
    disk: {
      filesystemRoot,
      totalBytes: diskTotalBytes,
      freeBytes: diskFreeBytes,
      usedBytes: diskTotalBytes - diskFreeBytes,
    },
    application: {
      appRoot,
      databasePath: path.join(dataDir(), 'lapanza.db'),
      backupCount: backupFiles.length,
      paths: appPaths,
      latestRelease,
    },
    virtualPaths: [...VIRTUAL_PATHS],
    rootDirectory: listSiteDirectory(filesystemRoot, { filesystemRoot }),
  };
}
