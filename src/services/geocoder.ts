/**
 * Photon geocoder — free geocoding + autocomplete powered by OpenStreetMap.
 * No API key required. Hosted by Komoot.
 *
 * Rate limit: ~1 req/sec on public instance.
 */

const PHOTON_API = 'https://photon.komoot.io';

// ── Types ──

export interface GeocoderResult {
  name: string;
  city?: string;
  state?: string;
  country?: string;
  lat: number;
  lng: number;
  /** Full display label */
  label: string;
}

// ── Autocomplete (search-as-you-type for cities) ──

let lastAutocompleteTs = 0;
const MIN_INTERVAL = 1100; // respect 1 req/sec

export async function autocompleteCity(query: string): Promise<GeocoderResult[]> {
  if (!query.trim() || query.trim().length < 2) return [];

  // Rate limiting
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastAutocompleteTs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastAutocompleteTs = Date.now();

  const url = `${PHOTON_API}/api/?q=${encodeURIComponent(query.trim())}&limit=5&layer=city&lang=en`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return parsePhotonResults(data);
  } catch {
    return [];
  }
}

/** Search for any POI or place (not just cities) */
export async function searchPlace(
  query: string,
  options?: { lat?: number; lng?: number; limit?: number },
): Promise<GeocoderResult[]> {
  if (!query.trim()) return [];

  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastAutocompleteTs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastAutocompleteTs = Date.now();

  let url = `${PHOTON_API}/api/?q=${encodeURIComponent(query.trim())}&limit=${options?.limit ?? 10}&lang=en`;
  if (options?.lat != null && options?.lng != null) {
    url += `&lat=${options.lat}&lon=${options.lng}`;
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return parsePhotonResults(data);
  } catch {
    return [];
  }
}

// ── Reverse geocode ──

export async function reverseGeocode(lat: number, lng: number): Promise<GeocoderResult | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastAutocompleteTs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastAutocompleteTs = Date.now();

  const url = `${PHOTON_API}/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const results = parsePhotonResults(data);
    return results[0] ?? null;
  } catch {
    return null;
  }
}

// ── Parser ──

function parsePhotonResults(geojson: any): GeocoderResult[] {
  const features = geojson?.features ?? [];
  return features.map((f: any) => {
    const props = f.properties ?? {};
    const coords = f.geometry?.coordinates ?? [0, 0];
    const name = props.name ?? props.city ?? props.state ?? '';
    const city = props.city;
    const state = props.state;
    const country = props.country;

    // Build display label
    const parts = [name];
    if (city && city !== name) parts.push(city);
    if (state && state !== city && state !== name) parts.push(state);
    if (country) parts.push(country);

    return {
      name,
      city,
      state,
      country,
      lat: coords[1],
      lng: coords[0],
      label: parts.join(', '),
    };
  });
}
