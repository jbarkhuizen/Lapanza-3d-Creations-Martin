import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeRichText, stripTags } from './rich-text.js';

test('sanitizeRichText keeps the allowed formatting set and canonicalizes aliases', () => {
  assert.strictEqual(
    sanitizeRichText('<p>Hi <b>bold</b> <i>italic</i> <u>under</u> <strike>gone</strike></p>'),
    '<p>Hi <strong>bold</strong> <em>italic</em> <u>under</u> <s>gone</s></p>',
  );
  assert.strictEqual(
    sanitizeRichText('<h3>Head</h3><ul><li>one</li><li>two</li></ul>'),
    '<h3>Head</h3><ul><li>one</li><li>two</li></ul>',
  );
});

test('sanitizeRichText drops scripts, event handlers, styles and unknown tags but keeps their text', () => {
  assert.strictEqual(sanitizeRichText('<script>alert(1)</script>hello'), 'alert(1)hello');
  assert.strictEqual(sanitizeRichText('<p onclick="steal()">safe</p>'), '<p>safe</p>');
  assert.strictEqual(sanitizeRichText('<span style="color:red">tinted</span> text'), 'tinted text');
  assert.strictEqual(sanitizeRichText('<img src=x onerror=alert(1)>after'), 'after');
  assert.strictEqual(sanitizeRichText('<!-- sneaky --><p>kept</p>'), '<p>kept</p>');
});

test('sanitizeRichText only keeps http(s) links, in canonical form', () => {
  assert.strictEqual(
    sanitizeRichText('<a href="https://example.com/x">site</a>'),
    '<a href="https://example.com/x" rel="noopener noreferrer" target="_blank">site</a>',
  );
  // javascript: and relative hrefs lose the link but keep the label text
  assert.strictEqual(sanitizeRichText('<a href="javascript:alert(1)">click</a>'), 'click');
  assert.strictEqual(sanitizeRichText('<a href="/local">local</a>'), 'local');
  assert.strictEqual(sanitizeRichText('<a>no href</a>'), 'no href');
});

test('sanitizeRichText balances tags: closes unclosed ones, drops orphan closes', () => {
  assert.strictEqual(sanitizeRichText('<p><strong>open'), '<p><strong>open</strong></p>');
  assert.strictEqual(sanitizeRichText('text</strong></p>'), 'text');
  assert.strictEqual(sanitizeRichText('<ul><li>a<li>b</ul>'), '<ul><li>a<li>b</li></li></ul>');
});

test('sanitizeRichText is idempotent and keeps plain text plain', () => {
  const rich = '<p>R 250 &amp; up — <strong>PLA</strong></p>';
  assert.strictEqual(sanitizeRichText(sanitizeRichText(rich)), sanitizeRichText(rich));
  // legacy plain-text descriptions with a literal < or & survive as text
  assert.strictEqual(sanitizeRichText('walls < 1.2mm need care & attention'), 'walls &lt; 1.2mm need care &amp; attention');
  assert.strictEqual(sanitizeRichText(''), '');
  assert.strictEqual(sanitizeRichText('   '), '');
  assert.strictEqual(sanitizeRichText('<p><br></p>'), '');
});

test('stripTags flattens markup to searchable/meta-safe plain text', () => {
  assert.strictEqual(stripTags('<h3>Tough</h3><p>Prints <strong>fast</strong>.</p>'), 'Tough Prints fast .');
  assert.strictEqual(stripTags('a &amp; b &lt;c&gt;'), 'a & b <c>');
  assert.strictEqual(stripTags(''), '');
  assert.strictEqual(stripTags(null), '');
});
