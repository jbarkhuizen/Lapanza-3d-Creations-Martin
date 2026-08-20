# AI Handoff Brief — Lapanza 3D Creative Lab

**If you are an AI assistant picking up this project cold, read this file first.** It orients you fast; it is not the full reference. Once you have repo access, read [`docs/SYSTEM_DOCUMENTATION.md`](SYSTEM_DOCUMENTATION.md) next — it has the complete architecture, database schema, API reference, functional spec, and test cases. This file exists so you don't have to read that whole document before knowing where to start or what not to break.

---

## What this is

A live e-commerce + operations platform for a South African 3D-printing/filament retailer (Lapanza 3D Creative Lab). Node/Express backend + SQLite, static Vite-built storefront, hand-written vanilla-JS admin SPA. Single developer/owner, no team, no CI/CD — changes are tested locally then deployed directly to production over SSH.

**Repo:** `github.com/jbarkhuizen/Lapanza-3d-Creations-Martin`, branch `main` (the only branch — no PR workflow, commits go straight to `main`)
**Live site:** https://lapanza3d.co.za
**Live admin:** https://lapanza3d.co.za/admin/
**Production server:** VPS at `41.222.36.147` (domain.co.za, AlmaLinux 10), SSH-key-only access as user `deploy`

## Start here, in order

1. `README.md` — quick local-dev setup
2. `docs/SYSTEM_DOCUMENTATION.md` — everything: architecture, DB schema (18 tables), full API reference, every feature's functional spec, requirements, test cases, deployment runbook, known limitations
3. `deploy/DEPLOY.md` — production deployment/SSH runbook specifically
4. `.env.example` and `deploy/.env.production.template` — every config variable, documented

## Non-obvious things that will bite you if you don't know them

These are real incidents from this project's build/deploy history — documented in full in `SYSTEM_DOCUMENTATION.md` §12.5, listed here so you don't repeat them:

- **`better-sqlite3` requires Node ≥22, hard requirement.** Node 20 installs with only a warning, then segfault-crashes the process on every DB access. Always verify `node -v` is 22+ before anything runs.
- **Never blindly re-copy `deploy/nginx-lapanza.conf` onto the live server.** Once certbot has run, the live `/etc/nginx/conf.d/lapanza.conf` has HTTPS/redirect blocks appended that a naive overwrite deletes, silently breaking HTTPS. `deploy/deploy-app.sh` already guards against this (only installs the template if the file doesn't exist) — do not "fix" that guard away.
- **Express needs `app.set('trust proxy', 1)`** (already set in `server/index.js`) because nginx sits in front of it in production. Removing it breaks every rate-limited route with a cryptic crash that looks to end users like a random 404.
- **Two independent, in-memory session systems** (admin sessions and customer sessions) — both are lost on every `systemctl restart lapanza-admin`. This is expected, not a bug to "fix" reflexively.
- **Product data lives in two places, not one:** the sellable filament catalog is in SQLite (`filament_types`/`filament_colours`); category items (toys/homeware/phones/car-parts) are in `data/catalog.json`, which is **gitignored** — it's real business data, not code, and must be copied to a new server separately from `git clone`.
- **Storefront static pages are not live-rendered.** They're pre-generated HTML (`scripts/generate-pages.mjs`, triggered by the admin "Publish to site" button). Catalog edits in the admin do not appear on the public site until that runs.
- **Checkout prices are always server-resolved, never trust a client-submitted price** — this is a deliberate security property, not an oversight to "simplify."
- **`.env` secrets are never pasted into chat/AI tooling** — the working rule established for this project is that whoever has server access types secrets directly on the server (`nano /opt/lapanza/app/.env`). Don't ask for or accept Payfast keys, the Gmail app password, or WhatsApp tokens in conversation.

## Current production state (as of this handoff)

| Item | State |
|---|---|
| Payfast | `PAYFAST_MODE=sandbox` — real payments are **not yet live** |
| WhatsApp campaigns | Not configured (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` unset) — requires the business owner to complete Meta Business Account + template approval first; sends fail cleanly with "not configured" until then |
| Gmail SMTP | Configured and working (order confirmations, verification emails, notifications) |
| SSL | Live, Let's Encrypt via certbot, auto-renewing |
| Automated backups | **Not yet scheduled** — `data/lapanza.db` (all customer/order data) has no backup job configured |
| Test suite | 143/143 passing (`node --test`), run before every commit |
| CI/CD | None — manual test-then-push-then-SSH-deploy |
| Staging environment | None — the VPS is production from first deploy |

## Who to ask

The business owner (repo owner, `jbarkhuizen@gmail.com`) is the only stakeholder and the only person with server/DNS/payment-provider credentials. Any decision requiring real secrets, financial config, or DNS changes needs them directly — an AI assistant should never fabricate or guess these.

---

*Generated as a portable context primer for handing this project to a different AI system/tool. Keep it in sync with `SYSTEM_DOCUMENTATION.md` §12.5 and §15 when either changes.*
