// Mobile twin of server/money.js / admin/money.js — keep in sync if the
// format ever changes there.

export function formatRand(value: unknown): string {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;
  const sign = amount < 0 ? '-' : '';
  const [whole, decimals] = Math.abs(amount).toFixed(2).split('.');
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}R ${withThousands}.${decimals}`;
}
