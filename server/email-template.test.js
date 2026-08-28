import { test } from 'node:test';
import assert from 'node:assert';
import { escapeHtml, textToHtml, interpolate, renderButton, renderEmailShell } from './email-template.js';
import { DEFAULT_SETTINGS } from './settings-defaults.js';

test('escapeHtml neutralizes every HTML-significant character', () => {
  assert.strictEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(escapeHtml(`Tom & Jerry's "great" day`), 'Tom &amp; Jerry&#39;s &quot;great&quot; day');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

test('textToHtml escapes content, turns blank lines into paragraphs and single newlines into <br>', () => {
  const out = textToHtml('Hi <there>\nsecond line\n\nnew paragraph');
  assert.strictEqual(out, '<p style="margin:0 0 16px;">Hi &lt;there&gt;<br>second line</p><p style="margin:0 0 16px;">new paragraph</p>');
});

test('textToHtml returns empty string for blank/missing input rather than an empty <p>', () => {
  assert.strictEqual(textToHtml(''), '');
  assert.strictEqual(textToHtml('   '), '');
  assert.strictEqual(textToHtml(undefined), '');
});

test('interpolate substitutes known {{token}}s and blanks out unknown ones rather than leaving them literal', () => {
  assert.strictEqual(interpolate('Hi {{name}}, order {{orderRef}} is ready', { name: 'Jo', orderRef: 'ABC123' }), 'Hi Jo, order ABC123 is ready');
  assert.strictEqual(interpolate('Hi {{name}}, {{missing}} stays blank', { name: 'Jo' }), 'Hi Jo,  stays blank');
});

test('interpolate handles a missing/undefined template string safely', () => {
  assert.strictEqual(interpolate(undefined, { name: 'Jo' }), '');
});

test('renderButton HTML-escapes both the label and the URL', () => {
  const html = renderButton('Reset <Password>', 'https://example.com/?a=1&b="x"');
  assert.ok(html.includes('Reset &lt;Password&gt;'));
  assert.ok(html.includes('https://example.com/?a=1&amp;b=&quot;x&quot;'));
  assert.ok(!html.includes('<Password>'));
});

test('renderEmailShell embeds the body HTML verbatim and escapes settings-derived text', () => {
  const html = renderEmailShell({
    settings: { siteName: 'Lapanza 3D Creative Lab', address: '23 Gladiator Rd <Centurion>', email: 'a@b.com', phoneDisplay: '082' },
    preheader: 'A preview line',
    bodyHtml: '<p>hello world</p>',
  });
  assert.ok(html.includes('<p>hello world</p>'));
  assert.ok(html.includes('23 Gladiator Rd &lt;Centurion&gt;'));
  assert.ok(html.includes('A preview line'));
  assert.ok(html.startsWith('<!DOCTYPE html>'));
});

test('renderEmailShell falls back to sensible defaults when settings fields are missing', () => {
  const html = renderEmailShell({ bodyHtml: '<p>x</p>' });
  assert.ok(html.includes('Lapanza 3D Creative Lab'));
  assert.ok(html.includes('lapanzaonline@gmail.com'));
});

test('DEFAULT_SETTINGS.emailTemplates has a non-empty subject and message for every known template', () => {
  const keys = [
    'passwordReset', 'emailVerification', 'orderConfirmation', 'designRequestStatus',
    'newsletterConfirm', 'lowStockAlert', 'newOrderNotification', 'orderCancelledNotification',
    'newDesignRequestNotification',
  ];
  for (const key of keys) {
    const tpl = DEFAULT_SETTINGS.emailTemplates[key];
    assert.ok(tpl, `missing default template for ${key}`);
    assert.ok(tpl.subject && tpl.subject.trim(), `blank default subject for ${key}`);
    assert.ok(tpl.message && tpl.message.trim(), `blank default message for ${key}`);
  }
});
