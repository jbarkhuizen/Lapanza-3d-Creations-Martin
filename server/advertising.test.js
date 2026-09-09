import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import {
  listPlatforms,
  getPlatform,
  createPlatform,
  updatePlatform,
  deletePlatform,
  listPlatformGroups,
  getPlatformGroup,
  createPlatformGroup,
  updatePlatformGroup,
  deletePlatformGroup,
  listAdverts,
  getAdvert,
  createAdvert,
  updateAdvert,
  deleteAdvert,
} from './advertising.js';

test('the 7 owner-specified platforms are seeded on boot, in order, with the right groups flagged', () => {
  const db = openDb(':memory:');
  const platforms = listPlatforms({}, db);
  assert.deepStrictEqual(
    platforms.map((p) => [p.name, p.hasGroups]),
    [
      ['Facebook', false],
      ['Facebook Groups', true],
      ['TikTok', false],
      ['Direct Email', false],
      ['Direct WhatsApp', false],
      ['Instagram', false],
      ['WhatsApp Groups', true],
    ],
  );
  db.close();
});

test('createPlatform requires a name; new platforms are configurable per owner decision', () => {
  const db = openDb(':memory:');
  assert.throws(() => createPlatform({ name: '' }, db), /name is required/);
  const platform = createPlatform({ name: 'Pinterest', hasGroups: false, notes: 'test board rules' }, db);
  assert.strictEqual(platform.name, 'Pinterest');
  assert.strictEqual(platform.active, true);
  assert.strictEqual(listPlatforms({}, db).length, 8);
  db.close();
});

test('updatePlatform edits fields; deletePlatform retires only unreferenced platforms', () => {
  const db = openDb(':memory:');
  const platform = createPlatform({ name: 'Pinterest' }, db);
  const updated = updatePlatform(platform.id, { notes: 'post 3x a week', active: false }, db);
  assert.strictEqual(updated.notes, 'post 3x a week');
  assert.strictEqual(updated.active, false);

  createAdvert({ platformId: platform.id, publishDate: '2026-09-15', durationDays: 2 }, db);
  assert.throws(() => deletePlatform(platform.id, db), /has scheduled adverts/);

  const untouched = createPlatform({ name: 'Snapchat' }, db);
  assert.strictEqual(deletePlatform(untouched.id, db), true);
  assert.strictEqual(getPlatform(untouched.id, db), null);
  db.close();
});

test('platform groups (Facebook Groups / WhatsApp Groups) capture name, allowed days, and notes', () => {
  const db = openDb(':memory:');
  const fbGroups = listPlatforms({}, db).find((p) => p.name === 'Facebook Groups');
  assert.throws(() => createPlatformGroup(fbGroups.id, { groupName: '' }, db), /name is required/);

  const group = createPlatformGroup(
    fbGroups.id,
    { groupName: '3D Printing SA', allowedDays: ['Mon', 'Wed', 'Fri', 'NotADay'], notes: 'no direct links' },
    db,
  );
  assert.strictEqual(group.groupName, '3D Printing SA');
  assert.deepStrictEqual(group.allowedDays, ['Mon', 'Wed', 'Fri']);
  assert.strictEqual(group.notes, 'no direct links');
  assert.strictEqual(listPlatformGroups(fbGroups.id, db).length, 1);

  const updated = updatePlatformGroup(group.id, { allowedDays: ['Sat', 'Sun'] }, db);
  assert.deepStrictEqual(updated.allowedDays, ['Sat', 'Sun']);

  assert.strictEqual(deletePlatformGroup(group.id, db), true);
  assert.strictEqual(getPlatformGroup(group.id, db), null);
  db.close();
});

test('createAdvert validates platform/date/duration and computes an inclusive end date', () => {
  const db = openDb(':memory:');
  const [facebook] = listPlatforms({}, db);
  assert.throws(() => createAdvert({ platformId: 'missing', publishDate: '2026-09-15' }, db), /Platform not found/);
  assert.throws(() => createAdvert({ platformId: facebook.id, publishDate: '' }, db), /Publish date is required/);

  const oneDay = createAdvert({ platformId: facebook.id, publishDate: '2026-09-15' }, db);
  assert.strictEqual(oneDay.durationDays, 1);
  assert.strictEqual(oneDay.endDate, '2026-09-15');

  const threeDay = createAdvert({ platformId: facebook.id, publishDate: '2026-09-15', durationDays: 3, caption: 'Spring sale' }, db);
  assert.strictEqual(threeDay.endDate, '2026-09-17');
  assert.strictEqual(threeDay.platformName, 'Facebook');
  db.close();
});

test('listAdverts({from,to}) returns adverts whose run window overlaps the range, for the calendar agenda', () => {
  const db = openDb(':memory:');
  const [facebook] = listPlatforms({}, db);
  createAdvert({ platformId: facebook.id, publishDate: '2026-09-01', durationDays: 2 }, db); // ends 09-02, before window
  const inWindow = createAdvert({ platformId: facebook.id, publishDate: '2026-09-10', durationDays: 3 }, db); // 09-10..09-12
  const spanning = createAdvert({ platformId: facebook.id, publishDate: '2026-09-14', durationDays: 10 }, db); // 09-14..09-23, starts inside window but runs past it
  createAdvert({ platformId: facebook.id, publishDate: '2026-10-01' }, db); // well after window

  const results = listAdverts({ from: '2026-09-05', to: '2026-09-15' }, db);
  const ids = results.map((a) => a.id);
  assert.ok(ids.includes(inWindow.id));
  assert.ok(ids.includes(spanning.id));
  assert.strictEqual(results.length, 2);
  db.close();
});

test('updateAdvert re-validates changed fields; deleteAdvert removes the row', () => {
  const db = openDb(':memory:');
  const [facebook, fbGroups] = listPlatforms({}, db);
  const advert = createAdvert({ platformId: facebook.id, publishDate: '2026-09-15' }, db);
  const moved = updateAdvert(advert.id, { platformId: fbGroups.id, durationDays: 5 }, db);
  assert.strictEqual(moved.platformName, 'Facebook Groups');
  assert.strictEqual(moved.endDate, '2026-09-19');
  assert.throws(() => updateAdvert(advert.id, { publishDate: '' }, db), /Publish date is required/);

  assert.strictEqual(deleteAdvert(advert.id, db), true);
  assert.strictEqual(getAdvert(advert.id, db), null);
  db.close();
});
