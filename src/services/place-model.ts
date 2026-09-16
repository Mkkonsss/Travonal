/**
 * Normalized Place model — single source of truth for all place data
 * in Explore, detail pages, imports, and trip activities.
 */

export type PlaceSource = 'google' | 'sample' | 'osm';

export type TravonalCategory =
  | 'food/restaurant'
  | 'food/cafe'
  | 'food/bakery'
  | 'food/bar'
  | 'food/other'
  | 'activity/museum'
  | 'activity/park'
  | 'activity/attraction'
  | 'activity/entertainment'
  | 'activity/sport'
  | 'activity/other'
  | 'stay/hotel'
  | 'stay/hostel'
  | 'stay/other'
  | 'shopping'
  | 'transport'
  | 'other';

export interface PlacePhoto {
  reference: string; // Google photo reference, URL, or 'pending' for lazy-loaded free photos
  width?: number;
  height?: number;
  /** Display name of the photo contributor */
  authorName?: string;
}

export interface OpeningPeriod {
  open: string;   // HH:MM
  close: string;  // HH:MM
  day: number;    // 0=Sunday
}

export interface NormalizedPlace {
  // Identity
  placeId?: string;           // Google Place ID
  source: PlaceSource;

  // Core
  name: string;
  address?: string;
  city?: string;
  country?: string;

  // Coordinates
  lat?: number;
  lng?: number;

  // Taxonomy
  googleTypes?: string[];
  category: TravonalCategory;

  // Quality
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;        // 0-4

  // Hours
  openNow?: boolean;
  openingHours?: string[];    // human-readable lines
  periods?: OpeningPeriod[];

  // Contact
  website?: string;
  phone?: string;
  googleMapsUri?: string;

  // Media
  photos?: PlacePhoto[];

  // Bookability
  reservable?: boolean;       // Google's reservable flag — gold standard signal

  // Discovery metadata
  distance?: number;          // metres from explore location
  matchReasons?: string[];    // personalization explanations
  description?: string;
}

/**
 * Google place type -> Travonal category.
 *
 * IMPORTANT: Order matters! Google assigns `point_of_interest` to nearly every
 * place, so specific types (lodging, shopping, entertainment, etc.) MUST be
 * checked BEFORE the tourist_attraction / point_of_interest catch-all.
 */
export function mapGoogleTypeToCategory(types: string[]): TravonalCategory {
  const t = types ?? [];
  // Food — most specific first
  if (t.includes('cafe') || t.includes('coffee_shop')) return 'food/cafe';
  if (t.includes('bakery')) return 'food/bakery';
  if (t.includes('bar') || t.includes('night_club')) return 'food/bar';
  if (t.includes('restaurant') || t.includes('food')) return 'food/restaurant';
  // Stays
  if (t.includes('lodging') || t.includes('hotel') || t.includes('resort_hotel')
    || t.includes('extended_stay_hotel')) return 'stay/hotel';
  if (t.includes('hostel')) return 'stay/hostel';
  if (t.includes('motel') || t.includes('bed_and_breakfast')
    || t.includes('guest_house') || t.includes('cottage')) return 'stay/other';
  // Museums & galleries
  if (t.includes('museum') || t.includes('art_gallery')) return 'activity/museum';
  // Entertainment — ticketed venues
  if (t.includes('amusement_park') || t.includes('bowling_alley') || t.includes('movie_theater')
    || t.includes('zoo') || t.includes('aquarium') || t.includes('theme_park')
    || t.includes('water_park') || t.includes('casino') || t.includes('concert_hall')) return 'activity/entertainment';
  // Sports & wellness
  if (t.includes('gym') || t.includes('stadium') || t.includes('spa') || t.includes('golf_course')) return 'activity/sport';
  // Shopping
  if (t.includes('shopping_mall') || t.includes('store') || t.includes('clothing_store')) return 'shopping';
  // Parks & nature
  if (t.includes('park') || t.includes('natural_feature')) return 'activity/park';
  // Generic catch-all — only reached when no specific type matched above
  if (t.includes('tourist_attraction') || t.includes('point_of_interest')) return 'activity/attraction';
  return 'activity/other';
}

/** Map Travonal category to Activity type for trip integration */
export function categoryToActivityType(
  cat: TravonalCategory,
): 'activity' | 'food' | 'hotel' | 'flight' {
  if (cat.startsWith('food/')) return 'food';
  if (cat.startsWith('stay/')) return 'hotel';
  return 'activity';
}

/** Price level label — only meaningful for food/stay categories */
export function priceLevelLabel(level?: number, category?: TravonalCategory): string {
  if (level == null) return '';
  // Don't show price tier for non-food/stay places (e.g. Eiffel Tower shouldn't show $$)
  if (category && !category.startsWith('food/') && !category.startsWith('stay/')) return '';
  return ['Free', '$', '$$', '$$$', '$$$$'][level] ?? '';
}

