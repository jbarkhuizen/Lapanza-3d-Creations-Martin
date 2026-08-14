import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { buildImageFilename, deleteImageFile, UPLOAD_DIR, ensureUploadDir } from './uploads.js';

test('buildImageFilename produces a slug-based name with the original extension', () => {
  const name = buildImageFilename('SKU-123', 'photo.JPG');
  assert.match(name, /^sku-123-[0-9a-f]{8}\.jpg$/);
});

test('buildImageFilename falls back to a safe default when sku is missing', () => {
  const name = buildImageFilename('', 'photo.png');
  assert.match(name, /^colour-[0-9a-f]{8}\.png$/);
});

test('buildImageFilename defaults to .jpg when the original name has no extension', () => {
  const name = buildImageFilename('sku', 'photo');
  assert.match(name, /\.jpg$/);
});

test('deleteImageFile removes an existing file and is a no-op for a missing one', () => {
  ensureUploadDir();
  const file = path.join(UPLOAD_DIR, 'delete-me-test.jpg');
  fs.writeFileSync(file, 'x');
  deleteImageFile('/uploads/filaments/delete-me-test.jpg');
  assert.strictEqual(fs.existsSync(file), false);
  assert.doesNotThrow(() => deleteImageFile('/uploads/filaments/never-existed.jpg'));
  assert.doesNotThrow(() => deleteImageFile(null));
});
