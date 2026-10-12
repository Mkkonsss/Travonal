/**
 * Tripseek Plus subscription service — wired to expo-iap (StoreKit / Google Play Billing).
 *
 * CODE-SIDE STATUS: Fully implemented. Purchases, restore, and entitlement checking
 * use real expo-iap StoreKit calls.
 *
 * EXTERNAL SETUP REQUIRED before purchases can succeed:
 *   1. Create a Tripseek Plus subscription group in App Store Connect.
 *   2. Create two auto-renewable subscription products with these exact IDs:
 *        Monthly: com.tripseek.app.plus.monthly
 *        Annual:  com.tripseek.app.plus.annual
 *   3. Set pricing, metadata, and localizations for each product.
 *   4. Complete agreements, tax, and banking in App Store Connect.
 *   5. Configure sandbox testers in App Store Connect for TestFlight testing.
 *
 * Until those App Store Connect products exist, `loadSubscriptionProducts()` will
 * return an empty array and purchases will fail with a StoreKit error — which is the
 * correct behavior (not faked).
 */

import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  deepLinkToSubscriptions,
  type ProductSubscription,
  type Purchase,
  type ExpoPurchaseError,
} from 'expo-iap';
import { supabase } from './supabase';

export const PRODUCT_IDS = {
  monthly: 'com.tripseek.app.plus.monthly',
  annual: 'com.tripseek.app.plus.annual',
} as const;

/**
 * Tracks the product ID of the user-initiated purchase in progress.
 * When set, only purchases matching the product ID are validated on the server.
 * This prevents wrong-product validation (e.g. monthly stored when user bought annual).
 * Auto-restore is removed so StoreKit replays can't leak subscriptions across accounts.
 */
let _expectedPurchaseProductId: string | null = null;
export function isPurchaseInProgress(purchase?: Purchase): boolean {
  if (!_expectedPurchaseProductId) return false;
  if (purchase) {
    return purchase.productId === _expectedPurchaseProductId;
  }
  return true;
}
export function clearPurchaseInProgress(): void {
  _expectedPurchaseProductId = null;
}

export type PlanId = keyof typeof PRODUCT_IDS;
export type ProductId = (typeof PRODUCT_IDS)[PlanId];

export interface SubscriptionProduct {
  planId: PlanId;
  /** Formatted price string from App Store (e.g. "$4.99") — never hardcoded */
  displayPrice: string;
  title: string;
  period: 'month' | 'year';
  raw: ProductSubscription;
}

export type SubscriptionStatus = 'loading' | 'available' | 'unavailable' | 'error';

let _connectionOpen = false;

/** Initialise the StoreKit / Play Billing connection. Call once at app start. */
export async function openIAPConnection(): Promise<void> {
  if (_connectionOpen) return;
  await initConnection();
  _connectionOpen = true;
}

/** Close the billing connection. Call on app background/unmount if needed. */
export async function closeIAPConnection(): Promise<void> {
  if (!_connectionOpen) return;
  await endConnection();
  _connectionOpen = false;
}

/**
 * Load available subscription products from the App Store / Play Store.
 * Returns an empty array when products are not yet configured in App Store Connect.
 */
export async function loadSubscriptionProducts(): Promise<SubscriptionProduct[]> {
  await openIAPConnection();

  const skus = Object.values(PRODUCT_IDS);
  const results = await fetchProducts({ skus, type: 'subs' });

  const products: SubscriptionProduct[] = [];
  for (const raw of results as ProductSubscription[]) {
    const entry = Object.entries(PRODUCT_IDS).find(([, id]) => id === raw.id);
    const planId = entry?.[0] as PlanId | undefined;
    if (!planId) continue;

    const period: 'month' | 'year' = planId === 'annual' ? 'year' : 'month';
    const displayPrice = (raw as { displayPrice?: string }).displayPrice ?? '';

    products.push({ planId, displayPrice, title: raw.title, period, raw });
  }

  return products;
}

