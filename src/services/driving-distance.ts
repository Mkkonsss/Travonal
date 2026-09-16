import { haversineDistanceKm } from './itinerary-engine';

export interface DrivingResult {
  distanceKm: number;
  durationMin: number;
}

const cache = new Map<string, DrivingResult>();

function cacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return `${lat1.toFixed(5)},${lng1.toFixed(5)};${lat2.toFixed(5)},${lng2.toFixed(5)}`;
}

/**
 * Get driving distance and duration between two points using OSRM (free, no API key).
 * Falls back to haversine × 1.4 if the request fails.
 */
export async function getDrivingDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): Promise<DrivingResult> {
  const key = cacheKey(lat1, lng1, lat2, lng2);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');

    const route = data.routes[0];
    const result: DrivingResult = {
      distanceKm: route.distance / 1000,
      durationMin: Math.round(route.duration / 60),
    };
    cache.set(key, result);
    return result;
  } catch {
    // Fallback: haversine × 1.4 urban detour factor
    const straight = haversineDistanceKm(lat1, lng1, lat2, lng2);
    const estimatedKm = straight * 1.4;
    // Rough estimate: 30 km/h average city driving speed
    const estimatedMin = Math.round((estimatedKm / 30) * 60);
    const result: DrivingResult = { distanceKm: estimatedKm, durationMin: estimatedMin };
    cache.set(key, result);
    return result;
  }
}

/**
 * Format a driving result for display. E.g. "3.2 km · 12 min"
 */
export function formatDrivingDistance(result: DrivingResult): string {
  const dist = result.distanceKm < 1
    ? `${(result.distanceKm * 1000).toFixed(0)} m`
    : `${result.distanceKm.toFixed(1)} km`;
  return `${dist} · ${result.durationMin} min`;
}
