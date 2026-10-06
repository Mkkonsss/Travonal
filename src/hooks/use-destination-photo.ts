/**
 * useDestinationPhoto — fetches a high-quality scenic photo URL for a destination city.
 *
 * Flow:
 *   1. Synchronous read from in-memory cache (instant on re-renders)
 *   2. Await persisted AsyncStorage cache — return immediately if already known
 *   3. Call destination_photo edge action (New Places API v1 Text Search → photo URL)
 *   4. Cache result in memory + AsyncStorage, prefetch image, return URL
 */

import { useEffect, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDestinationPhotoAI } from '@/services/ai';

const STORAGE_KEY = '@tripseek_destination_photos_v3';

// In-memory cache — shared across all hook instances for the session
const photoCache = new Map<string, string | null>();

// Load persisted cache once on module import
const cacheReady: Promise<void> = AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (!raw) return;
    try {
      const entries = JSON.parse(raw) as [string, string][];
      for (const [k, v] of entries) photoCache.set(k, v);
    } catch {}
  })
  .catch(() => {});

function persistCache() {
  const entries = Array.from(photoCache.entries()).filter(([, v]) => v !== null);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

export function useDestinationPhoto(destination: string): string | null {
  const key = destination.toLowerCase().trim();

  const [photoUrl, setPhotoUrl] = useState<string | null>(() => {
    const cached = photoCache.get(key);
    return cached !== undefined ? cached : null;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    async function run() {
      await cacheReady;
      if (cancelled) return;

      if (photoCache.has(key)) {
        setPhotoUrl(photoCache.get(key) ?? null);
        return;
      }

      try {
        const { url } = await getDestinationPhotoAI(destination);
        if (cancelled) return;

        photoCache.set(key, url);
        persistCache();
        if (url) ExpoImage.prefetch(url).catch(() => {});
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
