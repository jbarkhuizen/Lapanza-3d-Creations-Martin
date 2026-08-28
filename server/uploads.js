import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';

const root = process.cwd(); // cwd-based (not __dirname) so tests can isolate via process.chdir()
export const UPLOAD_DIR = path.join(root, 'public', 'uploads', 'filaments');

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Maps a VALIDATED mimetype to its stored extension. The extension must
// never come from the client-supplied original filename: fileFilter only
// checks mimetype (also client-supplied, but a common convention respected
// by browsers/clients and simpler to spoof-detect), and if the two are
// never cross-checked, an attacker can upload e.g. "evil.svg" with a spoofed
// image/png Content-Type and have it stored (and served, with a
// content-type based on its .svg extension) as same-origin SVG -- letting
// an inline <script> in that "image" execute in the app's own origin.
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function buildImageFilename(sku, mimetype) {
  // Falls back to '.jpg' only when mimetype is missing or not one of the
  // three fileFilter already restricts uploads to -- that branch shouldn't
  // be reachable through the real upload route, but keep a safe default
  // rather than trusting the original filename's extension.
  const ext = MIME_EXTENSIONS[mimetype] || '.jpg';
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
    filename: (req, file, cb) => cb(null, buildImageFilename(req.colourSku || req.params.colourId, file.mimetype)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

// ---- 3D Resources uploads ----

export const RESOURCE_UPLOAD_DIR = path.join(root, 'public', 'uploads', 'resources');

function ensureResourceUploadDir() {
  if (!fs.existsSync(RESOURCE_UPLOAD_DIR)) fs.mkdirSync(RESOURCE_UPLOAD_DIR, { recursive: true });
}

function randomResourceFilename(ext) {
  return `${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export const uploadResourceImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureResourceUploadDir();
      cb(null, RESOURCE_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => cb(null, randomResourceFilename(MIME_EXTENSIONS[file.mimetype] || '.jpg')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

// Downloadable model/print files (STL, 3MF, gcode, zip, PDF). Browsers report
// wildly inconsistent (or no) mimetype for these formats, unlike the
// standard image types above, so this validates by extension instead --
// safe here specifically because these files are always served for
// *download* (Content-Disposition: attachment, generic Content-Type; see
// the /api/resources/:id/download route), never rendered inline in a
// browser tab, so a mismatched extension can't be used to get script
// content interpreted as HTML/SVG the way it could for an inline <img>.
const RESOURCE_FILE_EXTENSIONS = new Set(['.stl', '.3mf', '.obj', '.gcode', '.zip', '.pdf']);

export const uploadResourceFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureResourceUploadDir();
      cb(null, RESOURCE_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, randomResourceFilename(RESOURCE_FILE_EXTENSIONS.has(ext) ? ext : '.bin'));
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, RESOURCE_FILE_EXTENSIONS.has(ext));
  },
});

export function deleteResourceFile(filePath) {
  if (!filePath) return;
  const filename = path.basename(filePath);
  const abs = path.join(RESOURCE_UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

// ---- Testimonial uploads (backlog #51) ----

export const TESTIMONIAL_UPLOAD_DIR = path.join(root, 'public', 'uploads', 'testimonials');

function ensureTestimonialUploadDir() {
  if (!fs.existsSync(TESTIMONIAL_UPLOAD_DIR)) fs.mkdirSync(TESTIMONIAL_UPLOAD_DIR, { recursive: true });
}

function randomTestimonialFilename(ext) {
  return `${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export const uploadTestimonialImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureTestimonialUploadDir();
      cb(null, TESTIMONIAL_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => cb(null, randomTestimonialFilename(MIME_EXTENSIONS[file.mimetype] || '.jpg')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

export function deleteTestimonialImage(imagePath) {
  if (!imagePath) return;
  const filename = path.basename(imagePath);
  const abs = path.join(TESTIMONIAL_UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

// ---- Custom design request uploads ----
// Same two allowlist strategies as the resource uploads above (mimetype for
// images, extension for model/print files), combined into one multer
// instance with two named fields since the public intake form submits both
// optional attachments in a single request.

export const DESIGN_REQUEST_UPLOAD_DIR = path.join(root, 'public', 'uploads', 'design-requests');

function ensureDesignRequestUploadDir() {
  if (!fs.existsSync(DESIGN_REQUEST_UPLOAD_DIR)) fs.mkdirSync(DESIGN_REQUEST_UPLOAD_DIR, { recursive: true });
}

function randomDesignRequestFilename(ext) {
  return `${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export const uploadDesignRequestAssets = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDesignRequestUploadDir();
      cb(null, DESIGN_REQUEST_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      if (file.fieldname === 'referenceImage') {
        return cb(null, randomDesignRequestFilename(MIME_EXTENSIONS[file.mimetype] || '.jpg'));
      }
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, randomDesignRequestFilename(RESOURCE_FILE_EXTENSIONS.has(ext) ? ext : '.bin'));
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'referenceImage') return cb(null, ALLOWED_TYPES.has(file.mimetype));
    if (file.fieldname === 'referenceFile') {
      const ext = path.extname(file.originalname || '').toLowerCase();
      return cb(null, RESOURCE_FILE_EXTENSIONS.has(ext));
    }
    cb(null, false);
  },
});

export function deleteDesignRequestFile(filePath) {
  if (!filePath) return;
  const filename = path.basename(filePath);
  const abs = path.join(DESIGN_REQUEST_UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

// ---- Print Job Costing uploads ----
// Same two allowlist strategies as resources/design-requests above, as two
// separate single-file endpoints (mirrors resources.js's uploadResourceImage/
// uploadResourceFile -- admin uploads happen after the job already exists,
// unlike the public design-request form's combined single-POST).

export const PRINT_JOB_UPLOAD_DIR = path.join(root, 'public', 'uploads', 'print-jobs');

function ensurePrintJobUploadDir() {
  if (!fs.existsSync(PRINT_JOB_UPLOAD_DIR)) fs.mkdirSync(PRINT_JOB_UPLOAD_DIR, { recursive: true });
}

function randomPrintJobFilename(ext) {
  return `${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export const uploadPrintJobImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensurePrintJobUploadDir();
      cb(null, PRINT_JOB_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => cb(null, randomPrintJobFilename(MIME_EXTENSIONS[file.mimetype] || '.jpg')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

export const uploadPrintJobFile = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensurePrintJobUploadDir();
      cb(null, PRINT_JOB_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, randomPrintJobFilename(RESOURCE_FILE_EXTENSIONS.has(ext) ? ext : '.bin'));
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, RESOURCE_FILE_EXTENSIONS.has(ext));
  },
});

export function deletePrintJobFile(filePath) {
  if (!filePath) return;
  const filename = path.basename(filePath);
  const abs = path.join(PRINT_JOB_UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

// ---- Category product item photos (Toys/Homeware/Phones/Car Parts/GWM/
// Landrover etc) ----
// Same pattern as uploadResourceImage above. Category items live inside
// catalog.json's product.items[] (see store.js), not their own DB table, so
// there's no colourSku-style value to build a traceable filename from --
// a random name is the same tradeoff resources.js already made.

export const CATEGORY_ITEM_UPLOAD_DIR = path.join(root, 'public', 'uploads', 'category-items');

function ensureCategoryItemUploadDir() {
  if (!fs.existsSync(CATEGORY_ITEM_UPLOAD_DIR)) fs.mkdirSync(CATEGORY_ITEM_UPLOAD_DIR, { recursive: true });
}

function randomCategoryItemFilename(ext) {
  return `${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export const uploadCategoryItemImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureCategoryItemUploadDir();
      cb(null, CATEGORY_ITEM_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => cb(null, randomCategoryItemFilename(MIME_EXTENSIONS[file.mimetype] || '.jpg')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype)),
});

export function deleteCategoryItemImage(imagePath) {
  if (!imagePath) return;
  const filename = path.basename(imagePath);
  const abs = path.join(CATEGORY_ITEM_UPLOAD_DIR, filename);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}
