/**
 * Travonal+ usage tracking service.
 *
 * Talks to the Supabase `check_and_use`, `rollback_usage`, and
 * `get_usage_summary` RPC functions. Caches the last-known usage
 * summary in AsyncStorage for offline display, but the server is
 * the source of truth for enforcement.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const CACHE_KEY = '@travonal/usage_summary';

// ─── Types ──────────────────────────────────────────────────────────────────

export type UsageCategory = 'generation' | 'assistance' | 'import';

export type ImportContentType = 'url' | 'text' | 'image_base64';

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  total: number;
  is_plus: boolean;
  reason?: string;
}

export interface UsageLimits {
  // Plus limits (monthly)
  generations?: number;
  assistance?: number;
  imports?: number;
  // Free limits (lifetime)
  generations_lifetime?: number;
  imports_link_lifetime?: number;
  imports_text_lifetime?: number;
  imports_image_lifetime?: number;
}

export interface UsageSummary {
  is_plus: boolean;
  plan: 'free' | 'monthly' | 'annual';
  status: 'active' | 'expired' | 'cancelled' | 'grace_period';
  expires_at: string | null;
  period: string;
  generations_used: number;
  generations_lifetime: number;
  assistance_used: number;
  imports_used: number;
  imports_link_lifetime: number;
  imports_text_lifetime: number;
  imports_image_lifetime: number;
  limits: UsageLimits;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Current billing period key, e.g. '2026-09' */
export function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Map AI action names to usage categories */
export function getActionCategory(action: string): UsageCategory | null {
  switch (action) {
    case 'generate_trip':
      return 'generation';
    case 'chat':
    case 'edit_trip':
    case 'analyze_trip':
    case 'prepare_fix':
    case 'natural_search':
    case 'enhance_profile':
    case 'rank_places':
      return 'assistance';
    case 'import_place':
      return 'import';
    default:
      // Ungated actions: google_places, place_details, city_autocomplete,
      // places_nearby, get_photo_key, place_photo, photo_cache_*
      return null;
  }
}

/** Which free-tier actions are allowed (chat is the only free assistance action) */
export function isFreeActionAllowed(action: string): boolean {
  const category = getActionCategory(action);
  if (category === null) return true; // ungated
  if (category === 'generation') return true; // limited but allowed
  if (category === 'import') return true; // limited but allowed
  // assistance: only chat is free
  return action === 'chat';
}

// ─── Server calls ───────────────────────────────────────────────────────────

/**
 * Check usage and atomically decrement the counter if allowed.
 * Call this BEFORE executing an AI action.
 * On AI failure, call `rollbackUsage` to refund the count.
 */
export async function checkAndUseAction(
  category: UsageCategory,
  contentType?: ImportContentType,
): Promise<UsageCheckResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    // Not signed in — allow but don't track (guest mode)
    return { allowed: true, remaining: 99, total: 99, is_plus: false };
  }

  const period = getCurrentPeriod();
  const { data, error } = await supabase.rpc('check_and_use', {
    p_user_id: session.user.id,
    p_period: period,
    p_category: category,
    p_content_type: contentType ?? null,
  });

  if (error) {
    console.warn('[usage] check_and_use error:', error.message);
    // On RPC error, allow the action (fail-open for UX, server still validates)
    return { allowed: true, remaining: 0, total: 0, is_plus: false };
  }

  return data as UsageCheckResult;
}

/**
 * Rollback a usage decrement after an AI call fails.
 * Error recovery is free — don't charge for broken results.
 */
export async function rollbackUsage(
  category: UsageCategory,
  contentType?: ImportContentType,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const period = getCurrentPeriod();
  const { error } = await supabase.rpc('rollback_usage', {
    p_user_id: session.user.id,
    p_period: period,
    p_category: category,
    p_content_type: contentType ?? null,
  });

  if (error) {
    console.warn('[usage] rollback_usage error:', error.message);
  }
}

/**
 * Fetch the full usage summary from the server.
 * Caches the result in AsyncStorage for offline display.
 */
export async function fetchUsageSummary(): Promise<UsageSummary | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return getDefaultSummary();

  const period = getCurrentPeriod();
  const { data, error } = await supabase.rpc('get_usage_summary', {
    p_user_id: session.user.id,
    p_period: period,
  });

  if (error) {
    console.warn('[usage] get_usage_summary error:', error.message);
    return getCachedSummary();
  }

  const summary = data as UsageSummary;

  // Cache for offline display
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(summary));
  } catch { /* ignore cache write errors */ }

  return summary;
}

/** Get cached summary for offline display */
async function getCachedSummary(): Promise<UsageSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as UsageSummary : getDefaultSummary();
  } catch {
    return getDefaultSummary();
  }
}

function getDefaultSummary(): UsageSummary {
  return {
    is_plus: false,
    plan: 'free',
    status: 'active',
    expires_at: null,
    period: getCurrentPeriod(),
    generations_used: 0,
    generations_lifetime: 0,
    assistance_used: 0,
    imports_used: 0,
    imports_link_lifetime: 0,
    imports_text_lifetime: 0,
    imports_image_lifetime: 0,
    limits: {
      generations_lifetime: 2,
      assistance: 10,
      imports_link_lifetime: 2,
      imports_text_lifetime: 2,
      imports_image_lifetime: 1,
    },
  };
}

/** Clear cached usage on sign-out */
export async function clearUsageCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}
