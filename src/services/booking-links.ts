/**
 * Booking link generator — constructs affiliate links routed through Booking.com.
 * Booking.com covers hotels, attractions, flights, and car rentals — one partner for everything.
 *
 * The affiliate ID is read from the EXPO_PUBLIC_BOOKING_COM_AID environment variable.
 * When empty, links are still generated but without tracking params.
 */

import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { Platform } from 'react-native';

import type { Activity } from '@/context/trips';

// Single affiliate ID — Booking.com covers hotels, attractions, flights, car rentals
const BOOKING_AID = process.env.EXPO_PUBLIC_BOOKING_COM_AID ?? '';

export type BookingPlatform =
  | 'booking_com'
  | 'booking_com_attractions'
  | 'booking_com_flights'
  | 'google_maps'
  | 'opentable'
  | 'google_search';

export interface BookingLink {
  url: string;
  platform: BookingPlatform;
  label: string; // "Book on Booking.com", "Reserve on OpenTable", etc.
  shortLabel: string; // "Book", "Reserve", "Find flights"
  price?: number; // Future: actual price from API
  currency?: string; // Future: currency code
  available?: boolean; // Future: availability from API
}

/**
 * Open a booking link in the in-app browser (SFSafariViewController / Chrome Custom Tab).
 * On web, opens in a new tab.
 */
export async function openBookingLink(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
  } else {
    await openBrowserAsync(url, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  }
}

/** Append the Booking.com affiliate ID to a URL if configured. */
function withAid(url: string): string {
  if (!BOOKING_AID) return url;
  return url + (url.includes('?') ? '&' : '?') + `aid=${BOOKING_AID}`;
}

/**
 * Generate booking links for an activity based on its type and available data.
 * Returns multiple options when applicable (e.g. both Booking.com and Google Maps for hotels).
 */
export function getBookingLinks(
  activity: Activity,
  tripStartDate: string,
  tripEndDate: string,
  destination: string,
  travelers?: number,
): BookingLink[] {
  switch (activity.type) {
    case 'hotel':
      return getHotelLinks(activity, tripStartDate, tripEndDate, travelers);
    case 'flight':
      return getFlightLinks(activity, tripStartDate, destination);
    case 'food':
      return getRestaurantLinks(activity, tripStartDate, travelers);
    case 'activity': {
      const tl = activity.title.toLowerCase();
      if (/walk|stroll|neighbourhood|neighborhood|wander|hike|trail|river walk|explore|promenade/i.test(tl)) {
        return getDirectionsLinks(activity);
      }
      return getExperienceLinks(activity, tripStartDate, destination);
    }
    default:
      return [];
  }
}

/**
 * Get the primary (best) booking link for an activity.
 */
export function getPrimaryBookingLink(
  activity: Activity,
  tripStartDate: string,
  tripEndDate: string,
  destination: string,
  travelers?: number,
): BookingLink | null {
  const links = getBookingLinks(activity, tripStartDate, tripEndDate, destination, travelers);
  return links[0] ?? null;
}

/**
 * Whether an activity is "bookable" — has a type that typically requires booking.
 */
export function isBookableActivity(activity: Activity): boolean {
  return activity.type === 'hotel' || activity.type === 'flight' ||
    activity.type === 'food' || activity.type === 'activity';
}

/**
 * Determine if a place should show a booking/tickets/reservation CTA.
 *
 * Uses category (set by mapGoogleTypeToCategory which now has correct priority
 * ordering) plus Google's `reservable` flag as a gold-standard override.
 */
export function isBookablePlace(opts: {
  category: string;
  reservable?: boolean;
  priceLevel?: number;
}): boolean {
  const { category, reservable, priceLevel } = opts;

  // Google's reservable flag is the gold standard — overrides all heuristics
  if (reservable === true) return true;

  // Stays — always bookable
  if (category.startsWith('stay/')) return true;

  // Museums & galleries — almost always ticketed
  if (category === 'activity/museum') return true;

  // Entertainment — amusement parks, cinemas, zoos, etc. — always bookable
  if (category === 'activity/entertainment') return true;

  // Restaurants — reservations make sense
  if (category === 'food/restaurant') return true;

  // Bars — bookable unless clearly budget/free
  if (category === 'food/bar') {
    return priceLevel == null || priceLevel >= 1;
  }

  // Sports & wellness (spa, golf) — bookable
  if (category === 'activity/sport') {
    return priceLevel == null || priceLevel >= 1;
  }

  // Attractions (tourist_attraction/point_of_interest catch-all) — not bookable
  // After the mapping fix, only genuine unclassified attractions land here.
  // These are typically free landmarks, churches, plazas, viewpoints, etc.
  // The reservable override above catches any that ARE bookable.

  // Everything else (parks, cafes, bakeries, shopping, transport, other) — not bookable
  return false;
}

