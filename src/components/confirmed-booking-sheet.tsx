import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { getCurrSymbol, TYPE_SYMBOLS, formatBookingDate } from '@/components/add-booking-modal';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Reservation, Trip } from '@/context/trips';

interface Props {
  data: { res: Reservation; trip: Trip; photoUrl?: string } | null;
  onClose: () => void;
  onEdit: (res: Reservation, tripId: string) => void;
  onDelete: (res: Reservation, tripId: string) => void;
}

export function ConfirmedBookingSheet({ data, onClose, onEdit, onDelete }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState(false);
  const [copiedConfirmation, setCopiedConfirmation] = useState<string | null>(null);

  const sheetAnim = useRef(new Animated.Value(800)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (data) {
      setMounted(true);
      setExpandedNotes(false);
      setCopiedConfirmation(null);
      Animated.parallel([
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(sheetAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [data]);

  function close(then?: () => void) {
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 800, duration: 240, useNativeDriver: true }),
    ]).start(() => {
      setMounted(false);
      onClose();
      then?.();
    });
  }

  async function handleCopyConfirmation(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedConfirmation(text);
    setTimeout(() => setCopiedConfirmation(null), 2000);
  }

  if (!mounted || !data) return null;

  const { res, trip, photoUrl } = data;

  // ── Shared helpers ──
  const sym = getCurrSymbol(res.currency ?? 'USD');

  const confirmationRow = res.confirmationNumber ? (
    <Pressable onPress={() => handleCopyConfirmation(res.confirmationNumber!)} style={styles.detailRow} accessibilityRole="button" accessibilityLabel="Copy confirmation number">
      <SymbolView name="doc.on.clipboard" size={16} tintColor={theme.textSecondary} />
      <ThemedText style={styles.detailLabel}>Confirmation</ThemedText>
      <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>{res.confirmationNumber}</ThemedText>
      <SymbolView name={copiedConfirmation === res.confirmationNumber ? 'checkmark' : 'doc.on.doc'} size={14} tintColor={copiedConfirmation === res.confirmationNumber ? theme.primary : theme.textSecondary} />
    </Pressable>
  ) : null;

  const linkRow = res.bookingUrl ? (
    <Pressable onPress={() => Linking.openURL(res.bookingUrl!)} style={styles.detailRow} accessibilityRole="button" accessibilityLabel="Open booking link">
      <SymbolView name="link" size={16} tintColor={theme.textSecondary} />
      <ThemedText style={styles.detailLabel}>Link</ThemedText>
      <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>{res.bookingUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}...</ThemedText>
      <SymbolView name={'arrow.up.right.square' as any} size={14} tintColor={theme.primary} />
    </Pressable>
  ) : null;

  const notesText = res.notes ? res.notes.split('\nCheck-out:')[0] : null;
  const notesRow = notesText ? (
    <View style={styles.detailRow}>
      <SymbolView name="note.text" size={16} tintColor={theme.textSecondary} />
      <ThemedText style={styles.detailLabel}>Notes</ThemedText>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.detailValue} numberOfLines={expandedNotes ? undefined : 2}>{notesText}</ThemedText>
        <Pressable onPress={() => setExpandedNotes(!expandedNotes)}>
          <ThemedText style={[styles.readMoreText, { color: theme.primary }]}>{expandedNotes ? 'Show less' : 'Read more'}</ThemedText>
        </Pressable>
      </View>
    </View>
  ) : null;

  function addressRow(label: string) {
    if (!res.address) return null;
    return (
      <Pressable onPress={() => { const q = encodeURIComponent(res.address!); Linking.openURL(Platform.OS === 'ios' ? `maps:?q=${q}` : `geo:0,0?q=${q}`); }} style={styles.detailRow} accessibilityRole="button" accessibilityLabel="Open in Maps">
        <SymbolView name="mappin" size={16} tintColor={theme.textSecondary} />
        <ThemedText style={styles.detailLabel}>{label}</ThemedText>
        <ThemedText style={[styles.detailValue, { flex: 1, color: theme.primary }]}>{res.address}</ThemedText>
        <SymbolView name="location.fill" size={14} tintColor={theme.primary} />
      </Pressable>
    );
  }

  function renderFields(r: Reservation) {
    // ── FLIGHT / TRAIN ──
    if (r.type === 'flight' || r.type === 'train') {
      const isFlight = r.type === 'flight';
      function parseAirport(str: string) {
        const idx = str.indexOf(' - ');
        return idx > 0 ? { code: str.slice(0, idx).trim(), city: str.slice(idx + 3).trim() } : { code: str.trim(), city: '' };
      }
      const orig = r.origin ? parseAirport(r.origin) : null;
      const dest = r.destination ? parseAirport(r.destination) : null;
      const departsText = r.date ? `${formatBookingDate(r.date)}${r.time ? ` at ${r.time}` : ''}` : r.time ?? null;
      const arrivesText = r.arrivalTime
        ? (r.checkOutDate && r.checkOutDate !== r.date ? `${formatBookingDate(r.checkOutDate)} at ${r.arrivalTime}` : r.arrivalTime)
        : (r.checkOutDate && r.checkOutDate !== r.date ? formatBookingDate(r.checkOutDate) : null);
      return (
        <>
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
          {r.flightNumber ? <View style={styles.detailRow}><SymbolView name={isFlight ? 'airplane' : 'tram.fill'} size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>{isFlight ? 'Flight' : 'Train'}</ThemedText><ThemedText style={styles.detailValue}>{r.flightNumber}</ThemedText></View> : null}
          {departsText ? <View style={styles.detailRow}><SymbolView name="calendar" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Departs</ThemedText><ThemedText style={styles.detailValue}>{departsText}</ThemedText></View> : null}
          {arrivesText ? <View style={styles.detailRow}><SymbolView name="calendar" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Arrives</ThemedText><ThemedText style={styles.detailValue}>{arrivesText}</ThemedText></View> : null}
          {r.boardingTime ? <View style={styles.detailRow}><SymbolView name="clock" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Boards</ThemedText><ThemedText style={styles.detailValue}>{r.boardingTime}</ThemedText></View> : null}
          {r.seat ? <View style={styles.detailRow}><SymbolView name="person.crop.rectangle" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Seat</ThemedText><ThemedText style={styles.detailValue}>{r.seat}</ThemedText></View> : null}
          {r.passengerName ? <View style={styles.detailRow}><SymbolView name="person" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Passenger</ThemedText><ThemedText style={[styles.detailValue, { flex: 1 }]}>{r.passengerName}</ThemedText></View> : null}
          {r.baggage ? <View style={styles.detailRow}><SymbolView name="bag" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Baggage</ThemedText><ThemedText style={[styles.detailValue, { flex: 1 }]}>{r.baggage}</ThemedText></View> : null}
          {r.price != null ? <View style={styles.detailRow}><SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Price</ThemedText><ThemedText style={styles.detailValue}>{sym}{r.price.toLocaleString()}</ThemedText></View> : null}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ── HOTEL ──
    if (r.type === 'hotel') {
      const checkInText = r.date ? `${formatBookingDate(r.date)}${r.checkInTime ? ` · from ${r.checkInTime}` : ''}` : null;
      const checkOutText = r.checkOutDate ? `${formatBookingDate(r.checkOutDate)}${r.checkOutTime ? ` · by ${r.checkOutTime}` : ''}` : null;
      let perNight: number | null = null;
      if (r.price != null && r.date && r.checkOutDate) {
        const nights = Math.round((new Date(r.checkOutDate).getTime() - new Date(r.date).getTime()) / 86_400_000);
        if (nights > 0) perNight = Math.round(r.price / nights);
      }
      return (
        <>
          {confirmationRow}
          {checkInText ? <View style={styles.detailRow}><SymbolView name="arrow.right.square" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Check-in</ThemedText><ThemedText style={styles.detailValue}>{checkInText}</ThemedText></View> : null}
          {checkOutText ? <View style={styles.detailRow}><SymbolView name="arrow.left.square" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Check-out</ThemedText><ThemedText style={styles.detailValue}>{checkOutText}</ThemedText></View> : null}
          {r.roomType ? <View style={styles.detailRow}><SymbolView name="bed.double" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Room</ThemedText><ThemedText style={[styles.detailValue, { flex: 1 }]}>{r.roomType}</ThemedText></View> : null}
          {r.guestCount ? <View style={styles.detailRow}><SymbolView name="person.2" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Guests</ThemedText><ThemedText style={styles.detailValue}>{r.guestCount}</ThemedText></View> : null}
          {r.price != null ? <View style={styles.detailRow}><SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Price</ThemedText><ThemedText style={styles.detailValue}>{sym}{r.price.toLocaleString()}{perNight != null ? ` · ${sym}${perNight.toLocaleString()}/night` : ''}</ThemedText></View> : null}
          {r.cancellationPolicy ? <View style={styles.detailRow}><SymbolView name="exclamationmark.circle" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Cancel</ThemedText><ThemedText style={[styles.detailValue, { flex: 1 }]}>{r.cancellationPolicy}</ThemedText></View> : null}
          {addressRow('Property')}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ── RESTAURANT ──
    if (r.type === 'restaurant') {
      const reservationText = r.date ? `${formatBookingDate(r.date)}${r.time ? ` at ${r.time}` : ''}` : r.time ?? null;
      return (
        <>
          {confirmationRow}
          {reservationText ? <View style={styles.detailRow}><SymbolView name="calendar" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Reservation</ThemedText><ThemedText style={styles.detailValue}>{reservationText}</ThemedText></View> : null}
          {r.guestCount ? <View style={styles.detailRow}><SymbolView name="person.2" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Party</ThemedText><ThemedText style={styles.detailValue}>{r.guestCount} {r.guestCount === 1 ? 'guest' : 'guests'}</ThemedText></View> : null}
          {r.price != null ? <View style={styles.detailRow}><SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Price</ThemedText><ThemedText style={styles.detailValue}>{sym}{r.price.toLocaleString()}</ThemedText></View> : null}
          {r.cancellationPolicy ? <View style={styles.detailRow}><SymbolView name="exclamationmark.circle" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Cancel</ThemedText><ThemedText style={[styles.detailValue, { flex: 1 }]}>{r.cancellationPolicy}</ThemedText></View> : null}
          {addressRow('Address')}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ── ACTIVITY ──
    if (r.type === 'activity') {
      const dateText = r.date ? `${formatBookingDate(r.date)}${r.time ? ` at ${r.time}` : ''}` : r.time ?? null;
      let perPerson: number | null = null;
      if (r.price != null && r.guestCount && r.guestCount > 1) perPerson = Math.round(r.price / r.guestCount);
      return (
        <>
          {confirmationRow}
          {dateText ? <View style={styles.detailRow}><SymbolView name="calendar" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Date</ThemedText><ThemedText style={styles.detailValue}>{dateText}</ThemedText></View> : null}
          {r.duration ? <View style={styles.detailRow}><SymbolView name="timer" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Duration</ThemedText><ThemedText style={styles.detailValue}>{r.duration}</ThemedText></View> : null}
          {r.guestCount ? <View style={styles.detailRow}><SymbolView name="person.2" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Participants</ThemedText><ThemedText style={styles.detailValue}>{r.guestCount}</ThemedText></View> : null}
          {r.price != null ? <View style={styles.detailRow}><SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Price</ThemedText><ThemedText style={styles.detailValue}>{sym}{r.price.toLocaleString()}{perPerson != null ? ` · ${sym}${perPerson.toLocaleString()}/person` : ''}</ThemedText></View> : null}
          {r.cancellationPolicy ? <View style={styles.detailRow}><SymbolView name="exclamationmark.circle" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Cancel</ThemedText><ThemedText style={[styles.detailValue, { flex: 1 }]}>{r.cancellationPolicy}</ThemedText></View> : null}
          {addressRow('Meeting point')}
          {linkRow}
          {notesRow}
        </>
      );
    }

    // ── OTHER / fallback ──
    return (
      <>
        {confirmationRow}
        {r.date ? <View style={styles.detailRow}><SymbolView name="calendar" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Date</ThemedText><ThemedText style={styles.detailValue}>{formatBookingDate(r.date)}{r.checkOutDate ? ` – ${formatBookingDate(r.checkOutDate)}` : ''}</ThemedText></View> : null}
        {r.time ? <View style={styles.detailRow}><SymbolView name="clock" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Time</ThemedText><ThemedText style={styles.detailValue}>{r.time}</ThemedText></View> : null}
        {r.price != null ? <View style={styles.detailRow}><SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} /><ThemedText style={styles.detailLabel}>Price</ThemedText><ThemedText style={styles.detailValue}>{sym}{r.price.toLocaleString()}</ThemedText></View> : null}
        {addressRow('Address')}
        {linkRow}
        {notesRow}
      </>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <Pressable
        style={styles.backdropPressable}
        onPress={() => close()}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: backdropAnim, backgroundColor: 'rgba(0,0,0,0.5)' }]}
          pointerEvents="none"
        />
      </Pressable>

      {/* Sheet panel */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.background, transform: [{ translateY: sheetAnim }] },
        ]}
      >
        {/* X close button overlaid on photo */}
        <Pressable
          onPress={() => close()}
          style={styles.closeBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <View style={styles.closeBtnInner}>
            <SymbolView name="xmark" size={12} tintColor="#fff" />
          </View>
        </Pressable>

        {/* Photo header */}
        <View style={styles.photo}>
          {photoUrl ? (
            <ExpoImage
              source={{ uri: photoUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <LinearGradient colors={['#2a2f3d', '#1a1e28']} style={StyleSheet.absoluteFill}>
              <View style={styles.photoPlaceholder}>
                <SymbolView
                  name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any}
                  size={40}
                  tintColor="rgba(255,255,255,0.4)"
                />
              </View>
            </LinearGradient>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)']}
            locations={[0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* Handle bar */}
        <View style={[styles.handle, { backgroundColor: theme.border }]} />

        {/* Scrollable details */}
        <ScrollView
          style={styles.details}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingBottom: insets.bottom + 16 }}
        >
          <ThemedText style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }} numberOfLines={2}>
            {res.title}
          </ThemedText>

          {renderFields(res)}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {/* Action row */}
          <View style={styles.actions}>
            {(res.type === 'hotel' || res.type === 'restaurant' || res.type === 'activity') && (() => {
              const category = res.type === 'hotel' ? 'stay' : res.type === 'restaurant' ? 'food' : 'activity';
              const linkedAct = trip.activities.find((a) => a.reservationId === res.id);
              const searchDest = res.address || trip.destination;
              let url = `/place-detail?name=${encodeURIComponent(res.title)}&destination=${encodeURIComponent(searchDest)}&tripId=${encodeURIComponent(trip.id)}&category=${encodeURIComponent(category)}`;
              if (res.address) url += `&address=${encodeURIComponent(res.address)}`;
              if (linkedAct?.placeId) url += `&placeId=${encodeURIComponent(linkedAct.placeId)}`;
              if (linkedAct?.lat != null) url += `&lat=${linkedAct.lat}`;
              if (linkedAct?.lng != null) url += `&lng=${linkedAct.lng}`;
              return (
                <Pressable
                  onPress={() => close(() => router.push(url as any))}
                  style={[styles.actionBtn, { backgroundColor: theme.primaryMuted }]}
                  accessibilityRole="button"
                  accessibilityLabel="View place details"
                >
                  <SymbolView name="mappin.and.ellipse" size={16} tintColor={theme.primary} />
                  <ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>View Place</ThemedText>
                </Pressable>
              );
            })()}

            <Pressable
              onPress={() => close(() => onEdit(res, trip.id))}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Edit booking"
            >
              <SymbolView name="pencil" size={16} tintColor={theme.text} />
              <ThemedText style={styles.actionBtnText}>Edit</ThemedText>
            </Pressable>

            <Pressable
              onPress={() => {
                Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      onDelete(res, trip.id);
                      close();
                    },
                  },
                ]);
              }}
              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="button"
              accessibilityLabel="Delete booking"
            >
              <SymbolView name="trash" size={16} tintColor={theme.danger} />
              <ThemedText style={[styles.actionBtnText, { color: theme.danger }]}>Delete</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdropPressable: {
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
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
  },
  closeBtnInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    height: 200,
    overflow: 'hidden',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  details: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
    width: 90,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginVertical: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
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
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  readMoreText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 4,
  },
  routeAirport: {
    alignItems: 'flex-start',
  },
  routeCode: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  routeCity: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
});
