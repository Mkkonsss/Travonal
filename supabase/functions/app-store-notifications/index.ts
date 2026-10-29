/**
 * Supabase Edge Function: app-store-notifications
 *
 * Receives App Store Server Notifications (V2) — renewals, expiries, refunds, billing
 * problems — and keeps user_subscriptions in step, so paying subscribers keep Tripseek+
 * after each renewal and people who cancel or are refunded lose it on time.
 *
 * The notification is only used to learn WHICH subscription changed. Its current state is
 * re-fetched from Apple's authenticated App Store Server API, so a forged notification
 * can't grant anything.
 *
 * DEPLOYMENT (Apple can't send a Supabase JWT, so JWT verification must be off):
 *   supabase functions deploy app-store-notifications --no-verify-jwt
 * Then in App Store Connect → App Information → App Store Server Notifications, set both
 * the Production and Sandbox URLs (Version 2) to:
 *   https://<project>.supabase.co/functions/v1/app-store-notifications
 *
 * Secrets: the In-App Purchase key (see _shared/app-store.ts) plus the Supabase defaults.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { appStoreConfig, fetchSubscriptionState } from '../_shared/app-store.ts';
import { type AppleTransaction, decodeJwsPayload, planForProduct, statusFromApple } from '../_shared/app-store-utils.ts';

interface NotificationPayload {
  notificationType?: string;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
  };
}

Deno.serve(async (req: Request) => {
  // Always answer 200 so Apple doesn't keep retrying; problems are logged instead
  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  try {
    const config = appStoreConfig();
    if (!config) {
      console.error('[app-store-notifications] APPLE_IAP_* secrets not set — ignoring notification');
      return new Response('ok', { status: 200 });
    }

    const { signedPayload } = await req.json() as { signedPayload?: string };
    if (typeof signedPayload !== 'string') return new Response('ok', { status: 200 });

    const notification = decodeJwsPayload<NotificationPayload>(signedPayload);
    if (notification.data?.bundleId && notification.data.bundleId !== config.bundleId) {
      return new Response('ok', { status: 200 });
    }
    const hint = notification.data?.signedTransactionInfo
      ? decodeJwsPayload<AppleTransaction>(notification.data.signedTransactionInfo)
      : null;
    if (!hint?.transactionId) return new Response('ok', { status: 200 });

    // Trust only what Apple's API says now
    const state = await fetchSubscriptionState(config, hint.transactionId, notification.data?.environment === 'Sandbox');
    const tx = state?.transaction;
    const plan = planForProduct(tx?.productId);
    if (!state || !tx || !plan || tx.bundleId !== config.bundleId) return new Response('ok', { status: 200 });

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // The account: whoever this subscription is already linked to, else the buyer's account ID
    const { data: existing } = await adminClient
      .from('user_subscriptions')
      .select('user_id')
      .eq('original_transaction_id', tx.originalTransactionId)
      .limit(1)
      .maybeSingle();
    const userId = existing?.user_id ?? tx.appAccountToken;
    if (!userId) {
      console.warn('[app-store-notifications] No account linked to this subscription yet');
      return new Response('ok', { status: 200 });
    }

    const { error } = await adminClient
      .from('user_subscriptions')
      .upsert(
        {
          user_id: userId,
          plan,
          status: statusFromApple(state.appleStatus),
          store: 'apple',
          product_id: tx.productId,
          original_transaction_id: tx.originalTransactionId,
          expires_at: tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) console.error('[app-store-notifications] upsert error:', error.message);
    else console.log('[app-store-notifications]', notification.notificationType, '→ updated subscription');
  } catch (err) {
    console.error('[app-store-notifications]', err instanceof Error ? err.message : 'Unknown error');
  }

  return new Response('ok', { status: 200 });
});
