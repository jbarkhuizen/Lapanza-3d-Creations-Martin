// Backlog #106 (SITE-072): responsive image variants for catalog photos.
//
// For an uploaded photo /uploads/<dir>/<name>.<ext>, generates WebP
// variants alongside it, NEVER touching the original:
//   <name>-480.webp   (cards / mobile)
//   <name>-960.webp   (larger screens, zoomed-in viewing)
// A variant is skipped when the source is already smaller than the target
// width (no fake upscaling). Failures are logged and swallowed -- a photo
// that can't produce variants still works exactly as before via the
// original file, and the page generator only references variants that
// actually exist on disk.
//
// scripts/generate-image-variants.mjs backfills the pre-existing library
// with the same function; upload routes call it for every new photo.
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

export const VARIANT_WIDTHS = [480, 960];

export function variantPath(imagePath, width) {
  const parsed = path.parse(imagePath);
  return path.join(parsed.dir, `${parsed.name}-${width}.webp`);
}

export async function generateImageVariants(absImagePath) {
  const results = [];
  let meta;
  try {
    meta = await sharp(absImagePath).metadata();
  } catch (err) {
    console.error('images: could not read', absImagePath, err.message);
    return results;
  }
  for (const width of VARIANT_WIDTHS) {
    if ((meta.width || 0) <= width) continue; // never upscale
    const out = variantPath(absImagePath, width);
    try {
      // Review #24/#12 (todos #163/#151): .rotate() with no argument bakes
      // the EXIF orientation flag into the pixels. Without it, phone photos
      // carrying an orientation flag rendered rotated in the WebP variants
      // (WebP drops EXIF) while the original JPEG displayed upright --
      // images "shifted orientation" depending on which file the browser
      // picked from the <picture> srcset.
      await sharp(absImagePath).rotate().resize({ width }).webp({ quality: 78 }).toFile(out);
      results.push(out);
    } catch (err) {
      console.error('images: variant failed', out, err.message);
    }
  }
  return results;
}

// Companion for deletes: removes any variants belonging to an original.
export function deleteImageVariants(absImagePath) {
  for (const width of VARIANT_WIDTHS) {
    const p = variantPath(absImagePath, width);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
}
