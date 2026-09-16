/**
 * Photo service — fetches place images using Google Places photos
 * with a shared Supabase cache for cost optimization.
 *
 * Flow:
 * 1. Check in-memory cache (instant)
 * 2. Batch-check shared Supabase photo_cache table (one query for many places)
 * 3. If miss: use photo reference from Google Text Search result (no extra API call)
 *    → Edge function downloads photo, uploads to Supabase Storage, caches permanent URL
 * 4. Fallback: category placeholder with emoji
 *
 * Cost optimization:
 * - Photo references come free with Text Search results (already paid for)
 * - Only the Photo Media call ($0.007) + download is needed per new place
 * - Shared cache means each place is fetched from Google only once across all users
 * - Photos stored permanently in Supabase Storage (no TTL expiry, no re-fetching)
 */

import { supabase } from './supabase';

// ── Edge function caller ──

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-travonal`;

async function callPhotoEdge<T>(action: string, payload: unknown): Promise<T> {
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

  if (!response.ok) throw new Error(`Edge function error: ${response.status}`);
  const json = await response.json();
  if (!json.success) throw new Error(json.error ?? 'Edge function failed');
  return json.data as T;
}

// ── In-memory cache ──

const photoCache = new Map<string, string | null>();

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

  // 3. Fetch from shared cache or Google via edge function
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
    console.warn('[Photos] Failed to fetch photo for', options.name ?? key, e?.message);
  } finally {
    releaseStoreSlot();
  }

  photoCache.set(key, null);
  return null;
}

/**
 * Batch-lookup photos from the shared Supabase cache.
 * Call this with a list of place IDs before rendering cards —
 * any hits populate the in-memory cache so getPlacePhoto() returns instantly.
 */
export async function prefetchPhotosFromCache(
  placeIds: string[],
): Promise<void> {
  // Only look up IDs not already in memory
  const uncached = placeIds.filter((id) => !photoCache.has(id));
  if (uncached.length === 0) return;

  try {
    const result = await callPhotoEdge<{ photos: Record<string, string> }>(
      'photo_cache_lookup',
      { placeIds: uncached },
    );

    const photos = result.photos ?? {};
    for (const id of uncached) {
      if (photos[id]) {
        photoCache.set(id, photos[id]);
      }
      // Don't set null for misses — let getPlacePhoto try Google for those
    }
  } catch (e: any) {
    console.warn('[Photos] Cache prefetch failed:', e?.message);
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
