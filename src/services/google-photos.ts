/**
 * Google Places photo service — fetches real place photos via the Places API (New).
 *
 * Cost optimization: Uses Autocomplete ($0.00283) + Place Details ($0.005) + Photo ($0.007)
 * instead of Text Search ($0.032) + Photo ($0.007).
 * Per-place cost: ~$0.015 instead of $0.039 — about 62% cheaper.
 *
 * Safety: tracks monthly API call count in AsyncStorage and hard-stops
 * when approaching the $200/month free credit limit.
 *
 * Flow per place:
 * 1. Check persistent photo cache (AsyncStorage, 90-day TTL)
 * 2. Check monthly budget → if exhausted, return null
 * 3. Autocomplete (name + location bias) → get place ID
 * 4. Place Details (photos field only) → get photo reference
 * 5. Photo media → get photo URL
 * 6. Cache photo URL persistently
 * 7. Increment monthly counter
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// ── Config ──

const API_KEY = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
  ?.googleMapsApiKey as string | undefined;

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

// Budget: 10,000 lookups/month × $0.015 = $150, safely under $200 free credit
const MONTHLY_LOOKUP_LIMIT = 10000;

// Cache TTL: 90 days (photo URLs are stable, longer TTL = fewer repeat lookups)
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ── AsyncStorage keys ──

const STORAGE_KEY_PREFIX = '@travonal/gphoto:';
const BUDGET_KEY = '@travonal/gphoto_budget';

// ── In-memory cache (fast path, populated from AsyncStorage) ──

const memoryCache = new Map<string, string | null>();
let budgetLoaded = false;
let currentMonth = '';
let currentCount = 0;

// ── Concurrency limit (prevent burst API usage from rapid scrolling) ──

let activeRequests = 0;
const MAX_CONCURRENT = 2;
const waitQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next();
  }
}

// ── Budget tracking ──

async function loadBudget(): Promise<void> {
  if (budgetLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(BUDGET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (parsed.month === month) {
        currentMonth = month;
        currentCount = parsed.count ?? 0;
      } else {
        // New month — reset counter
        currentMonth = month;
        currentCount = 0;
      }
    } else {
      const now = new Date();
      currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      currentCount = 0;
    }
  } catch {
    currentCount = 0;
  }
  budgetLoaded = true;
}

async function incrementBudget(): Promise<void> {
  currentCount += 1;
  const now = new Date();
  currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    await AsyncStorage.setItem(BUDGET_KEY, JSON.stringify({ month: currentMonth, count: currentCount }));
  } catch {
    // Non-critical — worst case we slightly over-count next session
  }
}

function isBudgetExhausted(): boolean {
  return currentCount >= MONTHLY_LOOKUP_LIMIT;
}

// ── Persistent cache ──

async function getCachedPhoto(cacheKey: string): Promise<string | null | undefined> {
  // Check memory first
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey) ?? null;
  }

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Check TTL
      if (Date.now() - parsed.ts < CACHE_TTL_MS) {
        memoryCache.set(cacheKey, parsed.url);
        return parsed.url; // May be null (cached miss)
      }
      // Expired — clean up
      AsyncStorage.removeItem(STORAGE_KEY_PREFIX + cacheKey).catch(() => {});
    }
  } catch {
    // Fall through
  }

  return undefined; // Not in cache
}

async function setCachedPhoto(cacheKey: string, url: string | null): Promise<void> {
  memoryCache.set(cacheKey, url);
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY_PREFIX + cacheKey,
      JSON.stringify({ url, ts: Date.now() }),
    );
  } catch {
    // Non-critical
  }
}

// ── Google Places API calls ──

async function searchPlaceForPhoto(
  name: string,
  lat: number,
  lng: number,
): Promise<string | null> {
  if (!API_KEY) return null;

  // Step 1: Autocomplete to find the place ($0.00283/request)
  const acResponse = await fetch(`${PLACES_API_BASE}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
    },
    body: JSON.stringify({
      input: name,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 500,
        },
      },
    }),
  });

  if (!acResponse.ok) {
    if (__DEV__) console.warn('[GooglePhotos] Autocomplete failed:', acResponse.status);
    return null;
  }

  const acData = await acResponse.json();
  const placeId = acData.suggestions?.[0]?.placePrediction?.placeId;
  if (!placeId) return null;

  // Step 2: Place Details for photo reference ($0.005 for Basic SKU)
  const detailResponse = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'photos',
    },
  });

  if (!detailResponse.ok) {
    if (__DEV__) console.warn('[GooglePhotos] Place Details failed:', detailResponse.status);
    return null;
  }

  const detailData = await detailResponse.json();
  const photoRef = detailData.photos?.[0]?.name;
  if (!photoRef) return null;

  // Step 3: Photo media to get URL ($0.007/request)
  const photoResp = await fetch(
    `${PLACES_API_BASE}/${photoRef}/media?maxWidthPx=800&skipHttpRedirect=true&key=${API_KEY}`,
  );

  if (!photoResp.ok) {
    if (__DEV__) console.warn('[GooglePhotos] Photo media failed:', photoResp.status);
    return null;
  }

  const photoData = await photoResp.json();
  return photoData.photoUri ?? null;
}

// ── Public API ──

export interface GooglePhotoResult {
  url: string;
  source: 'google';
}

/**
 * Get a real Google Places photo for a place.
 * Returns null if: no API key, budget exhausted, no photo found, or API error.
 * Caller should fall back to free photo sources.
 */
export async function getGooglePlacePhoto(options: {
  cacheKey: string;
  name: string;
  lat?: number;
  lng?: number;
}): Promise<GooglePhotoResult | null> {
  const { cacheKey, name, lat, lng } = options;

  if (!API_KEY || lat == null || lng == null) return null;

  // Load budget state
  await loadBudget();

  // Check persistent cache first (free — no API call)
  const cached = await getCachedPhoto(cacheKey);
  if (cached !== undefined) {
    return cached ? { url: cached, source: 'google' } : null;
  }

  // Check budget
  if (isBudgetExhausted()) {
    if (__DEV__) console.log('[GooglePhotos] Monthly budget exhausted (', currentCount, '/', MONTHLY_LOOKUP_LIMIT, ')');
    return null;
  }

  // Wait for a concurrency slot (max 2 parallel Google lookups)
  await acquireSlot();

  try {
    const url = await searchPlaceForPhoto(name, lat, lng);
    await setCachedPhoto(cacheKey, url);
    await incrementBudget();

    if (url) {
      return { url, source: 'google' };
    }
  } catch (e: any) {
    if (__DEV__) console.warn('[GooglePhotos] Error:', e?.message ?? e);
  } finally {
    releaseSlot();
  }

  return null;
}

/** Get current budget usage for display/debugging */
export async function getPhotoBudgetStatus(): Promise<{
  month: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}> {
  await loadBudget();
  return {
    month: currentMonth,
    used: currentCount,
    limit: MONTHLY_LOOKUP_LIMIT,
    remaining: Math.max(0, MONTHLY_LOOKUP_LIMIT - currentCount),
    exhausted: isBudgetExhausted(),
  };
}
