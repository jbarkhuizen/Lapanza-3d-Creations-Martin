import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeImportedHtml, renderBlocks } from './newsletter-content.js';

test('sanitizeImportedHtml strips an UNQUOTED event handler (the exact bypass the old regex sanitizer missed)', () => {
  const { bodyHtml } = sanitizeImportedHtml('<p>Hi</p><img src=x onerror=alert(1)>');
  assert.ok(!/onerror/i.test(bodyHtml), 'onerror attribute must be removed regardless of quoting');
  assert.ok(!/alert\(1\)/.test(bodyHtml));
});

test('sanitizeImportedHtml strips <script> tags and their contents', () => {
  const { bodyHtml, bodyText } = sanitizeImportedHtml('<p>Hello</p><script>alert(document.cookie)</script>');
  assert.ok(!/script/i.test(bodyHtml));
  assert.ok(!/alert/.test(bodyHtml));
  assert.ok(!/alert/.test(bodyText));
});

test('sanitizeImportedHtml strips <style> blocks and does not leak their CSS text as body content', () => {
  const { bodyHtml, bodyText } = sanitizeImportedHtml('<style>body{display:none}</style><p>Visible</p>');
  assert.ok(!/display:none/.test(bodyHtml));
  assert.ok(!/display:none/.test(bodyText));
  assert.ok(/Visible/.test(bodyHtml));
});

test('sanitizeImportedHtml drops iframe/object/embed/form tags', () => {
  const { bodyHtml } = sanitizeImportedHtml('<p>Ok</p><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input></form>');
  assert.ok(!/<iframe/i.test(bodyHtml));
  assert.ok(!/<form/i.test(bodyHtml));
  assert.ok(!/<input/i.test(bodyHtml));
});

test('sanitizeImportedHtml rejects javascript: URIs on links and images', () => {
  const { bodyHtml } = sanitizeImportedHtml('<a href="javascript:alert(1)">click</a><img src="javascript:alert(1)">');
  assert.ok(!/javascript:/i.test(bodyHtml));
});

test('sanitizeImportedHtml rejects data: URIs on images (kept consistent with renderBlocks\' http(s)-only image policy)', () => {
  const { bodyHtml } = sanitizeImportedHtml('<p>Newsletter</p><img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">');
  assert.ok(!/data:/i.test(bodyHtml));
});

test('sanitizeImportedHtml keeps ordinary email-template markup (tables, inline styles, real links/images)', () => {
  const input = '<table width="600" cellpadding="0"><tr><td style="padding:10px" bgcolor="#ffffff"><h1>Sale</h1><p>Hello <strong>there</strong></p><a href="https://example.com/shop">Shop now</a><img src="https://example.com/banner.jpg" alt="Banner"></td></tr></table>';
  const { bodyHtml, bodyText } = sanitizeImportedHtml(input);
  assert.ok(bodyHtml.includes('<table'));
  assert.ok(bodyHtml.includes('href="https://example.com/shop"'));
  assert.ok(bodyHtml.includes('src="https://example.com/banner.jpg"'));
  assert.ok(bodyText.includes('Shop now'));
});

test('sanitizeImportedHtml throws when nothing readable survives sanitization', () => {
  assert.throws(() => sanitizeImportedHtml('<script>alert(1)</script>'), /no readable content/);
  assert.throws(() => sanitizeImportedHtml(''), /no readable content/);
});

test('renderBlocks is unaffected by the sanitizer change (separate code path)', () => {
  const { bodyHtml } = renderBlocks([{ type: 'heading', text: 'Hi' }]);
  assert.ok(bodyHtml.includes('Hi'));
});
