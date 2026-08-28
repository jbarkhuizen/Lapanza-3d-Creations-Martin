import { test } from 'node:test';
import assert from 'node:assert';
import { openDb } from './db.js';
import { listTestimonials, getTestimonial, createTestimonial, updateTestimonial, deleteTestimonial, publicTestimonial } from './testimonials.js';

function basePayload(overrides = {}) {
  return { customerName: 'Jane Real Name', displayName: 'Jane D.', quote: 'Fast and friendly service.', ...overrides };
}

test('createTestimonial defaults to draft and stores customerName/displayName separately', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload(), db);
  assert.strictEqual(t.status, 'draft');
  assert.strictEqual(t.customerName, 'Jane Real Name');
  assert.strictEqual(t.displayName, 'Jane D.');
  db.close();
});

test('createTestimonial refuses to publish without consentGiven -- the actual privacy guard backlog #51 asked for', () => {
  const db = openDb(':memory:');
  assert.throws(() => createTestimonial(basePayload({ status: 'published', consentGiven: false }), db), /consent/i);
  db.close();
});

test('createTestimonial allows publishing when consentGiven is true', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload({ status: 'published', consentGiven: true }), db);
  assert.strictEqual(t.status, 'published');
  assert.strictEqual(t.consentGiven, true);
  db.close();
});

test('updateTestimonial refuses to flip an existing draft to published without consent, even if consent was never set', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload(), db); // draft, no consent
  assert.throws(() => updateTestimonial(t.id, { status: 'published' }, db), /consent/i);
  db.close();
});

test('updateTestimonial allows publishing once consentGiven is set in the same update', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload(), db);
  const updated = updateTestimonial(t.id, { status: 'published', consentGiven: true }, db);
  assert.strictEqual(updated.status, 'published');
  db.close();
});

test('updateTestimonial allows publishing when consent was already on file from an earlier save', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload({ consentGiven: true }), db); // draft, consent already recorded
  const updated = updateTestimonial(t.id, { status: 'published' }, db); // no consentGiven in THIS payload
  assert.strictEqual(updated.status, 'published');
  db.close();
});

test('listTestimonials filters by status and orders by sort order then newest first', () => {
  const db = openDb(':memory:');
  createTestimonial(basePayload({ displayName: 'Second', sortOrder: 1, status: 'published', consentGiven: true }), db);
  createTestimonial(basePayload({ displayName: 'First', sortOrder: 0, status: 'published', consentGiven: true }), db);
  createTestimonial(basePayload({ displayName: 'Draft one' }), db);

  const published = listTestimonials({ status: 'published' }, db);
  assert.strictEqual(published.length, 2);
  assert.strictEqual(published[0].displayName, 'First');
  assert.strictEqual(published[1].displayName, 'Second');

  const all = listTestimonials({}, db);
  assert.strictEqual(all.length, 3);
  db.close();
});

test('deleteTestimonial removes the row and getTestimonial returns null afterward', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload(), db);
  assert.strictEqual(deleteTestimonial(t.id, db), true);
  assert.strictEqual(getTestimonial(t.id, db), null);
  db.close();
});

test('publicTestimonial never leaks customerName or consentNote -- the whole point of keeping them separate from displayName', () => {
  const db = openDb(':memory:');
  const t = createTestimonial(basePayload({ customerName: 'Real Full Name', consentNote: 'WhatsApp message 2026-08-28', linkUrl: '/car-parts/gwm.html', linkLabel: 'GWM Cup Holder', imagePath: '/uploads/testimonials/abc.jpg' }), db);
  const pub = publicTestimonial(t);
  assert.deepStrictEqual(Object.keys(pub).sort(), ['date', 'displayName', 'id', 'imageUrl', 'linkLabel', 'linkUrl', 'quote'].sort());
  assert.strictEqual(pub.displayName, 'Jane D.');
  assert.ok(!JSON.stringify(pub).includes('Real Full Name'));
  assert.ok(!JSON.stringify(pub).includes('WhatsApp message'));
  db.close();
});
