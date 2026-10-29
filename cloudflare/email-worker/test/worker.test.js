import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForm, cloudflareAuthResults, dkimField, spfField } from '../src/index.js';

const CF_AUTH =
  'mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601 header.b=abc123; ' +
  'dmarc=pass header.from=gmail.com policy.dmarc=none; ' +
  'spf=pass (mx.cloudflare.net: domain of traveler@gmail.com designates 1.2.3.4 as permitted sender) ' +
  'smtp.mailfrom=traveler@gmail.com; arc=none smtp.remote-ip=1.2.3.4';

function rawEmail({ authResults = [CF_AUTH], from = 'Jo Traveler <traveler@gmail.com>' } = {}) {
  const pdf = Buffer.from('%PDF-1.4 fake booking pdf').toString('base64');
  return [
    ...authResults.map((a) => `Authentication-Results: ${a}`),
    `From: ${from}`,
    'To: bookings@tripseekapp.com',
    'Subject: Fwd: Your booking at Hotel Lumen',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Confirmation 12345 — check-in 3 Nov, Café Lumen',
    '--b1',
    'Content-Type: application/pdf; name="booking.pdf"',
    'Content-Disposition: attachment; filename="booking.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    pdf,
    '--b1--',
    '',
  ].join('\r\n');
}

function fakeMessage(raw, envelopeFrom = 'traveler@gmail.com') {
  return {
    raw: new Blob([raw]).stream(),
    rawSize: raw.length,
    from: envelopeFrom,
    to: 'bookings@tripseekapp.com',
    headers: new Headers({ from: 'Jo Traveler <traveler@gmail.com>', to: 'bookings@tripseekapp.com' }),
  };
}

test('converts Cloudflare results to SendGrid format', () => {
  assert.equal(dkimField([CF_AUTH]), '{@gmail.com : pass}');
  assert.equal(spfField([CF_AUTH]), 'pass');
  assert.equal(dkimField([]), '');
  assert.equal(spfField([]), '');
});

test('only trusts the topmost Authentication-Results, and only from Cloudflare', () => {
  const forged = 'mx.cloudflare.net; dkim=pass header.d=victim.com';
  const real = 'mx.cloudflare.net; dkim=fail header.d=attacker.com; spf=fail';
  const headers = [
    { key: 'authentication-results', value: real },
    { key: 'authentication-results', value: forged },
  ];
  assert.deepEqual(cloudflareAuthResults(headers), [real]);
  assert.deepEqual(cloudflareAuthResults([{ key: 'authentication-results', value: 'evil.example; dkim=pass header.d=gmail.com' }]), []);
});

test('builds the same fields SendGrid Inbound Parse sent', async () => {
  const { form, authFound } = await buildForm(fakeMessage(rawEmail()));
  assert.equal(authFound, true);
  assert.equal(form.get('from'), 'Jo Traveler <traveler@gmail.com>');
  assert.equal(form.get('subject'), 'Fwd: Your booking at Hotel Lumen');
  assert.match(form.get('text'), /Confirmation 12345 — check-in 3 Nov, Café Lumen/);
  assert.deepEqual(JSON.parse(form.get('envelope')), { to: ['bookings@tripseekapp.com'], from: 'traveler@gmail.com' });
  assert.equal(form.get('dkim'), '{@gmail.com : pass}');
  assert.equal(form.get('SPF'), 'pass');

  const info = JSON.parse(form.get('attachment-info'));
  assert.deepEqual(info, { attachment1: { filename: 'booking.pdf', type: 'application/pdf' } });
  const file = form.get('attachment1');
  assert.ok(file instanceof File);
  assert.equal(file.name, 'booking.pdf');
  assert.equal(await file.text(), '%PDF-1.4 fake booking pdf');
});

test('an email Cloudflare did not vouch for gets empty dkim/SPF (the function will ignore it)', async () => {
  const { form, authFound } = await buildForm(fakeMessage(rawEmail({ authResults: [] })));
  assert.equal(authFound, false);
  assert.equal(form.get('dkim'), '');
  assert.equal(form.get('SPF'), '');
});
