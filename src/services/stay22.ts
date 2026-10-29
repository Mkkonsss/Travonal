/**
 * Stay22 "Allez" deep links — every Booking.com link goes through Stay22 so bookings
 * are credited to our affiliate ID.
 *
 * Hotels are matched to their exact Booking.com page in one of three tiers:
 *   exact — we know the hotel's Booking.com URL → passed through as `link=`
 *   name  — hotel name + coordinates/address → Stay22 resolves the Booking.com hotel at click time
 *   area  — no usable name (generic word or bare chain brand) → Booking.com search around the place
 *
 * The app opens these Stay22 links as they are and lets Stay22 decide where they land — the hotel's
 * own page, or a results list with the hotel first. Stay22 asks partners to share only its links,
 * never the Booking.com pages they lead to (those aren't credited), and not to bypass its landing.
 *
 * Activities: Booking.com's activities page with the activity's name typed in — its activities
 * search needs a city number we don't have, and asking Stay22 for one would mean bypassing it.
 *
 * Pure module (no React Native imports) so it can be unit-tested under Node.
 */

import { STAY22_AID } from '@/constants/affiliates';

const ALLEZ_BOOKING_URL = 'https://www.stay22.com/allez/booking';
const BOOKING_ATTRACTIONS_URL = 'https://www.booking.com/attractions';

/** Booking.com caps a standard reservation at 30 nights. */
const MAX_NIGHTS = 30;
const MAX_ADULTS = 30;

export type HotelMatch = 'exact' | 'name' | 'area';

/** Which surface a click came from — shows up as `label=tripseek-app_<campaign>` in Stay22 reports. */
export type Stay22Campaign =
  | 'place_detail'
  | 'stay_sheet'
  | 'bookings_tab'
  | 'trip_timeline'
  | 'stays_strip'
  | 'add_trip'
  | 'explore_map'
  | 'flights_strip'
  | 'chat';

export interface HotelTarget {
  name?: string;
  lat?: number;
  lng?: number;
  /** Formatted address, or "City, Country" when that's all we have. */
  address?: string;
  /** Known Booking.com hotel page — gives an exact match. */
  bookingComUrl?: string;
}

export interface Stay22HotelOptions {
  campaign: Stay22Campaign;
  checkIn?: string; // YYYY-MM-DD
  checkOut?: string; // YYYY-MM-DD
  adults?: number;
  /** Local YYYY-MM-DD — injectable for tests. */
  today?: string;
}

