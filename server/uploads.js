import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
export const UPLOAD_DIR = path.join(root, 'public', 'uploads', 'filaments');

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function buildImageFilename(sku, originalName) {
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const safeSku =
    String(sku || 'colour')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'colour';
  const hash = crypto.randomBytes(4).toString('hex');
  return `${safeSku}-${hash}${ext}`;
}

export function deleteImageFile(imagePath) {
  if (!imagePath) return;
  const filename = path.basename(imagePath);
  const abs = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const uploadFilamentImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureUploadDir();
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => cb(null, buildImageFilename(req.params.colourId, file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});
