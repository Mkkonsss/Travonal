/**
 * Legal URLs for Privacy Policy and Terms of Use.
 * When a real URL is set, the corresponding Profile row automatically
 * becomes interactive and opens it via Linking.openURL.
 */

export const PRIVACY_POLICY_URL: string | null = 'https://tripseekapp.com/privacy';
export const TERMS_OF_USE_URL: string | null = 'https://tripseekapp.com/terms';
export const SUPPORT_EMAIL: string | null = 'support@tripseekapp.com';

/**
 * Where users forward booking confirmation emails. Keep this on the main domain: once support
 * mail moves to a real inbox, this address is forwarded on to the booking reader, so it keeps
 * working before and after that switch.
 */
export const BOOKING_FORWARD_EMAIL = 'bookings@tripseekapp.com';

/** Opens the App Store's "Write a Review" page directly (the in-app rating prompt is rate-limited by iOS). */
export const APP_STORE_REVIEW_URL = 'https://apps.apple.com/app/id6819936121?action=write-review';

/** Email domains Apple uses for Sign in with Apple "Hide My Email" relay addresses (old and new). */
export const APPLE_RELAY_EMAIL_DOMAINS = ['privaterelay.appleid.com', 'private.icloud.com'];

export function isAppleRelayEmail(email: string | null | undefined): boolean {
  const domain = email?.split('@')[1]?.toLowerCase();
  return !!domain && APPLE_RELAY_EMAIL_DOMAINS.includes(domain);
}
