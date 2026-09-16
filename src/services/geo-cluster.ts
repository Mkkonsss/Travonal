import { haversineDistanceKm, suggestTimeForActivity } from './itinerary-engine';
import type { Activity } from '@/context/trips';

interface GeoActivity {
  title: string;
  lat?: number;
  lng?: number;
  address?: string;
}

export interface GeoCluster {
  label: string;
  center: { lat: number; lng: number };
  activities: GeoActivity[];
  radiusKm: number;
}

export interface ClusterResult {
  clusters: GeoCluster[];
  unclustered: GeoActivity[];
}

/**
 * Extract a neighborhood hint from a formatted address.
 * Tries the 2nd or 3rd segment (comma-separated), skipping street numbers.
 */
function extractNeighborhood(address: string): string | null {
  const parts = address.split(',').map((s) => s.trim());
  // Typical format: "123 Street, Neighborhood, City, State ZIP, Country"
  // We want the segment that looks like a neighborhood (not a street number, not a zip)
  for (let i = 1; i < Math.min(parts.length - 1, 3); i++) {
    const seg = parts[i];
    // Skip segments that are mostly numbers (zip codes, street numbers)
    if (/^\d/.test(seg) || /\d{4,}/.test(seg)) continue;
    // Skip very short segments
    if (seg.length < 3) continue;
    return seg;
  }
  return null;
}

/**
 * Cluster activities by geographic proximity using single-linkage agglomerative clustering.
 * Activities within `thresholdKm` of any member in a cluster are merged together.
 */
export function clusterByProximity(
  activities: GeoActivity[],
  thresholdKm = 2.0,
): ClusterResult {
  const geoTagged = activities.filter(
    (a): a is GeoActivity & { lat: number; lng: number } =>
      a.lat != null && a.lng != null,
  );
  const unclustered = activities.filter((a) => a.lat == null || a.lng == null);

  if (geoTagged.length === 0) {
    return { clusters: [], unclustered };
  }

  // Start with each activity as its own cluster
  let groups: (typeof geoTagged)[] = geoTagged.map((a) => [a]);

  // Agglomerative: merge closest pair if within threshold
  let merged = true;
  while (merged) {
    merged = false;
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        // Single-linkage: minimum distance between any pair across clusters
        for (const a of groups[i]) {
          for (const b of groups[j]) {
            const d = haversineDistanceKm(a.lat, a.lng, b.lat, b.lng);
            if (d < bestDist) {
              bestDist = d;
              bestI = i;
              bestJ = j;
            }
          }
        }
      }
    }

    if (bestDist <= thresholdKm && bestI !== -1 && bestJ !== -1) {
      groups[bestI] = [...groups[bestI], ...groups[bestJ]];
      groups.splice(bestJ, 1);
      merged = true;
    }
  }

  // Build labeled clusters
  const clusters: GeoCluster[] = groups.map((group, idx) => {
    const centerLat = group.reduce((s, a) => s + a.lat, 0) / group.length;
    const centerLng = group.reduce((s, a) => s + a.lng, 0) / group.length;

    // Find max distance from center for radius
    let maxDist = 0;
    for (const a of group) {
      const d = haversineDistanceKm(centerLat, centerLng, a.lat, a.lng);
      if (d > maxDist) maxDist = d;
    }

    // Try to extract a neighborhood name from addresses
    const neighborhoods = group
      .map((a) => a.address ? extractNeighborhood(a.address) : null)
      .filter(Boolean) as string[];

    // Pick the most common neighborhood name
    let label = `Area ${String.fromCharCode(65 + idx)}`; // A, B, C...
    if (neighborhoods.length > 0) {
      const freq = new Map<string, number>();
      for (const n of neighborhoods) {
        freq.set(n, (freq.get(n) ?? 0) + 1);
      }
      let best = '';
      let bestCount = 0;
      for (const [n, c] of freq) {
        if (c > bestCount) { best = n; bestCount = c; }
      }
      if (best) label = best;
    }

    return {
      label,
      center: { lat: centerLat, lng: centerLng },
      activities: group,
      radiusKm: maxDist,
    };
  });

  return { clusters, unclustered };
}

/**
 * Build a geographic context string for the AI prompt.
 * Pre-computes clusters and inter-cluster distances so the AI
 * doesn't need to reason about raw coordinates.
 */
