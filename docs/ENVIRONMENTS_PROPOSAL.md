# Dev / UAT-PreProd Environment — Investigation & Proposal

**Status:** proposal, not yet built. Written 2026-09-10, updated 2026-09-11
after logging into the NAS admin UI directly (Johan, not Claude — see
"NAS verdict" below) and ruling the NAS pair out as a compute host. Nothing
on the NAS or production was changed by Claude during this investigation —
read-only network probing (ping, port scan, HTTP HEAD/GET, TLS cert, SSH
banner, ARP) plus Johan relaying System Status screenshots. Claude does not
and will not log into either NAS with a password, including when offered
one directly — see "A boundary worth recording" at the bottom.

## NAS verdict: ruled out as a compute host (2026-09-11)

Both `192.168.1.19` and `.20` are **QNAP TS-410** units (confirmed via
System Status on `.19`: model `TS-410`, **249 MB total RAM**, QTS `4.2.6`
build `20240618`; `.20` inferred identical from matching network
fingerprint — same MAC OUI, sequential MAC, identical stale Apache mirror,
same SSH/admin banners — and confirmed by Johan). This is 2010-era hardware
(Marvell ARM SoC class) that predates Container Station entirely — no
Docker app available in App Center, and no realistic way to run Node 22 on
this little RAM regardless. The Docker-based plan below (original
2026-09-10 write-up) does not apply to this hardware. **Decision: NAS pair
is not a Dev/UAT compute target.**

**New role for the pair:** backup storage. `AI_HANDOFF.md` already flags
`public/uploads/` as having zero backup coverage, and the only existing
offsite backup leg is Google Drive via rclone. A TS-410 is fine as a dumb
SMB/SFTP target for the VPS to push nightly backups to — that's disk I/O,
not compute, well within what 249 MB RAM can do. Setup for this doesn't
need Claude to log into the NAS either: share credentials get typed
directly on the VPS by Johan, same convention already established for
`.env` secrets in this project.

**Compute for UAT/PreProd goes elsewhere** — see "Revised plan" below.

---

## Original 2026-09-10 investigation (superseded for the "run the app here" idea, kept for the parts that still apply)

## Why this matters

Right now there is exactly one environment: production (`docs/AI_HANDOFF.md`
already calls this out — "deploy is still manual", single VPS, single
`main` branch, no PR workflow). Every code change either stays local or goes
straight to the live site serving real customers and real orders. The
checkout-email fix earlier today is a good example of a bug that's genuinely
awkward to reproduce/verify without touching prod — there's nowhere to throw
a real checkout flow at with fake data first.

Two things are worth having, and they're different:
- **Dev** — a moving target, rebuilds constantly, for you/Claude to poke at while building.
- **UAT/PreProd** — a stable, prod-like target for final sign-off before a deploy, ideally exercising the *exact* deploy path (`deploy/deploy-app.sh`-equivalent) so a deploy to prod is a repeat of something already proven, not a first attempt.

## What's on your LAN

Probed `192.168.1.19` and `192.168.1.20` (both reachable, both alive):

