import { getDb } from './db.js';

// Dashboard sales summary. Revenue only ever counts orders that have
// actually been paid (paid/shipped/completed) -- a pending_payment order is
// a hope, not money in the bank, so it's excluded here and surfaced
// separately in the status breakdown instead. Cancelled orders never count.
const REVENUE_STATUSES = "('paid', 'shipped', 'completed')";
const ALL_STATUSES = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled'];

const RANGE_DAYS = { today: 0, '7d': 7, '30d': 30, '90d': 90, all: null };

function rangeWhereClause(range) {
  if (!Object.hasOwn(RANGE_DAYS, range)) throw new Error(`Unknown range: ${range}`);
  if (range === 'all') return '';
  if (range === 'today') return "AND date(o.created_at) = date('now')";
  return `AND o.created_at >= datetime('now', '-${RANGE_DAYS[range]} days')`;
}

export function getSalesSummary(range = '30d', db = getDb()) {
  const rangeClause = rangeWhereClause(range);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o
       WHERE o.status IN ${REVENUE_STATUSES} ${rangeClause}`,
    )
    .get();

  // Daily series for the trend chart -- grouped by calendar date, same
  // paid-only scope as the headline revenue figure above.
  const series = db
    .prepare(
      `SELECT date(o.created_at) AS date, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o
       WHERE o.status IN ${REVENUE_STATUSES} ${rangeClause}
       GROUP BY date(o.created_at)
       ORDER BY date ASC`,
    )
    .all();

  // Grouped by product_id (the stable catalog key) rather than product_name,
  // so a mid-history rename doesn't split one product's sales across two
  // rows; MAX(product_name) just picks a display label deterministically.
  const topProducts = db
    .prepare(
      `SELECT oi.product_id AS productId, MAX(oi.product_name) AS name,
              SUM(oi.quantity) AS units, SUM(oi.price * oi.quantity) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ${REVENUE_STATUSES} ${rangeClause}
       GROUP BY oi.product_id
       ORDER BY revenue DESC
       LIMIT 10`,
    )
    .all();

  const statusRows = db
    .prepare(
      `SELECT o.status AS status, COUNT(*) AS count, COALESCE(SUM(o.total), 0) AS total
       FROM orders o
       WHERE 1=1 ${rangeClause}
       GROUP BY o.status`,
    )
    .all();
  const statusByKey = new Map(statusRows.map((r) => [r.status, r]));
  const statusBreakdown = ALL_STATUSES.map((status) => ({
    status,
    count: statusByKey.get(status)?.count || 0,
    total: statusByKey.get(status)?.total || 0,
  }));

  return {
    range,
    revenue: totals.revenue,
    orderCount: totals.orderCount,
    averageOrderValue: totals.orderCount ? Math.round(totals.revenue / totals.orderCount) : 0,
    pendingPayment: statusBreakdown.find((s) => s.status === 'pending_payment'),
    series,
    topProducts,
    statusBreakdown,
  };
}
