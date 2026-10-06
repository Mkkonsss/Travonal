import { memo, useEffect, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Reservation, Trip } from '@/context/trips';
import { searchFlightsAI, type FlightResult } from '@/services/ai';

// TODO: Replace with your real Booking.com affiliate ID once approved
const BOOKING_AFFILIATE_ID = 'YOUR_AID_HERE';

const CITY_TO_IATA: Record<string, string> = {
  'new york': 'NYC', 'new york city': 'NYC', 'nyc': 'NYC',
  'los angeles': 'LAX', 'la': 'LAX',
  'chicago': 'ORD', 'san francisco': 'SFO', 'sf': 'SFO',
  'miami': 'MIA', 'hollywood': 'FLL', 'fort lauderdale': 'FLL',
  'toronto': 'YYZ', 'vancouver': 'YVR',
  'montreal': 'YUL', 'calgary': 'YYC', 'ottawa': 'YOW',
  'washington': 'DCA', 'washington dc': 'DCA', 'boston': 'BOS',
  'seattle': 'SEA', 'dallas': 'DFW', 'houston': 'IAH',
  'atlanta': 'ATL', 'denver': 'DEN', 'phoenix': 'PHX',
  'las vegas': 'LAS', 'orlando': 'MCO', 'san diego': 'SAN',
  'portland': 'PDX', 'minneapolis': 'MSP', 'detroit': 'DTW',
  'philadelphia': 'PHL', 'charlotte': 'CLT', 'salt lake city': 'SLC',
  'mexico city': 'MEX', 'cancun': 'CUN',
  'london': 'LON', 'paris': 'PAR', 'amsterdam': 'AMS',
  'frankfurt': 'FRA', 'madrid': 'MAD', 'barcelona': 'BCN',
  'rome': 'FCO', 'milan': 'MIL', 'zurich': 'ZRH',
  'vienna': 'VIE', 'berlin': 'BER', 'munich': 'MUC',
  'brussels': 'BRU', 'lisbon': 'LIS', 'athens': 'ATH',
  'oslo': 'OSL', 'stockholm': 'STO', 'copenhagen': 'CPH',
  'helsinki': 'HEL', 'warsaw': 'WAW', 'prague': 'PRG',
  'budapest': 'BUD', 'dublin': 'DUB', 'edinburgh': 'EDI',
  'manchester': 'MAN', 'istanbul': 'IST', 'moscow': 'MOW',
  'dubai': 'DXB', 'abu dhabi': 'AUH', 'doha': 'DOH',
  'riyadh': 'RUH', 'tel aviv': 'TLV', 'cairo': 'CAI',
  'casablanca': 'CMN', 'nairobi': 'NBO', 'johannesburg': 'JNB',
  'cape town': 'CPT', 'tokyo': 'TYO', 'osaka': 'KIX',
  'seoul': 'SEL', 'beijing': 'BJS', 'shanghai': 'SHA',
  'hong kong': 'HKG', 'singapore': 'SIN', 'bangkok': 'BKK',
  'kuala lumpur': 'KUL', 'jakarta': 'CGK', 'manila': 'MNL',
  'taipei': 'TPE', 'delhi': 'DEL', 'new delhi': 'DEL',
  'mumbai': 'BOM', 'bangalore': 'BLR', 'sydney': 'SYD',
  'melbourne': 'MEL', 'brisbane': 'BNE', 'auckland': 'AKL',
  'sao paulo': 'SAO', 'rio de janeiro': 'RIO',
  'buenos aires': 'BUE', 'bogota': 'BOG', 'lima': 'LIM', 'santiago': 'SCL',
};

function toIata(cityName: string): string {
  const lower = cityName.toLowerCase().trim();
  if (CITY_TO_IATA[lower]) return CITY_TO_IATA[lower];
  if (/^[a-z]{3}$/i.test(lower)) return lower.toUpperCase();
  for (const key of Object.keys(CITY_TO_IATA)) {
    if (lower.includes(key) || key.includes(lower)) return CITY_TO_IATA[key];
  }
  return cityName.trim();
}

function buildBookingFlightsUrl(from: string | undefined, to: string, date?: string, returnDate?: string): string {
  const toCode = toIata(to.split(',')[0].trim());
  const fromCode = from ? toIata(from.split(',')[0].trim()) : undefined;

  const params = new URLSearchParams({
    aid: BOOKING_AFFILIATE_ID,
    adults: '1',
    type: returnDate ? 'ROUNDTRIP' : 'ONEWAY',
    cabinClass: 'ECONOMY',
  });
  // Only set if we resolved a proper 3-letter IATA code
  if (/^[A-Z]{3}$/.test(toCode)) params.set('to', toCode);
  if (fromCode && /^[A-Z]{3}$/.test(fromCode)) params.set('from', fromCode);
  if (date) params.set('depart', date);
  if (returnDate) params.set('return', returnDate);
  return `https://www.booking.com/flights/index.html?${params.toString()}`;
}

