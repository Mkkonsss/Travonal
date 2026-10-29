/**
 * Tripseek booking email worker (Cloudflare Email Routing → Supabase).
 *
 * bookings@tripseekapp.com is routed to this worker. It re-sends each email to the
 * inbound-booking edge function in the same multipart format SendGrid Inbound Parse used,
 * so the function didn't need to change:
 *   from, to, subject, text, html, envelope, dkim, SPF, attachment-info + attachment1..N
 *
 * dkim / SPF come from the Authentication-Results header Cloudflare adds when it receives
 * the email, converted to SendGrid's format ("{@gmail.com : pass}", "pass").
 *
 * Secrets: INBOUND_URL (the inbound-booking URL including ?secret=...).
 */

import PostalMime from 'postal-mime';

// Cloudflare's own receiving servers identify themselves with this in Authentication-Results
const CLOUDFLARE_AUTHSERV = /(^|\s|;)(mx\.cloudflare\.net|[a-z0-9.-]*\.mx\.cloudflare\.net)\s*;/i;

const MAX_EMAIL_BYTES = 20 * 1024 * 1024;

/**
 * The Authentication-Results header Cloudflare added. Receiving servers add theirs at the top,
 * so only the topmost one counts — anything further down could have been written by the sender.
 * `headers` is the ordered [{ key, value }] list from postal-mime.
 */
export function cloudflareAuthResults(headers) {
  const first = headers.find((h) => h.key.toLowerCase() === 'authentication-results');
  return first && CLOUDFLARE_AUTHSERV.test(first.value) ? [first.value] : [];
}

/** "dkim=pass header.d=gmail.com" → "{@gmail.com : pass}" (SendGrid's dkim field). */
export function dkimField(authResults) {
  const entries = [];
  for (const header of authResults) {
    for (const match of header.matchAll(/dkim=([a-z]+)[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/gi)) {
      entries.push(`@${match[2].toLowerCase()} : ${match[1].toLowerCase()}`);
    }
  }
  return entries.length ? `{${entries.join(', ')}}` : '';
}

/** "spf=pass smtp.mailfrom=..." → "pass" (SendGrid's SPF field). */
export function spfField(authResults) {
  for (const header of authResults) {
    const match = header.match(/spf=([a-z]+)/i);
    if (match) return match[1].toLowerCase();
  }
  return '';
}

export async function buildForm(message) {
  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw);
  const auth = cloudflareAuthResults(email.headers ?? []);

  const form = new FormData();
  form.append('from', message.headers.get('from') ?? message.from);
  form.append('to', message.headers.get('to') ?? message.to);
  form.append('subject', email.subject ?? '');
  form.append('text', email.text ?? '');
  form.append('html', email.html ?? '');
  form.append('envelope', JSON.stringify({ to: [message.to], from: message.from }));
  form.append('dkim', dkimField(auth));
  form.append('SPF', spfField(auth));

  const info = {};
  (email.attachments ?? []).forEach((attachment, i) => {
    const key = `attachment${i + 1}`;
    const filename = attachment.filename ?? key;
    const type = attachment.mimeType ?? 'application/octet-stream';
    info[key] = { filename, type };
    form.append(key, new Blob([attachment.content], { type }), filename);
  });
  if (Object.keys(info).length) form.append('attachment-info', JSON.stringify(info));

  return { form, authFound: auth.length > 0 };
}

export default {
  async email(message, env) {
    if (message.rawSize > MAX_EMAIL_BYTES) {
      message.setReject('Message too large');
      return;
    }
    const { form, authFound } = await buildForm(message);
    if (!authFound) console.warn('[booking-email] no Cloudflare Authentication-Results header found');
    else console.log('[booking-email] dkim:', form.get('dkim'), 'spf:', form.get('SPF'));

    const resp = await fetch(env.INBOUND_URL, { method: 'POST', body: form });
    if (!resp.ok) {
      // Throwing makes Cloudflare return a temporary failure, so the sender's server retries
      throw new Error(`inbound-booking responded ${resp.status}`);
    }
  },
};