export function buildGeoContext(activities: GeoActivity[]): string {
  const { clusters, unclustered } = clusterByProximity(activities);

  // Not enough geo data to be useful
  if (clusters.length === 0) return '';
  // Single cluster with no unclustered — no inter-cluster info needed
  if (clusters.length === 1 && unclustered.length === 0) {
    const c = clusters[0];
    const titles = c.activities.map((a) => `"${a.title}"`).join(', ');
    if (c.activities.length === 1) return '';
    const dist = c.radiusKm < 0.1
      ? 'all at the same location'
      : `within ${c.radiusKm.toFixed(1)} km (walkable)`;
    return [
      `All requested places are in ${c.label}: ${titles} — ${dist}.`,
      'Schedule them in the same half-day block.',
    ].join('\n');
  }

  const lines: string[] = [];

  // Cluster descriptions
  for (const c of clusters) {
    const titles = c.activities.map((a) => `"${a.title}"`).join(', ');
    const proximity = c.activities.length === 1
      ? 'single location'
      : c.radiusKm < 0.5
        ? `within ${(c.radiusKm * 1000).toFixed(0)} m (walkable)`
        : `within ${c.radiusKm.toFixed(1)} km (walkable)`;
    lines.push(`${c.label}: ${titles} — ${proximity}`);
  }

  if (unclustered.length > 0) {
    const titles = unclustered.map((a) => `"${a.title}"`).join(', ');
    lines.push(`Unclustered (no coordinates): ${titles}`);
  }

  // Inter-cluster distances
  if (clusters.length > 1) {
    lines.push('');
    lines.push('DISTANCES BETWEEN AREAS:');
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = haversineDistanceKm(
          clusters[i].center.lat, clusters[i].center.lng,
          clusters[j].center.lat, clusters[j].center.lng,
        );
        const transit = d < 3 ? '~15 min' : d < 8 ? '~30 min transit' : '~45-60 min transit';
        lines.push(`${clusters[i].label} ↔ ${clusters[j].label}: ${d.toFixed(1)} km (${transit})`);
      }
    }
  }

  lines.push('');
  lines.push('Schedule same-area activities in the same half-day block.');
  lines.push('Never alternate between distant areas within a morning or afternoon.');

  return lines.join('\n');
}

export interface DistributedActivity {
  title: string;
  day: number;
  time: string;
  type: Activity['type'];
  [key: string]: any;
}

/**
 * Distribute activities across days using geo clusters for proximity grouping
 * and smart time assignment based on activity type.
 *
 * Algorithm:
 * 1. Cluster activities by proximity (2km threshold)
 * 2. Sort clusters by size (largest first)
 * 3. Assign clusters to days round-robin (cluster 1 → day 1, cluster 2 → day 2, ...)
 * 4. Within each cluster, assign smart times using suggestTimeForActivity()
 * 5. Distribute unclustered items across days with fewest activities
 */
export function distributeActivitiesAcrossDays(
  activities: Array<{ title: string; type: Activity['type']; lat?: number; lng?: number; [key: string]: any }>,
  numDays: number,
  existingActivities: Activity[] = [],
): DistributedActivity[] {
  if (activities.length === 0) return [];
  const days = Math.max(1, numDays);

  const { clusters, unclustered } = clusterByProximity(activities);

  // Sort clusters largest first so bigger groups get assigned first
  const sortedClusters = [...clusters].sort((a, b) => b.activities.length - a.activities.length);

  // Track how many activities are on each day (including existing)
  const dayCounts = new Array(days).fill(0);
  for (const a of existingActivities) {
    if (a.day >= 1 && a.day <= days) {
      dayCounts[a.day - 1]++;
    }
  }

  const result: DistributedActivity[] = [];
  // Accumulate placed activities to feed into suggestTimeForActivity
  const placed: Activity[] = [...existingActivities];

  // Assign each cluster to a day (round-robin across days)
  let nextDay = 0;
  for (const cluster of sortedClusters) {
    // Find the day with fewest activities starting from nextDay
    const dayIndex = nextDay % days;
    const assignedDay = dayIndex + 1;
    nextDay++;

    // Find original activity objects for this cluster's members
    for (const member of cluster.activities) {
      const original = activities.find((a) => a.title === member.title);
      if (!original) continue;

      const time = suggestTimeForActivity(placed, assignedDay, original.type);
      const distributed: DistributedActivity = {
        ...original,
        day: assignedDay,
        time,
      };
      result.push(distributed);
      dayCounts[assignedDay - 1]++;
      // Add to placed so next time suggestion accounts for this one
      placed.push({ id: '', ...distributed } as Activity);
    }
  }

  // Distribute unclustered items across days with fewest activities
  for (const member of unclustered) {
    const original = activities.find((a) => a.title === member.title);
    if (!original) continue;

    // Find the day with fewest activities
    let minDay = 0;
    for (let d = 1; d < days; d++) {
      if (dayCounts[d] < dayCounts[minDay]) minDay = d;
    }
    const assignedDay = minDay + 1;

    const time = suggestTimeForActivity(placed, assignedDay, original.type);
    const distributed: DistributedActivity = {
      ...original,
      day: assignedDay,
      time,
    };
    result.push(distributed);
    dayCounts[assignedDay - 1]++;
    placed.push({ id: '', ...distributed } as Activity);
  }

  return result;
}
