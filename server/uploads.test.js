import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { buildImageFilename, deleteImageFile, UPLOAD_DIR, ensureUploadDir } from './uploads.js';

test('buildImageFilename produces a slug-based name with an extension derived from the validated mimetype', () => {
  const name = buildImageFilename('SKU-123', 'image/jpeg');
  assert.match(name, /^sku-123-[0-9a-f]{8}\.jpg$/);
});

test('buildImageFilename falls back to a safe default slug when sku is missing', () => {
  const name = buildImageFilename('', 'image/png');
  assert.match(name, /^colour-[0-9a-f]{8}\.png$/);
});

test('buildImageFilename maps image/webp to .webp', () => {
  const name = buildImageFilename('sku', 'image/webp');
  assert.match(name, /\.webp$/);
});

test('buildImageFilename defaults to .jpg when the mimetype is missing or unrecognized', () => {
  assert.match(buildImageFilename('sku', undefined), /\.jpg$/);
  assert.match(buildImageFilename('sku', 'image/svg+xml'), /\.jpg$/);
});

test('buildImageFilename has no filename parameter to spoof: extension is driven solely by mimetype', () => {
  // Regression test: buildImageFilename no longer accepts the client-supplied
  // original filename at all, so an attacker can't upload "evil.svg" with a
  // spoofed image/png Content-Type and have it stored/served back as
  // same-origin SVG (script-exec risk). Only a validated mimetype decides
  // the stored extension.
  const name = buildImageFilename('sku', 'image/png');
  assert.match(name, /\.png$/);
  assert.doesNotMatch(name, /\.svg$/);
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
