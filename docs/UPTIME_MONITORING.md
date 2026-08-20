# Uptime Monitoring Setup (UptimeRobot)

External monitoring so a site outage reaches you before a customer does. This is a third-party account signup — an AI assistant cannot do this step for you (it requires creating an account and authenticating to it). Everything below is exact, copy-paste-ready values so it takes a few minutes.

## What's being monitored

`GET https://lapanza3d.co.za/api/health` — as of this setup, this endpoint does more than confirm the Node process is running: it runs a real query against the SQLite database and returns:

| Response | Meaning |
|---|---|
| `200 {"ok": true, ...}` | Site and database both healthy |
| `503 {"ok": false, ...}` | Node process is up, but the **database is unreachable** — a more likely real failure than the process dying outright, and one a plain "is the server responding" check would miss entirely |
| No response / connection refused / timeout | Server, nginx, or the network is down |

A plain HTTP-status monitor (see below) correctly treats all of these as "down" except the first — no special configuration needed to catch the database-specific failure.

## Setup steps

1. Go to **https://uptimerobot.com** and create a free account (email + password — do this yourself, not through any AI tool).
2. Verify your email if prompted.
3. Click **+ Add New Monitor**.
4. Fill in:
   | Field | Value |
   |---|---|
   | Monitor Type | `HTTP(s)` |
   | Friendly Name | `Lapanza 3D — health` |
   | URL (or IP) | `https://lapanza3d.co.za/api/health` |
   | Monitoring Interval | `5 minutes` (the free-tier minimum — fine for this use case) |
5. Under **Alert Contacts**, add the email address (and/or SMS, if you set one up) that should get notified. Make sure it's actually checked/enabled for this monitor.
6. Save. UptimeRobot will do its first check within a few minutes — the monitor should show **Up** (green).

## Optional: also check the response content, not just the status code

If you want UptimeRobot to specifically verify the JSON body says `"ok":true` (catches the rare case of a 200 response with unexpected content, not just outright failures):

- Monitor Type: `Keyword`
- Keyword to check: `"ok":true`
- Alert when: keyword **not** found

This is stricter than the plain HTTP-status monitor above and not necessary for most cases — the 503-on-DB-failure change already covers the realistic failure modes. Use it only if you want extra sensitivity.

## Verifying it actually works

Don't just trust that alerts are configured — prove it once:

```bash
ssh -i ~/.ssh/lapanza_vps_deploy deploy@41.222.36.147
sudo systemctl stop lapanza-admin
```

Wait up to 5 minutes (the check interval) — you should get an email/SMS saying the monitor is down. Then bring it back:

```bash
sudo systemctl start lapanza-admin
```

You should get a second notification confirming it's back up. If neither notification arrives, the alert contact isn't wired up correctly in UptimeRobot — check step 5 again.

## What this does NOT cover

- **nginx being up but the backend down** — actually, this **is** covered: nginx would proxy the request to the dead backend and return a 502/504, which UptimeRobot correctly reports as down.
- **DNS pointing at the wrong server** — also covered, since UptimeRobot resolves the domain itself on every check, same as a real visitor's browser.
- **Slow-but-technically-up** (degraded performance, not outage) — UptimeRobot's free tier checks liveness, not latency/performance. Not addressed by this setup.
- **The storefront itself being broken while the API is healthy** (e.g. a bad static-page publish) — `/api/health` only proves the backend and DB are fine, not that every page renders correctly. Consider a second monitor on `https://lapanza3d.co.za/` (the homepage) if you want that covered too — same steps above, just a different URL.
