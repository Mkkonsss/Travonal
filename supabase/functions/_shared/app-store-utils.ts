/**
 * Pure helpers for App Store subscription data (no Deno APIs, so the app's Jest suite can
 * test them). Used by validate-purchase and app-store-notifications.
 */

export type Plan = 'monthly' | 'annual';

// Product ID → plan mapping (current and legacy App Store Connect IDs)
export const PRODUCT_PLAN_MAP: Record<string, Plan> = {
  'com.tripseek.app.plus.monthly': 'monthly',
  'com.tripseek.app.plus.annual': 'annual',
  'com.toveli.plus.monthly': 'monthly',
  'com.toveli.plus.annual': 'annual',
};

export function planForProduct(productId: string | null | undefined): Plan | null {
  return productId ? PRODUCT_PLAN_MAP[productId] ?? null : null;
}

/** The decoded fields we use from Apple's signed transaction (JWSTransactionDecodedPayload). */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment?: 'Sandbox' | 'Production' | string;
  type?: string;
}

/**
 * Decode the payload of an Apple JWS. Only call this on data fetched from Apple's
 * authenticated App Store Server API (or re-checked against it) — the signature isn't verified here.
 */
export function decodeJwsPayload<T>(jws: string): T {
  const part = jws.split('.')[1];
  if (!part) throw new Error('Malformed JWS');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Map Apple's subscription status to ours. Apple: 1 active, 2 expired, 3 billing retry,
 * 4 billing grace period, 5 revoked. Someone who turned off auto-renew stays "active"
 * until their paid period ends.
 */
export function statusFromApple(appleStatus: number): 'active' | 'grace_period' | 'expired' {
  if (appleStatus === 1) return 'active';
  if (appleStatus === 4) return 'grace_period';
  return 'expired';
}

/** Whether a purchase may be attached to this Tripseek account. */
export function ownershipConflict(params: {
  userId: string;
  appAccountToken?: string | null;
  existingOwnerId?: string | null;
}): boolean {
  // Purchases made in this app version carry the buyer's account ID
  if (params.appAccountToken) return params.appAccountToken.toLowerCase() !== params.userId.toLowerCase();
  // Older purchases: one Apple subscription can only back one Tripseek account
  return !!params.existingOwnerId && params.existingOwnerId !== params.userId;
}
