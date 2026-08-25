// Single source of truth for Rand formatting, server-side. Before this, five
// separate ad-hoc implementations existed (server/index.js, server/mailer.js,
// server/export.js's inline template, and two copies in src/js/) with three
// different behaviors -- some stripped trailing ".00", some showed 0
// decimals, none added a thousands separator. This is imported by
// server/*.js and scripts/generate-pages.mjs (both run under Node, unlike
// admin/admin.js and src/js/*.js which are served/bundled separately and so
// keep their own copies -- see admin/money.js and src/js/money.js).

export function formatRand(value) {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;
  const sign = amount < 0 ? '-' : '';
  const [whole, decimals] = Math.abs(amount).toFixed(2).split('.');
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}R ${withThousands}.${decimals}`;
}

// Category item prices are free text an admin types into a plain input
// (e.g. "350", "R450", "POA", "Contact us" -- see admin/admin.js's
// data-item="price" field), not a number column. Strips to digits and
// formats as currency when it parses cleanly; otherwise passes the original
// text through unchanged rather than mangling a deliberately non-numeric
// price note into "R 0.00".
export function parsePrice(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function formatItemPrice(value) {
  if (!value) return '';
  const stripped = String(value).replace(/[^0-9.]/g, '');
  if (!stripped) return String(value);
  const n = parseFloat(stripped);
  return Number.isFinite(n) ? formatRand(n) : String(value);
}