/** Convert a raw Google place type string to a human-readable label */
export function humanizeGoogleType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Returns 1–3 human-readable type labels for display,
 * filtering out overly generic types.
 */
const SKIP_TYPES = new Set([
  'point_of_interest', 'establishment', 'premise', 'geocode',
  'political', 'locality', 'sublocality', 'route', 'country',
  'administrative_area_level_1', 'administrative_area_level_2',
  // Non-travel-relevant types that confuse users
  'travel_agency', 'insurance_agency', 'real_estate_agency',
  'accounting', 'lawyer', 'dentist', 'doctor', 'hospital',
  'physiotherapist', 'veterinary_care', 'car_dealer', 'car_rental',
  'car_repair', 'car_wash', 'gas_station', 'parking',
  'post_office', 'bank', 'atm', 'finance', 'local_government_office',
  'city_hall', 'courthouse', 'fire_station', 'police',
  'school', 'university', 'library', 'church', 'mosque', 'synagogue',
  'hindu_temple', 'cemetery', 'funeral_home',
  'electrician', 'plumber', 'roofing_contractor', 'painter',
  'moving_company', 'storage', 'locksmith', 'laundry',
  'hardware_store', 'home_goods_store', 'furniture_store',
]);

/** Friendlier display names for common Google types */
const TYPE_DISPLAY_NAMES: Record<string, string> = {
  tourist_attraction: 'Attraction',
  natural_feature: 'Nature',
  night_club: 'Nightclub',
  shopping_mall: 'Mall',
  clothing_store: 'Fashion',
  book_store: 'Bookshop',
  department_store: 'Store',
  convenience_store: 'Shop',
  meal_delivery: 'Delivery',
  meal_takeaway: 'Takeaway',
  movie_theater: 'Cinema',
  amusement_park: 'Theme Park',
  bowling_alley: 'Bowling',
  art_gallery: 'Gallery',
  beauty_salon: 'Salon',
  hair_care: 'Salon',
  transit_station: 'Station',
  subway_station: 'Metro',
  train_station: 'Station',
  bus_station: 'Bus Stop',
  rv_park: 'RV Park',
  campground: 'Campground',
  lodging: 'Hotel',
};

export function formatGoogleTypes(types?: string[]): string {
  if (!types || types.length === 0) return '';
  const filtered = types.filter((t) => !SKIP_TYPES.has(t));
  if (filtered.length === 0) return '';
  return filtered
    .slice(0, 1)
    .map((t) => TYPE_DISPLAY_NAMES[t] ?? humanizeGoogleType(t))
    .join('');
}

/** Format distance for display */
export function formatDistance(metres?: number): string {
  if (metres == null) return '';
  if (metres < 1000) return Math.round(metres) + 'm';
  return (metres / 1000).toFixed(1) + ' km';
}

// ── OSM tag → category mapping ──

export function mapOSMTagsToCategory(tags: Record<string, string>): TravonalCategory {
  const amenity = tags.amenity ?? '';
  const tourism = tags.tourism ?? '';
  const shop = tags.shop ?? '';
  const leisure = tags.leisure ?? '';
  const historic = tags.historic ?? '';

  if (amenity === 'restaurant' || amenity === 'fast_food') return 'food/restaurant';
  if (amenity === 'cafe') return 'food/cafe';
  if (amenity === 'bar' || amenity === 'pub' || amenity === 'biergarten') return 'food/bar';
  if (amenity === 'nightclub') return 'food/bar';
  if (amenity === 'bakery') return 'food/bakery';
  if (tourism === 'hotel' || tourism === 'motel') return 'stay/hotel';
  if (tourism === 'hostel') return 'stay/hostel';
  if (tourism === 'guest_house' || tourism === 'apartment') return 'stay/other';
  if (tourism === 'museum' || tourism === 'gallery') return 'activity/museum';
  if (tourism === 'attraction' || tourism === 'artwork' || historic) return 'activity/attraction';
  if (leisure === 'park' || leisure === 'garden' || leisure === 'nature_reserve') return 'activity/park';
  if (amenity === 'theatre' || amenity === 'cinema') return 'activity/entertainment';
  if (amenity === 'gym' || leisure === 'stadium' || leisure === 'sports_centre') return 'activity/sport';
  if (shop) return 'shopping';
  return 'activity/other';
}

