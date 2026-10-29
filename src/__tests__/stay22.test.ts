import {
  buildStay22AttractionLink,
  buildStay22HotelLink,
  canonicalBookingHotelUrl,
  cleanHotelName,
  validStayDates,
  wrapBookingComUrl,
} from '@/services/stay22';

const TODAY = '2026-05-01';

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('buildStay22HotelLink', () => {
  test('name tier sends hotel name, coordinates, address, aid and campaign', () => {
    const link = buildStay22HotelLink(
      { name: 'Le Meurice', lat: 48.8651, lng: 2.3281, address: '228 Rue de Rivoli, 75001 Paris, France' },
      { campaign: 'place_detail', today: TODAY },
    );
    expect(link!.match).toBe('name');
    expect(link!.url.startsWith('https://www.stay22.com/allez/booking?')).toBe(true);
    const p = params(link!.url);
    expect(p.get('aid')).toBe('tripseek');
    expect(p.get('hotelname')).toBe('Le Meurice');
    expect(p.get('lat')).toBe('48.8651');
    expect(p.get('lng')).toBe('2.3281');
    expect(p.get('address')).toBe('228 Rue de Rivoli, 75001 Paris, France');
    expect(p.get('campaign')).toBe('app_place_detail');
    expect(p.has('link')).toBe(false);
  });

  test('percent-encodes values (spaces are %20, not +)', () => {
    const link = buildStay22HotelLink({ name: 'Hôtel & Spa', address: 'Paris, France' }, { campaign: 'place_detail' });
    expect(link!.url).toContain('hotelname=H%C3%B4tel%20%26%20Spa');
    expect(link!.url).toContain('address=Paris%2C%20France');
  });

  test('rounds coordinates to 6 decimals', () => {
    const link = buildStay22HotelLink({ name: 'Le Meurice', lat: 48.865123456, lng: 2.328198765 }, { campaign: 'place_detail' });
    expect(params(link!.url).get('lat')).toBe('48.865123');
    expect(params(link!.url).get('lng')).toBe('2.328199');
  });

  test('exact tier passes a known Booking.com hotel page through link=', () => {
    const link = buildStay22HotelLink(
      {
        name: 'Le Meurice',
        lat: 48.8651,
        lng: 2.3281,
        bookingComUrl: 'https://www.booking.com/hotel/fr/le-meurice-paris.en-gb.html?aid=123&label=x',
      },
      { campaign: 'stay_sheet', checkIn: '2026-06-01', checkOut: '2026-06-03', adults: 2, today: TODAY },
    );
    expect(link!.match).toBe('exact');
    const p = params(link!.url);
    expect(p.get('link')).toBe('https://www.booking.com/hotel/fr/le-meurice-paris.html');
    expect(link!.url).toContain('link=https%3A%2F%2Fwww.booking.com%2Fhotel%2Ffr%2Fle-meurice-paris.html');
    expect(p.get('checkin')).toBe('2026-06-01');
    expect(p.get('checkout')).toBe('2026-06-03');
    expect(p.get('adults')).toBe('2');
    expect(p.get('campaign')).toBe('app_stay_sheet');
    expect(p.has('hotelname')).toBe(false);
    expect(p.has('lat')).toBe(false);
  });

  test('ignores a Booking.com URL that is not a hotel page', () => {
    const link = buildStay22HotelLink(
      { name: 'Le Meurice', lat: 48.8651, lng: 2.3281, bookingComUrl: 'https://www.booking.com/searchresults.html?ss=Paris' },
      { campaign: 'place_detail' },
    );
    expect(link!.match).toBe('name');
    expect(params(link!.url).has('link')).toBe(false);
  });

  test.each(['Hilton', 'Hotel', 'Check-in', 'Holiday Inn', 'The Ritz-Carlton', 'Airbnb', 'Hotel in Le Marais'])(
    'area tier for the too-generic name %p',
    (name) => {
      const link = buildStay22HotelLink({ name, lat: 51.5194, lng: -0.172 }, { campaign: 'bookings_tab' });
      expect(link!.match).toBe('area');
      const p = params(link!.url);
      expect(p.has('hotelname')).toBe(false);
      expect(p.get('lat')).toBe('51.5194');
      expect(p.get('lng')).toBe('-0.172');
    },
  );

  test('area tier when there is no name at all', () => {
    const link = buildStay22HotelLink({ address: 'Lisbon, Portugal' }, { campaign: 'stays_strip' });
    expect(link!.match).toBe('area');
    expect(params(link!.url).get('address')).toBe('Lisbon, Portugal');
  });

  test('returns null when there is nothing to locate the hotel by', () => {
    expect(buildStay22HotelLink({ name: 'Le Meurice' }, { campaign: 'place_detail' })).toBeNull();
    expect(buildStay22HotelLink({ name: 'Le Meurice', address: '   ' }, { campaign: 'place_detail' })).toBeNull();
    expect(buildStay22HotelLink({ name: 'Le Meurice', lat: NaN, lng: 2.3 }, { campaign: 'place_detail' })).toBeNull();
  });

  test('includes valid future dates and the traveler count', () => {
    const link = buildStay22HotelLink(
      { name: 'Le Meurice', address: 'Paris, France' },
      { campaign: 'place_detail', checkIn: '2026-06-01', checkOut: '2026-06-05', adults: 3, today: TODAY },
    );
    const p = params(link!.url);
    expect(p.get('checkin')).toBe('2026-06-01');
    expect(p.get('checkout')).toBe('2026-06-05');
    expect(p.get('adults')).toBe('3');
  });

  test('drops dates Stay22 would otherwise replace with tonight', () => {
    const link = buildStay22HotelLink(
      { name: 'Le Meurice', address: 'Paris, France' },
      { campaign: 'place_detail', checkIn: '2026-04-01', checkOut: '2026-04-03', today: TODAY },
    );
    const p = params(link!.url);
    expect(p.has('checkin')).toBe(false);
    expect(p.has('checkout')).toBe(false);
  });

  test.each([0, -1, 2.5, 31, NaN])('omits an invalid adults value %p', (adults) => {
    const link = buildStay22HotelLink({ name: 'Le Meurice', address: 'Paris, France' }, { campaign: 'place_detail', adults });
    expect(params(link!.url).has('adults')).toBe(false);
  });
});

