import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AddBookingModal, getCurrSymbol, TYPE_SYMBOLS, TYPE_LABELS, formatBookingDate } from '@/components/add-booking-modal';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Reservation, Trip, useTrips } from '@/context/trips';
import { useBookings } from '@/context/bookings';
import { useToast } from '@/context/toast';
import {
  getParsedBookingsAI, markBookingImportedAI,
} from '@/services/ai';
import { useActivityPhotos, ActivityNameHint } from '@/hooks/use-activity-photos';

// ── Helpers ──

type TripState = 'upcoming' | 'active' | 'past' | 'draft' | 'planned';

type SheetContent =
  | { kind: 'confirmed'; res: Reservation; trip: Trip }
  | { kind: 'standalone'; res: Reservation }
  | null;

const GAP = 10;

// ── Main Screen ──

function BookingImage({ uri, typeKey, iconSize = 28, photosLoading = false }: { uri?: string; typeKey: string; iconSize?: number; photosLoading?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const showSpinner = photosLoading && !uri && !loaded;
  return (
    <>
      <LinearGradient colors={['#2a2f3d', '#1a1e28']} style={[StyleSheet.absoluteFill, styles.cardPlaceholder]}>
        {showSpinner || (uri && !loaded)
          ? <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
          : <SymbolView name={(TYPE_SYMBOLS[typeKey] ?? 'doc.text.fill') as any} size={iconSize} tintColor="rgba(255,255,255,0.4)" />
        }
      </LinearGradient>
      {uri ? (
        <ExpoImage
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={300}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </>
  );
}

function findMatchingTrip(bookingData: Record<string, unknown>, trips: Trip[]): Trip | null {
  const location = (
    (bookingData.location as string) ||
    (bookingData.destination as string) ||
    ''
  ).toLowerCase();
  if (!location) return null;
  const matches = trips.filter(
    (t) =>
      location.includes(t.destination.toLowerCase()) ||
      t.destination.toLowerCase().includes(location),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // Multiple matches — pick the trip whose start date is closest to the booking date
  const bookingDate = bookingData.bookingDate
    ? new Date(bookingData.bookingDate as string).getTime()
    : null;
  if (!bookingDate) return matches[0];
  return matches.reduce((best, trip) => {
    const tripDate = trip.startDate ? new Date(trip.startDate).getTime() : Infinity;
    const bestDate = best.startDate ? new Date(best.startDate).getTime() : Infinity;
    return Math.abs(tripDate - bookingDate) < Math.abs(bestDate - bookingDate) ? trip : best;
  });
}

export default function BookingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { trips, getTripState, addReservation, updateReservation, removeReservation } = useTrips();
  const { standaloneBookings, addStandaloneBooking, updateStandaloneBooking, removeStandaloneBooking, linkBookingToTrip } = useBookings();
  const { width: screenWidth } = useWindowDimensions();

  const CARD_WIDTH = (screenWidth - Spacing.four * 2 - GAP) / 2;
  const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.2);

  // ── Sheet state ──
  const [sheetContent, setSheetContent] = useState<SheetContent>(null);
  const [expandedNotesSheet, setExpandedNotesSheet] = useState(false);
  const sheetAnim = useRef(new Animated.Value(800)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  function openSheet(content: SheetContent) {
    setSheetContent(content);
    setExpandedNotesSheet(false);
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }

  function closeSheet(onDone?: () => void) {
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 800, duration: 240, useNativeDriver: true }),
    ]).start(() => {
      setSheetContent(null);
      setExpandedNotesSheet(false);
      onDone?.();
    });
  }

  // ── Sort ──
  type SortBy = 'recent' | 'upcoming' | 'trip' | 'type';
  const [sortBy, setSortBy] = useState<SortBy>('recent');

  // ── Modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalInitialMode, setModalInitialMode] = useState<'choose' | 'email' | 'manual'>('choose');
  const [editingReservation, setEditingReservation] = useState<{ res: Reservation; tripId: string } | null>(null);
  const [standaloneMode, setStandaloneMode] = useState(false);
  const [isStandaloneEdit, setIsStandaloneEdit] = useState(false);

  // ── Booking forwarding email ──
  const bookingEmail = 'bookings@tripseekapp.com';
  const [emailCopied, setEmailCopied] = useState(false);
  const [copiedConfirmation, setCopiedConfirmation] = useState<string | null>(null);

  async function handleCopyEmail() {
    await Clipboard.setStringAsync(bookingEmail);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  }

  // ── Auto-import pending bookings from email forwarding ──
  useEffect(() => {
    getParsedBookingsAI()
      .then((res) => {
        const pending = res.bookings.filter((b) => b.status === 'pending');
        for (const booking of pending) {
          const data = booking.booking_data as Record<string, unknown>;
          const typeMap: Record<string, string> = { restaurant: 'restaurant', hotel: 'hotel', flight: 'flight', train: 'train', activity: 'activity', other: 'other' };
          const resType = typeMap[data.reservationType as string] ?? 'other';
          const payload = {
            type: resType as any,
            title: (data.name as string) || 'Booking',
            date: (data.bookingDate as string) ?? undefined,
            checkOutDate: (data.checkoutDate as string) ?? undefined,
            time: (data.bookingTime as string) ?? undefined,
            arrivalTime: (data.arrivalTime as string) ?? undefined,
            confirmationNumber: (data.confirmationNumber as string) ?? undefined,
            price: data.price != null ? Number(data.price) : undefined,
            currency: (data.currency as string) ?? undefined,
            address: ((data.address as string) || (data.location as string)) ?? undefined,
            bookingUrl: (data.bookingUrl as string) ?? undefined,
            notes: (data.description as string) ?? undefined,
            fixed: true,
            // Flight / train
            flightNumber: (data.flightNumber as string) ?? undefined,
            origin: (data.origin as string) ?? undefined,
            destination: (data.destination as string) ?? undefined,
            seat: (data.seat as string) ?? undefined,
            boardingTime: (data.boardingTime as string) ?? undefined,
            passengerName: (data.passengerName as string) ?? undefined,
            baggage: (data.baggage as string) ?? undefined,
            // Hotel
            roomType: (data.roomType as string) ?? undefined,
            checkInTime: (data.checkInTime as string) ?? undefined,
            checkOutTime: (data.checkOutTime as string) ?? undefined,
            // Shared
            guestCount: data.guestCount != null ? Number(data.guestCount) : undefined,
            cancellationPolicy: (data.cancellationPolicy as string) ?? undefined,
            duration: (data.duration as string) ?? undefined,
          };
          addStandaloneBooking(payload);
          // Also link to matching trip if destination matches
          const matchedTrip = findMatchingTrip(data, trips);
          if (matchedTrip) {
            addReservation(matchedTrip.id, payload);
          }
          markBookingImportedAI(booking.id).catch(() => {});
        }
      })
      .catch(() => { /* not set up yet, ignore */ });
  }, [showAddModal]); // refresh when modal closes

  // ── Trip grouping ──
  const tripsWithReservations = useMemo(() => {
    const result: { trip: Trip; state: TripState; reservations: Reservation[] }[] = [];
    for (const trip of trips) {
      const reservations = (trip.reservations ?? []).filter((r) => !r.cancelled);
      if (reservations.length === 0) continue;
      result.push({ trip, state: getTripState(trip), reservations });
    }
    // Sort: active first, then upcoming, then past
    const order: Record<TripState, number> = { active: 0, upcoming: 1, planned: 2, draft: 3, past: 4 };
    result.sort((a, b) => order[a.state] - order[b.state]);
    return result;
  }, [trips, getTripState]);

  // These are displayed alongside confirmed trip bookings in the grid
  const allStandalone = useMemo(() => standaloneBookings.filter(b => !b.cancelled), [standaloneBookings]);

  type GridItem = { kind: 'confirmed'; res: Reservation; trip: Trip } | { kind: 'standalone'; res: Reservation };

  const sortedGridItems = useMemo((): GridItem[] => {
    const confirmed: GridItem[] = tripsWithReservations.flatMap(({ trip, reservations }) =>
      reservations.map((res) => ({ kind: 'confirmed' as const, res, trip }))
    );
    const standalone: GridItem[] = allStandalone.map((res) => ({ kind: 'standalone' as const, res }));
    const all: GridItem[] = [...confirmed, ...standalone];

    if (sortBy === 'upcoming') {
      return [...all].sort((a, b) => {
        const da = a.res.date ? new Date(a.res.date).getTime() : Infinity;
        const db = b.res.date ? new Date(b.res.date).getTime() : Infinity;
        return da - db;
      });
    }
    if (sortBy === 'trip') {
      return [...all].sort((a, b) => {
        const ta = a.kind === 'confirmed' ? a.trip.destination : '\uFFFF';
        const tb = b.kind === 'confirmed' ? b.trip.destination : '\uFFFF';
        return ta.localeCompare(tb);
      });
    }
    if (sortBy === 'type') {
      const typeOrder: Record<string, number> = { hotel: 0, flight: 1, train: 2, restaurant: 3, activity: 4, other: 5 };
      return [...all].sort((a, b) => (typeOrder[a.res.type] ?? 5) - (typeOrder[b.res.type] ?? 5));
    }
    // 'recent' — keep insertion order (confirmed first by trip, standalone prepended newest-first)
    return all;
  }, [tripsWithReservations, allStandalone, sortBy]);

  // ── Photos — resolved via name search → place details → photo ref ──
  const allNameHints = useMemo((): ActivityNameHint[] => {
    const hints: ActivityNameHint[] = [];
    for (const { trip, reservations } of tripsWithReservations) {
      for (const res of reservations) {
        hints.push({ key: `${res.title}::${trip.destination}`, name: res.title, destination: trip.destination });
      }
    }
    for (const res of allStandalone) {
      hints.push({ key: `${res.title}::standalone`, name: res.title, destination: res.address || undefined });
    }
    return hints;
  }, [tripsWithReservations, allStandalone]);

  // Single map keyed by booking.id / res.id — covers both pending and confirmed
  const { photos: photoMap, loading: photosLoading } = useActivityPhotos([], undefined, allNameHints);

  // ── Actions ──

  function openAddModal() {
    setEditingReservation(null);
    setModalInitialMode('choose');
    setStandaloneMode(true); // My Bookings always creates standalone
    setIsStandaloneEdit(false);
    setShowAddModal(true);
  }

  function openEditModal(res: Reservation, tripId: string) {
    setEditingReservation({ res, tripId });
    setStandaloneMode(false);
    setIsStandaloneEdit(false);
    setShowAddModal(true);
  }

  function openStandaloneEditModal(res: Reservation) {
    setEditingReservation({ res, tripId: '__standalone__' });
    setStandaloneMode(false);
    setIsStandaloneEdit(true);
    setShowAddModal(true);
  }

  function handleDelete(res: Reservation, tripId?: string) {
    Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          if (tripId) {
            removeReservation(tripId, res.id);
          } else {
            removeStandaloneBooking(res.id);
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast('Booking removed', 'success');
          closeSheet();
          setShowAddModal(false);
        },
      },
    ]);
  }

  async function handleCopyConfirmation(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedConfirmation(text);
    setTimeout(() => setCopiedConfirmation(null), 2000);
  }

  // ── Render helpers ──

  const totalBookings = tripsWithReservations.reduce((sum, g) => sum + g.reservations.length, 0) + allStandalone.length;



  function renderCardInner(
    photoUrl: string | undefined,
    typeKey: string,
    name: string,
    metaText: string,
  ) {
    return (
      <>
        <BookingImage uri={photoUrl} typeKey={typeKey} photosLoading={photosLoading} />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          locations={[0.35, 1]}
          style={StyleSheet.absoluteFill}
        />
        {/* Type icon — top-right, no pill */}
        <View style={styles.cardTypeIcon}>
          <SymbolView name={(TYPE_SYMBOLS[typeKey] ?? 'doc.text.fill') as any} size={18} tintColor="rgba(255,255,255,0.75)" />
        </View>
        {/* Bottom overlay */}
        <View style={styles.cardOverlay}>
          <ThemedText style={styles.cardName} numberOfLines={2}>{name}</ThemedText>
          {metaText ? (
            <ThemedText style={styles.cardMeta} numberOfLines={1}>{metaText}</ThemedText>
          ) : null}
        </View>
      </>
    );
  }

  // ── Sheet content rendering ──

  // Parse "CODE - City" → { code, city }
  function parseAirport(str: string): { code: string; city: string } {
    const idx = str.indexOf(' - ');
    if (idx > 0) return { code: str.slice(0, idx).trim(), city: str.slice(idx + 3).trim() };
    return { code: str.trim(), city: '' };
  }

  function renderTypeSpecificFields(res: Reservation) {
    const sym = getCurrSymbol(res.currency ?? 'USD');

    // ── Confirmation (shared) ──
    const confirmationRow = res.confirmationNumber ? (
      <Pressable onPress={() => handleCopyConfirmation(res.confirmationNumber!)} style={styles.detailRow} accessibilityRole="button" accessibilityLabel="Copy confirmation number">
        <SymbolView name="doc.on.clipboard" size={16} tintColor={theme.textSecondary} />
        <ThemedText style={styles.detailLabel}>Confirmation</ThemedText>
        <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>{res.confirmationNumber}</ThemedText>
        <SymbolView name={copiedConfirmation === res.confirmationNumber ? 'checkmark' : 'doc.on.doc'} size={14} tintColor={copiedConfirmation === res.confirmationNumber ? theme.primary : theme.textSecondary} />
      </Pressable>
    ) : null;

    // ── Booking link (shared) ──
    const linkRow = res.bookingUrl ? (
      <Pressable onPress={() => Linking.openURL(res.bookingUrl!)} style={styles.detailRow} accessibilityRole="button" accessibilityLabel="Open booking link">
        <SymbolView name="link" size={16} tintColor={theme.textSecondary} />
        <ThemedText style={styles.detailLabel}>Link</ThemedText>
        <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>
          {res.bookingUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}...
        </ThemedText>
        <SymbolView name={"arrow.up.right.square" as any} size={14} tintColor={theme.primary} />
      </Pressable>
    ) : null;

    // ── Notes (shared) ──
    const notesText = res.notes ? res.notes.split('\nCheck-out:')[0] : null;
    const notesRow = notesText ? (
      <View style={styles.detailRow}>
        <SymbolView name="note.text" size={16} tintColor={theme.textSecondary} />
        <ThemedText style={styles.detailLabel}>Notes</ThemedText>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.detailValue} numberOfLines={expandedNotesSheet ? undefined : 2}>{notesText}</ThemedText>
          <Pressable onPress={() => setExpandedNotesSheet(!expandedNotesSheet)}>
            <ThemedText style={[styles.readMoreText, { color: theme.primary }]}>{expandedNotesSheet ? 'Show less' : 'Read more'}</ThemedText>
          </Pressable>
        </View>
      </View>
    ) : null;

    // ── Address row helper ──
    function addressRow(label: string, openMaps: boolean) {
      if (!res.address) return null;
      if (openMaps) {
        return (
          <Pressable
            onPress={() => { const q = encodeURIComponent(res.address!); Linking.openURL(Platform.OS === 'ios' ? `maps:?q=${q}` : `geo:0,0?q=${q}`); }}
            style={styles.detailRow} accessibilityRole="button" accessibilityLabel="Open in Maps"
          >
            <SymbolView name="mappin" size={16} tintColor={theme.textSecondary} />
            <ThemedText style={styles.detailLabel}>{label}</ThemedText>
            <ThemedText style={[styles.detailValue, { flex: 1, color: theme.primary }]}>{res.address}</ThemedText>
            <SymbolView name="location.fill" size={14} tintColor={theme.primary} />
          </Pressable>
        );
      }
      return (
        <View style={styles.detailRow}>
          <SymbolView name="mappin" size={16} tintColor={theme.textSecondary} />
          <ThemedText style={styles.detailLabel}>{label}</ThemedText>
          <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.address}</ThemedText>
        </View>
      );
    }

    // ════════════════════════════════════════
    // FLIGHT / TRAIN
    // ════════════════════════════════════════
    if (res.type === 'flight' || res.type === 'train') {
      const isFlight = res.type === 'flight';
      const orig = res.origin ? parseAirport(res.origin) : null;
      const dest = res.destination ? parseAirport(res.destination) : null;

      const departsText = res.date
        ? `${formatBookingDate(res.date)}${res.time ? ` at ${res.time}` : ''}`
        : res.time ?? null;
      const arrivesText = res.arrivalTime
        ? (res.checkOutDate && res.checkOutDate !== res.date
            ? `${formatBookingDate(res.checkOutDate)} at ${res.arrivalTime}`
            : res.arrivalTime)
        : (res.checkOutDate && res.checkOutDate !== res.date ? formatBookingDate(res.checkOutDate) : null);

      return (
        <>
          {/* Route header */}
          {orig && dest ? (
            <View style={styles.routeHeader}>
              <View style={styles.routeAirport}>
                <ThemedText style={styles.routeCode}>{orig.code}</ThemedText>
                {orig.city ? <ThemedText style={[styles.routeCity, { color: theme.textSecondary }]}>{orig.city}</ThemedText> : null}
              </View>
              <SymbolView name={isFlight ? 'airplane' : 'tram.fill'} size={20} tintColor={theme.textSecondary} />
              <View style={[styles.routeAirport, { alignItems: 'flex-end' }]}>
                <ThemedText style={styles.routeCode}>{dest.code}</ThemedText>
                {dest.city ? <ThemedText style={[styles.routeCity, { color: theme.textSecondary }]}>{dest.city}</ThemedText> : null}
              </View>
            </View>
          ) : null}

          {confirmationRow}

          {res.flightNumber ? (
            <View style={styles.detailRow}>
              <SymbolView name={isFlight ? 'airplane' : 'tram.fill'} size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>{isFlight ? 'Flight' : 'Train'}</ThemedText>
              <ThemedText style={styles.detailValue}>{res.flightNumber}</ThemedText>
            </View>
          ) : null}

          {departsText ? (
            <View style={styles.detailRow}>
              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Departs</ThemedText>
              <ThemedText style={styles.detailValue}>{departsText}</ThemedText>
            </View>
          ) : null}

          {arrivesText ? (
            <View style={styles.detailRow}>
              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Arrives</ThemedText>
              <ThemedText style={styles.detailValue}>{arrivesText}</ThemedText>
            </View>
          ) : null}

          {res.boardingTime ? (
            <View style={styles.detailRow}>
              <SymbolView name="clock" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Boards</ThemedText>
              <ThemedText style={styles.detailValue}>{res.boardingTime}</ThemedText>
            </View>
          ) : null}

          {res.seat ? (
            <View style={styles.detailRow}>
              <SymbolView name="person.crop.rectangle" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Seat</ThemedText>
              <ThemedText style={styles.detailValue}>{res.seat}</ThemedText>
            </View>
          ) : null}

          {res.passengerName ? (
            <View style={styles.detailRow}>
              <SymbolView name="person" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Passenger</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.passengerName}</ThemedText>
            </View>
          ) : null}

          {res.baggage ? (
            <View style={styles.detailRow}>
              <SymbolView name="bag" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Baggage</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.baggage}</ThemedText>
            </View>
          ) : null}

          {res.price != null ? (
            <View style={styles.detailRow}>
              <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Price</ThemedText>
              <ThemedText style={styles.detailValue}>{sym}{res.price.toLocaleString()}</ThemedText>
            </View>
          ) : null}

          {linkRow}
          {notesRow}
        </>
      );
    }

    // ════════════════════════════════════════
    // HOTEL
    // ════════════════════════════════════════
    if (res.type === 'hotel') {
      const checkInText = res.date
        ? `${formatBookingDate(res.date)}${res.checkInTime ? ` · from ${res.checkInTime}` : ''}`
        : null;
      const checkOutText = res.checkOutDate
        ? `${formatBookingDate(res.checkOutDate)}${res.checkOutTime ? ` · by ${res.checkOutTime}` : ''}`
        : null;

      let perNight: number | null = null;
      if (res.price != null && res.date && res.checkOutDate) {
        const nights = Math.round((new Date(res.checkOutDate).getTime() - new Date(res.date).getTime()) / 86_400_000);
        if (nights > 0) perNight = Math.round(res.price / nights);
      }

      return (
        <>
          {confirmationRow}

          {checkInText ? (
            <View style={styles.detailRow}>
              <SymbolView name="arrow.right.square" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Check-in</ThemedText>
              <ThemedText style={styles.detailValue}>{checkInText}</ThemedText>
            </View>
          ) : null}

          {checkOutText ? (
            <View style={styles.detailRow}>
              <SymbolView name="arrow.left.square" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Check-out</ThemedText>
              <ThemedText style={styles.detailValue}>{checkOutText}</ThemedText>
            </View>
          ) : null}

          {res.roomType ? (
            <View style={styles.detailRow}>
              <SymbolView name="bed.double" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Room</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.roomType}</ThemedText>
            </View>
          ) : null}

          {res.guestCount ? (
            <View style={styles.detailRow}>
              <SymbolView name="person.2" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Guests</ThemedText>
              <ThemedText style={styles.detailValue}>{res.guestCount}</ThemedText>
            </View>
          ) : null}

          {res.price != null ? (
            <View style={styles.detailRow}>
              <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Price</ThemedText>
              <ThemedText style={styles.detailValue}>
                {sym}{res.price.toLocaleString()}{perNight != null ? ` · ${sym}${perNight.toLocaleString()}/night` : ''}
              </ThemedText>
            </View>
          ) : null}

          {res.cancellationPolicy ? (
            <View style={styles.detailRow}>
              <SymbolView name="exclamationmark.circle" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Cancel</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.cancellationPolicy}</ThemedText>
            </View>
          ) : null}

          {addressRow('Property', true)}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ════════════════════════════════════════
    // RESTAURANT
    // ════════════════════════════════════════
    if (res.type === 'restaurant') {
      const reservationText = res.date
        ? `${formatBookingDate(res.date)}${res.time ? ` at ${res.time}` : ''}`
        : res.time ?? null;

      return (
        <>
          {confirmationRow}

          {reservationText ? (
            <View style={styles.detailRow}>
              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Reservation</ThemedText>
              <ThemedText style={styles.detailValue}>{reservationText}</ThemedText>
            </View>
          ) : null}

          {res.guestCount ? (
            <View style={styles.detailRow}>
              <SymbolView name="person.2" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Party</ThemedText>
              <ThemedText style={styles.detailValue}>{res.guestCount} {res.guestCount === 1 ? 'guest' : 'guests'}</ThemedText>
            </View>
          ) : null}

          {res.price != null ? (
            <View style={styles.detailRow}>
              <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Price</ThemedText>
              <ThemedText style={styles.detailValue}>{sym}{res.price.toLocaleString()}</ThemedText>
            </View>
          ) : null}

          {res.cancellationPolicy ? (
            <View style={styles.detailRow}>
              <SymbolView name="exclamationmark.circle" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Cancel</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.cancellationPolicy}</ThemedText>
            </View>
          ) : null}

          {addressRow('Address', true)}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ════════════════════════════════════════
    // ACTIVITY
    // ════════════════════════════════════════
    if (res.type === 'activity') {
      const dateText = res.date
        ? `${formatBookingDate(res.date)}${res.time ? ` at ${res.time}` : ''}`
        : res.time ?? null;

      let perPerson: number | null = null;
      if (res.price != null && res.guestCount && res.guestCount > 1) {
        perPerson = Math.round(res.price / res.guestCount);
      }

      return (
        <>
          {confirmationRow}

          {dateText ? (
            <View style={styles.detailRow}>
              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Date</ThemedText>
              <ThemedText style={styles.detailValue}>{dateText}</ThemedText>
            </View>
          ) : null}

          {res.duration ? (
            <View style={styles.detailRow}>
              <SymbolView name="timer" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Duration</ThemedText>
              <ThemedText style={styles.detailValue}>{res.duration}</ThemedText>
            </View>
          ) : null}

          {res.guestCount ? (
            <View style={styles.detailRow}>
              <SymbolView name="person.2" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Participants</ThemedText>
              <ThemedText style={styles.detailValue}>{res.guestCount}</ThemedText>
            </View>
          ) : null}

          {res.price != null ? (
            <View style={styles.detailRow}>
              <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Price</ThemedText>
              <ThemedText style={styles.detailValue}>
                {sym}{res.price.toLocaleString()}{perPerson != null ? ` · ${sym}${perPerson.toLocaleString()}/person` : ''}
              </ThemedText>
            </View>
          ) : null}

          {res.cancellationPolicy ? (
            <View style={styles.detailRow}>
              <SymbolView name="exclamationmark.circle" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={styles.detailLabel}>Cancel</ThemedText>
              <ThemedText style={[styles.detailValue, { flex: 1 }]}>{res.cancellationPolicy}</ThemedText>
            </View>
          ) : null}

          {addressRow('Meeting point', true)}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ════════════════════════════════════════
    // OTHER / fallback
    // ════════════════════════════════════════
    return (
      <>
        {confirmationRow}

        {res.date ? (
          <View style={styles.detailRow}>
            <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
            <ThemedText style={styles.detailLabel}>Date</ThemedText>
            <ThemedText style={styles.detailValue}>{formatBookingDate(res.date)}{res.checkOutDate ? ` \u2013 ${formatBookingDate(res.checkOutDate)}` : ''}</ThemedText>
          </View>
        ) : null}

        {res.time ? (
          <View style={styles.detailRow}>
            <SymbolView name="clock" size={16} tintColor={theme.textSecondary} />
            <ThemedText style={styles.detailLabel}>Time</ThemedText>
            <ThemedText style={styles.detailValue}>{res.time}</ThemedText>
          </View>
        ) : null}

        {res.price != null ? (
          <View style={styles.detailRow}>
            <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
            <ThemedText style={styles.detailLabel}>Price</ThemedText>
            <ThemedText style={styles.detailValue}>{sym}{res.price.toLocaleString()}</ThemedText>
          </View>
        ) : null}

        {addressRow('Address', true)}
        {linkRow}
        {notesRow}
      </>
    );
  }

  function renderSheetBody() {
    if (!sheetContent) return null;

    const showViewPlace = (res: Reservation) => res.type === 'hotel' || res.type === 'restaurant' || res.type === 'activity';

    if (sheetContent.kind === 'standalone') {
      const { res } = sheetContent;
      const photoUrl = photoMap.get(`${res.title}::standalone`);

      return (
        <>
          <View style={styles.sheetPhoto}>
            <BookingImage uri={photoUrl} typeKey={res.type} iconSize={40} photosLoading={photosLoading} />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} locations={[0.4, 1]} style={StyleSheet.absoluteFill} />
          </View>
          <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
          <ScrollView style={styles.sheetDetails} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <ThemedText style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }} numberOfLines={2}>{res.title}</ThemedText>
            {renderTypeSpecificFields(res)}
          </ScrollView>
          <View style={[styles.sheetActionsBar, { borderTopColor: theme.border, paddingBottom: insets.bottom + 8 }]}>
            {showViewPlace(res) && (() => {
              const category = res.type === 'hotel' ? 'stay' : res.type === 'restaurant' ? 'food' : 'activity';
              const searchDest = res.address || res.title;
              let url = `/place-detail?name=${encodeURIComponent(res.title)}&destination=${encodeURIComponent(searchDest)}&category=${encodeURIComponent(category)}`;
              if (res.address) url += `&address=${encodeURIComponent(res.address)}`;
              return (
                <Pressable onPress={() => closeSheet(() => router.push(url as any))} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="View place details">
                  <SymbolView name="mappin.and.ellipse" size={16} tintColor={theme.text} />
                  <ThemedText style={styles.actionBtnText}>View Place</ThemedText>
                </Pressable>
              );
            })()}
            <Pressable onPress={() => closeSheet(() => openStandaloneEditModal(res))} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="Edit booking">
              <SymbolView name="pencil" size={16} tintColor={theme.text} />
              <ThemedText style={styles.actionBtnText}>Edit</ThemedText>
            </Pressable>
            <Pressable onPress={() => handleDelete(res)} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="Delete booking">
              <SymbolView name="trash" size={16} tintColor={theme.danger} />
              <ThemedText style={[styles.actionBtnText, { color: theme.danger }]}>Delete</ThemedText>
            </Pressable>
          </View>
        </>
      );
    }

    if (sheetContent.kind === 'confirmed') {
      const { res, trip } = sheetContent;
      const photoUrl = photoMap.get(`${res.title}::${trip.destination}`);

      return (
        <>
          <View style={styles.sheetPhoto}>
            <BookingImage uri={photoUrl} typeKey={res.type} iconSize={40} photosLoading={photosLoading} />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} locations={[0.4, 1]} style={StyleSheet.absoluteFill} />
          </View>
          <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
          <ScrollView style={styles.sheetDetails} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            <ThemedText style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }} numberOfLines={2}>{res.title}</ThemedText>
            {renderTypeSpecificFields(res)}
            <View style={styles.sheetTripLabel}>
              <ThemedText style={styles.sheetTripLabelText} numberOfLines={1}>{trip.emoji} {trip.destination}</ThemedText>
            </View>
          </ScrollView>
          <View style={[styles.sheetActionsBar, { borderTopColor: theme.border, paddingBottom: insets.bottom + 8 }]}>
            {showViewPlace(res) && (() => {
              const category = res.type === 'hotel' ? 'stay' : res.type === 'restaurant' ? 'food' : 'activity';
              const linkedAct = trip.activities.find((a) => a.reservationId === res.id);
              const searchDest = res.address || trip.destination;
              let url = `/place-detail?name=${encodeURIComponent(res.title)}&destination=${encodeURIComponent(searchDest)}&tripId=${encodeURIComponent(trip.id)}&category=${encodeURIComponent(category)}`;
              if (res.address) url += `&address=${encodeURIComponent(res.address)}`;
              if (linkedAct?.placeId) url += `&placeId=${encodeURIComponent(linkedAct.placeId)}`;
              if (linkedAct?.lat != null) url += `&lat=${linkedAct.lat}`;
              if (linkedAct?.lng != null) url += `&lng=${linkedAct.lng}`;
              return (
                <Pressable onPress={() => closeSheet(() => router.push(url as any))} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="View place details">
                  <SymbolView name="mappin.and.ellipse" size={16} tintColor={theme.text} />
                  <ThemedText style={styles.actionBtnText}>View Place</ThemedText>
                </Pressable>
              );
            })()}
            <Pressable onPress={() => closeSheet(() => openEditModal(res, trip.id))} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="Edit booking">
              <SymbolView name="pencil" size={16} tintColor={theme.text} />
              <ThemedText style={styles.actionBtnText}>Edit</ThemedText>
            </Pressable>
            <Pressable onPress={() => handleDelete(res, trip.id)} style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="button" accessibilityLabel="Delete booking">
              <SymbolView name="trash" size={16} tintColor={theme.danger} />
              <ThemedText style={[styles.actionBtnText, { color: theme.danger }]}>Delete</ThemedText>
            </Pressable>
          </View>
        </>
      );
    }

    return null;
  }

  // ── Main render ──

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ contentStyle: { backgroundColor: theme.background } }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name="chevron.left" size={20} tintColor={theme.primary} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>My Bookings</ThemedText>
        <Pressable onPress={openAddModal} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Add booking">
          <SymbolView name="plus" size={20} tintColor={theme.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
          totalBookings === 0 && { flexGrow: 1 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Empty state */}
        {totalBookings === 0 && (
          <View style={styles.emptyState}>
            <ExpoImage
              source={require('@/assets/images/onboarding-slide-2.png')}
              style={styles.gmailLogo}
              contentFit="contain"
            />
            <ThemedText type="headline" style={styles.emptyTitle}>
              Your bookings, all in one place.
            </ThemedText>
            <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
              Forward your confirmation emails to the address below and we'll organize everything for you.
            </ThemedText>
            <Pressable
              onPress={handleCopyEmail}
              style={[styles.emptyEmailBox, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="Copy forwarding email address"
            >
              <ThemedText style={[styles.emptyEmailText, { color: theme.primary }]} numberOfLines={1}>
                {bookingEmail}
              </ThemedText>
              <SymbolView
                name={emailCopied ? 'checkmark' : 'square.on.square'}
                size={14}
                tintColor={emailCopied ? theme.primary : theme.textSecondary}
              />
            </Pressable>
          </View>
        )}

        {/* Confirmed section — email strip + sort + 2-column grid */}
        {sortedGridItems.length > 0 && (
          <View style={styles.sectionBlock}>

            {/* Forward email strip */}
            <Pressable
              onPress={handleCopyEmail}
              style={[styles.emailStrip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Copy forwarding email address"
            >
              <ExpoImage source={require('@/assets/images/gmail-logo.png')} style={{ width: 16, height: 16 }} contentFit="contain" />
              <ThemedText style={[styles.emailStripLabel, { color: theme.textSecondary }]}>Forward to:</ThemedText>
              <ThemedText style={[styles.emailStripAddress, { color: theme.primary }]} numberOfLines={1}>{bookingEmail}</ThemedText>
              <SymbolView name={emailCopied ? 'checkmark' : 'square.on.square'} size={13} tintColor={emailCopied ? theme.primary : theme.textSecondary} />
            </Pressable>

            {/* Sort chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
              {([
                { key: 'recent', label: 'Recent' },
                { key: 'upcoming', label: 'Upcoming' },
                { key: 'trip', label: 'By Trip' },
                { key: 'type', label: 'By Type' },
              ] as { key: SortBy; label: string }[]).map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setSortBy(opt.key)}
                  style={[
                    styles.sortChip,
                    sortBy === opt.key
                      ? { backgroundColor: theme.primary }
                      : { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${opt.label}`}
                >
                  <ThemedText style={[styles.sortChipText, { color: sortBy === opt.key ? theme.primaryText : theme.text }]}>
                    {opt.label}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            {(() => {
              function renderCard(item: GridItem) {
                const res = item.res;
                const photoUrl = item.kind === 'confirmed'
                  ? photoMap.get(`${res.title}::${item.trip.destination}`)
                  : photoMap.get(`${res.title}::standalone`);
                const metaText = (
                  res.date && res.checkOutDate
                    ? `${formatBookingDate(res.date)} – ${formatBookingDate(res.checkOutDate)}`
                    : res.date ? formatBookingDate(res.date) : ''
                );
                return (
                  <Pressable
                    key={res.id}
                    onPress={() => item.kind === 'confirmed'
                      ? openSheet({ kind: 'confirmed', res, trip: item.trip })
                      : openSheet({ kind: 'standalone', res })
                    }
                    style={[styles.gridCard, { width: CARD_WIDTH, height: CARD_HEIGHT }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${res.title}, tap to view details`}
                  >
                    {renderCardInner(photoUrl, res.type, res.title, metaText)}
                    {item.kind === 'confirmed' && sortBy !== 'trip' && (
                      <View style={styles.cardTripLabel}>
                        <ThemedText style={styles.cardTripLabelText} numberOfLines={1}>{item.trip.emoji} {item.trip.destination}</ThemedText>
                      </View>
                    )}
                  </Pressable>
                );
              }

              if (sortBy === 'trip') {
                if (trips.length === 0) {
                  return (
                    <ThemedText style={[styles.groupEmptyText, { color: theme.textSecondary }]}>No trips planned</ThemedText>
                  );
                }
                // Build a map of tripId → confirmed items
                const tripItemMap = new Map<string, GridItem[]>();
                for (const item of sortedGridItems) {
                  if (item.kind !== 'confirmed') continue;
                  if (!tripItemMap.has(item.trip.id)) tripItemMap.set(item.trip.id, []);
                  tripItemMap.get(item.trip.id)!.push(item);
                }
                // Standalone (not linked to any trip)
                const standaloneItems = sortedGridItems.filter((i) => i.kind === 'standalone');
                return (
                  <>
                    {trips.map((trip) => {
                      const items = tripItemMap.get(trip.id) ?? [];
                      return (
                        <View key={trip.id} style={styles.groupSection}>
                          <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>{trip.destination}</ThemedText>
                          {items.length > 0
                            ? <View style={styles.grid}>{items.map(renderCard)}</View>
                            : <ThemedText style={[styles.groupEmptyText, { color: theme.textSecondary }]}>No bookings for this trip</ThemedText>
                          }
                        </View>
                      );
                    })}
                    {standaloneItems.length > 0 && (
                      <View style={styles.groupSection}>
                        <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>Unlinked</ThemedText>
                        <View style={styles.grid}>{standaloneItems.map(renderCard)}</View>
                      </View>
                    )}
                  </>
                );
              }

              if (sortBy === 'type') {
                const typeOrder = ['flight', 'train', 'hotel', 'restaurant', 'activity', 'other'];
                const typeLabels: Record<string, string> = { flight: 'Flights', train: 'Transport', hotel: 'Hotels', restaurant: 'Restaurants', activity: 'Activities', other: 'Other' };
                const typeMap = new Map<string, GridItem[]>();
                for (const item of sortedGridItems) {
                  const t = item.res.type;
                  if (!typeMap.has(t)) typeMap.set(t, []);
                  typeMap.get(t)!.push(item);
                }
                return typeOrder.filter((t) => typeMap.has(t)).map((t) => (
                  <View key={t} style={styles.groupSection}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <SymbolView name={(TYPE_SYMBOLS[t] ?? 'doc.text.fill') as any} size={14} tintColor={theme.textSecondary} />
                      <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>{typeLabels[t]}</ThemedText>
                    </View>
                    <View style={styles.grid}>{typeMap.get(t)!.map(renderCard)}</View>
                  </View>
                ));
              }

              return <View style={styles.grid}>{sortedGridItems.map(renderCard)}</View>;
            })()}
          </View>
        )}

      </ScrollView>

      {/* ── Bottom Sheet (in-tree Animated) ── */}
      {sheetContent !== null && (
        <>
          {/* Backdrop — full-screen Pressable first so taps outside the sheet
              always land here; the visual dim is a non-interactive child */}
          <Pressable style={styles.sheetBackdropPressable} onPress={() => closeSheet()} accessibilityRole="button" accessibilityLabel="Close">
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropAnim, backgroundColor: 'rgba(0,0,0,0.5)' }]} pointerEvents="none" />
          </Pressable>

          {/* Sheet */}
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme.background, transform: [{ translateY: sheetAnim }] },
            ]}
          >
            {/* X close button overlaid on photo */}
            <Pressable
              onPress={() => closeSheet()}
              style={styles.sheetCloseBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <View style={styles.sheetCloseBtnInner}>
                <SymbolView name="xmark" size={12} tintColor="#fff" />
              </View>
            </Pressable>

            {renderSheetBody()}
          </Animated.View>
        </>
      )}

      {/* ── Add / Edit Modal ── */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        {showAddModal && (
          <AddBookingModal
            visible={showAddModal}
            onClose={() => setShowAddModal(false)}
            editRes={editingReservation}
            pendingImport={null}
            initialMode={modalInitialMode}
            trips={standaloneMode ? [] : trips}
            onAdd={(tripId, payload) => {
              if (standaloneMode) {
                addStandaloneBooking(payload);
              } else {
                addReservation(tripId, payload);
              }
            }}
            onUpdate={(tripId, res) => {
              if (isStandaloneEdit) {
                updateStandaloneBooking(res.id, res);
              } else {
                updateReservation(tripId, res);
              }
            }}
            onDelete={(res, tripId) => {
              if (isStandaloneEdit) {
                handleDelete(res);
              } else {
                handleDelete(res, tripId);
              }
            }}
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  headerBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },

  // Content
  content: { padding: Spacing.four, gap: 24 },

  // Email strip
  emailStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  emailStripLabel: { fontSize: 12, fontWeight: '600' },
  emailStripAddress: { fontSize: 12, fontWeight: '700', flex: 1 },

  // Sort chips
  sortRow: { gap: 8, paddingVertical: 2 },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  sortChipText: { fontSize: 13, fontWeight: '600' },

  // Section
  sectionBlock: { gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 0,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // Grid (confirmed)
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  groupSection: { gap: 10 },
  groupLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  groupEmptyText: { fontSize: 13, fontWeight: '500', fontStyle: 'italic' },

  // Pending horizontal scroll
  pendingRow: { gap: GAP },

  // Card (shared by pending + confirmed)
  gridCard: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: '#1a1e28',
  },
  cardPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  cardName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  cardMeta: { fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  cardTypeIcon: { position: 'absolute', top: 10, right: 10 },
  cardTripLabel: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  cardTripLabelText: { fontSize: 10, fontWeight: '600', color: '#fff' },

  // Empty state
  emptyState: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 32, paddingBottom: 60, gap: 12 },
  gmailLogo: { width: 180, height: 180, marginBottom: 4, transform: [{ rotate: '12deg' }] },
  emptyTitle: { textAlign: 'center' as const },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' as const },
  emptyEmailBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: 4,
  },
  emptyEmailText: { fontSize: 15, fontWeight: '700' as const },

  // Detail rows (used inside sheet)
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  detailLabel: { fontSize: 13, fontWeight: '600', width: 90 },
  detailValue: { fontSize: 14, fontWeight: '500' },
  expandedDivider: { height: 1, marginVertical: 2 },
  expandedActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  sheetActionsBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  readMoreText: { fontSize: 12, fontWeight: '600', marginTop: 3 },

  // Bottom sheet
  sheetBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 101,
    maxHeight: '85%',
  },
  sheetCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
  },
  sheetCloseBtnInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPhoto: {
    height: 200,
    overflow: 'hidden',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetPhotoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetDetails: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetTripLabel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 4,
  },
  sheetTripLabelText: { fontSize: 12, fontWeight: '600' },

  // Route header (flight / train sheet)
  routeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginBottom: 4 },
  routeAirport: { alignItems: 'flex-start' },
  routeCode: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 36 },
  routeCity: { fontSize: 12, fontWeight: '500', marginTop: 2 },
});
