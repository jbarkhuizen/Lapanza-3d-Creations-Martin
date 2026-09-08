import { randomUUID } from 'crypto';
import { getDb } from './db.js';
import { listExpenses } from './expenses.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function rowToRepayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    account: row.account,
    amount: row.amount,
    repaidDate: row.repaid_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getRepayment(id, db = getDb()) {
  return rowToRepayment(db.prepare('SELECT * FROM account_repayments WHERE id = ?').get(id));
}

export function listRepayments({ account } = {}, db = getDb()) {
  let rows = db.prepare('SELECT * FROM account_repayments ORDER BY repaid_date DESC, created_at DESC').all().map(rowToRepayment);
  if (account) rows = rows.filter((r) => r.account === account);
  return rows;
}

function assertValid({ account, amount }) {
  if (!String(account || '').trim()) throw new Error('Paid From account is required');
  if (!(round2(amount) > 0)) throw new Error('Repayment amount must be greater than zero');
}

export function createRepayment({ account, amount, repaidDate, notes }, db = getDb()) {
  assertValid({ account, amount });
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO account_repayments (id, account, amount, repaid_date, notes, created_at, updated_at) VALUES (@id, @account, @amount, @repaid_date, @notes, @created_at, @updated_at)',
  ).run({
    id,
    account: String(account).trim(),
    amount: round2(amount),
    repaid_date: repaidDate || now.slice(0, 10),
    notes: String(notes || '').trim().slice(0, 500),
    created_at: now,
    updated_at: now,
  });
  return getRepayment(id, db);
}

export function updateRepayment(id, { account, amount, repaidDate, notes }, db = getDb()) {
  const existing = db.prepare('SELECT * FROM account_repayments WHERE id = ?').get(id);
  if (!existing) return null;
  const next = {
    account: account !== undefined ? String(account).trim() : existing.account,
    amount: amount !== undefined ? round2(amount) : existing.amount,
  };
  assertValid(next);
  db.prepare(
    'UPDATE account_repayments SET account = @account, amount = @amount, repaid_date = @repaid_date, notes = @notes, updated_at = @updated_at WHERE id = @id',
  ).run({
    id,
    account: next.account,
    amount: next.amount,
    repaid_date: repaidDate !== undefined ? repaidDate : existing.repaid_date,
    notes: notes !== undefined ? String(notes).trim().slice(0, 500) : existing.notes,
    updated_at: new Date().toISOString(),
  });
  return getRepayment(id, db);
}

export function deleteRepayment(id, db = getDb()) {
  return db.prepare('DELETE FROM account_repayments WHERE id = ?').run(id).changes > 0;
}

// Owner request (2026-09-08): every expense is paid from one of the owner's
// own Paid From accounts -- that money is an advance into the business, not
// business capital, until it's paid back. "Advanced" is deliberately
// all-time (every expense ever, no date window), unlike Financial
// Overview's own paymentMethods breakdown, which is windowed to the last 12
// months for the trend chart -- an advance from 14 months ago is still
// owed, so this can't reuse that windowed map.
// Accounts are the UNION of "ever had an expense" and "ever had a
// repayment" -- a fully-repaid account (outstanding back to zero) must
// still show up, e.g. after being renamed/retired in Settings, rather than
// silently vanishing the moment its balance hits zero.
export function getAdvancesSummary(db = getDb()) {
  const advancedByAccount = new Map();
  for (const e of listExpenses({}, db)) {
    const account = e.paymentMethod || 'Unspecified';
    advancedByAccount.set(account, round2((advancedByAccount.get(account) || 0) + e.total));
  }
  const repaidByAccount = new Map();
  for (const r of listRepayments({}, db)) {
    repaidByAccount.set(r.account, round2((repaidByAccount.get(r.account) || 0) + r.amount));
  }
  const accounts = new Set([...advancedByAccount.keys(), ...repaidByAccount.keys()]);
  const rows = [...accounts]
    .map((account) => {
      const advanced = advancedByAccount.get(account) || 0;
      const repaid = repaidByAccount.get(account) || 0;
      return { account, advanced, repaid, outstanding: round2(advanced - repaid) };
    })
    .sort((a, b) => b.outstanding - a.outstanding);
  const totals = rows.reduce(
    (acc, r) => ({
      advanced: round2(acc.advanced + r.advanced),
      repaid: round2(acc.repaid + r.repaid),
      outstanding: round2(acc.outstanding + r.outstanding),
    }),
    { advanced: 0, repaid: 0, outstanding: 0 },
  );
  return { accounts: rows, totals };
}