describe('validStayDates', () => {
  test('accepts a future stay', () => {
    expect(validStayDates('2026-06-01', '2026-06-05', TODAY)).toEqual({ checkIn: '2026-06-01', checkOut: '2026-06-05' });
    expect(validStayDates(TODAY, '2026-05-02', TODAY)).not.toBeNull();
  });

  test('rejects past, inverted, too-long, placeholder and malformed dates', () => {
    expect(validStayDates('2026-04-30', '2026-05-02', TODAY)).toBeNull(); // check-in in the past
    expect(validStayDates('2026-06-05', '2026-06-01', TODAY)).toBeNull(); // inverted
    expect(validStayDates('2026-06-01', '2026-06-01', TODAY)).toBeNull(); // zero nights
    expect(validStayDates('2026-06-01', '2026-07-02', TODAY)).toBeNull(); // 31 nights
    expect(validStayDates('2099-01-01', '2099-01-05', TODAY)).toBeNull(); // duration-mode placeholder
    expect(validStayDates('2026-6-1', '2026-06-05', TODAY)).toBeNull();
    expect(validStayDates('2026-06-01', undefined, TODAY)).toBeNull();
    expect(validStayDates(undefined, undefined, TODAY)).toBeNull();
  });

  test('allows exactly 30 nights', () => {
    expect(validStayDates('2026-06-01', '2026-07-01', TODAY)).not.toBeNull();
  });
});

