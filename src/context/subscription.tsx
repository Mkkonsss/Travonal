/**
 * SubscriptionProvider — exposes Travonal+ state to the entire app.
 *
 * Source of truth is server-side (Supabase). This context:
 *   - Fetches subscription + usage on mount and after purchases
 *   - Caches for offline display via AsyncStorage
 *   - Exposes `isPlus`, `plan`, `usage`, and `refresh()`
 *   - Listens for expo-iap purchase events and updates state
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/auth';
import {
  fetchUsageSummary,
  clearUsageCache,
  type UsageSummary,
} from '@/services/usage';
import {
  verifyEntitlement,
  listenForPurchaseUpdates,
  acknowledgePurchase,
  openIAPConnection,
} from '@/services/subscription';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubscriptionState {
  /** Whether the user has an active Plus subscription */
  isPlus: boolean;
  /** Current plan: free, monthly, or annual */
  plan: 'free' | 'monthly' | 'annual';
  /** Full usage summary from server */
  usage: UsageSummary | null;
  /** Whether we're still loading initial state */
  loading: boolean;
  /** Refresh subscription and usage from server */
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [isPlus, setIsPlus] = useState(false);
  const [plan, setPlan] = useState<'free' | 'monthly' | 'annual'>('free');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const loadState = useCallback(async () => {
    try {
      // Fetch from server
      const summary = await fetchUsageSummary();
      if (summary) {
        setIsPlus(summary.is_plus);
        setPlan(summary.plan);
        setUsage(summary);
      }

      // Also verify via StoreKit in case server is behind
      const storeEntitled = await verifyEntitlement();
      if (storeEntitled && !summary?.is_plus) {
        // Store says subscribed but server doesn't know yet —
        // trust the store for display, server will catch up
        setIsPlus(true);
      }
    } catch {
      // Failed to load — keep cached state
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load when session changes
  useEffect(() => {
    if (session) {
      setLoading(true);
      loadState();
    } else {
      // Signed out — reset
      setIsPlus(false);
      setPlan('free');
      setUsage(null);
      setLoading(false);
      clearUsageCache();
    }
  }, [session, loadState]);

  // Refresh on app foreground (catches external subscription changes)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active' && session) {
        loadState();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [session, loadState]);

  // Listen for IAP purchase events
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function setup() {
      try {
        await openIAPConnection();
        cleanup = listenForPurchaseUpdates(
          async (purchase) => {
            await acknowledgePurchase(purchase);
            // Refresh state after successful purchase
            await loadState();
          },
          (_error) => {
            // Purchase error — no state change needed
          },
        );
      } catch {
        // IAP not available (simulator, web, etc.)
      }
    }

    setup();
    return () => cleanup?.();
  }, [loadState]);

  const refresh = useCallback(async () => {
    await loadState();
  }, [loadState]);

  return (
    <SubscriptionContext.Provider value={{ isPlus, plan, usage, loading, refresh }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
