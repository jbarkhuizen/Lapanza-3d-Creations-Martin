# Deploying to the domain.co.za VPS

Single VPS, Ubuntu/Debian assumed. nginx serves the built static site and
reverse-proxies `/api`, `/admin`, `/uploads` to the Node backend (systemd
service, port 8787, localhost-only).

## 0. What you need before starting
- VPS IP address
- Root SSH access (password or key domain.co.za gave you)
- Access to lapanzaonline.co.za's DNS (domain.co.za control panel, or
  wherever the domain is registered/managed)

## 1. Add the deploy key to the VPS
A dedicated key was generated for this (`~/.ssh/lapanza_vps_deploy` on this
machine, public half already baked into `bootstrap-vps.sh`). Two ways to get
it onto the VPS:

**Easiest** — if domain.co.za's control panel has an "SSH Keys" field for
the VPS, paste this in:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEu87hzq0KoCiNW5exKUqmG+mmzv4DiYW7Ff5c845e4d lapanza-deploy
```

**Otherwise** — `bootstrap-vps.sh` (step 2 below) installs it for you as
part of first boot, using the root password once.

## 2. Bootstrap the VPS (run once, as root)
From this machine:
```bash
scp deploy/bootstrap-vps.sh root@<VPS_IP>:/root/
ssh root@<VPS_IP> 'bash /root/bootstrap-vps.sh'
```
You'll be prompted for the root password once (or it'll just work if the
key's already on the box). This installs Node 20, nginx, certbot, git,
build tools, opens the firewall for SSH/HTTP/HTTPS only, and creates a
`deploy` user with the key from step 1.

Verify key login works before continuing:
```bash
ssh -i ~/.ssh/lapanza_vps_deploy deploy@<VPS_IP>
```

## 3. Point DNS at the VPS
In lapanzaonline.co.za's DNS settings, set:
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

## 5. Fill in real secrets on the server
```bash
nano /opt/lapanza/app/.env
sudo systemctl restart lapanza-admin
```
Fill in Gmail app password and Payfast credentials directly here — never
paste these into chat with me or any AI tool. `SITE_URL`/`API_URL` are
already set to `https://lapanzaonline.co.za` in the template.

## 6. First-run admin account
Visit `https://lapanzaonline.co.za/admin/` (or `http://<VPS_IP>/admin/`
before DNS/SSL are live) — first boot shows a "create your admin account"
screen since the shipped DB has no admin users yet. Set a real
username/password there.

## 7. Enable HTTPS
Once DNS resolves to the VPS:
```bash
sudo certbot --nginx -d lapanzaonline.co.za -d www.lapanzaonline.co.za
```
Follow the prompts (email for renewal notices, agree to terms, choose
redirect HTTP->HTTPS: yes). Certbot auto-renews via a systemd timer it
installs — nothing further needed.

## 8. Smoke test
- `https://lapanzaonline.co.za/` — homepage loads, cart empty
- `https://lapanzaonline.co.za/admin/` — login works, dashboard loads
- Place a sandbox Payfast order end to end
- Submit a design request, confirm the owner-notification email arrives
  (needs `GMAIL_APP_PASSWORD` filled in)
- Check `sudo systemctl status lapanza-admin` is `active (running)`

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
- Backups: `data/lapanza.db` is the entire database (clients, orders,
  campaigns, admin accounts). Worth a periodic `scp` copy or a cron'd
  `sqlite3 data/lapanza.db ".backup /opt/lapanza/backups/$(date +%F).db"`.
- To go from Payfast sandbox to live: fill in `PAYFAST_MERCHANT_*` in
  `.env`, set `PAYFAST_MODE=live`, restart the service.
