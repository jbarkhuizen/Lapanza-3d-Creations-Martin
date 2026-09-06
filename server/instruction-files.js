import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';

// Owner request (2026-09-06): a place in the admin centre to keep printable
// instruction sheets (fitting cards etc.) that get included with shipped
// prints. Files live under public/uploads/instructions and are served by the
// existing /uploads static route -- same deployment story as product images
// (public/uploads is untracked by git and lives on the VPS disk).
// cwd-based (not __dirname) and resolved per call so tests can isolate via process.chdir()
export const INSTRUCTIONS_DIR = () => path.join(process.cwd(), 'public', 'uploads', 'instructions');

export function ensureInstructionsDir() {
  const dir = INSTRUCTIONS_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Unlike product images (random hash names keyed to a SKU), instruction
// files are picked BY NAME by the admin -- keep the original name
// recognizable, sanitized to a safe slug, always .pdf (extension from the
// validated mimetype, never the client filename -- see uploads.js for why).
// A name collision gets a short hash suffix instead of overwriting: the
// existing file may already be referenced/printed.
export function buildInstructionFilename(originalName) {
  const base = String(originalName || 'instructions')
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '') || 'instructions';
  let filename = `${base}.pdf`;
  if (fs.existsSync(path.join(INSTRUCTIONS_DIR(), filename))) {
    filename = `${base}-${crypto.randomBytes(3).toString('hex')}.pdf`;
  }
  return filename;
}

export function listInstructionFiles() {
  const dir = INSTRUCTIONS_DIR();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { filename: f, size: st.size, uploadedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

// basename() guard: the route passes a client-supplied name -- never let a
// path traversal ("../../data/lapanza.db") reach the filesystem.
export function deleteInstructionFile(filename) {
  const safe = path.basename(String(filename || ''));
  if (!safe.toLowerCase().endsWith('.pdf')) return false;
  const abs = path.join(INSTRUCTIONS_DIR(), safe);
  if (!fs.existsSync(abs)) return false;
  fs.unlinkSync(abs);
  return true;
}

export const uploadInstructionFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureInstructionsDir()),
    filename: (_req, file, cb) => cb(null, buildInstructionFilename(file.originalname)),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});
