/**
 * useGate — checks whether the current user can perform a gated AI action.
 *
 * Returns the current allowance state and a `showUpgrade()` function
 * that opens a contextual upgrade prompt.
 *
 * Usage:
 *   const gate = useGate('generate_trip');
 *   if (!gate.allowed) { gate.showUpgrade(); return; }
 *   // proceed with AI call
 */

import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useSubscription } from '@/context/subscription';
import { getActionCategory, isFreeActionAllowed, type ImportContentType } from '@/services/usage';

export type GatedAction =
  | 'generate_trip'
  | 'chat'
  | 'edit_trip'
  | 'analyze_trip'
  | 'prepare_fix'
  | 'natural_search'
  | 'enhance_profile'
  | 'rank_places'
  | 'import_place'
  | 'export_pdf'
  | 'invite_member';

export interface GateResult {
  /** Whether the user is currently allowed to perform this action */
  allowed: boolean;
  /** How many uses remain (for display) */
  remaining: number;
  /** Total limit for this action category */
  total: number;
  /** Human-readable reason if blocked */
  reason: string;
  /** Whether user is Plus */
  isPlus: boolean;
  /** Navigate to paywall with context */
  showUpgrade: () => void;
}

const UPGRADE_MESSAGES: Record<string, { title: string; desc: string }> = {
  generate_trip: {
    title: 'More AI trip plans',
    desc: 'Get 5 AI-powered itineraries every month with Tripseek+.',
  },
  chat: {
    title: 'More AI messages',
    desc: 'Get 100 AI messages per month to plan the perfect trip.',
  },
  edit_trip: {
    title: 'AI trip editing',
    desc: 'Let AI restructure your itinerary based on your instructions.',
  },
  analyze_trip: {
    title: 'Trip analysis',
    desc: 'Get a detailed breakdown of your trip\'s pacing, variety, and budget.',
  },
  prepare_fix: {
    title: 'Smart trip fixes',
    desc: 'Automatically resolve schedule conflicts and issues with one tap.',
  },
  natural_search: {
    title: 'Natural language search',
    desc: 'Search for activities in plain English — "a cozy cafe near the museum".',
  },
  enhance_profile: {
    title: 'Advanced personalization',
    desc: 'Let AI learn deeper from your preferences for better recommendations.',
  },
  rank_places: {
    title: 'Personalized recommendations',
    desc: 'Get AI-ranked "For You" recommendations based on your taste.',
  },
  import_place: {
    title: 'Import more places',
    desc: 'Add up to 15 places from links & photos every month with Tripseek+.',
  },
  export_pdf: {
    title: 'Export your itinerary',
    desc: 'Save or print your trip as a PDF with Tripseek+.',
  },
  invite_member: {
    title: 'Invite travel companions',
    desc: 'Share your trip and plan together with Tripseek+.',
  },
};

export function useGate(action: GatedAction, contentType?: ImportContentType): GateResult {
  const { isPlus, usage } = useSubscription();
  const router = useRouter();

  const result = useMemo((): Omit<GateResult, 'showUpgrade'> => {
    // Bypass gating in development
    if (__DEV__) {
      return { allowed: true, remaining: 99, total: 99, reason: '', isPlus };
    }

    const category = getActionCategory(action);

    // Plus-only actions that are gated by tier but not metered
    if (action === 'export_pdf' || action === 'invite_member') {
      if (!isPlus) {
        const msg = UPGRADE_MESSAGES[action]?.desc ?? 'Upgrade to Tripseek+ to use this feature.';
        return { allowed: false, remaining: 0, total: 0, reason: msg, isPlus: false };
      }
      return { allowed: true, remaining: 99, total: 99, reason: '', isPlus };
    }

    // Ungated actions (no category, no tier restriction)
    if (category === null) {
      return { allowed: true, remaining: 99, total: 99, reason: '', isPlus };
    }

    // No usage data yet — allow (server will enforce)
    if (!usage) {
      return { allowed: true, remaining: 0, total: 0, reason: '', isPlus };
    }

    // Plus users
    if (isPlus) {
      if (category === 'generation') {
        const limit = usage.limits.generations ?? 5;
        const remaining = limit - usage.generations_used;
        return {
          allowed: remaining > 0,
          remaining: Math.max(0, remaining),
          total: limit,
          reason: remaining <= 0 ? 'You\'ve used all 5 AI plans this month.' : '',
          isPlus,
        };
      }
      if (category === 'assistance') {
        const limit = usage.limits.assistance ?? 100;
        const remaining = limit - usage.assistance_used;
        return {
          allowed: remaining > 0,
          remaining: Math.max(0, remaining),
          total: limit,
          reason: remaining <= 0 ? 'You\'ve used all 100 AI messages this month.' : '',
          isPlus,
        };
      }
      if (category === 'import') {
        const limit = usage.limits.imports ?? 15;
        const remaining = limit - usage.imports_used;
        return {
          allowed: remaining > 0,
          remaining: Math.max(0, remaining),
          total: limit,
          reason: remaining <= 0 ? 'You\'ve added all 15 places from links this month.' : '',
          isPlus,
        };
      }
    }

    // Free users
    // Check if this specific action is allowed on free tier
    if (!isFreeActionAllowed(action)) {
      const msg = UPGRADE_MESSAGES[action]?.desc ?? 'Upgrade to Tripseek+ to use this feature.';
      return { allowed: false, remaining: 0, total: 0, reason: msg, isPlus: false };
    }

    if (category === 'generation') {
      const limit = usage.limits.generations ?? 1;
      const remaining = limit - usage.generations_used;
      return {
        allowed: remaining > 0,
        remaining: Math.max(0, remaining),
        total: limit,
        reason: remaining <= 0 ? 'You\'ve used your free trip plan this month. Upgrade for more.' : '',
        isPlus: false,
      };
    }

    if (category === 'assistance') {
      // Only chat is free (20/month)
      const limit = usage.limits.assistance ?? 20;
      const remaining = limit - usage.assistance_used;
      return {
        allowed: remaining > 0,
        remaining: Math.max(0, remaining),
        total: limit,
        reason: remaining <= 0 ? 'You\'ve used your 20 free AI messages this month. Upgrade for 100 per month.' : '',
        isPlus: false,
      };
    }

    if (category === 'import') {
      // Unified monthly limit across all import types
      const limit = usage.limits.imports ?? 3;
      const remaining = limit - usage.imports_used;
      return {
        allowed: remaining > 0,
        remaining: Math.max(0, remaining),
        total: limit,
        reason: remaining <= 0 ? 'Upgrade to Tripseek+ to import more places from links & photos.' : '',
        isPlus: false,
      };
    }

    return { allowed: true, remaining: 0, total: 0, reason: '', isPlus };
  }, [action, contentType, isPlus, usage]);

  const showUpgrade = useCallback(() => {
    router.push('/toveli-plus' as any);
  }, [router]);

  return { ...result, showUpgrade };
}
