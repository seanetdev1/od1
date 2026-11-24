/* WHATSAPP - Meta's Cloud API (graph.facebook.com), the two calls the daily
 * update needs:
 *
 *   uploadMedia   the PDF, to Meta, for a media id - the install is not on the
 *                 internet, so Meta cannot fetch it from a link
 *   sendTemplate  the approved template to one number, the PDF as its
 *                 document header and the day's totals as its variables
 *
 * "Sent" means Meta ACCEPTED the message. Whether it was delivered comes back
 * only through a webhook, which needs the install reachable from the
 * internet - it is not, so it is not asked.
 *
 * `fetchImpl` is for tests; Node's own fetch otherwise.
 */
const GRAPH = 'https://graph.facebook.com';

class WhatsAppError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.code = meta.code;
    this.meta = meta;
  }
}

/* What Meta's commonest refusals mean for whoever set this up. */
const HINTS = {
  190: 'The access token is invalid or has expired - make a new one (a System User\'s permanent token) and save it in Config > WhatsApp.',
  100: 'Meta did not accept a value - check the phone number ID and the template name.',
  131030: 'This number is not on the test number\'s allowed list. While the business number is in test mode, add the number in WhatsApp Manager > API Setup.',
  131026: 'This number cannot receive the message - is it on WhatsApp?',
  131047: 'More than 24 hours since this person last messaged - only an approved template can be sent.',
  132000: 'The template\'s variables do not match - its body must have exactly the six shown in Config > WhatsApp.',
  132001: 'No approved template has that name in that language - check both in WhatsApp Manager.',
  132012: 'The template does not match what was sent - its header must be a Document.',
  133010: 'The business number is not registered with the Cloud API.',
};

const explain = (error, status) => {
  const code = error?.code;
  const sub = error?.error_subcode;
  const hint = HINTS[code] || HINTS[sub];
  const what = error?.error_data?.details || error?.message || `WhatsApp answered ${status}.`;
  return hint ? `${hint} (${what})` : what;
};

const call = async (fetchImpl, url, init) => {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new WhatsAppError(`Could not reach WhatsApp (${e.message}) - is the server online, and can it reach graph.facebook.com?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new WhatsAppError(explain(data?.error, res.status), data?.error || { status: res.status });
  return data;
};

async function uploadMedia({ connection, token, buffer, filename, mime = 'application/pdf', fetchImpl = fetch }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const data = await call(fetchImpl, `${GRAPH}/${connection.apiVersion}/${connection.phoneNumberId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!data.id) throw new WhatsAppError('WhatsApp took the file but gave no media id back.');
  return data.id;
}

/** The message body Meta takes for our template. Exported for tests. */
const templateMessage = ({ to, template, mediaId, filename, bodyParams }) => ({
  messaging_product: 'whatsapp',
  to,
  type: 'template',
  template: {
    name: template.name,
    language: { code: template.language },
    components: [
      ...(mediaId ? [{ type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] }] : []),
      { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) },
    ],
  },
});

async function sendTemplate({ connection, token, fetchImpl = fetch, ...message }) {
  const data = await call(fetchImpl, `${GRAPH}/${connection.apiVersion}/${connection.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(templateMessage(message)),
  });
  return { messageId: data?.messages?.[0]?.id || null };
}

module.exports = { uploadMedia, sendTemplate, templateMessage, WhatsAppError, GRAPH };
