import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getDb } from './db.js';

export function hasAnyAdmin(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0;
}

export function listAdmins(db = getDb()) {
  return db.prepare('SELECT id, username, created_at FROM admins ORDER BY created_at ASC').all();
}

// One password rule for every path that sets an admin password. The 8+
// minimum previously existed only on the first-run /api/setup route, so
// "add admin" and "reset password" happily accepted a 1-character password
// on the account guarding the entire back office (launch-audit finding).
// Matches resetClientPassword's customer-side rule.
const MIN_PASSWORD_LENGTH = 8;
function assertPasswordAllowed(password) {
  if (!password) throw new Error('Password required');
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export function createAdmin({ username, password }, db = getDb()) {
  if (!username) throw new Error('Username and password required');
  assertPasswordAllowed(password);
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) throw new Error('Username already taken');
  const admin = {
    id: randomUUID(),
    username,
    password_hash: bcrypt.hashSync(password, 10),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    'INSERT INTO admins (id, username, password_hash, created_at) VALUES (@id, @username, @password_hash, @created_at)',
  ).run(admin);
  return { id: admin.id, username: admin.username, created_at: admin.created_at };
}

export function deleteAdmin(id, db = getDb()) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count <= 1) throw new Error('Cannot remove the last admin account');
  const result = db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  return result.changes > 0;
}

export function resetPassword(id, password, db = getDb()) {
  assertPasswordAllowed(password);
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
  return result.changes > 0;
}

export function verifyLogin(username, password, db = getDb()) {
  const row = db.prepare('SELECT id, password_hash FROM admins WHERE username = ?').get(username);
  if (!row) return null;
  return bcrypt.compareSync(password, row.password_hash) ? { id: row.id, username } : null;
}
