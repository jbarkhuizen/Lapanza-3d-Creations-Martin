import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  createExpense,
  updateExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  migratePurchasesToExpenses,
  getFinancialOverview,
} from './expenses.js';
import { createPurchase } from './purchases.js';
import { createFilament, addColour } from './filaments.js';
import { createOrder, markOrderPaid } from './orders.js';

function seedExpense(db, overrides = {}) {
  return createExpense(
    {
      supplier: 'Creality Store',
      purchaseDate: '2026-09-01',
      paymentMethod: 'Absa Credit Card',
      items: [
        { description: 'K1C Printer', category: 'Printers & Equipment', quantity: 1, unitPrice: 8999.99 },
        { description: 'Nozzle pack', category: 'Consumables', quantity: 2, unitPrice: 150.5 },
      ],
      ...overrides,
    },
    db,
  );
}

test('createExpense computes the invoice total from its line items (cents-safe)', () => {
  const db = openDb(':memory:');
  const expense = seedExpense(db);
  assert.strictEqual(expense.total, 9300.99); // 8999.99 + 2*150.50
  assert.strictEqual(expense.items.length, 2);
  assert.strictEqual(expense.items[1].lineTotal, 301);
  assert.throws(() => createExpense({ supplier: '', items: [{ description: 'x', unitPrice: 1 }] }, db), /supplier is required/i);
  assert.throws(() => createExpense({ supplier: 'S', items: [] }, db), /at least one line item/i);
  db.close();
});

test('updateExpense replaces items wholesale and recomputes the total; delete cascades', () => {
  const db = openDb(':memory:');
  const expense = seedExpense(db);
  const updated = updateExpense(expense.id, {
    supplier: 'Takealot',
    items: [{ description: 'PLA rolls', category: 'Filament & Stock', quantity: 4, unitPrice: 250 }],
  }, db);
  assert.strictEqual(updated.supplier, 'Takealot');
  assert.strictEqual(updated.total, 1000);
  assert.strictEqual(updated.items.length, 1);

  assert.strictEqual(deleteExpense(expense.id, db), true);
  assert.strictEqual(getExpense(expense.id, db), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM expense_items').get().n, 0, 'items cascade-deleted');
  db.close();
});

test('listExpenses filters by q and category', () => {
  const db = openDb(':memory:');
  seedExpense(db);
  seedExpense(db, { supplier: 'Eskom', items: [{ description: 'Electricity', category: 'Operating Costs', quantity: 1, unitPrice: 800 }] });
  assert.strictEqual(listExpenses({}, db).length, 2);
  assert.strictEqual(listExpenses({ q: 'eskom' }, db).length, 1);
  assert.strictEqual(listExpenses({ q: 'nozzle' }, db).length, 1);
  assert.strictEqual(listExpenses({ category: 'Operating Costs' }, db).length, 1);
  db.close();
});

test('migratePurchasesToExpenses converts old rows once, idempotently', () => {
  const db = openDb(':memory:');
  createPurchase({ supplier: 'Old Supplier', goods: 'Filament batch', totalValue: 1500, paymentType: 'Card', status: 'paid' }, db);
  createPurchase({ supplier: 'Outstanding Guy', goods: 'Nozzles', totalValue: 300, status: 'outstanding' }, db);

  assert.strictEqual(migratePurchasesToExpenses(db), 2);
  const expenses = listExpenses({}, db);
  assert.strictEqual(expenses.length, 2);
  const migrated = expenses.find((e) => e.supplier === 'Old Supplier');
  assert.strictEqual(migrated.total, 1500);
  assert.strictEqual(migrated.items[0].description, 'Filament batch');
  assert.ok(migrated.sourcePurchaseId);
  const outstanding = expenses.find((e) => e.supplier === 'Outstanding Guy');
  assert.match(outstanding.notes, /outstanding/i);

  // Re-running migrates nothing new.
  assert.strictEqual(migratePurchasesToExpenses(db), 0);
  assert.strictEqual(listExpenses({}, db).length, 2);
  db.close();
});

test('getFinancialOverview: income counts paid orders only, expenses bucket by month', () => {
  const db = openDb(':memory:');
  const filament = createFilament({ name: 'PLA', slug: 'pla' }, db);
  const colour = addColour(filament.id, { name: 'Red', sku: 'PLA-FIN-1KG', priceRand: 500, weightG: 500, stockQty: 10 }, db).colours[0];
  const base = {
    items: [{ productId: `filament:pla:${colour.sku}`, quantity: 1 }],
    paymentMethod: 'manual_eft',
    shippingMethod: 'collect',
  };
  const paid = createOrder({ ...base, client: { name: 'A', email: 'a@x.com' } }, db);
  markOrderPaid(paid.id, db);
  createOrder({ ...base, client: { name: 'B', email: 'b@x.com' } }, db); // stays pending -- must NOT count

  const thisMonth = new Date().toISOString().slice(0, 7);
  createExpense({ supplier: 'Eskom', purchaseDate: `${thisMonth}-05`, paymentMethod: 'Cheque ACC', items: [{ description: 'Power', category: 'Operating Costs', quantity: 1, unitPrice: 200 }] }, db);

  const overview = getFinancialOverview({}, db);
  const current = overview.months[overview.months.length - 1];
  assert.strictEqual(current.month, thisMonth);
  assert.strictEqual(current.income, 500);
  assert.strictEqual(current.expenses, 200);
  assert.strictEqual(current.net, 300);
  assert.deepStrictEqual(overview.categories[0], { category: 'Operating Costs', total: 200 });
  assert.deepStrictEqual(overview.paymentMethods[0], { method: 'Cheque ACC', total: 200 });
  assert.strictEqual(overview.taxYears.length, 2);
  const currentTax = overview.taxYears[0];
  assert.strictEqual(currentTax.income, 500);
  assert.strictEqual(currentTax.expenses, 200);
  assert.strictEqual(currentTax.net, 300);
  db.close();
});
