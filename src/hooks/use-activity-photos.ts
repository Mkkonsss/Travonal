/**
 * useActivityPhotos — fetches thumbnail photos for trip activities.
 *
 * Flow:
 *  1. Check in-memory + Supabase shared cache for already-cached photos
 *  2. For misses: fetch place details (includes photo references), then
 *     use getPlacePhoto to fetch + cache the photo via the edge function
 *  3. Returns a Map<placeId, photoUrl> that updates as photos load
 *
 * Activities without a placeId are skipped.
 */

import { useEffect, useState } from 'react';
import {
  prefetchPhotosFromCache,
  getCachedPhotoUrl,
  getPlacePhoto,
} from '@/services/free-photos';
import { getPlaceDetailsAI } from '@/services/ai';

export function useActivityPhotos(
  placeIds: string[],
): Map<string, string> {
  const [photos, setPhotos] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const id of placeIds) {
      const url = getCachedPhotoUrl(id);
      if (url) map.set(id, url);
    }
    return map;
  });

  useEffect(() => {
    if (placeIds.length === 0) return;
    let cancelled = false;

    async function run() {
      // Step 1: Check shared Supabase cache (fast batch lookup)
      await prefetchPhotosFromCache(placeIds);
      if (cancelled) return;

      const map = new Map<string, string>();
      const uncached: string[] = [];
      for (const id of placeIds) {
        const url = getCachedPhotoUrl(id);
        if (url) {
          map.set(id, url);
        } else {
          uncached.push(id);
        }
      }

      // Publish cache hits immediately
      if (map.size > 0) setPhotos(new Map(map));

      // Step 2: For uncached, fetch place details to get photo references
      // Process in small batches to avoid overwhelming the API
      const BATCH = 3;
      for (let i = 0; i < uncached.length && !cancelled; i += BATCH) {
        const batch = uncached.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (placeId) => {
            const details = await getPlaceDetailsAI({ placeId });
            if (cancelled) return;

            // Extract first photo reference from details
            const photos = details?.photos as { name?: string }[] | undefined;
            const photoRef = photos?.[0]?.name;
            if (!photoRef) return;

            const result = await getPlacePhoto({
              cacheKey: placeId,
              photoRef,
            });
            if (result?.url && !cancelled) {
              map.set(placeId, result.url);
            }
          }),
        );

        if (cancelled) return;

        // Update state after each batch
        if (map.size > 0) setPhotos(new Map(map));
      }
    }

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeIds.join(',')]);

  return photos;
}
