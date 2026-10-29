/**
 * Photo service — fetches place images using Google Places photos
 * with a shared Supabase cache for cost optimization.
 *
 * Flow:
 * 1. Check in-memory cache (instant)
 * 2. Batch-check shared Supabase photo_cache table (one query for many places — single
 *    getPlacePhoto calls made at the same moment are batched too)
 * 3. If miss: use photo reference from Google Text Search result (no extra API call)
 *    → Edge function downloads photo, uploads to Supabase Storage, caches permanent URL
 * 4. Fallback: category placeholder with emoji
 *
 * Cost optimization:
 * - Photo references come free with Text Search results (already paid for)
 * - Only the Photo Media call ($0.007) + download is needed per new place
 * - Shared cache means each place is fetched from Google only once across all users
 * - Photos stored permanently in Supabase Storage (no TTL expiry, no re-fetching)
 * - Requests are paced to stay inside the backend's per-minute limit (photo-budget.ts)
 */

import { supabase } from './supabase';
import { pausePhotoRequests, photoRequestSlot } from './photo-budget';

// ── Edge function caller ──

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-toveli`;

async function callPhotoEdge<T>(action: string, payload: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await photoRequestSlot();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

    const response = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ action, payload }),
    });

    // Over the backend's per-minute limit — wait until it lets us in again, then ask once more
    if (response.status === 429 && attempt < 3) {
      pausePhotoRequests(Number(response.headers.get('Retry-After')) || 60);
      continue;
    }
    if (!response.ok) throw new Error(`Edge function error: ${response.status}`);
    const json = await response.json();
    if (!json.success) throw new Error(json.error ?? 'Edge function failed');
    return json.data as T;
  }
}

// ── In-memory cache ──

const photoCache = new Map<string, string | null>();
/** Keys already checked against the shared cache this session */
const lookedUp = new Set<string>();

// ── Concurrency control (max 3 parallel Google photo fetches) ──

let activeStores = 0;
const MAX_CONCURRENT_STORES = 6;
const storeQueue: (() => void)[] = [];

function acquireStoreSlot(): Promise<void> {
  if (activeStores < MAX_CONCURRENT_STORES) {
    activeStores++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    storeQueue.push(() => {
      activeStores++;
      resolve();
    });
  });
}

function releaseStoreSlot(): void {
  activeStores--;
  if (storeQueue.length > 0) {
    storeQueue.shift()!();
  }
}

// ── Main API ──

export interface PhotoResult {
  url: string;
  source: 'cache' | 'google' | 'placeholder';
}

/**
 * Get a photo for a place.
 *
 * @param options.cacheKey - Unique key for this place (typically placeId)
 * @param options.photoRef - Google photo reference from Text Search results (free — already included in search response)
 * @param options.name - Place name (for logging)
 */
export async function getPlacePhoto(options: {
  cacheKey: string;
  photoRef?: string;
  name?: string;
  category?: string;
  // Legacy params kept for compatibility with other callers
  osmTags?: Record<string, string>;
  lat?: number;
  lng?: number;
  skipGoogle?: boolean;
}): Promise<PhotoResult | null> {
  const { cacheKey: key, photoRef } = options;

  // 1. In-memory cache
  if (photoCache.has(key)) {
    const cached = photoCache.get(key);
    if (cached) return { url: cached, source: 'cache' };
    return null;
  }

  // 2. If no photo reference, no photo available
  if (!photoRef) {
    photoCache.set(key, null);
    return null;
  }

  // 3. Shared cache — checked together with every other photo asked for at the same moment
  const saved = await lookUpSavedPhoto(key);
  if (saved) return { url: saved, source: 'cache' };

  // 4. Not saved yet — the edge function fetches it from Google and saves it
  return storePhoto(key, photoRef, options.name);
}

// Photos asked for within a moment of each other share one shared-cache lookup
const lookupWaiters = new Map<string, ((url: string | null) => void)[]>();
let lookupTimer: ReturnType<typeof setTimeout> | null = null;

function lookUpSavedPhoto(key: string): Promise<string | null> {
  if (lookedUp.has(key)) return Promise.resolve(photoCache.get(key) ?? null);
  return new Promise((resolve) => {
    lookupWaiters.set(key, [...(lookupWaiters.get(key) ?? []), resolve]);
    if (!lookupTimer) lookupTimer = setTimeout(flushLookups, 50);
  });
}

async function flushLookups(): Promise<void> {
  lookupTimer = null;
  const waiters = new Map(lookupWaiters);
  lookupWaiters.clear();
  await prefetchPhotosFromCache([...waiters.keys()]);
  for (const [key, resolvers] of waiters) {
    const url = photoCache.get(key) ?? null;
    for (const resolve of resolvers) resolve(url);
  }
}

/** Store requests in flight — cards asking for the same place at once share one */
const storing = new Map<string, Promise<PhotoResult | null>>();

function storePhoto(key: string, photoRef: string, name?: string): Promise<PhotoResult | null> {
  const inFlight = storing.get(key);
  if (inFlight) return inFlight;

  const request = (async (): Promise<PhotoResult | null> => {
    await acquireStoreSlot();
    try {
      const result = await callPhotoEdge<{ url: string; stored: boolean }>(
        'photo_cache_store',
        { placeId: key, photoRef },
      );

      if (result.url) {
        photoCache.set(key, result.url);
        return { url: result.url, source: result.stored ? 'cache' : 'google' };
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[Photos] Failed to fetch photo for', name ?? key, e?.message);
    } finally {
      releaseStoreSlot();
    }

    photoCache.set(key, null);
    return null;
  })().finally(() => storing.delete(key));

  storing.set(key, request);
  return request;
}

/**
 * Batch-lookup photos from the shared Supabase cache.
 * Call this with a list of place IDs before rendering cards —
 * any hits populate the in-memory cache so getPlacePhoto() returns instantly.
 */
export async function prefetchPhotosFromCache(
  placeIds: string[],
): Promise<void> {
  // Only look up IDs not already in memory or checked earlier
  const uncached = placeIds.filter((id) => !photoCache.has(id) && !lookedUp.has(id));

  // The server looks IDs up through a URL query — batches keep it under URL length limits
  const BATCH = 50;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    try {
      const result = await callPhotoEdge<{ photos: Record<string, string> }>(
        'photo_cache_lookup',
        { placeIds: batch },
      );

      const photos = result.photos ?? {};
      for (const id of batch) {
        lookedUp.add(id);
        if (photos[id]) {
          photoCache.set(id, photos[id]);
        }
        // Don't set null for misses — let getPlacePhoto try Google for those
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[Photos] Cache prefetch failed:', e?.message);
    }
  }
}

/**
 * Batch-prefetch photos: first check shared cache, then fetch remaining from Google.
 * Non-blocking — fires in background.
 */
export function prefetchPhotos(
  places: {
    cacheKey: string;
    photoRef?: string;
    name?: string;
    category?: string;
    osmTags?: Record<string, string>;
    lat?: number;
    lng?: number;
  }[],
): void {
  const uncached = places.filter((p) => !photoCache.has(p.cacheKey));
  if (uncached.length === 0) return;

  // Step 1: Batch-check shared cache
  const placeIds = uncached.map((p) => p.cacheKey);
  prefetchPhotosFromCache(placeIds).then(() => {
    // Step 2: Fetch remaining from Google (those still not in cache)
    const stillMissing = uncached.filter((p) => !photoCache.has(p.cacheKey) && p.photoRef);
    if (stillMissing.length === 0) return;

    // Fetch in small batches to avoid overwhelming the edge function
    const BATCH = 5;
    let i = 0;
    function fetchBatch() {
      const batch = stillMissing.slice(i, i + BATCH);
      if (batch.length === 0) return;
      i += BATCH;
      Promise.allSettled(batch.map((p) => getPlacePhoto(p))).then(fetchBatch);
    }
    fetchBatch();
  });
}

/** Synchronous read from in-memory cache. Returns URL or null. */
export function getCachedPhotoUrl(cacheKey: string): string | null {
  return photoCache.get(cacheKey) ?? null;
}

// ── Category placeholder colors ──

/** Returns a gradient pair for a category when no photo is available */
export function categoryPlaceholderColors(category: string): [string, string] {
  if (category.startsWith('food/')) return ['#F97316', '#EA580C'];
  if (category.startsWith('stay/')) return ['#6366F1', '#4F46E5'];
  if (category.startsWith('activity/museum')) return ['#8B5CF6', '#7C3AED'];
  if (category.startsWith('activity/park')) return ['#22C55E', '#16A34A'];
  if (category.startsWith('activity/')) return ['#3B82F6', '#2563EB'];
  if (category === 'shopping') return ['#EC4899', '#DB2777'];
  return ['#6B7280', '#4B5563'];
}

/** Returns an SF Symbol name for a category placeholder */
export function categoryPlaceholderEmoji(category: string): string {
  if (category === 'food/restaurant') return 'fork.knife';
  if (category === 'food/cafe') return 'cup.and.saucer.fill';
  if (category === 'food/bar') return 'wineglass.fill';
  if (category === 'food/bakery') return 'birthday.cake';
  if (category.startsWith('food/')) return 'fork.knife';
  if (category === 'stay/hotel') return 'building.2.fill';
  if (category.startsWith('stay/')) return 'bed.double.fill';
  if (category === 'activity/museum') return 'building.columns.fill';
  if (category === 'activity/park') return 'tree.fill';
  if (category === 'activity/attraction') return 'star.fill';
  if (category.startsWith('activity/')) return 'theatermasks.fill';
  if (category === 'shopping') return 'bag.fill';
  return 'mappin';
}
