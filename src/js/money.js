// Public-site twin of server/money.js. Client bundle (vite) is a separate
// build from the server/admin code, so it can't import either of those --
// keep this in sync with server/money.js if the format ever changes.

export function formatRand(value) {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;
  const sign = amount < 0 ? '-' : '';
  const [whole, decimals] = Math.abs(amount).toFixed(2).split('.');
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}R ${withThousands}.${decimals}`;
}
