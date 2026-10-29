import { domainOf, domainsAlign, isSenderVerified, passingDkimDomains } from '../../supabase/functions/_shared/email-auth';

describe('domainOf', () => {
  test('extracts the lowercase domain', () => {
    expect(domainOf('Jane@Gmail.com')).toBe('gmail.com');
    expect(domainOf('bounces+abc@em.example.com')).toBe('em.example.com');
  });

  test('returns null for missing or invalid addresses', () => {
    expect(domainOf('')).toBeNull();
    expect(domainOf(null)).toBeNull();
    expect(domainOf('no-at-sign')).toBeNull();
  });
});

describe('domainsAlign', () => {
  test('accepts the same domain and subdomains', () => {
    expect(domainsAlign('gmail.com', 'gmail.com')).toBe(true);
    expect(domainsAlign('mail.example.com', 'example.com')).toBe(true);
  });

  test('rejects look-alike domains', () => {
    expect(domainsAlign('evil-gmail.com', 'gmail.com')).toBe(false);
    expect(domainsAlign('gmail.com.evil.com', 'gmail.com')).toBe(false);
  });
});

describe('passingDkimDomains', () => {
  test('parses SendGrid dkim results', () => {
    expect(passingDkimDomains('{@gmail.com : pass}')).toEqual(['gmail.com']);
    expect(passingDkimDomains('{@example.com : fail, @sendgrid.net : pass}')).toEqual(['sendgrid.net']);
    expect(passingDkimDomains('none')).toEqual([]);
    expect(passingDkimDomains(undefined)).toEqual([]);
  });
});

describe('isSenderVerified', () => {
  test('trusts a DKIM signature from the sender’s own domain', () => {
    expect(isSenderVerified({ senderEmail: 'jane@gmail.com', dkim: '{@gmail.com : pass}', spf: 'pass', envelopeFrom: 'jane@gmail.com' })).toBe(true);
  });

  test('still trusts DKIM after a forwarding service relays the email', () => {
    expect(isSenderVerified({
      senderEmail: 'jane@gmail.com',
      dkim: '{@gmail.com : pass, @improvmx.com : pass}',
      spf: 'pass',
      envelopeFrom: 'srs0=abc=gmail.com=jane@improvmx.com',
    })).toBe(true);
  });

  test('trusts SPF only when the envelope sender matches the From domain', () => {
    expect(isSenderVerified({ senderEmail: 'jo@smallisp.net', dkim: '', spf: 'pass', envelopeFrom: 'jo@smallisp.net' })).toBe(true);
    expect(isSenderVerified({ senderEmail: 'jo@smallisp.net', dkim: '', spf: 'pass', envelopeFrom: 'someone@attacker.io' })).toBe(false);
  });

  test('rejects a faked From address signed by a different domain', () => {
    expect(isSenderVerified({ senderEmail: 'victim@gmail.com', dkim: '{@attacker.io : pass}', spf: 'pass', envelopeFrom: 'x@attacker.io' })).toBe(false);
  });

  test('rejects emails with no passing checks', () => {
    expect(isSenderVerified({ senderEmail: 'jane@gmail.com', dkim: '{@gmail.com : fail}', spf: 'softfail', envelopeFrom: 'jane@gmail.com' })).toBe(false);
    expect(isSenderVerified({ senderEmail: 'jane@gmail.com' })).toBe(false);
  });
});
