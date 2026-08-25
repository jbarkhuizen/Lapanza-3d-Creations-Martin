# Lapanza 3D Creative Lab

E-commerce storefront + admin/operations portal for a South African 3D-printing and filament retailer. Node/Express backend, SQLite database, Vite-built static storefront, single hand-written admin SPA.

**Full documentation:** [`docs/SYSTEM_DOCUMENTATION.md`](docs/SYSTEM_DOCUMENTATION.md) — architecture, database schema, complete API reference, every feature's functional spec, requirements, test cases, deployment runbook. Start there for anything beyond local setup.

**Live site:** https://lapanza3d.co.za · **Admin:** https://lapanza3d.co.za/admin/

## Quick start (local development)

```bash
node start.mjs
```

Installs dependencies (first run) and opens:

| Service | URL |
|---|---|
| Public site | http://localhost:5173 |
| Admin portal | http://localhost:8787/admin/ |

First run of the admin portal shows a **setup screen** — there is no default admin account or password. Create your own credentials there.

## Commands

| Command | What it does |
|---|---|
| `node start.mjs` | Install (if needed) + site + admin, together |
| `npm run dev:site` | Public site only (Vite dev server) |
| `npm run dev:admin` | Admin API/UI only (Express) |
| `npm run generate` | Regenerate static category/filament HTML from current catalog data |
| `npm run build` | Production build → `dist/` |
| `npm test` | Full test suite (`node --test`, no external framework) |

## Stack

Express 5 · better-sqlite3 · Vite + Tailwind CSS v4 · GSAP · Three.js · Payfast (payments) · Gmail SMTP (email) · Meta WhatsApp Business Cloud API (campaigns)

Production: AlmaLinux 10 VPS, nginx (TLS + reverse proxy), systemd-managed Node process. See `deploy/DEPLOY.md` for the full deployment runbook.

## Admin portal

- Product catalog (filament types/colours + category items), stock, orders, invoicing, manual orders
- Client relationship management (registered users, guest clients, verify/resend/delete)
- Print job costing + in-house filament tracking (internal only — never affects storefront pricing)
- Supplier purchase tracking, shipping configuration, 3D Resources library
- Email newsletter and WhatsApp marketing campaigns (compose → approve → send)
- Audit Logs — admin login/session/account events, order/stock/catalog/settings changes, and security signals (rate-limit trips, unauthorized access attempts, customer login failures); 12-month retention, "all-time" analytics totals survive pruning via permanent tally tables
- Todo / Backlog — tracks bugs/features/tech debt, including a "Claude Fix" status for items this assistant resolved directly
- **Publish to site** regenerates public HTML from current catalog data and rebuilds the deployed `dist/` output — storefront content is only as fresh as the last publish

Sidebar is organised into three groups: **Client Side**, **Local Management**, **Settings**.