describe('canonicalBookingHotelUrl', () => {
  test('strips locale suffix, query and fragment', () => {
    expect(canonicalBookingHotelUrl('https://www.booking.com/hotel/fr/le-meurice-paris.en-gb.html?aid=1&label=x#map'))
      .toBe('https://www.booking.com/hotel/fr/le-meurice-paris.html');
    expect(canonicalBookingHotelUrl('https://www.booking.com/hotel/gb/londonolympia.html'))
      .toBe('https://www.booking.com/hotel/gb/londonolympia.html');
    expect(canonicalBookingHotelUrl('https://www.booking.com/hotel/br/copacabana-palace.pt-br.html'))
      .toBe('https://www.booking.com/hotel/br/copacabana-palace.html');
  });

  test('normalizes host and scheme variants', () => {
    expect(canonicalBookingHotelUrl('http://booking.com/hotel/FR/le-meurice-paris.html'))
      .toBe('https://www.booking.com/hotel/fr/le-meurice-paris.html');
    expect(canonicalBookingHotelUrl('https://m.booking.com/hotel/fr/le-meurice-paris.fr.html'))
      .toBe('https://www.booking.com/hotel/fr/le-meurice-paris.html');
  });

  test('rejects look-alike hosts and non-hotel pages', () => {
    expect(canonicalBookingHotelUrl('https://booking.com.evil.com/hotel/fr/x.html')).toBeNull();
    expect(canonicalBookingHotelUrl('https://notbooking.com/hotel/fr/x.html')).toBeNull();
    expect(canonicalBookingHotelUrl('https://evil.com/?u=https://www.booking.com/hotel/fr/x.html')).toBeNull();
    expect(canonicalBookingHotelUrl('https://www.booking.com/searchresults.html?ss=Paris')).toBeNull();
    expect(canonicalBookingHotelUrl('https://www.booking.com/Share-AbC123')).toBeNull();
    expect(canonicalBookingHotelUrl(undefined)).toBeNull();
  });
});

describe('cleanHotelName', () => {
  test('keeps real property names', () => {
    expect(cleanHotelName('Le Meurice')).toBe('Le Meurice');
    expect(cleanHotelName('Hilton London Metropole')).toBe('Hilton London Metropole');
    expect(cleanHotelName('Hotel Indigo Paris')).toBe('Hotel Indigo Paris');
    expect(cleanHotelName('Staybridge Suites Vauxhall')).toBe('Staybridge Suites Vauxhall');
  });

  test('strips itinerary wrappers', () => {
    expect(cleanHotelName('Check-in at Le Meurice')).toBe('Le Meurice');
    expect(cleanHotelName('Check in: Generator Paris')).toBe('Generator Paris');
    expect(cleanHotelName('Check into The Hoxton, Shoreditch')).toBe('The Hoxton, Shoreditch');
    expect(cleanHotelName('Stay at Le Meurice')).toBe('Le Meurice');
    expect(cleanHotelName('Le Meurice (check-in)')).toBe('Le Meurice');
    expect(cleanHotelName('Le Meurice check-out')).toBe('Le Meurice');
  });

  test('returns undefined for generic names and bare chain brands', () => {
    for (const name of ['', 'Hotel', 'Hotel check-in', 'Check-in', 'Hilton', 'Hilton Hotel', 'The Ritz-Carlton', 'B&B', 'Motel 6', 'Stay in Paris', 'Apartment near the Old Town']) {
      expect(cleanHotelName(name)).toBeUndefined();
    }
  });
});

describe('wrapBookingComUrl', () => {
  test('wraps Booking.com URLs through Stay22 with the campaign', () => {
    const original = 'https://www.booking.com/attractions/searchresults.html?query=Louvre%20Paris';
    const wrapped = wrapBookingComUrl(original, 'trip_timeline');
    expect(wrapped.startsWith('https://www.stay22.com/allez/booking?aid=tripseek&link=')).toBe(true);
    const p = params(wrapped);
    expect(p.get('link')).toBe(original);
    expect(p.get('campaign')).toBe('app_trip_timeline');
  });

  test('leaves non-Booking.com URLs unchanged', () => {
    const url = 'https://www.opentable.com/s?term=Le%20Cinq';
    expect(wrapBookingComUrl(url, 'place_detail')).toBe(url);
    expect(wrapBookingComUrl('https://booking.com.evil.com/x', 'place_detail')).toBe('https://booking.com.evil.com/x');
  });
});

describe('activity links', () => {
  test("go through Stay22 to Booking.com's activities page with the name typed in", () => {
    const link = buildStay22AttractionLink(" Ripley's Aquarium of Canada ", 'place_detail');
    expect(link.startsWith('https://www.stay22.com/allez/booking?aid=tripseek&link=')).toBe(true);
    expect(params(link).get('link')).toBe("https://www.booking.com/attractions/index.html?query=Ripley's%20Aquarium%20of%20Canada");
    expect(params(link).get('campaign')).toBe('app_place_detail');
  });
});
