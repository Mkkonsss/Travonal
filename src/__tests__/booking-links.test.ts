import { openBrowserAsync } from 'expo-web-browser';
import { getBookingLinks, getPrimaryBookingLink, isBookableActivity, getTripReadiness, getPlaceBookingLinks, getPlaceBookingLabel, getPlaceBookingSectionTitle, openBookingLink, tripStayDates } from '@/services/booking-links';
import { Activity } from '@/context/trips';

const STAY22_BOOKING = 'https://www.stay22.com/allez/booking?aid=tripseek';

function makeActivity(overrides: Partial<Activity> & { id: string; title: string; day: number; time: string; type: Activity['type'] }): Activity {
  return { ...overrides };
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

// Fixtures use June 2026 trips — freeze "today" before them so their dates count as future
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-05-01T12:00:00') });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('getBookingLinks', () => {
  test('generates a Stay22 → Booking.com link for hotels', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].platform).toBe('booking_com');
    expect(links[0].url.startsWith(STAY22_BOOKING)).toBe(true);
    expect(links[0].url).toContain('hotelname=Hotel%20Ritz');
    expect(links[0].url).toContain('checkin=2026-06-01');
    expect(links[0].url).toContain('checkout=2026-06-05');
    expect(links[0].match).toBe('name');
    expect(links[0].label).toBe('Book on Booking.com');
  });

  test('generates Google Maps link for hotel with placeId', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel', placeId: 'ChIJxyz' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    const gmaps = links.find((l) => l.platform === 'google_maps');
    expect(gmaps).toBeDefined();
    expect(gmaps!.url).toContain('ChIJxyz');
  });

  test('sends hotel coordinates, address and a known Booking.com page', () => {
    const located = makeActivity({ id: '1', title: 'Le Meurice', day: 1, time: '15:00', type: 'hotel', lat: 48.8651, lng: 2.3281, address: '228 Rue de Rivoli, Paris, France' });
    const p = params(getBookingLinks(located, '2026-06-01', '2026-06-05', 'Paris')[0].url);
    expect(p.get('lat')).toBe('48.8651');
    expect(p.get('lng')).toBe('2.3281');
    expect(p.get('address')).toBe('228 Rue de Rivoli, Paris, France');

    const exact = makeActivity({ ...located, bookingComUrl: 'https://www.booking.com/hotel/fr/le-meurice-paris.html' });
    const exactLink = getBookingLinks(exact, '2026-06-01', '2026-06-05', 'Paris')[0];
    expect(exactLink.match).toBe('exact');
    expect(params(exactLink.url).get('link')).toBe('https://www.booking.com/hotel/fr/le-meurice-paris.html');
  });

  test('prefers exact stay dates over the trip range', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 3, time: '15:00', type: 'hotel' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-10', 'Paris', 2, {
      stayDates: { checkIn: '2026-06-03', checkOut: '2026-06-06' },
    });
    expect(params(links[0].url).get('checkin')).toBe('2026-06-03');
    expect(params(links[0].url).get('checkout')).toBe('2026-06-06');
  });

  test('omits dates for duration-mode trips and past trips', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel' });
    const placeholder = getBookingLinks(activity, '2099-01-01', '2099-01-05', 'Paris', 2, { datesKnown: false });
    expect(params(placeholder[0].url).has('checkin')).toBe(false);
    const past = getBookingLinks(activity, '2026-03-01', '2026-03-05', 'Paris');
    expect(params(past[0].url).has('checkin')).toBe(false);
  });

  test('adds the trip country to the destination, without repeating it', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel' });
    expect(params(getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris', 2, { country: 'France' })[0].url).get('address')).toBe('Paris, France');
    expect(params(getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris, France', 2, { country: 'France' })[0].url).get('address')).toBe('Paris, France');
  });

  test('labels a generic hotel title as a nearby search', () => {
    const activity = makeActivity({ id: '1', title: 'Check-in at hotel', day: 1, time: '15:00', type: 'hotel' });
    const link = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris')[0];
    expect(link.match).toBe('area');
    expect(link.label).toBe('Find stays nearby on Booking.com');
    expect(link.shortLabel).toBe('Find stays');
    expect(params(link.url).has('hotelname')).toBe(false);
  });

  test('tags the click with the calling surface', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel' });
    expect(params(getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris')[0].url).get('campaign')).toBe('app_trip_timeline');
    expect(params(getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris', 2, { campaign: 'stay_sheet' })[0].url).get('campaign')).toBe('app_stay_sheet');
  });

  test('generates Booking.com flights link for flights, wrapped by Stay22', () => {
    const activity = makeActivity({ id: '1', title: 'SFO to CDG', day: 1, time: '08:00', type: 'flight' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].platform).toBe('booking_com_flights');
    expect(links[0].url.startsWith(STAY22_BOOKING)).toBe(true);
    expect(params(links[0].url).get('link')).toBe('https://www.booking.com/flights/searchresults.html?search=Paris&depart=2026-06-01');
  });

  test('omits the flight departure date for duration-mode trips', () => {
    const activity = makeActivity({ id: '1', title: 'SFO to CDG', day: 1, time: '08:00', type: 'flight' });
    const links = getBookingLinks(activity, '2099-01-01', '2099-01-05', 'Paris', 1, { datesKnown: false });
    expect(params(links[0].url).get('link')).toBe('https://www.booking.com/flights/searchresults.html?search=Paris');
  });

  test("restaurants reserve on their own website, with Google Maps after it", () => {
    const activity = makeActivity({ id: '1', title: 'Le Cinq', day: 2, time: '19:30', type: 'food', placeId: 'ChIJ_lecinq', website: 'https://www.restaurant-lecinq.com/' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.map((l) => [l.platform, l.url, l.shortLabel])).toEqual([
      ['restaurant_website', 'https://www.restaurant-lecinq.com/', 'Reserve'],
      ['google_maps', 'https://www.google.com/maps/place/?q=place_id:ChIJ_lecinq', 'View'],
    ]);
  });

  test('a restaurant without a website reserves through its Google Maps page', () => {
    const activity = makeActivity({ id: '1', title: 'Le Cinq', day: 2, time: '19:30', type: 'food', placeId: 'ChIJ_lecinq', website: 'javascript:alert(1)' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ platform: 'google_maps', url: 'https://www.google.com/maps/place/?q=place_id:ChIJ_lecinq', shortLabel: 'Reserve' });
  });

  test('a restaurant with neither is searched on Google Maps by name and address', () => {
    const activity = makeActivity({ id: '1', title: 'Le Cinq', day: 2, time: '19:30', type: 'food', address: '31 Av. George V, Paris' });
    const [link] = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(link.url).toBe('https://www.google.com/maps/search/?api=1&query=Le%20Cinq%2C%2031%20Av.%20George%20V%2C%20Paris');
    expect(getBookingLinks(makeActivity({ id: '2', title: 'Le Cinq', day: 2, time: '19:30', type: 'food' }), '2026-06-01', '2026-06-05', 'Paris')[0].url)
      .toBe('https://www.google.com/maps/search/?api=1&query=Le%20Cinq%2C%20Paris');
  });

  test('generates Booking.com attractions link for activities, wrapped by Stay22', () => {
    const activity = makeActivity({ id: '1', title: 'Eiffel Tower Tour', day: 3, time: '10:00', type: 'activity' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.some((l) => l.platform === 'booking_com_attractions')).toBe(true);
    expect(links[0].url.startsWith(`${STAY22_BOOKING}&`)).toBe(true);
    expect(params(links[0].url).get('link')).toBe('https://www.booking.com/attractions/index.html?query=Eiffel%20Tower%20Tour');
  });

  test('passes travelers count to hotel links', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel', address: 'Paris' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris', 4);
    expect(links[0].url).toContain('adults=4');
  });

  test('all non-restaurant links go through Stay22 with the tripseek aid', () => {
    const hotel = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel' });
    const flight = makeActivity({ id: '2', title: 'Flight', day: 1, time: '08:00', type: 'flight' });
    const activity = makeActivity({ id: '3', title: 'Museum', day: 1, time: '10:00', type: 'activity' });

    for (const a of [hotel, flight, activity]) {
      const links = getBookingLinks(a, '2026-06-01', '2026-06-05', 'Paris');
      expect(links[0].url.startsWith(STAY22_BOOKING)).toBe(true);
    }
  });
});

describe('getPrimaryBookingLink', () => {
  test('returns first link for bookable activity', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel' });
    const link = getPrimaryBookingLink(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(link).not.toBeNull();
    expect(link!.platform).toBe('booking_com');
  });

  test('returns non-null for activities', () => {
    const activity = makeActivity({ id: '1', title: 'Museum Tour', day: 1, time: '10:00', type: 'activity' });
    const link = getPrimaryBookingLink(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(link).not.toBeNull();
  });

  test('passes options through', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel' });
    const link = getPrimaryBookingLink(activity, '2026-06-01', '2026-06-05', 'Paris', 2, { campaign: 'bookings_tab' });
    expect(params(link!.url).get('campaign')).toBe('app_bookings_tab');
  });
});

describe('isBookableActivity', () => {
  test('returns true for hotel, flight, food, activity', () => {
    expect(isBookableActivity(makeActivity({ id: '1', title: 'A', day: 1, time: '10:00', type: 'hotel' }))).toBe(true);
    expect(isBookableActivity(makeActivity({ id: '2', title: 'B', day: 1, time: '10:00', type: 'flight' }))).toBe(true);
    expect(isBookableActivity(makeActivity({ id: '3', title: 'C', day: 1, time: '10:00', type: 'food' }))).toBe(true);
    expect(isBookableActivity(makeActivity({ id: '4', title: 'D', day: 1, time: '10:00', type: 'activity' }))).toBe(true);
  });
});

describe('getTripReadiness', () => {
  test('computes correct readiness percentages', () => {
    const activities = [
      makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel', bookingStatus: 'booked' }),
      makeActivity({ id: '2', title: 'Flight', day: 1, time: '08:00', type: 'flight', bookingStatus: 'pending' }),
      makeActivity({ id: '3', title: 'Museum', day: 1, time: '10:00', type: 'activity' }),
      makeActivity({ id: '4', title: 'Lunch', day: 1, time: '12:00', type: 'food' }),
    ];
    const readiness = getTripReadiness(activities);
    expect(readiness.total).toBe(4);
    expect(readiness.booked).toBe(1);
    expect(readiness.pending).toBe(1);
    expect(readiness.unbooked).toBe(2);
    expect(readiness.percentage).toBe(25);
  });

  test('returns 100% when all bookable activities are booked', () => {
    const activities = [
      makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel', bookingStatus: 'booked' }),
      makeActivity({ id: '2', title: 'Flight', day: 1, time: '08:00', type: 'flight', bookingStatus: 'booked' }),
    ];
    const readiness = getTripReadiness(activities);
    expect(readiness.percentage).toBe(100);
  });

  test('returns 100% when no bookable activities exist', () => {
    const readiness = getTripReadiness([]);
    expect(readiness.percentage).toBe(100);
    expect(readiness.total).toBe(0);
  });
});

describe('getPlaceBookingLinks', () => {
  test('returns a Stay22 → Booking.com link for stay categories', () => {
    const links = getPlaceBookingLinks('Hotel Ritz', 'stay/hotel', 'Paris');
    expect(links.length).toBe(1);
    expect(links[0].platform).toBe('booking_com');
    expect(links[0].url.startsWith(STAY22_BOOKING)).toBe(true);
    expect(links[0].url).toContain('Hotel%20Ritz');
    expect(params(links[0].url).get('campaign')).toBe('app_place_detail');
  });

  test('includes dates when provided for hotels', () => {
    const links = getPlaceBookingLinks('Hotel Ritz', 'stay/hotel', 'Paris', { checkIn: '2026-06-01', checkOut: '2026-06-05' });
    expect(links[0].url).toContain('checkin=2026-06-01');
    expect(links[0].url).toContain('checkout=2026-06-05');
  });

  test('sends place coordinates, address and campaign for hotels', () => {
    const links = getPlaceBookingLinks('Le Meurice', 'stay/hotel', 'Paris', undefined, 2, {
      lat: 48.8651,
      lng: 2.3281,
      address: '228 Rue de Rivoli, Paris, France',
      campaign: 'explore_map',
    });
    const p = params(links[0].url);
    expect(p.get('hotelname')).toBe('Le Meurice');
    expect(p.get('lat')).toBe('48.8651');
    expect(p.get('address')).toBe('228 Rue de Rivoli, Paris, France');
    expect(p.get('adults')).toBe('2');
    expect(p.get('campaign')).toBe('app_explore_map');
  });

  test('uses a known Booking.com hotel page for an exact match', () => {
    const links = getPlaceBookingLinks('Le Meurice', 'stay/hotel', 'Paris', undefined, undefined, {
      bookingComUrl: 'https://www.booking.com/hotel/fr/le-meurice-paris.en-gb.html?label=x',
    });
    expect(links[0].match).toBe('exact');
    expect(params(links[0].url).get('link')).toBe('https://www.booking.com/hotel/fr/le-meurice-paris.html');
  });

  test('returns no hotel link when there is nothing to locate it by', () => {
    expect(getPlaceBookingLinks('Hotel Ritz', 'stay/hotel', '')).toEqual([]);
  });

  test('returns Booking.com attractions for activity categories, wrapped by Stay22', () => {
    const links = getPlaceBookingLinks('Eiffel Tower', 'activity/museum', 'Paris');
    expect(links.length).toBe(1);
    expect(links[0].platform).toBe('booking_com_attractions');
    expect(links[0].url.startsWith(`${STAY22_BOOKING}&`)).toBe(true);
    expect(params(links[0].url).get('link')).toBe('https://www.booking.com/attractions/index.html?query=Eiffel%20Tower');
  });

  test("returns the restaurant's own website for food categories, Google Maps without one", () => {
    const withSite = getPlaceBookingLinks('Le Cinq', 'food/restaurant', 'Paris', undefined, 2, { website: 'https://www.restaurant-lecinq.com/', placeId: 'ChIJ_lecinq' });
    expect(withSite[0]).toMatchObject({ platform: 'restaurant_website', url: 'https://www.restaurant-lecinq.com/' });
    const withoutSite = getPlaceBookingLinks('Le Cinq', 'food/restaurant', 'Paris', undefined, 2, { placeId: 'ChIJ_lecinq' });
    expect(withoutSite).toHaveLength(1);
    expect(withoutSite[0]).toMatchObject({ platform: 'google_maps', url: 'https://www.google.com/maps/place/?q=place_id:ChIJ_lecinq' });
  });

  test('returns empty array for non-bookable categories', () => {
    expect(getPlaceBookingLinks('H&M', 'shopping', 'Paris')).toEqual([]);
    expect(getPlaceBookingLinks('Bus Stop', 'transport', 'Paris')).toEqual([]);
    expect(getPlaceBookingLinks('Place', 'other', 'Paris')).toEqual([]);
  });

  test('includes destination in search queries', () => {
    const links = getPlaceBookingLinks('Hotel Ritz', 'stay/hotel', 'Paris');
    expect(links[0].url).toContain('Paris');
  });
});

describe('tripStayDates', () => {
  test('returns the trip range when dates are known', () => {
    expect(tripStayDates({ startDate: '2026-06-01', endDate: '2026-06-05' })).toEqual({ checkIn: '2026-06-01', checkOut: '2026-06-05' });
  });

  test('returns undefined for placeholder dates or no trip', () => {
    expect(tripStayDates({ startDate: '2099-01-01', endDate: '2099-01-05', datesKnown: false })).toBeUndefined();
    expect(tripStayDates(undefined)).toBeUndefined();
    expect(tripStayDates({ startDate: '', endDate: '' })).toBeUndefined();
  });
});

describe('getPlaceBookingLabel', () => {
  test('returns correct labels for categories', () => {
    expect(getPlaceBookingLabel('stay/hotel')).toBe('Book hotel');
    expect(getPlaceBookingLabel('activity/museum')).toBe('Find tickets');
    expect(getPlaceBookingLabel('attraction/theme_park')).toBe('Find tickets');
    expect(getPlaceBookingLabel('food/restaurant')).toBe('Reserve');
  });
});

describe('getPlaceBookingSectionTitle', () => {
  test('returns correct section titles', () => {
    expect(getPlaceBookingSectionTitle('stay/hotel')).toBe('Book this stay');
    expect(getPlaceBookingSectionTitle('activity/museum')).toBe('Find tickets & tours');
    expect(getPlaceBookingSectionTitle('food/restaurant')).toBe('Make a reservation');
  });
});

describe('openBookingLink', () => {
  afterEach(() => {
    (openBrowserAsync as jest.Mock).mockClear();
  });

  // Stay22 only credits bookings made through its own links — never a Booking.com page it led to
  test.each([
    ['a hotel', getPlaceBookingLinks('Le Meurice', 'stay/hotel', 'Paris', undefined, 2, { lat: 48.8651, lng: 2.3281 })[0]],
    ['an area search', getPlaceBookingLinks('Hilton', 'stay/hotel', 'Paris', undefined, 2, { lat: 48.8651, lng: 2.3281 })[0]],
    ['an activity', getPlaceBookingLinks('Louvre Museum', 'attraction/museum', 'Paris')[0]],
  ])('opens the Stay22 link for %s exactly as built', async (_, link) => {
    await openBookingLink(link.url);
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(openBrowserAsync).toHaveBeenCalledWith(link.url, expect.anything());
    expect(link.url.startsWith(`${STAY22_BOOKING}&`)).toBe(true);
  });
});

describe('every Booking.com link the app builds', () => {
  test("goes through our Stay22 link with aid=tripseek — never straight to Booking.com", () => {
    const urls: string[] = [];
    const titles = ['Delta Hotels Toronto Markham', 'Hilton', 'Check-in at Hotel X', 'CN Tower', 'Walk along the river', 'Air Canada AC100'];
    for (const type of ['hotel', 'flight', 'food', 'activity'] as const) {
      for (const title of titles) {
        const activity = makeActivity({ id: '1', title, day: 1, time: '10:00', type, lat: 43.64, lng: -79.39, address: '290 Bremner Blvd, Toronto' });
        for (const options of [{}, { datesKnown: false }, { campaign: 'bookings_tab' as const }]) {
          urls.push(...getBookingLinks(activity, '2026-06-10', '2026-06-14', 'Toronto', 2, options).map((l) => l.url));
        }
      }
    }
    for (const category of ['stay/hotel', 'stay/hostel', 'stay/apartment', 'activity/attraction', 'activity/museum', 'activity/tour', 'food/restaurant', 'shopping']) {
      urls.push(...getPlaceBookingLinks('CN Tower', category, 'Toronto', { checkIn: '2026-06-10', checkOut: '2026-06-14' }, 2, { lat: 43.64, lng: -79.39 }).map((l) => l.url));
      urls.push(...getPlaceBookingLinks('CN Tower', category, 'Toronto').map((l) => l.url));
    }

    const bookingComUrls = urls.filter((url) => url.includes('booking.com'));
    expect(bookingComUrls.length).toBeGreaterThan(20);
    for (const url of bookingComUrls) expect(url.startsWith(`${STAY22_BOOKING}&`)).toBe(true);
  });
});