/**
 * Purchase a subscription plan.
 * Triggers the native App Store payment sheet.
 * The actual purchase confirmation comes via purchaseUpdatedListener.
 */
export async function purchaseSubscription(planId: PlanId): Promise<{ error?: string }> {
  try {
    await openIAPConnection();
    _expectedPurchaseProductId = PRODUCT_IDS[planId];
    const sku = PRODUCT_IDS[planId];
    // requestPurchase is event-driven — listen via purchaseUpdatedListener for result.
    await requestPurchase({
      request: {
        apple: { sku },
        google: { skus: [sku] },
      },
      type: 'subs',
    });
    return {};
  } catch (e: unknown) {
    _expectedPurchaseProductId = null;
    const msg = e instanceof Error ? e.message : 'Purchase failed.';
    return { error: msg };
  }
}

/**
 * Restore previously purchased subscriptions.
 * Returns whether the user has an active Tripseek Plus subscription.
 */
export async function restorePurchases(): Promise<{ isSubscribed: boolean; error?: string }> {
  try {
    await openIAPConnection();
    const purchases = await getAvailablePurchases();
    const plusIds = new Set<string>(Object.values(PRODUCT_IDS));
    const plusPurchases = purchases.filter((p: Purchase) => plusIds.has(p.productId));
    const isSubscribed = plusPurchases.length > 0;

    // Finish all plus transactions
    for (const p of plusPurchases) {
      await finishTransaction({ purchase: p, isConsumable: false });
    }

    // Only validate the highest-tier purchase on the server (annual > monthly).
    // The server upserts by user_id, so the last validated purchase wins —
    // if we validate monthly after annual, it would downgrade the subscription.
    const annualId = PRODUCT_IDS.annual;
    const best = plusPurchases.find((p) => p.productId === annualId) ?? plusPurchases[0];
    if (best) {
      await validatePurchaseOnServer(best);
    }

    return { isSubscribed };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Restore failed.';
    return { isSubscribed: false, error: msg };
  }
}

/**
 * Check current subscription entitlement by inspecting available purchases.
 * Returns true if the user has an active Tripseek Plus subscription.
 */
export async function verifyEntitlement(): Promise<boolean> {
  try {
    await openIAPConnection();
    const purchases = await getAvailablePurchases();
    const plusIds = new Set<string>(Object.values(PRODUCT_IDS));
    return purchases.some((p: Purchase) => plusIds.has(p.productId));
  } catch {
    return false;
  }
}

/**
 * Subscribe to purchase result events. Returns an unsubscribe function.
 *
 * @param onPurchase — called with the completed purchase (finish transaction here)
 * @param onError   — called on purchase error
 */
export function listenForPurchaseUpdates(
  onPurchase: (purchase: Purchase) => void,
  onError: (error: ExpoPurchaseError) => void,
): () => void {
  const updateSub = purchaseUpdatedListener((purchase: Purchase) => {
    onPurchase(purchase);
  });
  const errorSub = purchaseErrorListener((error: ExpoPurchaseError) => {
    onError(error);
  });
  return () => {
    updateSub.remove();
    errorSub.remove();
  };
}

/**
 * Acknowledge and complete a purchase after server-side validation.
 * Must be called for every purchase received via listenForPurchaseUpdates.
 */
export async function acknowledgePurchase(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false });
}

/**
 * Validate a purchase on the server and update user_subscriptions.
 * This is the critical step that makes the server recognize the subscription.
 */
export async function validatePurchaseOnServer(purchase: Purchase): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const { error } = await supabase.functions.invoke('validate-purchase', {
      body: {
        productId: purchase.productId,
        transactionId: purchase.transactionId,
      },
    });

    if (error) {
      console.warn('[subscription] validate-purchase error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[subscription] validate-purchase failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Open the platform subscription management page.
 */
export async function openSubscriptionManagement(): Promise<void> {
  await deepLinkToSubscriptions({});
}
