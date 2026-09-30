/**
 * useActivityPhotos — fetches thumbnail photos for trip activities.
 *
 * Flow:
 *  1. Check in-memory + Supabase shared cache for already-cached photos
 *  2. For misses: fetch place details (includes photo references), then
 *     use getPlacePhoto to fetch + cache the photo via the edge function
 *  3. If place details fails (404 — bad/fabricated placeId), fall back to
 *     name-based Google Places search to resolve a real placeId
 *  4. Returns a Map<placeId, photoUrl> that updates as photos load
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
import { searchExplorePlaces, fetchPlaceDetails } from '@/services/explore-service';

/** Optional activity metadata for fallback name-based resolution */
export interface ActivityPhotoHint {
  placeId: string;
  name?: string;
  destination?: string;
}

/** Activities without a placeId — resolved purely by name search */
export interface ActivityNameHint {
  /** Unique key used to look up the photo in the returned map (e.g. activity.id) */
  key: string;
  name: string;
  destination?: string;
}

export function useActivityPhotos(
  placeIds: string[],
  hints?: ActivityPhotoHint[],
  nameOnlyHints?: ActivityNameHint[],
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

    // Build a lookup from placeId → hint for fallback resolution
    const hintMap = new Map<string, ActivityPhotoHint>();
    if (hints) {
      for (const h of hints) hintMap.set(h.placeId, h);
    }

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
        await Promise.allSettled(
          batch.map(async (placeId) => {
            let photoRef: string | undefined;

            // Try fetching details by placeId first
            try {
              const details = await getPlaceDetailsAI({ placeId });
              if (cancelled) return;
              const detailPhotos = details?.photos as { name?: string }[] | undefined;
              photoRef = detailPhotos?.[0]?.name;
            } catch {
              // Place details failed (likely 404 from fabricated placeId)
              // Fall back to name-based search if we have hints
              if (cancelled) return;
              const hint = hintMap.get(placeId);
              if (hint?.name) {
                try {
                  const searchLoc = hint.destination
                    ? { type: 'custom' as const, query: hint.destination, label: hint.destination }
                    : { type: 'custom' as const, query: 'world', label: '' };
                  const results = await searchExplorePlaces(hint.name, searchLoc);
                  if (cancelled) return;
                  if (results.length > 0 && results[0].placeId) {
                    const resolvedId = results[0].placeId;
                    const resolvedDetails = await fetchPlaceDetails(resolvedId);
                    if (cancelled) return;
                    const resolvedPhotos = resolvedDetails?.photos as { name?: string }[] | undefined;
                    photoRef = resolvedPhotos?.[0]?.name;
                    // Use resolved placeId as cache key so it's found next time
                    if (photoRef) {
                      const result = await getPlacePhoto({ cacheKey: placeId, photoRef });
                      if (result?.url && !cancelled) {
                        map.set(placeId, result.url);
                      }
                      return;
                    }
                  }
                } catch { /* fallback search also failed, give up */ }
              }
            }

            if (!photoRef || cancelled) return;

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

      // Resolve photos for activities with no placeId via name search
      if (nameOnlyHints && nameOnlyHints.length > 0) {
        const NBATCH = 2;
        for (let i = 0; i < nameOnlyHints.length && !cancelled; i += NBATCH) {
          const nbatch = nameOnlyHints.slice(i, i + NBATCH);
          await Promise.allSettled(
            nbatch.map(async (hint) => {
              if (cancelled) return;
              try {
                const searchLoc = hint.destination
                  ? { type: 'custom' as const, query: hint.destination, label: hint.destination }
                  : { type: 'custom' as const, query: 'world', label: '' };
                const results = await searchExplorePlaces(hint.name, searchLoc);
                if (cancelled) return;
                if (results.length > 0 && results[0].placeId) {
                  const resolvedDetails = await fetchPlaceDetails(results[0].placeId);
                  if (cancelled) return;
                  const resolvedPhotos = resolvedDetails?.photos as { name?: string }[] | undefined;
                  const photoRef = resolvedPhotos?.[0]?.name;
                  if (photoRef) {
                    const result = await getPlacePhoto({ cacheKey: hint.key, photoRef });
                    if (result?.url && !cancelled) {
                      map.set(hint.key, result.url);
                    }
                  }
                }
              } catch { /* name resolution failed, skip */ }
            }),
          );
          if (cancelled) return;
          if (map.size > 0) setPhotos(new Map(map));
        }
      }
    }

    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeIds.join(','), (nameOnlyHints ?? []).map((h) => h.key).join(',')]);

  return photos;
}