/**
 * Get the short CTA label for a bookable place.
 * Returns null for non-bookable categories.
 */
export function getBookableCTA(category: string): string | null {
  const prefix = category.split('/')[0];
  switch (prefix) {
    case 'stay':
      return 'Book';
    case 'food':
      return 'Reserve';
    case 'activity':
      return category === 'activity/sport' ? 'Book' : 'Get Tickets';
    default:
      return 'Book';
  }
}

/**
 * Compute trip readiness — what fraction of bookable activities are booked.
 * Returns { booked, pending, unbooked, total, percentage }.
 */
export function getTripReadiness(activities: Activity[]): {
  booked: number;
  pending: number;
  unbooked: number;
  total: number;
  percentage: number;
} {
  const bookable = activities.filter(isBookableActivity);
  const booked = bookable.filter((a) => a.bookingStatus === 'booked').length;
  const pending = bookable.filter((a) => a.bookingStatus === 'pending').length;
  const unbooked = bookable.length - booked - pending;
  const percentage = bookable.length > 0 ? Math.round((booked / bookable.length) * 100) : 100;
  return { booked, pending, unbooked, total: bookable.length, percentage };
}

/**
 * Generate booking links from place data (category-based).
 * Used on the place-detail screen where we have TravonalCategory instead of Activity.
 */
export function getPlaceBookingLinks(
  placeName: string,
  category: string,
  destination: string,
  dates?: { checkIn: string; checkOut: string },
  travelers?: number,
): BookingLink[] {
  const links: BookingLink[] = [];
  const query = encodeURIComponent(placeName);
  const destQuery = encodeURIComponent(destination);
  const guests = travelers ?? 2;
  const prefix = category.split('/')[0];

  if (prefix === 'stay') {
    // Hotels / hostels / accommodations
    let url = `https://www.booking.com/searchresults.html?ss=${query}+${destQuery}&group_adults=${guests}`;
    if (dates) {
      url += `&checkin=${dates.checkIn}&checkout=${dates.checkOut}`;
    }
    links.push({
      url: withAid(url),
      platform: 'booking_com',
      label: 'Search on Booking.com',
      shortLabel: 'Book hotel',
    });
  } else if (prefix === 'activity' || prefix === 'attraction') {
    // Activities / tours / museums
    const url = `https://www.booking.com/attractions/searchresults.html?query=${query}+${destQuery}`;
    links.push({
      url: withAid(url),
      platform: 'booking_com_attractions',
      label: 'Find on Booking.com',
      shortLabel: 'Find tickets',
    });
  } else if (prefix === 'food') {
    // Restaurants — Booking.com doesn't do restaurant reservations, use OpenTable
    let otUrl = `https://www.opentable.com/s?term=${query}&covers=${guests}`;
    if (dates?.checkIn) {
      otUrl += `&dateTime=${dates.checkIn}T19:00`;
    }
    links.push({
      url: otUrl,
      platform: 'opentable',
      label: 'Search on OpenTable',
      shortLabel: 'Reserve',
    });
  }

  return links;
}

/**
 * Get the short CTA label for a place category.
 */
export function getPlaceBookingLabel(category: string): string {
  const prefix = category.split('/')[0];
  switch (prefix) {
    case 'stay': return 'Book hotel';
    case 'activity':
    case 'attraction': return 'Find tickets';
    case 'food': return 'Reserve';
    default: return 'Book';
  }
}

/**
 * Get the section title for the booking CTA area on place-detail.
 */
export function getPlaceBookingSectionTitle(category: string): string {
  const prefix = category.split('/')[0];
  switch (prefix) {
    case 'stay': return 'Book this stay';
    case 'activity':
    case 'attraction': return 'Find tickets & tours';
    case 'food': return 'Make a reservation';
    default: return 'Book';
  }
}

// ---------- Per-type link generators ----------

