// Backlog #60 (SITE-026): client-side mirror of the server's volume-discount
// rule (server/orders.js is the authority at order creation -- this exists
// only so the cart drawer and checkout summary can SHOW the same numbers
// the server will charge). Tiers come from site-settings.json
// (settings.volumeDiscounts); filament lines are identified by the same
// productId prefix the server keys on.
export function computeVolumeDiscount(items, tiers) {
  const active = (Array.isArray(tiers) ? tiers : []).filter((t) => t && t.active !== false && Number(t.minQty) > 0 && Number(t.pct) > 0);
  if (!active.length) return null;
  const filament = (items || []).filter((i) => String(i.productId || '').startsWith('filament:'));
  const qty = filament.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const subtotal = filament.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
  const best = active.filter((t) => qty >= Number(t.minQty)).sort((a, b) => Number(b.minQty) - Number(a.minQty))[0];
  if (!best) return null;
  const pct = Math.min(100, Number(best.pct));
  return { pct, qty, amount: Math.round(subtotal * (pct / 100)) };
}