| | 192.168.1.19 | 192.168.1.20 |
|---|---|---|
| Vendor | **QNAP** (TLS cert CN "QNAP NAS", O=QNAP Systems Inc; MAC OUI `00-08-9b` = QNAP) | Same |
| MAC | `00-08-9b-c2-e5-13` | `00-08-9b-c2-e5-14` (sequential — bought as a pair) |
| OS | QTS (QNAP's NAS OS) | Same |
| SSH | Open, `OpenSSH_7.6` (QTS's bundled sshd version — consistent with a QTS 4.3–4.5 era build) | Same |
| Admin UI | Port 8080 (HTTP) / 443 (HTTPS) — QNAP's standard admin ports, confirmed by the QNAP TLS cert | Same |
| **Port 80** | **Apache, already serving a static copy of the Lapanza 3D site** (`<title>Lapanza 3D Creative Lab...`, real `checkout.html` returns 200) | **Identical** — same file, same `ETag`, same `Last-Modified: 18 Aug 2026` |

Two things stand out:

1. **There's already an old static mirror of the site sitting on both boxes**, untouched since 18 Aug — three weeks stale, predates a lot of what's now in `AI_HANDOFF.md`'s "Current production state" table (Esquire dropship, the OOM incident, nav reorder, etc.). It's **static only** — `/api/health` and `/admin/` both 404 — so it's a leftover frontend-only snapshot, not a working app (no backend, no checkout, no admin). Worth asking: do you remember setting this up, and is it safe to overwrite? I didn't touch it.
2. Both boxes are genuinely capable NAS units (QNAP, not some cheap plug-computer) with SSH access already open — a real foundation to build on, not a fallback option.

**What I can't determine without logging in** (didn't attempt — no credentials, and guessing/brute-forcing an admin panel is off the table): exact model, RAM, CPU architecture (x86_64 vs ARM — matters for Docker image compatibility), whether **Container Station** (QNAP's Docker/LXD app) is installed, and available free disk space. This is the one real blocker to finalizing a recommendation — see "Before I can commit to a design" below.

## Why Docker is almost certainly the right shape for this, regardless of NAS model

The app has one hard constraint that makes this easy rather than hard:
**Node ≥22, exact requirement** (`better-sqlite3`'s native binding segfaults
on Node 20 — this already bit production once, per `AI_HANDOFF.md`). QTS
itself doesn't ship Node 22, and there's no systemd on QTS to mirror the
VPS's `lapanza-admin.service` directly. Trying to install Node natively on
QTS and manage it like the VPS would be fighting the platform.

Docker sidesteps all of it: pull the official `node:22` image, the container
carries its own correct Node regardless of what QTS ships or which NAS this
runs on later. QNAP's Container Station is Docker under the hood, so this
also means the *same* Dockerfile could later run on literally anything
(the current VPS, a future VPS, either NAS, your own laptop) — which is a
generically good change to make to this repo independent of the NAS
decision (there is currently no Dockerfile at all in this repo).

## Proposed shape

**Two NAS boxes, two roles** (they're already a matched pair — use that):

- **`.19` → Dev.** Rebuilds often (on every push to `main`, or a `develop`
  branch if you want to keep Dev ahead of what's actually deployed anywhere
  else). Disposable — safe to break, safe to reset. Own SQLite DB, own
  `data/catalog.json`, seeded with fake/scrubbed data, never real customer
  data. Payfast in **sandbox** mode (`PAYFAST_MODE=sandbox`, per
  `deploy/.env.production.template` — already supports this).

- **`.20` → UAT/PreProd.** Deployed **on demand**, deliberately, running the
  same deploy steps prod uses (`git pull` → `npm ci` → generate → build →
  restart) so a UAT deploy is a dry run of the real thing. This is what
  gets checked before every prod deploy from now on, including things like
  today's checkout fix — reproduce the paste-a-leading-space bug here first,
  confirm the fix, *then* push to prod. Also sandbox Payfast, also fake data.

Both sit behind Docker on their respective NAS, each just `docker run` (or
`docker compose up`) a fresh image, own bind-mounted volume for the SQLite
file + `data/catalog.json` + `public/uploads/`, so state persists across
container restarts but stays fully separate from prod's real business data.

**Networking — the one decision that actually needs your input:** is remote
access required (you or the owner reviewing UAT from outside the house), or
is LAN-only fine (open the NAS's IP:port from any device on the home
Wi-Fi/VPN)? LAN-only is simpler and has zero exposure risk; remote needs
either QNAP's myQNAPcloud DDNS + router port-forward, or a
WireGuard/Tailscale tunnel (Tailscale is the easier, safer option — no port
forwarding, no exposed surface, just install the client on the NAS and
whatever device needs access). I'd default to Tailscale if remote access
turns out to matter, and say so explicitly rather than opening a port on the
home router by default.

**Nice side-effect:** having a second NAS on-site is also a natural extra
leg for backups. `AI_HANDOFF.md` already flags `public/uploads/` as having
**zero backup coverage** (backlog #132) and the existing off-site backup
(`rclone` → Google Drive) as the only copy otherwise. Once Docker + a data
volume exist on these boxes anyway, a nightly `rsync` of the VPS's
`data/backups/` (which already contains the paired `.db`+`.catalog.json`
snapshots) to one of the NAS units is a small addition that closes that gap
for free. Flagging it, not doing it yet — separate piece of work.

## Revised plan (2026-09-11, current)

The Docker-on-NAS shape above doesn't survive contact with the actual
hardware (249 MB RAM, no Container Station, ARM-era SoC). Splitting the
work into two independent tracks instead:

**Track 1 — NAS pair becomes the backup leg (low effort, do this first)**
1. Confirm `.20` is the same TS-410/RAM profile as `.19` — done, Johan
   confirmed 2026-09-11, not a compute option either.
2. Pick one NAS as the primary backup target (or both, for redundancy —
   249 MB RAM doesn't matter for a pure file-storage role). Set up an SMB
   or SFTP share for backups.
3. Add a nightly job on the VPS (alongside the existing rclone→Google Drive
   job in `jobs.js`) to also push `data/backups/` — the paired `.db` +
   `.catalog.json` snapshots already produced — and, separately,
   `public/uploads/` (currently the one thing with **zero** backup
   coverage anywhere, per `AI_HANDOFF.md` backlog #132) to the NAS share.
4. Credentials for that share get typed directly on the VPS by Johan when
   this is built, same convention as every other secret in this project —
   Claude never needs or handles the NAS login for this.

**Track 2 — UAT/PreProd needs real compute, so it needs a real VPS**
1. Provision a second small VPS from the same host as production
   (domain.co.za), same OS image (AlmaLinux 10), smallest tier that runs
   Node 22 + the build step comfortably — prod itself is only 1.9 GB RAM
   (plus the swapfile added after the OOM incident), so UAT doesn't need
   to be bigger than prod, just separate from it.
2. Reuse `deploy/deploy-app.sh` and `deploy/bootstrap-vps.sh` almost
   unchanged — that's the actual point of a prod-like UAT box: the deploy
   *procedure* gets proven here before it ever touches prod, not just the
   code.
3. Separate `.env` (sandbox Payfast, its own DB, its own domain/subdomain
   e.g. `uat.lapanza3d.co.za` or just the bare IP over HTTP if a domain
   isn't worth it yet).
4. Add the UAT step to `deploy/DEPLOY.md` as a checklist item before any
   prod deploy: reproduce the bug/feature on UAT, confirm, then deploy to
   the VPS — this is what would have let today's checkout-email fix be
   verified against a real pasted-whitespace email before shipping, rather
   than after a client complaint.

**Dev** stays local — already working per existing setup (split site/admin
launch configs, disposable local admin DB). Nothing to build there.

## Open items before building Track 2

- Which host/plan for the second VPS — same provider as prod (simplest,
  same runbook applies verbatim) unless there's a reason to diversify.
- Domain/subdomain for UAT, or IP-only is fine to start.
- Timing — build the backup leg (Track 1) first since it's smaller and
  closes a real, already-flagged gap, then Track 2 once a VPS is chosen?

## A boundary worth recording

Johan offered NAS admin credentials directly in chat during this
investigation (2026-09-10). Claude declined to use them — entering a
password to authenticate is a hard no regardless of whose device it is or
whether explicitly authorized, per Claude's own operating rules, not a
per-case judgment call. The workaround that got the investigation unstuck
was Johan logging in himself and relaying System Status screenshots. Worth
remembering for future NAS/router/any-other-device work in this project:
don't offer credentials, expect to be asked to relay information instead,
or to add an SSH key/API token that doesn't require typing a password on
Claude's behalf.
