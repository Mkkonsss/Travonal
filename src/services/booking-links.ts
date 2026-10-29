/**
 * Booking link generator — hotels, attractions and flights go to Booking.com through
 * Stay22 (see stay22.ts) so bookings are credited to our affiliate ID. Hotels deep-link
 * to the exact property; restaurants go to their own website, or Google Maps without one.
 */

import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { Platform } from 'react-native';

import type { Activity, Trip } from '@/context/trips';
import {
  buildStay22AttractionLink,
  buildStay22HotelLink,
  wrapBookingComUrl,
  type HotelMatch,
  type HotelTarget,
  type Stay22Campaign,
} from '@/services/stay22';

export type BookingPlatform =
  | 'booking_com'
  | 'booking_com_attractions'
  | 'booking_com_flights'
  | 'google_maps'
  | 'restaurant_website'
  | 'google_search';

export interface BookingLink {
  url: string;
  platform: BookingPlatform;
  label: string; // "Book on Booking.com", "Reserve on their website", etc.
  shortLabel: string; // "Book", "Reserve", "Find flights"
  price?: number; // Future: actual price from API
  currency?: string; // Future: currency code
  available?: boolean; // Future: availability from API
  match?: HotelMatch; // Hotels only — how precisely the link targets the property
}

export interface StayDates {
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
}

/** Extra trip context for activity links. */
export interface ActivityBookingOptions {
  country?: string;
  /** false when the trip's start/end dates are placeholders (duration-mode trips). */
  datesKnown?: boolean;
  /** Exact nights for a hotel — defaults to the whole trip. */
  stayDates?: StayDates;
  campaign?: Stay22Campaign;
}

/** Extra place context for place-detail / explore / suggestion links. */
export interface PlaceBookingOptions {
  lat?: number;
  lng?: number;
  address?: string;
  country?: string;
  /** Known Booking.com hotel page — gives an exact match. */
  bookingComUrl?: string;
  campaign?: Stay22Campaign;
  /** The place's own website — where a restaurant's Reserve goes. */
  website?: string;
  /** Google Place ID — a restaurant without a website opens on Google Maps. */
  placeId?: string;
}

let bookingLinkOpening = false;

/**
 * Open a booking link in the in-app browser (SFSafariViewController / Chrome Custom Tab); on web,
 * in a new tab. Stay22 links are opened exactly as built — Stay22 only credits bookings that come
 * through its own links, and decides itself where they land.
 */
export async function openBookingLink(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
    return;
  }
  // The browser takes a moment to appear — ignore repeat taps meanwhile
  if (bookingLinkOpening) return;
  bookingLinkOpening = true;
  try {
    await openBrowserAsync(url, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  } finally {
    bookingLinkOpening = false;
  }
}