// Booking.com hotel page: /hotel/<cc>/<slug>[.<locale>].html — anchored so look-alike hosts don't pass.
const BOOKING_HOTEL_URL = /^https?:\/\/(?:www\.|m\.)?booking\.com\/hotel\/([a-z]{2})\/([\w-]+?)(?:\.[a-z]{2}(?:-[a-z]{2,4})?)?\.html(?:[?#].*)?$/i;
const BOOKING_URL = /^https:\/\/(?:www\.)?booking\.com\//i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// AI-written itinerary titles often wrap the hotel name: "Check-in at Hotel X", "Stay at X", "X (check-in)".
const NAME_PREFIX = /^\s*(?:check[\s-]?(?:in(?:to)?|out)|stay)\b\s*(?:(?:at|from|to)\b|[:\-–])?\s*/i;
const NAME_SUFFIX = /\s*[-–:(]?\s*check[\s-]?(?:in|out)\)?\s*$/i;
// "Hotel in Le Marais", "Stay near the station" — a placeholder, not a property name.
const PLACEHOLDER_NAME = /^\s*(?:(?:a|an|your|my)\s+)?(?:hotel|stay|accommodation|lodging|airbnb|apartment|hostel|guesthouse|rental)s?\s+(?:in|near|around|by|close to)\b/i;

// Too generic for Stay22's fuzzy matcher — a bare chain brand ("Hilton") matched the wrong property in testing.
const GENERIC_STAY_NAMES = new Set([
  '', 'my', 'our', 'your', 'inn', 'motel', 'hostel', 'resort', 'stay', 'airbnb', 'apartment', 'apartments',
  'accommodation', 'guesthouse', 'guest house', 'b&b', 'bnb', 'bed & breakfast', 'bed and breakfast',
  'accor', 'best western', 'comfort inn', 'courtyard', 'crowne plaza', 'days inn', 'doubletree',
  'four seasons', 'hampton inn', 'hilton', 'holiday inn', 'holiday inn express', 'hyatt', 'ibis',
  'intercontinental', 'marriott', 'mercure', 'motel 6', 'novotel', 'premier inn', 'radisson',
  'ramada', 'ritz carlton', 'sheraton', 'sofitel', 'super 8', 'travelodge', 'westin', 'wyndham',
]);

/**
 * Build a Stay22 link that lands on the hotel's Booking.com page.
 * Returns null when there's nothing to locate the hotel by.
 */
export function buildStay22HotelLink(
  target: HotelTarget,
  opts: Stay22HotelOptions,
): { url: string; match: HotelMatch } | null {
  const dates = validStayDates(opts.checkIn, opts.checkOut, opts.today);
  const adults = opts.adults != null && Number.isInteger(opts.adults) && opts.adults >= 1 && opts.adults <= MAX_ADULTS
    ? opts.adults
    : undefined;
  const tail = {
    checkin: dates?.checkIn,
    checkout: dates?.checkOut,
    adults,
    campaign: `app_${opts.campaign}`,
  };

  const exactUrl = canonicalBookingHotelUrl(target.bookingComUrl);
  if (exactUrl) {
    return { url: allezUrl({ aid: STAY22_AID, link: exactUrl, ...tail }), match: 'exact' };
  }

  const { lat, lng } = target;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);
  const address = target.address?.trim();
  if (!hasCoords && !address) return null;

  const hotelName = cleanHotelName(target.name);
  return {
    url: allezUrl({
      aid: STAY22_AID,
      hotelname: hotelName,
      lat: hasCoords ? roundCoord(lat) : undefined,
      lng: hasCoords ? roundCoord(lng) : undefined,
      address,
      ...tail,
    }),
    match: hotelName ? 'name' : 'area',
  };
}

/** Route any Booking.com URL (attractions, flights…) through Stay22. Other URLs are returned unchanged. */
export function wrapBookingComUrl(url: string, campaign: Stay22Campaign): string {
  if (!BOOKING_URL.test(url)) return url;
  return allezUrl({ aid: STAY22_AID, link: url, campaign: `app_${campaign}` });
}

/** Stay22 link to Booking.com's activities page with the activity's name typed in. */
export function buildStay22AttractionLink(name: string, campaign: Stay22Campaign): string {
  return allezUrl({
    aid: STAY22_AID,
    link: `${BOOKING_ATTRACTIONS_URL}/index.html?query=${encodeURIComponent(name.trim())}`,
    campaign: `app_${campaign}`,
  });
}

/** Canonical `https://www.booking.com/hotel/<cc>/<slug>.html` for a Booking.com hotel page, else null. */
export function canonicalBookingHotelUrl(url?: string): string | null {
  const m = url?.trim().match(BOOKING_HOTEL_URL);
  if (!m) return null;
  return `https://www.booking.com/hotel/${m[1].toLowerCase()}/${m[2]}.html`;
}

/** Strip itinerary wrappers from a hotel title; undefined when what's left is too generic to match. */
export function cleanHotelName(name?: string): string | undefined {
  if (!name || PLACEHOLDER_NAME.test(name)) return undefined;
  const cleaned = name.replace(NAME_PREFIX, '').replace(NAME_SUFFIX, '').trim();
  const normalized = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\b(?:the|hotels?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return GENERIC_STAY_NAMES.has(normalized) ? undefined : cleaned;
}

/**
 * Dates Booking.com will accept, or null.
 * Stay22 silently swaps past dates for "tonight", so anything doubtful is dropped instead.
 */
export function validStayDates(
  checkIn?: string,
  checkOut?: string,
  today: string = localToday(),
): { checkIn: string; checkOut: string } | null {
  if (!checkIn || !checkOut || !ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return null;
  // Duration-mode trips use a 2099 placeholder anchor
  if (checkIn.startsWith('2099')) return null;
  if (checkIn < today || checkOut <= checkIn) return null;
  const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
  if (!(nights >= 1 && nights <= MAX_NIGHTS)) return null;
  return { checkIn, checkOut };
}

// ---------- Helpers ----------

function allezUrl(params: Record<string, string | number | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${ALLEZ_BOOKING_URL}?${query}`;
}

function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function localToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
