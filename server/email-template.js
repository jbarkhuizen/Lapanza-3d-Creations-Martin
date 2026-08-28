// Shared branded HTML shell for every transactional email in server/mailer.js
// (invoice emails keep their own template — server/invoice.js's
// renderInvoiceHtml — since that one doubles as the printable invoice and
// must stay pixel-identical between print and email). Every other email was
// plain-text with a raw link and no branding; this gives them the site's
// actual look (charcoal/terracotta/cream, matching src/styles/main.css)
// while keeping the structural HTML (buttons, tables, disclaimers)
// code-controlled — only the wording (subject/message) is admin-editable,
// via settings.emailTemplates, so an admin can't accidentally break a link
// or drop a security disclaimer.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Admin-authored plain text -> safe paragraph HTML. Blank lines split
// paragraphs, single newlines become <br>, everything is escaped first so a
// stray "<" typed in the admin textarea can't break the email layout.
export function textToHtml(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// {{token}} substitution for admin-editable subject/message strings. Unknown
// tokens resolve to '' rather than being left literally in the sent email.
export function interpolate(template, vars = {}) {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ''));
}

export function renderButton(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr><td style="border-radius:999px;background:#c24b28;">
  <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 30px;color:#f7f3eb;text-decoration:none;font-weight:600;font-size:14px;border-radius:999px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

// bodyHtml is trusted (built from code + escaped/interpolated admin text
// above), never raw admin/user input passed straight through.
export function renderEmailShell({ settings = {}, preheader = '', bodyHtml }) {
  const siteName = settings.siteName || 'Lapanza 3D Creative Lab';
  const address = settings.address || '23 Gladiator Rd, Pierre van Ryneveld, Centurion';
  const email = settings.email || 'lapanzaonline@gmail.com';
  const phone = settings.phoneDisplay || '082 663 9608';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(siteName)}</title>
</head>
<body style="margin:0;padding:0;background:#efe7d8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3eb;border-radius:6px;overflow:hidden;border:1px solid #e5dcc9;">
    <tr><td style="background:#1a1612;padding:28px 32px;text-align:center;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:#f7f3eb;letter-spacing:-0.02em;">${escapeHtml(siteName.replace(/\s*3D\s*Creative Lab\s*$/i, ''))} <span style="color:#c24b28;">3D</span></span>
    </td></tr>
    <tr><td style="padding:32px;color:#1a1612;font-size:15px;line-height:1.6;">
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:20px 32px;border-top:1px solid #e5dcc9;color:#3b322b;font-size:12px;line-height:1.6;">
      ${escapeHtml(siteName)} &middot; ${escapeHtml(address)}<br>
      ${escapeHtml(email)} &middot; ${escapeHtml(phone)}
    </td></tr>
  </table>
</div>
</body>
</html>`;
}
