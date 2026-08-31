# Performance Baseline & Results — P2 pass, 2026-08-31

Backlog #107 (SITE-073). Method: browser-measured against the live production
site (resource transfer sizes via no-store fetches, LCP via
PerformanceObserver). PageSpeed Insights' anonymous API quota was exhausted on
the day; re-run PSI for lab-grade CWV numbers when convenient — the
before/after below used one consistent method on both sides, which is what
the comparison needs.

## Before (morning of 2026-08-31)

| Metric | Value |
|---|---|
| Homepage JS on the wire | **518 KB** (`home.js`) + 147 KB (`site.js`) — **served uncompressed; nginx had no gzip at all** |
| Homepage featured-card images | **~5.4 MB** for 4 cards rendered at ~230 px (worst single file: **3,018 KB** JPEG) |
| LCP (warm cache) | ~924 ms |
| Asset caching | No Cache-Control on hashed assets |

## Changes shipped (commits `b975c28`, `1c7113a`, `2bfbbd1`)

1. **Bundle split (#104/#105):** Three.js hero scene → own chunk, loaded via
   `requestIdleCallback` only when `prefers-reduced-motion` is not set.
2. **nginx gzip** (`conf.d/gzip.conf`) + **1y immutable Cache-Control** on
   `/assets/` (Vite content-hashes every filename).
3. **Responsive images (#106):** sharp-generated 480/960 WebP variants beside
   every catalog upload (originals untouched), `<picture>`/srcset on generated
   pages, featured-product resolution prefers the 480 variant.

## After (evening of 2026-08-31, live)

| Metric | Value |
|---|---|
| Homepage JS on the wire | **184 KB gzipped total**, of which the critical path is **~48 KB** (`main` 2 KB + `site` 46 KB); `hero-scene` 117 KB arrives idle-time, motion-users only, and **never downloads for reduced-motion visitors** |
| Worst featured-card image | 3,018 KB → **9 KB** (480px WebP variant) |
| Compression | gzip live on JS/CSS/JSON/SVG (verified `Content-Encoding: gzip`) |
| Caching | `Cache-Control: public, immutable, max-age=1y` on `/assets/` (verified) |

## Follow-ups

- Run PSI (mobile + desktop) for the canonical URL once the anonymous quota
  resets, or with an API key, and append the scores here.
- The remaining large transfers are catalog-page photos for items whose
  colours have no linked photo variants (#131's photo-upload gap) — variants
  generate automatically as photos are uploaded.
