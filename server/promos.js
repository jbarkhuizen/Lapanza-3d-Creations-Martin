// Backlog #99 (SITE-065), promotions half: percent / fixed-rand promo codes.
// The whole feature follows the site's standing pricing rule -- the CLIENT
// never decides a discount. validatePromo() is used twice: once by the
// public preview endpoint (so checkout can show the discount line before
// payment) and again, authoritatively, inside createOrder()'s transaction,
// where redeemPromo() also increments used_count with a guard that makes
// concurrent checkouts unable to over-redeem a limited code.
//
// Stacking rule (owner-approved default): volume discount first, promo on
// the remainder. computePromoDiscount() therefore takes the subtotal AFTER
// the volume discount.
import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export const PROMO_KINDS = ['percent', 'fixed'];

function rowToPromo(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    minSubtotal: row.min_subtotal,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPromoCodes(db = getDb()) {
  return db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all().map(rowToPromo);
}

export function getPromoByCode(code, db = getDb()) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return null;
  return rowToPromo(db.prepare('SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE').get(trimmed));
}

function normalizePromoInput(data, existing = {}) {
  const code = String(data.code ?? existing.code ?? '').trim();
  if (!code) throw new Error('Code is required');
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) throw new Error('Codes are 2-40 letters, digits, dashes or underscores');
  const kind = data.kind ?? existing.kind ?? 'percent';
  if (!PROMO_KINDS.includes(kind)) throw new Error('Invalid discount type');
  const value = Number(data.value ?? existing.value);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Discount value must be a positive number');
  if (kind === 'percent' && value > 90) throw new Error('Percentage discounts are capped at 90%');
  const minSubtotal = Math.max(0, Number(data.minSubtotal ?? existing.minSubtotal) || 0);
  const expiresAt = (data.expiresAt ?? existing.expiresAt) || null;
  const maxUsesRaw = data.maxUses ?? existing.maxUses;
  const maxUses = maxUsesRaw === null || maxUsesRaw === undefined || maxUsesRaw === '' ? null : Math.max(1, Math.floor(Number(maxUsesRaw) || 0));
  const active = (data.active ?? existing.active ?? true) !== false;
  return { code, kind, value, minSubtotal, expiresAt, maxUses, active };
}

export function createPromoCode(data, db = getDb()) {
  const p = normalizePromoInput(data);
  if (getPromoByCode(p.code, db)) throw new Error(`Code "${p.code}" already exists`);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO promo_codes (id, code, kind, value, min_subtotal, expires_at, max_uses, used_count, active, created_at, updated_at)
     VALUES (@id, @code, @kind, @value, @min_subtotal, @expires_at, @max_uses, 0, @active, @now, @now)`,
  ).run({ id, code: p.code, kind: p.kind, value: p.value, min_subtotal: p.minSubtotal, expires_at: p.expiresAt, max_uses: p.maxUses, active: p.active ? 1 : 0, now });
  return rowToPromo(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id));
}

export function updatePromoCode(id, data, db = getDb()) {
  const existing = rowToPromo(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id));
  if (!existing) return null;
  const p = normalizePromoInput(data, existing);
  const clash = getPromoByCode(p.code, db);
  if (clash && clash.id !== id) throw new Error(`Code "${p.code}" already exists`);
  db.prepare(
    `UPDATE promo_codes SET code = @code, kind = @kind, value = @value, min_subtotal = @min_subtotal,
       expires_at = @expires_at, max_uses = @max_uses, active = @active, updated_at = @now WHERE id = @id`,
  ).run({ id, code: p.code, kind: p.kind, value: p.value, min_subtotal: p.minSubtotal, expires_at: p.expiresAt, max_uses: p.maxUses, active: p.active ? 1 : 0, now: new Date().toISOString() });
  return rowToPromo(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id));
}

// Rule check only -- no side effects, safe for the public preview endpoint.
// `subtotal` is the order subtotal after any volume discount. Returns
// { ok:true, promo } or { ok:false, reason } with a customer-safe reason.
export function validatePromo(code, subtotal, db = getDb()) {
  const promo = getPromoByCode(code, db);
  if (!promo || !promo.active) return { ok: false, reason: 'That promo code is not valid.' };
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: 'That promo code has expired.' };
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return { ok: false, reason: 'That promo code has been fully redeemed.' };
  }
  if (Number(subtotal) < promo.minSubtotal) {
    return { ok: false, reason: `That code needs a minimum order of R ${promo.minSubtotal.toFixed(2)}.` };
  }
  return { ok: true, promo };
}

export function computePromoDiscount(promo, subtotalAfterVolume) {
  const base = Math.max(0, Number(subtotalAfterVolume) || 0);
  const raw = promo.kind === 'percent' ? base * (promo.value / 100) : promo.value;
  return Math.min(base, Math.round(raw));
}

// Counts the redemption. MUST run inside the order-creating transaction:
// the guarded UPDATE re-checks max_uses at write time, so two concurrent
// checkouts racing for a code's last use cannot both succeed.
export function redeemPromo(promoId, db = getDb()) {
  const res = db.prepare(
    `UPDATE promo_codes SET used_count = used_count + 1, updated_at = ?
     WHERE id = ? AND active = 1 AND (max_uses IS NULL OR used_count < max_uses)`,
  ).run(new Date().toISOString(), promoId);
  if (res.changes === 0) throw new Error('That promo code has been fully redeemed.');
}
