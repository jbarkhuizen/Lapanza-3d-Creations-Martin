# Lapanza Admin — Mobile

A React Native (Expo Router) client for the Lapanza 3D admin portal, covering
every section of the desktop admin sidebar (`admin/index.html`): Dashboard,
Orders, Clients, Products, Design Requests, Stock/Filament, Print Job
Costing, Purchases, marketing sections, and Settings (Backups, Audit Log,
Site Settings, etc).

It's a separate client for the **same backend** — `server/index.js` — using
the same cookie-session admin login. No new backend code was added; this app
only talks to the existing REST API.

For internal staff use: no App Store / Play Store listing is set up. Run it
via Expo Go during development, or produce a standalone internal build (see
below) to sideload directly.

## Scope notes

A few desktop-only power workflows were deliberately simplified rather than
rebuilt pixel-for-pixel on a phone screen:

- **Newsletter / WhatsApp Updates** — read-only campaign status plus
  approve/send actions on an *already-composed* campaign. No HTML/template
  composer (that stays a desktop task).
- **New Order** — free-text line items (description + price + qty) and a
  client search-or-create field, instead of the desktop's full product
  catalog picker.
- **Resources / Testimonials** — text metadata only; image/file uploads stay
  a desktop task.
- **Site Settings** — the dozen everyday scalar fields (business info,
  `invoiceNumberSeed`, etc.) are editable; complex nested settings
  (email templates, home-page tiles, volume discount tables, …) are shown
  read-only.
- **Potential Market** bulk CSV import, **Backups** offsite-sync
  configuration, and **Client merge** are desktop-only.

Every section still reads real, live data from the real API — nothing here
is mocked or stubbed.

## Running it

```bash
cd mobile
npm install       # first time only
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press `i`/`a` for a
simulator/emulator if you have one set up locally.

### Pointing it at your server

On the login screen, tap **Server settings** and enter the admin API's base
URL:

- **Local dev**, phone on the same Wi-Fi as your dev machine:
  `http://<your-computer's-LAN-IP>:8787` (the server's default port — see
  `server/index.js`'s `PORT`/`ADMIN_PORT`). `localhost` will not work from a
  physical phone.
- **Production**: `https://admin.procomsolutions.co.za` (the default baked
  into the app).

The chosen URL is stored on-device (`expo-secure-store`) and persists
between app launches. Switching servers clears the stored session cookie.

## Producing an internal build (sideload, no app store)

Requires a free Expo account (`npx expo login`) and `eas-cli`:

```bash
npm install -g eas-cli
cd mobile
eas build --profile preview --platform android   # produces a downloadable .apk
eas build --profile preview --platform ios        # produces a downloadable .ipa (needs an Apple Developer account for device install)
```

`eas.json` isn't checked in yet — `eas build:configure` will generate one on
first run. The Android `.apk` from a `preview` profile can be installed
directly on a device (enable "install from unknown sources"); the iOS
`.ipa` needs to go through TestFlight or ad-hoc device registration since
Apple requires that even for non-App-Store installs.

Alternatively, `npx expo export` produces a static bundle for hosting a
web version of the app, if that's ever useful for a quick desktop check.

## Project layout

```
app/                      Expo Router screens (file-based routing)
  _layout.tsx              Root: fonts, providers, signed-in/out gate
  login.tsx
  (app)/
    _layout.tsx             Stack wrapper
    (tabs)/                 Dashboard + Menu tab bar
    orders/, clients/, ...  One folder per sidebar section
components/                Shared UI: Card, Badge, buttons, EntityList, ...
lib/
  api.ts                    fetch wrapper, base URL, error handling
  auth-context.tsx           login/logout/session-check
  theme.ts / theme-context.tsx   brand colors (matches admin/admin.css), fonts
  types.ts                   TypeScript types mirroring server response shapes
  nav-sections.ts             the Menu tab's grouped section list
```

## Verification performed

- `npx tsc --noEmit` — clean.
- Every route referenced in `lib/nav-sections.ts` has a matching screen.
- Endpoint paths/response shapes were verified against `server/index.js` and
  the matching `server/*.js` module for each section, not assumed.

**Not verified**: this was built without a device/simulator available in the
build environment. Before relying on it, run it via Expo Go (or a dev
build) and walk through: login → Dashboard → Orders (list, detail, status
update, new order) → Clients → a few other sections → logout. Report any
runtime issues (they'll mostly be layout/RN-API-usage bugs that only surface
on-device, not the data-fetching logic itself).
