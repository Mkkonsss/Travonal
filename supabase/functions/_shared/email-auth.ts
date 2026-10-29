/**
 * Sender verification for forwarded booking emails.
 *
 * The "From" header is easy to fake, so before trusting it to decide whose account a booking
 * goes into we require proof from the sender's mail provider:
 *   - a passing DKIM signature for the sender's domain (this survives forwarding), or
 *   - a passing SPF check where the envelope sender matches the From domain (direct sends).
 *
 * Inputs are SendGrid Inbound Parse fields. `dkim` looks like "{@gmail.com : pass}" or
 * "{@example.com : pass, @mailer.net : fail}"; `SPF` is "pass", "fail", "softfail", "none", ...
 *
 * Pure TypeScript (no Deno APIs) so it can be unit-tested from the app's Jest suite.
 */

export function domainOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim().toLowerCase().replace(/[>\s]+$/, '');
  return domain || null;
}

/** Relaxed alignment: the same domain, or one is a subdomain of the other. */
export function domainsAlign(a: string, b: string): boolean {
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

/** Domains whose DKIM signature passed, from SendGrid's `dkim` field. */
export function passingDkimDomains(dkimField: string | null | undefined): string[] {
  if (!dkimField) return [];
  const domains: string[] = [];
  for (const match of dkimField.matchAll(/@([a-z0-9.-]+)\s*:\s*([a-z]+)/gi)) {
    if (match[2].toLowerCase() === 'pass') domains.push(match[1].toLowerCase());
  }
  return domains;
}

export function isSenderVerified(params: {
  senderEmail: string;
  dkim?: string | null;
  spf?: string | null;
  envelopeFrom?: string | null;
}): boolean {
  const senderDomain = domainOf(params.senderEmail);
  if (!senderDomain) return false;
  if (passingDkimDomains(params.dkim).some((d) => domainsAlign(d, senderDomain))) return true;
  const envelopeDomain = domainOf(params.envelopeFrom);
  return (params.spf ?? '').trim().toLowerCase() === 'pass'
    && !!envelopeDomain
    && domainsAlign(envelopeDomain, senderDomain);
}
