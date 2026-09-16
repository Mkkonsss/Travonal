import { getBookingLinks, getPrimaryBookingLink, isBookableActivity, getTripReadiness, getPlaceBookingLinks, getPlaceBookingLabel, getPlaceBookingSectionTitle } from '@/services/booking-links';
import { Activity } from '@/context/trips';

function makeActivity(overrides: Partial<Activity> & { id: string; title: string; day: number; time: string; type: Activity['type'] }): Activity {
  return { duration: 60, ...overrides };
}

describe('getBookingLinks', () => {
  test('generates Booking.com link for hotels', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].platform).toBe('booking_com');
    expect(links[0].url).toContain('booking.com');
    expect(links[0].url).toContain('Hotel%20Ritz');
    expect(links[0].url).toContain('checkin=2026-06-01');
    expect(links[0].url).toContain('checkout=2026-06-05');
  });

  test('generates Google Maps link for hotel with placeId', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel Ritz', day: 1, time: '15:00', type: 'hotel', placeId: 'ChIJxyz' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    const gmaps = links.find((l) => l.platform === 'google_maps');
    expect(gmaps).toBeDefined();
    expect(gmaps!.url).toContain('ChIJxyz');
  });

  test('generates Booking.com flights link for flights', () => {
    const activity = makeActivity({ id: '1', title: 'SFO to CDG', day: 1, time: '08:00', type: 'flight' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].platform).toBe('booking_com_flights');
    expect(links[0].url).toContain('booking.com/flights');
  });

  test('generates OpenTable link for restaurants', () => {
    const activity = makeActivity({ id: '1', title: 'Le Cinq', day: 2, time: '19:30', type: 'food' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    const opentable = links.find((l) => l.platform === 'opentable');
    expect(opentable).toBeDefined();
    expect(opentable!.url).toContain('Le%20Cinq');
    expect(opentable!.url).toContain('2026-06-02'); // day 2 = June 2
  });

  test('generates Booking.com attractions link for activities', () => {
    const activity = makeActivity({ id: '1', title: 'Eiffel Tower Tour', day: 3, time: '10:00', type: 'activity' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris');
    expect(links.some((l) => l.platform === 'booking_com_attractions')).toBe(true);
    expect(links[0].url).toContain('booking.com/attractions');
  });

  test('omits affiliate param when env var is empty', () => {
    const hotel = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel' });
    const links = getBookingLinks(hotel, '2026-06-01', '2026-06-05', 'Paris');
    expect(links[0].url).not.toContain('aid=');
  });

  test('links still work without affiliate param', () => {
    const hotel = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel' });
    const links = getBookingLinks(hotel, '2026-06-01', '2026-06-05', 'Paris');
    expect(links[0].url).toMatch(/^https:\/\/www\.booking\.com/);
  });

  test('passes travelers count to hotel links', () => {
    const activity = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel' });
    const links = getBookingLinks(activity, '2026-06-01', '2026-06-05', 'Paris', 4);
    expect(links[0].url).toContain('group_adults=4');
  });

  test('all non-restaurant links go through Booking.com', () => {
    const hotel = makeActivity({ id: '1', title: 'Hotel', day: 1, time: '15:00', type: 'hotel' });
    const flight = makeActivity({ id: '2', title: 'Flight', day: 1, time: '08:00', type: 'flight' });
    const activity = makeActivity({ id: '3', title: 'Museum', day: 1, time: '10:00', type: 'activity' });

    for (const a of [hotel, flight, activity]) {
      const links = getBookingLinks(a, '2026-06-01', '2026-06-05', 'Paris');
      const primary = links[0];
      expect(primary.url).toContain('booking.com');
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
  test('returns Booking.com link for stay categories', () => {
    const links = getPlaceBookingLinks('Hotel Ritz', 'stay/hotel', 'Paris');
    expect(links.length).toBe(1);
    expect(links[0].platform).toBe('booking_com');
    expect(links[0].url).toContain('booking.com');
    expect(links[0].url).toContain('Hotel%20Ritz');
  });

  test('includes dates when provided for hotels', () => {
    const links = getPlaceBookingLinks('Hotel Ritz', 'stay/hotel', 'Paris', { checkIn: '2026-06-01', checkOut: '2026-06-05' });
    expect(links[0].url).toContain('checkin=2026-06-01');
    expect(links[0].url).toContain('checkout=2026-06-05');
  });

  test('returns Booking.com attractions for activity categories', () => {
    const links = getPlaceBookingLinks('Eiffel Tower', 'activity/museum', 'Paris');
    expect(links.length).toBe(1);
    expect(links[0].platform).toBe('booking_com_attractions');
    expect(links[0].url).toContain('booking.com/attractions');
  });

  test('returns OpenTable for food categories', () => {
    const links = getPlaceBookingLinks('Le Cinq', 'food/restaurant', 'Paris');
    expect(links.length).toBe(1);
    expect(links[0].platform).toBe('opentable');
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