/** The trip's full date range as stay dates, or undefined when the dates are placeholders. */
export function tripStayDates(trip?: Pick<Trip, 'startDate' | 'endDate' | 'datesKnown'> | null): StayDates | undefined {
  if (!trip || trip.datesKnown === false || !trip.startDate || !trip.endDate) return undefined;
  return { checkIn: trip.startDate, checkOut: trip.endDate };
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
  options: ActivityBookingOptions = {},
): BookingLink[] {
  const campaign = options.campaign ?? 'trip_timeline';
  switch (activity.type) {
    case 'hotel': {
      const stay = options.stayDates
        ?? (options.datesKnown === false ? undefined : { checkIn: tripStartDate, checkOut: tripEndDate });
      return getHotelLinks(activity, destinationLabel(destination, options.country), stay, travelers, campaign);
    }
    case 'flight':
      return getFlightLinks(activity, options.datesKnown === false ? undefined : tripStartDate, destination, campaign);
    case 'food':
      return getRestaurantLinks(activity.title, activity.website, activity.placeId, activity.address || destination);
    case 'activity': {
      const tl = activity.title.toLowerCase();
      if (/walk|stroll|neighbourhood|neighborhood|wander|hike|trail|river walk|explore|promenade/i.test(tl)) {
        return getDirectionsLinks(activity);
      }
      return getExperienceLinks(activity, campaign);
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
  options: ActivityBookingOptions = {},
): BookingLink | null {
  const links = getBookingLinks(activity, tripStartDate, tripEndDate, destination, travelers, options);
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
 * Used on the place-detail screen where we have ToveliCategory instead of Activity.
 */
export function getPlaceBookingLinks(
  placeName: string,
  category: string,
  destination: string,
  dates?: StayDates,
  travelers?: number,
  options: PlaceBookingOptions = {},
): BookingLink[] {
  const links: BookingLink[] = [];
  const prefix = category.split('/')[0];
  const campaign = options.campaign ?? 'place_detail';

  if (prefix === 'stay') {
    // Hotels / hostels / accommodations — deep-link to the exact property
    const hotelLink = getStay22HotelLink(
      {
        name: placeName,
        lat: options.lat,
        lng: options.lng,
        address: options.address || destinationLabel(destination, options.country),
        bookingComUrl: options.bookingComUrl,
      },
      dates,
      travelers,
      campaign,
    );
    if (hotelLink) links.push(hotelLink);
  } else if (prefix === 'activity' || prefix === 'attraction') {
    // Activities / tours / museums
    links.push({
      url: buildStay22AttractionLink(placeName, campaign),
      platform: 'booking_com_attractions',
      label: 'Find on Booking.com',
      shortLabel: 'Find tickets',
    });
  } else if (prefix === 'food') {
    links.push(...getRestaurantLinks(placeName, options.website, options.placeId, options.address || destination));
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
  destination: string,
  stay: StayDates | undefined,
  travelers: number | undefined,
  campaign: Stay22Campaign,
): BookingLink[] {
  const links: BookingLink[] = [];

  const hotelLink = getStay22HotelLink(
    {
      name: activity.title,
      lat: activity.lat,
      lng: activity.lng,
      address: activity.address || destination,
      bookingComUrl: activity.bookingComUrl,
    },
    stay,
    travelers,
    campaign,
  );
  if (hotelLink) links.push(hotelLink);

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
  tripStartDate: string | undefined,
  destination: string,
  campaign: Stay22Campaign,
): BookingLink[] {
  const links: BookingLink[] = [];
  const destQuery = encodeURIComponent(destination);

  // Booking.com flights
  let url = `https://www.booking.com/flights/searchresults.html?search=${destQuery}`;
  if (tripStartDate) url += `&depart=${tripStartDate}`;
  links.push({
    url: wrapBookingComUrl(url, campaign),
    platform: 'booking_com_flights',
    label: 'Search on Booking.com',
    shortLabel: 'Find flights',
  });

  return links;
}

/**
 * A restaurant's reservations live on its own website, so Reserve opens that. Without one it's the
 * restaurant's Google Maps page, which lists its phone, website and any table booking Google offers.
 */
function getRestaurantLinks(
  name: string,
  website: string | undefined,
  placeId: string | undefined,
  location: string,
): BookingLink[] {
  const links: BookingLink[] = [];
  const site = website?.trim();
  if (site && /^https?:\/\//i.test(site)) {
    links.push({
      url: site,
      platform: 'restaurant_website',
      label: 'Reserve on their website',
      shortLabel: 'Reserve',
    });
  }

  const onMaps = links.length === 0;
  links.push({
    url: placeId
      ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, location.trim()].filter(Boolean).join(', '))}`,
    platform: 'google_maps',
    label: onMaps ? 'Reserve on Google Maps' : 'View on Google Maps',
    shortLabel: onMaps ? 'Reserve' : 'View',
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

function getExperienceLinks(activity: Activity, campaign: Stay22Campaign): BookingLink[] {
  const links: BookingLink[] = [];

  // Booking.com attractions
  links.push({
    url: buildStay22AttractionLink(activity.title, campaign),
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

/** Stay22 deep link to a hotel's Booking.com page, labelled by how precise the match is. */
function getStay22HotelLink(
  target: HotelTarget,
  stay: StayDates | undefined,
  travelers: number | undefined,
  campaign: Stay22Campaign,
): BookingLink | null {
  const link = buildStay22HotelLink(target, {
    campaign,
    checkIn: stay?.checkIn,
    checkOut: stay?.checkOut,
    adults: travelers,
  });
  if (!link) return null;
  const nearby = link.match === 'area';
  return {
    url: link.url,
    platform: 'booking_com',
    label: nearby ? 'Find stays nearby on Booking.com' : 'Book on Booking.com',
    shortLabel: nearby ? 'Find stays' : 'Book',
    match: link.match,
  };
}

/** "Paris, France" — leaves the country off when the destination already names it. */
function destinationLabel(destination: string, country?: string): string {
  const dest = destination.trim();
  if (!country || dest.toLowerCase().includes(country.toLowerCase())) return dest;
  return dest ? `${dest}, ${country}` : country;
}

/** Get a user-friendly platform name. */
export function platformDisplayName(platform: BookingPlatform): string {
  switch (platform) {
    case 'booking_com': return 'Booking.com';
    case 'booking_com_attractions': return 'Booking.com';
    case 'booking_com_flights': return 'Booking.com';
    case 'google_maps': return 'Google Maps';
    case 'restaurant_website': return 'Restaurant website';
    case 'google_search': return 'Google';
  }
}
