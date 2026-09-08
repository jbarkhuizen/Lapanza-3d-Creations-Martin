import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { createRepayment, updateRepayment, deleteRepayment, listRepayments, getRepayment, getAdvancesSummary } from './account-repayments.js';
import { createExpense } from './expenses.js';

function seedExpense(db, overrides = {}) {
  return createExpense(
    {
      supplier: 'Creality Store',
      purchaseDate: '2026-09-01',
      paymentMethod: 'Absa Credit Card',
      items: [{ description: 'K1C Printer', category: 'Printers & Equipment', quantity: 1, unitPrice: 1000 }],
      ...overrides,
    },
    db,
  );
}

test('createRepayment requires an account and a positive amount', () => {
  const db = openDb(':memory:');
  assert.throws(() => createRepayment({ account: '', amount: 100 }, db), /Paid From account is required/);
  assert.throws(() => createRepayment({ account: 'Absa Credit Card', amount: 0 }, db), /greater than zero/);
  assert.throws(() => createRepayment({ account: 'Absa Credit Card', amount: -50 }, db), /greater than zero/);
  const repayment = createRepayment({ account: 'Absa Credit Card', amount: 100.5, repaidDate: '2026-09-10', notes: 'part payment' }, db);
  assert.strictEqual(repayment.account, 'Absa Credit Card');
  assert.strictEqual(repayment.amount, 100.5);
  assert.strictEqual(repayment.repaidDate, '2026-09-10');
  assert.strictEqual(repayment.notes, 'part payment');
  db.close();
});

test('createRepayment defaults the date to today when not given', () => {
  const db = openDb(':memory:');
  const repayment = createRepayment({ account: 'Absa Credit Card', amount: 50 }, db);
  assert.strictEqual(repayment.repaidDate, new Date().toISOString().slice(0, 10));
  db.close();
});

test('updateRepayment changes fields and re-validates; deleteRepayment removes the row', () => {
  const db = openDb(':memory:');
  const repayment = createRepayment({ account: 'Absa Credit Card', amount: 100 }, db);
  const updated = updateRepayment(repayment.id, { amount: 250, notes: 'topped up' }, db);
  assert.strictEqual(updated.amount, 250);
  assert.strictEqual(updated.notes, 'topped up');
  assert.strictEqual(updated.account, 'Absa Credit Card', 'untouched field survives a partial update');

  assert.throws(() => updateRepayment(repayment.id, { amount: 0 }, db), /greater than zero/);
  assert.strictEqual(updateRepayment('unknown-id', { amount: 10 }, db), null);

  assert.strictEqual(deleteRepayment(repayment.id, db), true);
  assert.strictEqual(getRepayment(repayment.id, db), null);
  assert.strictEqual(deleteRepayment(repayment.id, db), false, 'deleting again is a no-op, not an error');
  db.close();
});

test('listRepayments filters by account and sorts newest-first', () => {
  const db = openDb(':memory:');
  createRepayment({ account: 'Absa Credit Card', amount: 100, repaidDate: '2026-09-01' }, db);
  createRepayment({ account: 'Revolving Acc', amount: 200, repaidDate: '2026-09-05' }, db);
  createRepayment({ account: 'Absa Credit Card', amount: 50, repaidDate: '2026-09-10' }, db);

  const all = listRepayments({}, db);
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].repaidDate, '2026-09-10', 'newest first');

  const absaOnly = listRepayments({ account: 'Absa Credit Card' }, db);
  assert.strictEqual(absaOnly.length, 2);
  db.close();
});

// Owner request (2026-09-08): every expense is an advance from the account
// it was paid from; this is the whole point of the feature, so it's worth
// pinning down precisely.
test('getAdvancesSummary computes advanced/repaid/outstanding per account, all-time (not windowed)', () => {
  const db = openDb(':memory:');
  seedExpense(db, { purchaseDate: '2020-01-01', paymentMethod: 'Absa Credit Card', items: [{ description: 'Old printer', category: 'Printers & Equipment', quantity: 1, unitPrice: 5000 }] });
  seedExpense(db, { purchaseDate: '2026-09-01', paymentMethod: 'Absa Credit Card', items: [{ description: 'Filament', category: 'Filament & Stock', quantity: 1, unitPrice: 1000 }] });
  seedExpense(db, { purchaseDate: '2026-09-05', paymentMethod: 'Revolving Acc', items: [{ description: 'Resin', category: 'Filament & Stock', quantity: 1, unitPrice: 500 }] });
  createRepayment({ account: 'Absa Credit Card', amount: 2000 }, db);

  const summary = getAdvancesSummary(db);
  const absa = summary.accounts.find((a) => a.account === 'Absa Credit Card');
  const revolving = summary.accounts.find((a) => a.account === 'Revolving Acc');

  // 5000 (from 2020, well outside any 12-month window) + 1000 must both
  // count -- proves this isn't windowed like Financial Overview's own
  // paymentMethods breakdown.
  assert.strictEqual(absa.advanced, 6000);
  assert.strictEqual(absa.repaid, 2000);
  assert.strictEqual(absa.outstanding, 4000);

  assert.strictEqual(revolving.advanced, 500);
  assert.strictEqual(revolving.repaid, 0);
  assert.strictEqual(revolving.outstanding, 500);

  assert.strictEqual(summary.totals.advanced, 6500);
  assert.strictEqual(summary.totals.repaid, 2000);
  assert.strictEqual(summary.totals.outstanding, 4500);
  db.close();
});

test('getAdvancesSummary still lists an account that has been fully repaid, at zero outstanding', () => {
  const db = openDb(':memory:');
  seedExpense(db, { paymentMethod: 'Absa Credit Card', items: [{ description: 'Printer', category: 'Printers & Equipment', quantity: 1, unitPrice: 1000 }] });
  createRepayment({ account: 'Absa Credit Card', amount: 1000 }, db);

  const summary = getAdvancesSummary(db);
  const absa = summary.accounts.find((a) => a.account === 'Absa Credit Card');
  assert.ok(absa, 'fully-repaid account is still listed, not dropped');
  assert.strictEqual(absa.outstanding, 0);
  db.close();
});

test('getAdvancesSummary handles a repayment logged against an account with no expenses at all (does not crash, does not go negative silently)', () => {
  const db = openDb(':memory:');
  createRepayment({ account: 'Cheque ACC', amount: 500 }, db);
  const summary = getAdvancesSummary(db);
  const cheque = summary.accounts.find((a) => a.account === 'Cheque ACC');
  assert.strictEqual(cheque.advanced, 0);
  assert.strictEqual(cheque.repaid, 500);
  assert.strictEqual(cheque.outstanding, -500);
  db.close();
});
