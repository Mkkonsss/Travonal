/**
 * useDestinationPhoto — fetches a representative photo URL for a destination city.
 *
 * Flow:
 *   1. Check in-memory cache (populated from AsyncStorage on first import)
 *   2. Await persisted cache load — if URL already known, return it instantly
 *   3. Call getPlacesNearbyAI with destination keyword
 *   4. Walk results until a photo resource name is found
 *   5. Build photo URL via getPlacePhotoAI
 *   6. Cache in memory + AsyncStorage, prefetch image file, return
 *
 * The edge function uses Google Places API v1 (New), which returns
 * photos[i].name (a resource path) — NOT the legacy photo_reference field.
 */

import { useEffect, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPlacesNearbyAI, getPlacePhotoAI } from '@/services/ai';

const STORAGE_KEY = '@travonal_destination_photos_v1';

// In-memory cache — shared across all hook instances for the session
const photoCache = new Map<string, string | null>();

// Load persisted cache once on module import so it's ready before components render
const cacheReady: Promise<void> = AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (!raw) return;
    try {
      const entries = JSON.parse(raw) as [string, string][];
      for (const [k, v] of entries) {
        photoCache.set(k, v);
      }
    } catch {}
  })
  .catch(() => {});

function persistCache() {
  // Only persist entries with a real URL (skip nulls — those are "no photo found")
  const entries = Array.from(photoCache.entries()).filter(([, v]) => v !== null);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

export function useDestinationPhoto(destination: string): string | null {
  const key = destination.toLowerCase().trim();

  const [photoUrl, setPhotoUrl] = useState<string | null>(() => {
    // Synchronous read — works if cacheReady has already resolved (common on re-renders)
    const cached = photoCache.get(key);
    return cached !== undefined ? cached : null;
  });

  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    async function run() {
      // Wait for persisted cache to finish loading
      await cacheReady;
      if (cancelled) return;

      if (photoCache.has(key)) {
        setPhotoUrl(photoCache.get(key) ?? null);
        return;
      }

      try {
        const { places } = await getPlacesNearbyAI({ keyword: destination + ' landmark' });
        if (cancelled) return;

        // Walk results to find first usable photo name (New Places API v1 field)
        let ref: string | null = null;
        for (const place of places) {
          const p = place as Record<string, unknown>;
          const photos = p['photos'] as Record<string, unknown>[] | undefined;
          const candidate = (photos?.[0]?.['name'] as string) ?? null;
          if (candidate) { ref = candidate; break; }
        }

        if (!ref || cancelled) {
          photoCache.set(key, null);
          if (!cancelled) setPhotoUrl(null);
          return;
        }

        const { url } = await getPlacePhotoAI({ reference: ref, maxWidth: 1600 });
        if (cancelled) return;

        photoCache.set(key, url);
        persistCache();
        // Pre-download image into native cache so it renders without delay next time
        ExpoImage.prefetch(url).catch(() => {});
        setPhotoUrl(url);
      } catch {
        if (!cancelled) {
          photoCache.set(key, null);
          setPhotoUrl(null);
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [key, destination]);

  return photoUrl;
}
