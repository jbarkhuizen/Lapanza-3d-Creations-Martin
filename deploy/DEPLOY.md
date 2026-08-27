# Deploying to the domain.co.za VPS

Single VPS running AlmaLinux 10 (dnf, firewalld, SELinux disabled). nginx
serves the built static site and reverse-proxies `/api`, `/admin`,
`/uploads` to the Node backend (systemd service, port 8787, localhost-only).

Live domain: **lapanza3d.co.za** / **www.lapanza3d.co.za** (this is a new
site — unrelated to lapanzaonline.co.za, which is email-only, and unrelated
to the existing separate "www.lapanza" site).

## 0. What you need before starting
- VPS IP address
- Root SSH access (password or key domain.co.za gave you)
- Access to lapanza3d.co.za's DNS (wherever that domain is registered)

## 1. Add the deploy key to the VPS
A dedicated key was generated for this (`~/.ssh/lapanza_vps_deploy` on this
machine, public half already baked into `bootstrap-vps.sh`). Two ways to get
it onto the VPS:

**Easiest** — if domain.co.za's control panel has an "SSH Keys" field for
the VPS, paste this in:
```
Enter key```

**Otherwise** — `bootstrap-vps.sh` (step 2 below) installs it for you as
part of first boot, using the root password once.

## 2. Bootstrap the VPS (run once, as root)
From this machine:
```bash
scp deploy/bootstrap-vps.sh root@<VPS_IP>:/root/
ssh root@<VPS_IP> 'bash /root/bootstrap-vps.sh'
```
You'll be prompted for the root password once (or it'll just work if the
key's already on the box). This installs Node 22, nginx, certbot, git,
build tools, opens the firewall for SSH/HTTP/HTTPS only, and creates a
`deploy` user with the key from step 1.

Verify key login works before continuing:
```bash
ssh -i ~/.ssh/lapanza_vps_deploy deploy@<VPS_IP>
```

## 3. Point DNS at the VPS
In lapanza3d.co.za's DNS settings, set:
- `A` record: `@` -> `<VPS_IP>`
- `A` record: `www` -> `<VPS_IP>`

DNS propagation can take a few minutes to a few hours. You can start step 4
before it fully propagates -- HTTP will just work by IP in the meantime;
certbot (step 6) needs DNS pointed correctly first, though.

## 4. Deploy the app
```bash
ssh -i ~/.ssh/lapanza_vps_deploy deploy@<VPS_IP>
sudo mkdir -p /opt/lapanza && sudo chown deploy:deploy /opt/lapanza
cd /opt/lapanza
git clone https://github.com/jbarkhuizen/Lapanza-3d-Creations-Martin.git app
cd app
bash deploy/deploy-app.sh
```
This clones the repo, `npm ci`, `npm run build`, copies `.env` from the
template, installs the systemd service, and wires up nginx.

`data/catalog.json` (category products) is gitignored -- copy it up
separately:
```bash
scp -i ~/.ssh/lapanza_vps_deploy data/catalog.json deploy@<VPS_IP>:/opt/lapanza/app/data/catalog.json
```
Do this *before* the service first starts (or delete `data/lapanza.db*` and
restart it after) so the first-boot migration picks up real category data
instead of an empty catalog.

Filament types/colours, shipping options, and settings live only in the
dev SQLite DB (never exported to a file) -- export/import them once via a
short Node script reading/writing those specific tables, rather than
copying the whole dev DB (which also carries test accounts/orders).

## 5. Fill in real secrets on the server
```bash
nano /opt/lapanza/app/.env
sudo systemctl restart lapanza-admin
```
Fill in Gmail app password and Payfast credentials directly here — never
paste these into chat with me or any AI tool. `SITE_URL`/`API_URL` are
already set to `https://www.lapanza3d.co.za` in the template.

## 6. First-run admin account
Visit `https://www.lapanza3d.co.za/admin/` (or `http://<VPS_IP>/admin/`
before DNS/SSL are live) — first boot shows a "create your admin account"
screen since the shipped DB has no admin users yet. Set a real
username/password there.

