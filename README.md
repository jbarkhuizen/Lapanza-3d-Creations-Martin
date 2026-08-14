# Lapanza 3D Creative Lab

Professional multi-page site + admin catalog portal.

## Quick start

Double-click **`start.bat`**, or run:

```bash
node start.mjs
```

That installs dependencies (first run) and opens:

| Service | URL |
|--------|-----|
| Public site | http://localhost:5173 |
| Admin portal | http://localhost:8787/admin/ |

**Admin password:** `lapanza-admin`

## Admin portal

- Product catalog for **filament** and **category** pages
- Edit every field used on the live site (specs, colours/SKUs/prices, category items, SEO, status)
- Dark mode toggle (top of sidebar)
- **Publish to site** regenerates public HTML from the catalog

## Commands

| Command | What it does |
|--------|----------------|
| `node start.mjs` | Install (if needed) + site + admin |
| `npm run dev:site` | Public site only |
| `npm run dev:admin` | Admin API/UI only |
| `npm run generate` | Regenerate HTML from `src/data/` |
| `npm run build` | Production site → `dist/` |

## Stack

- Vite + Tailwind CSS v4 + GSAP + Three.js
- Express admin API with JSON catalog store (`data/catalog.json`)
