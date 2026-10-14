/**
 * Overpass API client — free OpenStreetMap POI search.
 * No API key required. Public endpoint with reasonable-use rate limits.
 *
 * Strategy: use regex filters and nwr to minimize query count,
 * run queries sequentially to respect rate limits.
 */

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ── OSM element shape ──

export interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// ── Category → compact Overpass queries ──
// Uses regex (~) to combine similar tags and nwr to query all element types at once.
// Each category maps to 1–3 query templates (kept minimal to avoid rate limits).

interface QueryTemplate {
  /** Element type: 'node', 'nwr' (node/way/relation), etc. */
  element: string;
  /** Overpass tag filter, e.g. '["amenity"~"^(restaurant|cafe)$"]["name"]' */
  filter: string;
}

const CATEGORY_QUERIES: Record<string, QueryTemplate[]> = {
  for_you: [
    { element: 'node', filter: '["amenity"~"^(restaurant|cafe)$"]["name"]' },
    { element: 'nwr', filter: '["tourism"~"^(museum|attraction)$"]["name"]' },
    { element: 'nwr', filter: '["leisure"="park"]["name"]' },
  ],
  restaurants: [
    { element: 'node', filter: '["amenity"~"^(restaurant|fast_food)$"]["name"]' },
  ],
  cafes: [
    { element: 'node', filter: '["amenity"="cafe"]["name"]' },
  ],
  stays: [
    { element: 'node', filter: '["tourism"~"^(hotel|hostel|guest_house)$"]["name"]' },
  ],
  things_to_do: [
    { element: 'nwr', filter: '["tourism"~"^(attraction|museum)$"]["name"]' },
    { element: 'nwr', filter: '["historic"]["name"]' },
    { element: 'nwr', filter: '["leisure"="park"]["name"]' },
  ],
  nightlife: [
    { element: 'node', filter: '["amenity"~"^(bar|pub|nightclub)$"]["name"]' },
  ],
  shopping: [
    { element: 'node', filter: '["shop"]["name"]' },
  ],
};

// ── In-memory cache ──

const cache = new Map<string, { data: OSMElement[]; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function cacheKey(lat: number, lng: number, category: string, radius: number): string {
  const rLat = Math.round(lat * 1000) / 1000;
  const rLng = Math.round(lng * 1000) / 1000;
  return `${rLat},${rLng},${category},${radius}`;
}

// ── Fetch single query (tries servers in order) ──

async function fetchOverpass(query: string): Promise<OSMElement[]> {
  for (const server of OVERPASS_SERVERS) {
    try {
      const response = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });

      // On rate limit, don't try the next server — just return empty
      if (response.status === 429) {
        if (__DEV__) console.warn('[Overpass] Rate limited (429) — skipping');
        return [];
      }

      if (response.status === 504) {
        if (__DEV__) console.warn('[Overpass] Timeout (504) — trying next server');
        continue;
      }

      if (!response.ok) {
        if (__DEV__) console.warn('[Overpass] HTTP', response.status, '— trying next server');
        continue;
      }

      const text = await response.text();

      if (text.startsWith('<')) {
        if (__DEV__) console.warn('[Overpass] Got HTML — trying next server');
        continue;
      }

      const json = JSON.parse(text);

      if (json.remark?.includes('timed out')) {
        if (__DEV__) console.warn('[Overpass] Query timed out — trying next server');
        continue;
      }

      return json.elements ?? [];
    } catch (e: any) {
      if (__DEV__) console.warn('[Overpass] Network error:', e?.message ?? e);
    }
  }

  return [];
}

// ── Small delay helper ──

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main fetch ──

export async function searchOverpass(
  lat: number,
  lng: number,
  category: string,
  options?: { radius?: number; limit?: number },
): Promise<OSMElement[]> {
  const radius = options?.radius ?? 10000;
  const limit = options?.limit ?? 80;

  // Check cache
  const key = cacheKey(lat, lng, category, radius);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const templates = CATEGORY_QUERIES[category] ?? CATEGORY_QUERIES.for_you;

  if (__DEV__) console.log('[Overpass] Fetching:', category, 'at', lat.toFixed(4), lng.toFixed(4), '—', templates.length, 'queries');

  // Run queries sequentially to avoid rate limits
  const seen = new Set<string>();
  const allElements: OSMElement[] = [];

  for (let i = 0; i < templates.length; i++) {
    if (i > 0) await wait(500); // Small gap between queries

    const { element, filter } = templates[i];
    const query = `[out:json][timeout:15];${element}${filter}(around:${radius},${lat},${lng});out center body qt ${limit};`;

    const elements = await fetchOverpass(query);

    for (const el of elements) {
      const uid = `${el.type}:${el.id}`;
      if (!seen.has(uid)) {
        seen.add(uid);
        allElements.push(el);
      }
    }
  }

  if (__DEV__) console.log('[Overpass] Got', allElements.length, 'elements for', category);

  // Filter to elements with coordinates
  const withCoords = allElements.filter(
    (el) => (el.lat != null && el.lon != null) || el.center != null,
  );

  const trimmed = withCoords.slice(0, limit);
  cache.set(key, { data: trimmed, ts: Date.now() });

  return trimmed;
}

/** Text search: filter cached/fetched results by name match */
export function filterByName(elements: OSMElement[], query: string): OSMElement[] {
  const q = query.toLowerCase().trim();
  if (!q) return elements;

  const terms = q.split(/\s+/);
  return elements.filter((el) => {
    const name = (el.tags?.name ?? '').toLowerCase();
    const cuisine = (el.tags?.cuisine ?? '').toLowerCase();
    const amenity = (el.tags?.amenity ?? '').toLowerCase();
    const tourism = (el.tags?.tourism ?? '').toLowerCase();
    const shop = (el.tags?.shop ?? '').toLowerCase();
    const searchable = `${name} ${cuisine} ${amenity} ${tourism} ${shop}`;
    return terms.every((t) => searchable.includes(t));
  });
}

/** Clear the cache (e.g. on location change) */
export function clearOverpassCache(): void {
  cache.clear();
}