## 7. Enable HTTPS
Once DNS resolves to the VPS:
```bash
sudo certbot --nginx -d lapanza3d.co.za -d www.lapanza3d.co.za
```
Follow the prompts (email for renewal notices, agree to terms, choose
redirect HTTP->HTTPS: yes). Certbot auto-renews via a systemd timer it
installs — nothing further needed.

## 8. Smoke test
- `https://www.lapanza3d.co.za/` — homepage loads, cart empty
- `https://www.lapanza3d.co.za/admin/` — login works, dashboard loads
- Place a sandbox Payfast order end to end
- Submit a design request, confirm the owner-notification email arrives
  (needs `GMAIL_APP_PASSWORD` filled in)
- Check `sudo systemctl status lapanza-admin` is `active (running)`

## 9. Off-server backups (Google Drive)

Automated daily backups (§Notes below) already write to `data/backups/` on
the VPS itself -- good against bad data, a bad deploy, or human error, but
useless against that disk or the whole VPS failing outright. This step
mirrors that folder to Google Drive nightly via `rclone`.

**A Google service account does NOT work here** -- confirmed the hard way.
It can be shared onto a folder and will list/read it fine, but any *new*
file upload still fails with `storageQuotaExceeded`: service accounts have
zero storage quota of their own on a personal (non-Workspace) Google
account, and sharing a folder doesn't change that. Real Shared Drives
(where this would work) are a paid Google Workspace feature, not available
on a plain Gmail account. Use OAuth as your own account instead --
uploads then count against your normal 15GB quota, like any other file you
add to Drive yourself.

**One-time setup:**

1. **Google Cloud Console** (console.cloud.google.com) -- create a project
   (or reuse one), then **APIs & Services -> Library**, enable the
   **Google Drive API**.