export interface FlightsStripProps {
  trip: Trip;
  reservations: Reservation[];
  departureCity?: string;
  onAddFlight: () => void;
  onViewFlight: (reservation: Reservation) => void;
}

function formatRoute(origin?: string, destination?: string, title?: string): string {
  if (origin && destination) {
    const orig = origin.split(' - ')[0].trim();
    const dest = destination.split(' - ')[0].trim();
    return `${orig} → ${dest}`;
  }
  return title ?? 'Flight';
}

function formatFlightDate(date?: string, time?: string): string {
  const parts: string[] = [];
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    parts.push(dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  if (time) parts.push(time);
  return parts.join(' · ');
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const FlightsStrip = memo(function FlightsStrip({
  trip,
  reservations,
  departureCity,
  onAddFlight,
  onViewFlight,
}: FlightsStripProps) {
  const theme = useTheme();
  const [suggestedFlights, setSuggestedFlights] = useState<FlightResult[]>([]);
  const [flightsLoading, setFlightsLoading] = useState(false);

  // Reset suggestions when trip changes
  useEffect(() => {
    setSuggestedFlights([]);
    setFlightsLoading(false);
  }, [trip.id]);

  // Fetch flight suggestions when departure city + trip dates are available and no reservations yet
  useEffect(() => {
    if (reservations.length > 0) return;
    if (!departureCity || !trip.startDate) return;
    // Skip synthetic/placeholder dates (duration-mode trips use year 2099)
    if (trip.startDate.startsWith('2099')) return;

    let cancelled = false;
    setFlightsLoading(true);

    searchFlightsAI({
      origin: departureCity,
      destination: trip.destination,
      departureDate: trip.startDate,
      returnDate: trip.endDate ?? undefined,
    }).then((res) => {
      if (!cancelled) setSuggestedFlights(res.flights);
    }).catch(() => {
      // silently fail — carousel just won't show flight suggestions
    }).finally(() => {
      if (!cancelled) setFlightsLoading(false);
    });

    return () => { cancelled = true; };
  }, [trip.id, departureCity, trip.destination, trip.startDate, trip.endDate, reservations.length]);

  const googleFlightsUrl = `https://www.google.com/flights?q=flights+to+${encodeURIComponent(trip.destination)}`;

  const addButton = (
    <Pressable onPress={onAddFlight} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add flight">
      <SymbolView name="plus" size={14} tintColor={theme.text} />
    </Pressable>
  );

  // ── EMPTY STATE ──
  if (reservations.length === 0) {
    const showCarousel = flightsLoading || suggestedFlights.length > 0;

    return (
      <Animated.View entering={FadeInDown.duration(300)} style={s.container}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            <ThemedText style={s.headerTitle}>Flights</ThemedText>
            <ThemedText style={[s.headerMeta, { color: theme.textSecondary }]}>No flights yet</ThemedText>
          </View>
          {addButton}
        </View>

        <Pressable
          onPress={() => {
            const validDate = trip.startDate && !trip.startDate.startsWith('2099') ? trip.startDate : undefined;
            const validReturn = trip.endDate && !trip.endDate.startsWith('2099') ? trip.endDate : undefined;
            Linking.openURL(buildBookingFlightsUrl(departureCity, trip.destination, validDate, validReturn));
          }}
          accessibilityRole="button"
          accessibilityLabel="Find a flight"
          style={({ pressed }) => [s.findFlightBtn, { borderColor: theme.border, opacity: pressed ? 0.75 : 1 }]}
        >
          <SymbolView name="magnifyingglass" size={13} tintColor={theme.primary} />
          <ThemedText style={[s.findFlightLink, { color: theme.primary }]}>Find a flight</ThemedText>
        </Pressable>

        {/* Flight suggestions carousel — only when loading or suggestions exist */}
        {(flightsLoading || suggestedFlights.length > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.carouselScroll}
            style={s.carousel}
          >
            {flightsLoading && suggestedFlights.length === 0 ? (
              // Skeleton cards while loading
              [0, 1, 2].map((i) => (
                <View key={i} style={[s.flightSuggestCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <View style={[s.skeletonLine, { width: 80, backgroundColor: theme.border }]} />
                  <View style={[s.skeletonLine, { width: 60, backgroundColor: theme.border, marginTop: 6 }]} />
                  <View style={[s.skeletonLine, { width: 40, backgroundColor: theme.border, marginTop: 6 }]} />
                </View>
              ))
            ) : (
              suggestedFlights.map((f, i) => {
                const bookingUrl = buildBookingFlightsUrl(
                  f.departureAirport,
                  f.arrivalAirport,
                  trip.startDate && !trip.startDate.startsWith('2099') ? trip.startDate : undefined,
                  trip.endDate && !trip.endDate.startsWith('2099') ? trip.endDate : undefined,
                );
                return (
                  <View
                    key={i}
                    style={[s.flightSuggestCard, { backgroundColor: theme.background, borderColor: theme.border }]}
                  >
                    {f.airlineLogo ? (
                      <ExpoImage source={{ uri: f.airlineLogo }} style={s.airlineLogo} contentFit="contain" />
                    ) : (
                      <SymbolView name="airplane" size={18} tintColor={theme.textSecondary} />
                    )}
                    <ThemedText style={s.suggestPrice} numberOfLines={1}>
                      {f.price != null ? `est. $${f.price}` : '—'}
                    </ThemedText>
                    <ThemedText style={[s.suggestAirline, { color: theme.textSecondary }]} numberOfLines={1}>
                      {f.airline}
                    </ThemedText>
                    <ThemedText style={[s.suggestMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                      {f.stops === 0 ? 'Nonstop' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`}
                      {f.duration > 0 ? ` · ${formatDuration(f.duration)}` : ''}
                    </ThemedText>
                    <Pressable
                      onPress={() => Linking.openURL(bookingUrl)}
                      style={[s.suggestBookBtn, { backgroundColor: theme.primary }]}
                      accessibilityRole="button"
                      accessibilityLabel="Book flight"
                    >
                      <ThemedText style={s.suggestBookBtnText}>Book</ThemedText>
                    </Pressable>
                  </View>
                );
              })
            )}

            {/* "Find a flight" card at end of carousel */}
            {!flightsLoading && (
              <Pressable
                onPress={() => Linking.openURL(googleFlightsUrl)}
                style={({ pressed }) => [
                  s.flightSuggestCard,
                  s.findFlightCard,
                  { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? 0.75 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Find a flight"
              >
                <SymbolView name="magnifyingglass" size={18} tintColor={theme.primary} />
                <ThemedText style={[s.findFlightText, { color: theme.primary }]}>Find a flight</ThemedText>
              </Pressable>
            )}
          </ScrollView>
        )}

      </Animated.View>
    );
  }

  // ── POPULATED STATE ──
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={s.container}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <ThemedText style={s.headerTitle}>Flights</ThemedText>
          <ThemedText style={[s.headerMeta, { color: theme.textSecondary }]}>
            · {reservations.length} {reservations.length === 1 ? 'flight' : 'flights'}
          </ThemedText>
        </View>
        <View style={s.headerRight}>
          {addButton}
        </View>
      </View>

      <View style={s.grid}>
        {reservations.map((res) => {
          const booked = !!res.confirmationNumber;
          const route = formatRoute(res.origin, res.destination, res.title);
          const dateStr = formatFlightDate(res.date, res.time);

          return (
            <Pressable
              key={res.id}
              onPress={() => onViewFlight(res)}
              style={({ pressed }) => [s.gridCard, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={route}
            >
              {/* Dark gradient background */}
              <LinearGradient colors={['#2a2f3d', '#1a1e28']} style={StyleSheet.absoluteFill} />
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.75)']}
                locations={[0.3, 1]}
                style={StyleSheet.absoluteFill}
              />

              {/* Airplane icon — top right */}
              <View style={s.cardTypeIcon}>
                <SymbolView name="airplane" size={16} tintColor="rgba(255,255,255,0.7)" />
              </View>

              {/* Status badge — top left */}
              <View style={s.cardStatusPos}>
                <View style={s.cardStatusBadge}>
                  {booked && <View style={[s.statusDot, { backgroundColor: '#10B981' }]} />}
                  <ThemedText style={s.cardStatusText}>
                    {booked ? 'Booked' : 'Not booked'}
                  </ThemedText>
                </View>
              </View>

              {/* Text overlay — bottom */}
              <View style={s.cardOverlay}>
                <ThemedText style={s.cardName} numberOfLines={1}>{route}</ThemedText>
                {(res.flightNumber || dateStr) ? (
                  <ThemedText style={s.cardMeta} numberOfLines={1}>
                    {[res.flightNumber, dateStr].filter(Boolean).join(' · ')}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
});

const s = StyleSheet.create({
  container: {
    marginBottom: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  headerMeta: {
    fontSize: 13,
    fontWeight: '500',
  },
  // Carousel
  carousel: {
    marginBottom: 4,
  },
  carouselScroll: {
    gap: 8,
    paddingHorizontal: 1,
  },
  flightSuggestCard: {
    width: 130,
    borderRadius: Radius.sm,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  findFlightCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  findFlightBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginBottom: 10,
  },
  findFlightLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  findFlightText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  airlineLogo: {
    width: 28,
    height: 28,
    marginBottom: 4,
  },
  suggestPrice: {
    fontSize: 16,
    fontWeight: '800',
  },
  suggestAirline: {
    fontSize: 12,
    fontWeight: '500',
  },
  suggestMeta: {
    fontSize: 11,
  },
  suggestBookBtn: {
    marginTop: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  suggestBookBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Booked flight grid cards (My Bookings style)
  gridCard: {
    width: '48%',
    aspectRatio: 5 / 6,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: '#1a1e28',
  },
  cardTypeIcon: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  cardStatusPos: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
  cardStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  cardMeta: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
});
