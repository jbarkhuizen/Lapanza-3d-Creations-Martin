// #115: browser-level smoke of the core journeys. Setup seeds the scratch
// DB through the real admin API so the committed dist/ pages' product IDs
// resolve at checkout (the built PLA page carries real SKUs from the
// checked-in filaments.json — the first listed colour is re-created here).
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { spawnSync } from 'child_process';

const API = 'http://localhost:8787';
const ADMIN = { username: 'e2e-admin', password: 'correcthorsebattery' };

let adminCookie = '';
let seededSku = '';
let seededColourName = '';

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

test.beforeAll(async () => {
  // Fresh scratch DB -> first-run setup creates the admin.
  await api('/api/setup', { method: 'POST', body: ADMIN });
  const login = await api('/api/auth/login', { method: 'POST', body: ADMIN });
  adminCookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // Seed the scratch DB DIRECTLY (scripts/e2e-seed.mjs) -- the admin
  // colour-create API triggers publishCatalog(), which would regenerate
  // pages + rebuild dist/ from the near-empty scratch DB mid-run.
  const seed = spawnSync(process.execPath, ['scripts/e2e-seed.mjs'], {
    env: { ...process.env, DATA_DIR: process.env.E2E_DATA_DIR },
    encoding: 'utf8',
  });
  if (seed.status !== 0) throw new Error(`e2e seed failed: ${seed.stderr || seed.stdout}`);

  const filaments = JSON.parse(fs.readFileSync('src/data/filaments.json', 'utf8'));
  const colour = filaments.find((f) => f.slug === 'pla').colours.find((c) => c.listed !== false);
  seededSku = colour.sku;
  seededColourName = colour.name;
});

test('storefront: browse PLA, add to cart, complete a manual-EFT checkout', async ({ page }) => {
  await page.goto('/filament/pla.html');
  await expect(page.locator('h1')).toContainText('PLA');

  // Add the seeded colour (its card carries the SKU we re-created).
  const card = page.locator('.swatch-card', { hasText: seededSku }).first();
  await card.locator('button[data-product-id]').click();
  await expect(page.locator('#cart-badge')).toHaveText('1');

  await page.goto('/checkout.html');
  await expect(page.locator('#checkout-lines')).toContainText(seededColourName);
  await page.fill('[name="firstName"]', 'E2E');
  await page.fill('[name="lastName"]', 'Shopper');
  await page.fill('[name="email"]', 'e2e-shopper@example.com');
  await page.check('input[name="shippingMethod"][value="collect"]');
  await page.check('input[name="paymentMethod"][value="manual_eft"]');
  await page.click('button[type="submit"]');
  await expect(page.locator('#checkout-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#checkout-success')).toContainText(/order reference/i);
});

test('design request: guided form with review step submits', async ({ page }) => {
  await page.goto('/design-request.html');
  await page.check('input[name="serviceType"][value="design_for_me"]');
  await page.fill('#design-request-form [name="name"]', 'E2E Requester');
  await page.fill('#design-request-form [name="email"]', 'e2e-request@example.com');
  await page.fill('#design-request-form [name="phone"]', '0820000000');
  await page.fill('#design-request-form [name="description"]', 'E2E smoke request — replacement bracket.');
  await page.fill('#design-request-form [name="dimensions"]', '50 x 20 mm');
  await page.click('#dr-review-btn'); // -> review panel
  await expect(page.locator('#dr-review')).toBeVisible();
  await expect(page.locator('#dr-review-body')).toContainText('E2E Requester');
  await page.click('#dr-confirm');
  await expect(page.locator('#design-request-note')).toContainText(/received your request/i, { timeout: 15_000 });
});

test('account: register, verify, log in, see order history table', async ({ page }) => {
  const email = 'e2e-account@example.com';
  await page.goto('/account.html');
  await page.fill('#register-form [name="firstName"]', 'E2E');
  await page.fill('#register-form [name="lastName"]', 'Account');
  await page.fill('#register-form [name="email"]', email);
  await page.fill('#register-form [name="password"]', 'correcthorsebattery');
  await page.fill('#register-form [name="confirmPassword"]', 'correcthorsebattery');
  await page.click('#register-form button[type="submit"]');
  await expect(page.locator('#register-note')).toContainText(/verify|check your email/i, { timeout: 15_000 });

  // Email verification is a real gate; flip it via the admin API the same
  // way the HTTP tests do, then log in through the real UI.
  const list = await api(`/api/clients?q=${encodeURIComponent(email)}`, { cookie: adminCookie });
  const { clients } = await list.json();
  await api(`/api/clients/${clients[0].id}/verify`, { method: 'PATCH', cookie: adminCookie });

  await page.fill('#login-form [name="email"]', email);
  await page.fill('#login-form [name="password"]', 'correcthorsebattery');
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#account-loggedin')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#account-welcome')).toContainText(/welcome/i);
});

test('admin: real login screen accepts the seeded credentials', async ({ page }) => {
  await page.goto('http://localhost:8787/admin/');
  // The username input is injected at runtime (ensureLoginUsernameField).
  await page.fill('#login-form input[name="username"]', ADMIN.username);
  await page.fill('#login-form input[name="password"]', ADMIN.password);
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#view-dashboard')).toBeVisible({ timeout: 15_000 });
});