/** Build a human-readable category label from OSM tags */
export function osmCategoryLabel(tags: Record<string, string>): string {
  const cuisine = tags.cuisine;
  const amenity = tags.amenity;
  const tourism = tags.tourism;
  const shop = tags.shop;
  const leisure = tags.leisure;
  const historic = tags.historic;

  // Prefer cuisine for food places
  if (cuisine) {
    const first = cuisine.split(';')[0].split(',')[0].trim();
    const label = first.charAt(0).toUpperCase() + first.slice(1);
    if (amenity === 'restaurant') return `${label} Restaurant`;
    if (amenity === 'cafe') return `${label} Café`;
    return label;
  }

  if (amenity === 'restaurant') return 'Restaurant';
  if (amenity === 'cafe') return 'Café';
  if (amenity === 'bar') return 'Bar';
  if (amenity === 'pub') return 'Pub';
  if (amenity === 'nightclub') return 'Nightclub';
  if (amenity === 'fast_food') return 'Fast Food';
  if (amenity === 'bakery') return 'Bakery';
  if (amenity === 'biergarten') return 'Beer Garden';
  if (amenity === 'theatre') return 'Theatre';
  if (amenity === 'cinema') return 'Cinema';
  if (tourism === 'hotel') return 'Hotel';
  if (tourism === 'hostel') return 'Hostel';
  if (tourism === 'guest_house') return 'Guest House';
  if (tourism === 'museum') return 'Museum';
  if (tourism === 'gallery') return 'Gallery';
  if (tourism === 'attraction') return 'Attraction';
  if (tourism === 'artwork') return 'Artwork';
  if (historic === 'castle') return 'Castle';
  if (historic === 'monument') return 'Monument';
  if (historic === 'memorial') return 'Memorial';
  if (historic === 'ruins') return 'Ruins';
  if (historic === 'church') return 'Church';
  if (historic) return 'Historic Site';
  if (leisure === 'park') return 'Park';
  if (leisure === 'garden') return 'Garden';
  if (shop === 'mall') return 'Shopping Mall';
  if (shop === 'supermarket') return 'Supermarket';
  if (shop === 'clothes') return 'Clothing Store';
  if (shop === 'books') return 'Bookstore';
  if (shop) return 'Shop';
  return 'Place';
}

/** Normalize an OSM Overpass element into NormalizedPlace */
export function normalizeOSMPlace(element: {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}): NormalizedPlace {
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;

  // Build address from addr:* tags
  const addrParts = [
    tags['addr:housenumber'],
    tags['addr:street'],
  ].filter(Boolean);
  const cityParts = [
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter(Boolean);
  const fullAddr = [...addrParts, ...cityParts].join(', ') || undefined;

  // Build description from available tags
  const descParts: string[] = [];
  if (tags.cuisine) {
    const cuisines = tags.cuisine.split(';').map((c) => c.trim()).slice(0, 3);
    descParts.push(cuisines.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(', '));
  }
  if (tags.description) descParts.push(tags.description);
  else if (tags['description:en']) descParts.push(tags['description:en']);

  const place: NormalizedPlace = {
    placeId: `osm:${element.type}:${element.id}`,
    source: 'osm',
    name: tags.name ?? tags['name:en'] ?? 'Unknown place',
    address: fullAddr,
    city: tags['addr:city'],
    country: tags['addr:country'],
    lat,
    lng,
    category: mapOSMTagsToCategory(tags),
    openingHours: tags.opening_hours ? [tags.opening_hours] : undefined,
    website: tags.website ?? tags['contact:website'],
    phone: tags.phone ?? tags['contact:phone'],
    description: descParts.join(' — ') || undefined,
  };

  // Preserve OSM tags for photo lookup (image, wikimedia_commons, brand, cuisine)
  (place as any)._osmTags = tags;

  return place;
}

/** Normalize a raw Google Places (New API) result into NormalizedPlace */
export function normalizeGooglePlace(raw: Record<string, unknown>): NormalizedPlace {
  const displayName = raw.displayName as Record<string, string> | undefined;
  const name = displayName?.text ?? String(raw.name ?? 'Unknown place');
  const location = raw.location as Record<string, number> | undefined;
  const types = (raw.types as string[]) ?? [];
  const photos = (raw.photos as Record<string, unknown>[]) ?? [];
  const currentOpeningHours = raw.currentOpeningHours as Record<string, unknown> | undefined;
  const editorialSummary = raw.editorialSummary as Record<string, string> | undefined;

  return {
    placeId: raw.id as string | undefined,
    source: 'google',
    name,
    address: raw.formattedAddress as string | undefined,
    lat: location?.latitude,
    lng: location?.longitude,
    googleTypes: types,
    category: mapGoogleTypeToCategory(types),
    rating: raw.rating as number | undefined,
    reviewCount: raw.userRatingCount as number | undefined,
    priceLevel: raw.priceLevel as number | undefined,
    openNow: currentOpeningHours?.openNow as boolean | undefined,
    openingHours: currentOpeningHours?.weekdayDescriptions as string[] | undefined,
    website: raw.websiteUri as string | undefined,
    phone: raw.nationalPhoneNumber as string | undefined,
    googleMapsUri: raw.googleMapsUri as string | undefined,
    photos: photos.slice(0, 10).map((p) => {
      const attributions = p.authorAttributions as Record<string, string>[] | undefined;
      return {
        reference: p.name as string,
        width: p.widthPx as number | undefined,
        height: p.heightPx as number | undefined,
        authorName: attributions?.[0]?.displayName,
      };
    }),
    description: editorialSummary?.text,
    reservable: raw.reservable as boolean | undefined,
  };
}