function getHotelLinks(
  activity: Activity,
  checkIn: string,
  checkOut: string,
  travelers?: number,
): BookingLink[] {
  const links: BookingLink[] = [];
  const query = encodeURIComponent(activity.title);
  const guests = travelers ?? 2;

  const url = `https://www.booking.com/searchresults.html?ss=${query}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${guests}`;
  links.push({
    url: withAid(url),
    platform: 'booking_com',
    label: 'Search on Booking.com',
    shortLabel: 'Book hotel',
  });

  if (activity.placeId) {
    links.push({
      url: `https://www.google.com/maps/place/?q=place_id:${activity.placeId}`,
      platform: 'google_maps',
      label: 'View on Google Maps',
      shortLabel: 'View',
    });
  }

  return links;
}

function getFlightLinks(
  activity: Activity,
  tripStartDate: string,
  destination: string,
): BookingLink[] {
  const links: BookingLink[] = [];
  const destQuery = encodeURIComponent(destination);

  // Booking.com flights
  const url = `https://www.booking.com/flights/searchresults.html?search=${destQuery}&depart=${tripStartDate}`;
  links.push({
    url: withAid(url),
    platform: 'booking_com_flights',
    label: 'Search on Booking.com',
    shortLabel: 'Find flights',
  });

  return links;
}

function getRestaurantLinks(
  activity: Activity,
  tripDate: string,
  travelers?: number,
): BookingLink[] {
  const links: BookingLink[] = [];
  const query = encodeURIComponent(activity.title);
  const partySize = travelers ?? 2;
  const actDate = getActivityDate(tripDate, activity.day);

  // Google Maps reserve — works for many restaurants
  if (activity.placeId) {
    links.push({
      url: `https://www.google.com/maps/place/?q=place_id:${activity.placeId}`,
      platform: 'google_maps',
      label: 'Reserve on Google Maps',
      shortLabel: 'Reserve',
    });
  }

  // OpenTable search
  links.push({
    url: `https://www.opentable.com/s?term=${query}&dateTime=${actDate}T${activity.time}&covers=${partySize}`,
    platform: 'opentable',
    label: 'Search on OpenTable',
    shortLabel: 'Reserve',
  });

  return links;
}

function getDirectionsLinks(activity: Activity): BookingLink[] {
  const links: BookingLink[] = [];
  if (activity.placeId) {
    links.push({
      url: `https://www.google.com/maps/place/?q=place_id:${activity.placeId}`,
      platform: 'google_maps',
      label: 'View on Google Maps',
      shortLabel: 'Get directions',
    });
  } else if (activity.address) {
    links.push({
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address)}`,
      platform: 'google_maps',
      label: 'View on Google Maps',
      shortLabel: 'Get directions',
    });
  }
  return links;
}

function getExperienceLinks(
  activity: Activity,
  tripStartDate: string,
  destination: string,
): BookingLink[] {
  const links: BookingLink[] = [];
  const query = encodeURIComponent(activity.title);
  const destQuery = encodeURIComponent(destination);

  // Booking.com attractions
  const url = `https://www.booking.com/attractions/searchresults.html?query=${query}+${destQuery}`;
  links.push({
    url: withAid(url),
    platform: 'booking_com_attractions',
    label: 'Find on Booking.com',
    shortLabel: 'Find tickets',
  });

  // Google Maps if we have placeId
  if (activity.placeId) {
    links.push({
      url: `https://www.google.com/maps/place/?q=place_id:${activity.placeId}`,
      platform: 'google_maps',
      label: 'View on Google Maps',
      shortLabel: 'View',
    });
  }

  return links;
}

// ---------- Helpers ----------

/** Compute the calendar date for a given trip day number. */
function getActivityDate(tripStartDate: string, dayNumber: number): string {
  const start = new Date(tripStartDate + 'T00:00:00');
  start.setDate(start.getDate() + dayNumber - 1);
  return start.toISOString().split('T')[0];
}

/** Get a user-friendly platform name. */
export function platformDisplayName(platform: BookingPlatform): string {
  switch (platform) {
    case 'booking_com': return 'Booking.com';
    case 'booking_com_attractions': return 'Booking.com';
    case 'booking_com_flights': return 'Booking.com';
    case 'google_maps': return 'Google Maps';
    case 'opentable': return 'OpenTable';
    case 'google_search': return 'Google';
  }
}