2. In your own Google Drive, create a folder for backups (e.g.
   "Lapanza Backups"). Get its ID from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART`**.
3. On a machine with a browser and `rclone` installed locally (not the
   headless VPS), run:
   ```bash
   rclone authorize "drive"
   ```
   This opens a browser -- log in with the Google account that owns the
   folder above and authorize. It prints a JSON blob starting with
   `{"access_token":...}` -- copy the whole thing.
4. On the VPS, as the `deploy` user, write the rclone config **as a single
   line** (a heredoc/multi-line paste is prone to silently mangling in some
   terminals -- if `rclone config show gdrive` afterward doesn't match what
   you expect, that's almost certainly what happened; redo it as one line):
   ```bash
   printf '[gdrive]\ntype = drive\nscope = drive\ntoken = %s\nroot_folder_id = %s\n' 'PASTE_THE_JSON_BLOB_FROM_STEP_3' 'PASTE_THE_FOLDER_ID_FROM_STEP_2' > ~/.config/rclone/rclone.conf
   ```
5. Verify, then test directly before wiring it into the app:
   ```bash
   rclone config show gdrive    # confirm it shows "token = ..." not "service_account_file"
   rclone sync /opt/lapanza/app/data/backups gdrive: -v
   rclone lsf gdrive:           # should now list the synced .db files
   ```
6. Set the env var and restart:
   ```bash
   nano /opt/lapanza/app/.env      # BACKUP_RCLONE_REMOTE=gdrive:
   sudo systemctl restart lapanza-admin
   ```
7. Confirm from the admin UI: **Settings -> Backups -> Sync offsite now**
   should succeed immediately, rather than waiting for the next daily run.
   (Restarting the service also logs out every admin session -- that's
   expected, just log back in.)

The `refresh_token` inside that JSON blob means rclone renews the access
token on its own from here on -- this is a one-time setup, not something
you repeat per sync. Note also the rclone NOTICE about its shared
`client_id` being retired sometime in 2026 (harmless for now, worth
revisiting later): https://rclone.org/drive/#making-your-own-client-id

From here, every automated daily backup mirrors to that Drive folder right
after it's created and pruned locally -- no further action needed. If the
VPS is ever lost, the backups are sitting in that Drive folder, not on the
dead disk.

**`public/uploads/` (filament colour photos, category item photos, design-
request/print-job/3D-resource uploads) rides along on the same sync,
automatically** -- to a sibling `uploads` folder under the same remote, no
separate setup. This closes a real gap found the hard way on 2026-08-27:
uploads are genuine, manually-created business content with no rotation of
their own, and had never been backed up anywhere before -- only the SQLite
DB was. Deliberately uses `rclone copy` (add/update only) rather than
`sync` for this one: `sync` makes the destination match the source
exactly, including deletions, which for the DB backups directory is
correct (mirrors `pruneOldBackups()`'s own deliberate pruning) but for
uploads would silently propagate an accidental local deletion to the
offsite copy too -- exactly the failure mode this exists to prevent. A
file removed locally therefore stays safe offsite until someone explicitly
deletes it there as well.

## 10. Restoring from a backup

Backups (§9, `data/backups/*.db`) had never actually been restored before
2026-08-26 (backlog #119/SITE-085) -- the automated create/list/download
path was live and working, but nobody had verified a `.db` file coming out
of it was actually usable. It was: `PRAGMA integrity_check` passed and
`orders`/`clients`/`filament_colours`/`todo_items`/`audit_log` row counts
all matched expectations on a real backup file, tested read-only in
`/tmp` without touching the live service.

**To validate a backup without any downtime** (do this after any change to
the backup job itself, or periodically as a health check):
```bash
cd /opt/lapanza/app
cp data/backups/<filename>.db /tmp/restore-test.db
node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/restore-test.db', { readonly: true });
console.log(db.prepare('PRAGMA integrity_check').get());
for (const t of ['orders','clients','filament_colours','todo_items','audit_log']) {
  console.log(t, db.prepare('SELECT COUNT(*) n FROM ' + t).get().n);
}
"
rm /tmp/restore-test.db
```

**To actually restore** (real outage -- e.g. recovering from bad data or a
failed migration), this needs a brief service stop:
```bash
sudo systemctl stop lapanza-admin
cd /opt/lapanza/app
cp data/lapanza.db data/lapanza.db.before-restore   # undo button, just in case
cp data/backups/<filename>.db data/lapanza.db
sudo systemctl start lapanza-admin
curl -s http://localhost:8787/api/health             # {"ok":true,...} expected
```
If something's wrong after restarting, `cp data/lapanza.db.before-restore
data/lapanza.db` and restart again to undo. Once you're confident the
restore is good, delete `data/lapanza.db.before-restore` -- it's a plain
file copy, not tracked or pruned automatically.

This has not yet been rehearsed as a full live cutover (stop → swap →
restart → verify) on this server -- only the read-only integrity path
above has. Worth doing once during a real maintenance window if you want
the whole procedure proven end-to-end, not just the backup file itself.

## Future deploys
```bash
ssh -i ~/.ssh/lapanza_vps_deploy deploy@<VPS_IP>
cd /opt/lapanza/app
bash deploy/deploy-app.sh
```
Pulls latest `main`, rebuilds, restarts the service. `.env` is untouched
(only created if missing).

## Notes
- The VPS `.env` holds live payment/email credentials. It is never in git
  (`.gitignore`'d) and never passes through this chat.
- Backups: automated daily, on-boot, 30-backup retention -- see the admin
  "Backups" view (Settings group) or `data/backups/` on the server. Also
  auto-synced offsite to Google Drive nightly once §9 above is set up
  (`BACKUP_RCLONE_REMOTE` set) -- without that, backups still run but only
  live on the same disk as the live DB, which protects against bad data or
  a bad deploy but not against that disk/VPS failing entirely.
- To go from Payfast sandbox to live: fill in `PAYFAST_MERCHANT_*` in
  `.env`, set `PAYFAST_MODE=live`, restart the service.
- better-sqlite3 in this repo requires Node **>=22** -- installing Node 20
  will let `npm install` "succeed" with only a warning, then segfault the
  service on every boot. Always Node 22.
- `deploy-app.sh` only installs `nginx-lapanza.conf` the *first* time
  (checks whether `/etc/nginx/conf.d/lapanza.conf` already exists). Once
  certbot has run, that file has HTTPS/redirect blocks appended -- it's
  left alone on every later deploy so those survive. To change the nginx
  config after SSL is live, edit `/etc/nginx/conf.d/lapanza.conf` on the
  server directly (or re-run `certbot --nginx ...`), not the repo template.
