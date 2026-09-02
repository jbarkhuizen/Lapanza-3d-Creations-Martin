// #139: canonical rich-text handling for product descriptions.
//
// Admin editors submit limited HTML (bold/italic/underline/strikethrough,
// h3/h4, lists, links). sanitizeRichText() is the ONLY thing that decides
// what of it survives, and it runs at every save path (filament
// description/colourNote, category description, item details) AND again in
// the page generator — save-time keeps stored data clean, render-time makes
// pre-#139 legacy values safe (descriptions used to be interpolated into
// public HTML completely unescaped).
//
// The sanitizer RECONSTRUCTS output rather than filtering input: text is
// entity-decoded then re-escaped (idempotent), and only allowlisted tags are
// re-emitted in canonical form with no attributes — except <a>, which keeps
// an http(s)-only href and gains rel/target. Everything else (attributes,
// event handlers, scripts, comments, unknown tags) is dropped while its
// inner text is kept.

const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 's', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote']);
const ALIAS = { b: 'strong', i: 'em', strike: 's', del: 's', div: 'p' };

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeRichText(input) {
  const source = String(input ?? '');
  if (!source.trim()) return '';
  // Comments and CDATA can hide "<" from the tag tokenizer — remove first.
  const cleaned = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  let out = '';
  const stack = [];
  for (const token of cleaned.split(/(<[^>]*>)/)) {
    if (!token) continue;
    if (token[0] !== '<' || token[token.length - 1] !== '>') {
      // Plain text (including any stray "<" that never closed).
      out += escapeText(decodeEntities(token));
      continue;
    }
    const tag = /^<\s*(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([\s\S]*?)\/?\s*>$/.exec(token);
    if (!tag) continue; // <!doctype>, <?…?>, malformed — drop the tag itself
    const closing = tag[1] === '/';
    const name = ALIAS[tag[2].toLowerCase()] || tag[2].toLowerCase();
    if (!ALLOWED.has(name)) continue; // drop tag, keep surrounding text
    if (closing) {
      const openedAt = stack.lastIndexOf(name);
      if (openedAt === -1) continue; // orphan close (or its open was dropped)
      while (stack.length > openedAt) out += `</${stack.pop()}>`;
      continue;
    }
    if (name === 'br') {
      out += '<br>';
      continue;
    }
    if (name === 'a') {
      const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[3]);
      const href = (hrefMatch ? hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] : '').trim();
      if (!/^https?:\/\//i.test(href)) continue; // no valid http(s) href → drop the link, keep its text
      out += `<a href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" rel="noopener noreferrer" target="_blank">`;
      stack.push('a');
      continue;
    }
    out += `<${name}>`;
    stack.push(name);
  }
  while (stack.length) out += `</${stack.pop()}>`;
  // Editors leave empty paragraphs behind; collapse the fully-empty result.
  return /^(?:<p>(?:\s|<br>)*<\/p>|\s)*$/.test(out) ? '' : out;
}

// Plain-text projection for the places markup must never reach: meta
// descriptions, JSON-LD, search/filter indexes. Returns UNESCAPED text —
// callers embedding it in attributes keep using their own escaping
// (escapeAttr etc), same as before #139.
export function stripTags(input) {
  return decodeEntities(String(input ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
