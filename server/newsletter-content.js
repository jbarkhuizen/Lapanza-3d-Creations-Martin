import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const escape = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeUrl = (value) => /^(https?:\/\/|\/uploads\/)/i.test(String(value || '').trim()) ? String(value).trim() : '';

export function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) throw new Error('Add at least one content block');
  if (blocks.length > 40) throw new Error('A newsletter may contain at most 40 blocks');
  const text = [];
  const html = blocks.map((block) => {
    const value = String(block.text || '').trim();
    if (block.type === 'heading') { text.push(value); return `<h1 style="font:700 28px Arial,sans-serif;color:#12100e;margin:0 0 18px">${escape(value)}</h1>`; }
    if (block.type === 'text') { text.push(value); return `<p style="font:16px/1.6 Arial,sans-serif;color:#38332d;margin:0 0 16px">${escape(value).replace(/\n/g, '<br>')}</p>`; }
    if (block.type === 'image') { const url = safeUrl(block.url); if (!url) throw new Error('Image blocks need a valid uploaded image URL'); return `<img src="${escape(url)}" alt="${escape(block.alt || '')}" style="display:block;max-width:100%;height:auto;margin:0 0 18px;border:0">`; }
    if (block.type === 'button') { const url = safeUrl(block.url); if (!url || !value) throw new Error('Button blocks need text and a valid URL'); text.push(`${value}: ${url}`); return `<p style="margin:0 0 20px"><a href="${escape(url)}" style="display:inline-block;background:#b7410e;color:#fff;padding:13px 20px;border-radius:6px;font:700 16px Arial,sans-serif;text-decoration:none">${escape(value)}</a></p>`; }
    if (block.type === 'divider') return '<hr style="border:0;border-top:1px solid #ddd4ca;margin:24px 0">';
    throw new Error('Unsupported newsletter block');
  }).join('');
  return { bodyHtml: `<div style="max-width:640px;margin:auto;padding:28px;background:#fffaf4">${html}</div>`, bodyText: text.filter(Boolean).join('\n\n') };
}

export function listTemplates(db = getDb()) {
  return db.prepare('SELECT id, name, subject, blocks_json AS blocksJson, body_html AS bodyHtml, body_text AS bodyText, created_at AS createdAt FROM newsletter_templates ORDER BY created_at DESC').all()
    .map((row) => ({ ...row, blocks: JSON.parse(row.blocksJson || '[]') }));
}

export function createTemplate({ name, subject = '', blocks }, db = getDb()) {
  if (!String(name).trim()) throw new Error('Template name is required');
  const content = renderBlocks(blocks);
  const id = randomUUID();
  db.prepare('INSERT INTO newsletter_templates (id, name, subject, blocks_json, body_html, body_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, String(name).trim(), String(subject).trim(), JSON.stringify(blocks), content.bodyHtml, content.bodyText, new Date().toISOString());
  return listTemplates(db).find((template) => template.id === id);
}

export function sanitizeImportedHtml(value) {
  const bodyHtml = String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
  const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!bodyText) throw new Error('Imported template has no readable content');
  return { bodyHtml, bodyText };
}

export function createImportedTemplate({ name, subject = '', html }, db = getDb()) {
  if (!String(name).trim()) throw new Error('Template name is required');
  const content = sanitizeImportedHtml(html);
  const id = randomUUID();
  db.prepare('INSERT INTO newsletter_templates (id, name, subject, blocks_json, body_html, body_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, String(name).trim(), String(subject).trim(), '[]', content.bodyHtml, content.bodyText, new Date().toISOString());
  return listTemplates(db).find((template) => template.id === id);
}
