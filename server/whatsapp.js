// Meta WhatsApp Business Cloud API. Business-initiated messages outside a
// customer's live 24h session must use a template Meta has pre-approved --
// free-text broadcast isn't permitted by WhatsApp's own rules, which is why
// this only ever sends templates (name + {{1}}/{{2}}... parameters), never
// a plain message body.
const GRAPH_API_VERSION = 'v20.0';

// Lazy check (not at import time) -- mirrors mailer.js's getTransporter(),
// so booting the server without these set (e.g. running tests) doesn't throw.
function requireCredentials() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error(
      'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set — WhatsApp campaigns cannot be sent. Complete Meta WhatsApp Business Cloud API setup (Business Account, verified number, access token, phone-number-ID, an approved message template) first.',
    );
  }
  return { accessToken, phoneNumberId };
}

export function isWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsAppTemplate({ to, templateName, params = [] }) {
  const { accessToken, phoneNumberId } = requireCredentials();
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }]
          : [],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatsApp send failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}
