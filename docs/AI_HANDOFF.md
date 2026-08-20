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
2. `docs/SYSTEM_DOCUMENTATION.md` — everything: architecture, DB schema (19 tables), full API reference, every feature's functional spec, requirements, test cases, deployment runbook, known limitations
3. `deploy/DEPLOY.md` — production deployment/SSH runbook specifically
4. `docs/UPTIME_MONITORING.md` — external monitoring setup (manual, third-party account signup — not something to attempt on the user's behalf)
5. `.env.example` and `deploy/.env.production.template` — every config variable, documented

## Non-obvious things that will bite you if you don't know them

These are real incidents from this project's build/deploy history — documented in full in `SYSTEM_DOCUMENTATION.md` §12.5, listed here so you don't repeat them:

- **`better-sqlite3` requires Node ≥22, hard requirement.** Node 20 installs with only a warning, then segfault-crashes the process on every DB access. Always verify `node -v` is 22+ before anything runs.
- **Never blindly re-copy `deploy/nginx-lapanza.conf` onto the live server.** Once certbot has run, the live `/etc/nginx/conf.d/lapanza.conf` has HTTPS/redirect blocks appended that a naive overwrite deletes, silently breaking HTTPS. `deploy/deploy-app.sh` already guards against this (only installs the template if the file doesn't exist) — do not "fix" that guard away.
- **Express needs `app.set('trust proxy', 1)`** (already set in `server/index.js`) because nginx sits in front of it in production. Removing it breaks every rate-limited route with a cryptic crash that looks to end users like a random 404.
- **Two independent, in-memory session systems** (admin sessions and customer sessions) — both are lost on every `systemctl restart lapanza-admin`. This is expected, not a bug to "fix" reflexively.
- **Product data lives in two places, not one:** the sellable filament catalog is in SQLite (`filament_types`/`filament_colours`); category items (toys/homeware/phones/car-parts) are in `data/catalog.json`, which is **gitignored** — it's real business data, not code, and must be copied to a new server separately from `git clone`.
- **Storefront static pages are not live-rendered.** They're pre-generated HTML (`scripts/generate-pages.mjs`, triggered by the admin "Publish to site" button). Catalog edits in the admin do not appear on the public site until that runs.
- **Checkout prices are always server-resolved, never trust a client-submitted price** — this is a deliberate security property, not an oversight to "simplify."
- **Checkout validates stock before creating orders** — `server/orders.js`'s `createOrder()` rejects any order where any item's quantity exceeds its `stockQty`, returning a detailed error listing which items are out of stock. This applies to both online checkout and admin-created orders. Test coverage: 6 dedicated tests in `server/orders.test.js` (T-66–T-71).
- **Password reset tokens (V1.01) are a separate column pair from email-verification tokens** (`reset_token`/`reset_token_expires` vs `verification_token`/`verification_token_expires` on `clients`) — both can be outstanding at once without clobbering each other. Reset TTL is 1h, shorter than verification's 24h, since it's freely re-requestable.
- **`deploy/deploy-app.sh` now writes to the live DB directly** (via `scripts/record-deploy-version.mjs`, no HTTP/auth involved) as its last step, to log the deploy in Version History. It's `|| echo ...`-guarded so a failure there can't abort an otherwise-successful deploy — if you ever touch that script, keep it non-fatal.
- **Offsite backup sync needs `rclone` on the VPS and a Google service account the assistant can't create on your behalf.** `deploy/bootstrap-vps.sh` now installs `rclone` (idempotent — safe to re-run on the already-provisioned VPS just to pick this up), but the Google Cloud service account, Drive folder share, and `BACKUP_RCLONE_REMOTE` env var are a one-time manual step (DEPLOY.md §9) only a human with a Google account can do.
- **SQLite `date()`/`datetime()` default to UTC; the server runs in SAST (UTC+2).** Any query grouping by calendar day (invoice dates, analytics daily breakdowns) needs the `'localtime'` modifier explicitly, or day boundaries silently shift near midnight. Already bit this project once (imported invoice dates landed a day early) before being applied proactively elsewhere.
- **`.env` secrets are never pasted into chat/AI tooling** — the working rule established for this project is that whoever has server access types secrets directly on the server (`nano /opt/lapanza/app/.env`). Don't ask for or accept Payfast keys, the Gmail app password, or WhatsApp tokens in conversation.

## Current production state (as of this handoff)

| Item | State |
|---|---|
| Payfast | `PAYFAST_MODE=sandbox` — real payments are **not yet live** |
| WhatsApp campaigns | Not configured (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` unset) — requires the business owner to complete Meta Business Account + template approval first; sends fail cleanly with "not configured" until then |
| Gmail SMTP | Configured and working (order confirmations, verification emails, notifications) |
| SSL | Live, Let's Encrypt via certbot, auto-renewing |
| Automated backups | Live — daily + on-boot, 30-backup retention, admin "Backups" view. Mirrors offsite to Google Drive via `rclone` right after every automated run (`syncOffsite()` in `server/backups.js`) once `BACKUP_RCLONE_REMOTE` is set (DEPLOY.md §9, one-time human setup — account creation isn't something this assistant can do). Until that's set, backups still run but stay on the *same disk* as the live DB |
| Uptime monitoring | `/api/health` verifies real DB connectivity (503 on failure). Setup guide at `docs/UPTIME_MONITORING.md` — whether an actual monitor is configured depends on that manual, third-party account-signup step having been completed by the owner |
| Visitor analytics | Live — first-party, anonymous pageview/heartbeat tracking, admin "Analytics" page. No cookie/tracking disclosure shown to visitors yet (ties into the still-missing Privacy Policy page) |
| Checkout stock validation | Live — orders blocked if any cart item exceeds available stock; detailed error message lists out-of-stock items + quantities. Closes the pre-validation gap where out-of-stock items could be purchased. Covers both online checkout and admin-created orders |
| Customer password recovery (V1.01) | Live — `account.html` "Forgot password?" → `POST /api/client/forgot-password` emails a single-use, 1h-expiry reset link (generic response either way, no email enumeration) → `POST /api/client/reset-password` sets the new password, verifies the account, revokes other live sessions for that client, logs the requester in. Closes the previous register→verify→login-only dead end |
| Version history recording | Automated as of V1.01 — `deploy/deploy-app.sh` runs `scripts/record-deploy-version.mjs` after every deploy; no more manual "+ Record Version" button. Labels are `"<major>.<minor>"` (this feature shipped as `1.01`), incrementing the minor each deploy |
| Test suite | 180/180 passing (`node --test`), run before every commit |
| CI/CD | None — manual test-then-push-then-SSH-deploy |
| Staging environment | None — the VPS is production from first deploy |

## Who to ask

The business owner (repo owner, `jbarkhuizen@gmail.com`) is the only stakeholder and the only person with server/DNS/payment-provider credentials. Any decision requiring real secrets, financial config, or DNS changes needs them directly — an AI assistant should never fabricate or guess these.

---

*Generated as a portable context primer for handing this project to a different AI system/tool. Keep it in sync with `SYSTEM_DOCUMENTATION.md` §12.5 and §15 when either changes.*
