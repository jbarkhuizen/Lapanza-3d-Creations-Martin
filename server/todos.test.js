import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listTodos, getTodo, createTodo, updateTodo, TODO_CATEGORIES, TODO_PRIORITIES, TODO_STATUSES } from './todos.js';

test('a fresh database is seeded with the known-limitations backlog automatically', () => {
  const db = openDb(':memory:');
  const todos = listTodos(db);
  assert.strictEqual(todos.length, 13);
  assert.ok(todos.every((t) => TODO_CATEGORIES.includes(t.category)));
  assert.ok(todos.every((t) => TODO_PRIORITIES.includes(t.priority)));
  assert.ok(todos.every((t) => TODO_STATUSES.includes(t.status)));
  assert.ok(todos.some((t) => t.name.includes('Privacy Policy')));
  db.close();
});

test('createTodo requires a name', () => {
  const db = openDb(':memory:');
  assert.throws(() => createTodo({ description: 'no name given' }, db), /Name is required/);
  db.close();
});

test('createTodo defaults invalid category, priority, and status rather than rejecting the request', () => {
  const db = openDb(':memory:');
  const todo = createTodo({ name: 'Something', category: 'Nonsense', priority: 'Nonsense', status: 'Nonsense' }, db);
  assert.strictEqual(todo.category, 'Feature');
  assert.strictEqual(todo.priority, 'Medium');
  assert.strictEqual(todo.status, 'Backlog');
  db.close();
});

test('createTodo and updateTodo retain a valid priority', () => {
  const db = openDb(':memory:');
  const todo = createTodo({ name: 'Urgent task', priority: 'Critical' }, db);
  assert.strictEqual(todo.priority, 'Critical');

  const updated = updateTodo(todo.id, { priority: 'Low' }, db);
  assert.strictEqual(updated.priority, 'Low');
  db.close();
});

test('createTodo assigns sequential numbers continuing from the seeded items', () => {
  const db = openDb(':memory:');
  const before = listTodos(db).length;
  const todo = createTodo({ name: 'New idea', category: 'Feature' }, db);
  assert.strictEqual(todo.number, before + 1);
  db.close();
});

test('listTodos returns newest first', () => {
  const db = openDb(':memory:');
  // Both dates set well into the future relative to the seeded items'
  // (real "now") dateAdded, so this is unaffected by whenever the test
  // actually runs.
  const a = createTodo({ name: 'Older', dateAdded: '2030-01-01T00:00:00.000Z' }, db);
  const b = createTodo({ name: 'Newer', dateAdded: '2031-01-01T00:00:00.000Z' }, db);
  const todos = listTodos(db);
  assert.strictEqual(todos[0].id, b.id);
  assert.ok(todos.findIndex((t) => t.id === a.id) > todos.findIndex((t) => t.id === b.id));
  db.close();
});

test('updateTodo auto-stamps actualFixDate when status moves to Done, unless already set', () => {
  const db = openDb(':memory:');
  const todo = createTodo({ name: 'Fix the thing', status: 'In Progress' }, db);
  assert.strictEqual(todo.actualFixDate, null);

  const done = updateTodo(todo.id, { status: 'Done' }, db);
  assert.ok(done.actualFixDate);

  // An explicit actualFixDate on the same call is respected, not overridden.
  const todo2 = createTodo({ name: 'Fix another thing', status: 'In Progress' }, db);
  const done2 = updateTodo(todo2.id, { status: 'Done', actualFixDate: '2026-01-01T00:00:00.000Z' }, db);
  assert.strictEqual(done2.actualFixDate, '2026-01-01T00:00:00.000Z');
  db.close();
});

test('updateTodo also auto-stamps actualFixDate when status moves to Claude Fix', () => {
  const db = openDb(':memory:');
  const todo = createTodo({ name: 'Fix the thing', status: 'Backlog' }, db);
  assert.strictEqual(todo.actualFixDate, null);
  const fixed = updateTodo(todo.id, { status: 'Claude Fix' }, db);
  assert.ok(fixed.actualFixDate);
  db.close();
});

test('updateTodo edits fields without touching status', () => {
  const db = openDb(':memory:');
  const todo = createTodo({ name: 'Original name', category: 'Bug', description: 'Original desc' }, db);
  const updated = updateTodo(todo.id, { name: 'Renamed', description: 'New desc' }, db);
  assert.strictEqual(updated.name, 'Renamed');
  assert.strictEqual(updated.description, 'New desc');
  assert.strictEqual(updated.status, 'Backlog');
  assert.strictEqual(updated.category, 'Bug');
  db.close();
});

test('updateTodo returns null for an unknown id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(updateTodo('bogus-id', { name: 'x' }, db), null);
  db.close();
});

test('getTodo returns null for an unknown id', () => {
  const db = openDb(':memory:');
  assert.strictEqual(getTodo('bogus-id', db), null);
  db.close();
});
