import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { TYPE_SYMBOLS, formatBookingDate } from '@/components/add-booking-modal';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Reservation, Trip } from '@/context/trips';
import { useActivityPhotos, ActivityNameHint } from '@/hooks/use-activity-photos';
import { isBookableActivity } from '@/services/booking-links';

const GAP = 10;

function BookingImage({
  uri,
  typeKey,
  iconSize = 28,
  photosLoading = false,
}: {
  uri?: string;
  typeKey: string;
  iconSize?: number;
  photosLoading?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const showSpinner = photosLoading && !uri && !loaded;
  return (
    <>
      <LinearGradient
        colors={['#2a2f3d', '#1a1e28']}
        style={[StyleSheet.absoluteFill, styles.cardPlaceholder]}
      >
        {showSpinner || (uri && !loaded) ? (
          <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
        ) : (
          <SymbolView
            name={(TYPE_SYMBOLS[typeKey] ?? 'doc.text.fill') as any}
            size={iconSize}
            tintColor="rgba(255,255,255,0.4)"
          />
        )}
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

interface TripBookingsTabProps {
  trip: Trip;
  onReservationPress: (res: Reservation, photoUrl?: string) => void;
}

export function TripBookingsTab({ trip, onReservationPress }: TripBookingsTabProps) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const CARD_WIDTH = (screenWidth - Spacing.four * 2 - GAP) / 2;
  const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.2);

  type SortBy = 'recent' | 'upcoming' | 'type';
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [emailCopied, setEmailCopied] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const bookingEmail = 'bookings@tripseekapp.com';

  const reservations = useMemo(
    () => (trip.reservations ?? []).filter((r) => !r.cancelled),
    [trip.reservations],
  );

  const nameOnlyHints = useMemo(
    (): ActivityNameHint[] =>
      reservations.map((r) => ({ key: r.id, name: r.title, destination: trip.destination })),
    [reservations, trip.destination],
  );

  const { photos: photoMap, loading: photosLoading } = useActivityPhotos([], undefined, nameOnlyHints);

  const sortedReservations = useMemo(() => {
    if (sortBy === 'upcoming') {
      return [...reservations].sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : Infinity;
        const db = b.date ? new Date(b.date).getTime() : Infinity;
        return da - db;
      });
    }
    return reservations;
  }, [reservations, sortBy]);

  async function handleCopyEmail() {
    await Clipboard.setStringAsync(bookingEmail);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  }

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
        <View style={styles.cardTypeIcon}>
          <SymbolView
            name={(TYPE_SYMBOLS[typeKey] ?? 'doc.text.fill') as any}
            size={18}
            tintColor="rgba(255,255,255,0.75)"
          />
        </View>
        <View style={styles.cardOverlay}>
          <ThemedText style={styles.cardName} numberOfLines={2}>
            {name}
          </ThemedText>
          {metaText ? (
            <ThemedText style={styles.cardMeta} numberOfLines={1}>
              {metaText}
            </ThemedText>
          ) : null}
        </View>
      </>
    );
  }

  function renderCard(res: Reservation) {
    const photoUrl = photoMap.get(res.id);
    const metaText =
      res.date && res.checkOutDate
        ? `${formatBookingDate(res.date)} – ${formatBookingDate(res.checkOutDate)}`
        : res.date
          ? formatBookingDate(res.date)
          : '';
    return (
      <Pressable
        key={res.id}
        onPress={() => onReservationPress(res, photoUrl)}
        style={[styles.gridCard, { width: CARD_WIDTH, height: CARD_HEIGHT }]}
        accessibilityRole="button"
        accessibilityLabel={`${res.title}, tap to view details`}
      >
        {renderCardInner(photoUrl, res.type, res.title, metaText)}
      </Pressable>
    );
  }

  // ── Accordion sections (bookable itinerary items) ──
  const sectionDefs = [
    { actType: 'hotel', resType: 'hotel', label: 'Hotels', icon: 'bed.double.fill' },
    { actType: 'flight', resType: 'flight', label: 'Flights', icon: 'airplane' },
    { actType: 'food', resType: 'restaurant', label: 'Restaurants', icon: 'fork.knife' },
    { actType: 'activity', resType: 'activity', label: 'Activities', icon: 'star.fill' },
  ] as const;

  const alwaysShow = new Set(['hotel', 'flight']);
  const bookable = trip.activities.filter(isBookableActivity);
  const tripReservations = trip.reservations ?? [];

  const activeSections = sectionDefs.filter(({ actType, resType }) =>
    alwaysShow.has(actType) ||
    bookable.some((a) => a.type === actType && a.cost !== 'free') ||
    tripReservations.some((r) => r.type === resType && !r.cancelled),
  );

  function renderAccordion() {
    if (activeSections.length === 0) return null;
    const AID = 'YOUR_AID_HERE';
    return (
      <View style={styles.accordionContainer}>
        <View style={[styles.accordionDivider, { backgroundColor: theme.border }]} />
        <ThemedText style={[styles.accordionHeader, { color: theme.textSecondary }]}>
          What to book
        </ThemedText>
        {activeSections.map(({ actType, resType, label, icon }) => {
          const sectionActivities = bookable
            .filter((a) => a.type === actType && a.cost !== 'free')
            .sort((a, b) => a.day - b.day);
          const sectionReservations = tripReservations.filter(
            (r) => r.type === resType && !r.cancelled,
          );
          const bookedCount =
            sectionActivities.filter((a) => a.bookingStatus === 'booked').length +
            sectionReservations.filter(
              (r) => !sectionActivities.some((a) => a.reservationId === r.id),
            ).length;
          const total =
            sectionActivities.length +
            sectionReservations.filter(
              (r) => !sectionActivities.some((a) => a.reservationId === r.id),
            ).length;
          const allBooked = total > 0 && bookedCount === total;
          const isOpen = expandedSections.has(actType);

          return (
            <View
              key={actType}
              style={[styles.accordionSection, { backgroundColor: theme.backgroundElement }]}
            >
              <Pressable
                onPress={() => {
                  const next = new Set(expandedSections);
                  if (next.has(actType)) next.delete(actType);
                  else next.add(actType);
                  setExpandedSections(next);
                }}
                style={styles.accordionRow}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${isOpen ? 'collapse' : 'expand'}`}
              >
                <SymbolView
                  name={icon as any}
                  size={16}
                  tintColor={allBooked ? '#10B981' : theme.textSecondary}
                />
                <ThemedText style={styles.accordionLabel}>{label}</ThemedText>
                <ThemedText
                  style={[
                    styles.accordionCount,
                    { color: allBooked ? '#10B981' : theme.textSecondary },
                  ]}
                >
                  {bookedCount}/{total}
                </ThemedText>
                <SymbolView
                  name={isOpen ? 'chevron.up' : 'chevron.down'}
                  size={12}
                  tintColor={theme.textSecondary}
                />
              </Pressable>

              {isOpen && (
                <View style={[styles.accordionBody, { borderTopColor: theme.border }]}>
                  {sectionActivities.map((activity) => {
                    const linked = activity.reservationId
                      ? tripReservations.find((r) => r.id === activity.reservationId)
                      : undefined;
                    const booked = activity.bookingStatus === 'booked';
                    return (
                      <View
                        key={activity.id}
                        style={[styles.accordionItem, { borderBottomColor: theme.border }]}
                      >
                        <View style={styles.accordionItemText}>
                          <ThemedText style={styles.accordionItemTitle} numberOfLines={1}>
                            {activity.title}
                          </ThemedText>
                          <ThemedText style={[styles.accordionItemMeta, { color: theme.textSecondary }]}>
                            Day {activity.day}
                            {linked?.confirmationNumber ? ` · ${linked.confirmationNumber}` : ''}
                          </ThemedText>
                        </View>
                        {booked ? (
                          <View style={styles.bookedPill}>
                            <SymbolView name="checkmark" size={11} tintColor="#10B981" />
                            <ThemedText style={styles.bookedPillText}>Booked</ThemedText>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => {
                              const q = `${activity.title} ${trip.destination}`.replace(/\s+/g, '+');
                              const url =
                                actType === 'flight'
                                  ? `https://www.booking.com/flights/index.html?aid=${AID}`
                                  : actType === 'hotel'
                                    ? `https://www.booking.com/searchresults.html?ss=${q}&aid=${AID}`
                                    : `https://www.booking.com/attractions/index.html?aid=${AID}`;
                              Linking.openURL(url);
                            }}
                            style={[styles.bookBtn, { backgroundColor: theme.text }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Book ${activity.title}`}
                          >
                            <ThemedText style={[styles.bookBtnText, { color: theme.background }]}>Book</ThemedText>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                  {/* Standalone reservations not linked to an activity */}
                  {sectionReservations
                    .filter((r) => !sectionActivities.some((a) => a.reservationId === r.id))
                    .map((res) => (
                      <View
                        key={res.id}
                        style={[styles.accordionItem, { borderBottomColor: theme.border }]}
                      >
                        <View style={styles.accordionItemText}>
                          <ThemedText style={styles.accordionItemTitle} numberOfLines={1}>
                            {res.title}
                          </ThemedText>
                          <ThemedText style={[styles.accordionItemMeta, { color: theme.textSecondary }]}>
                            {res.date ? formatBookingDate(res.date) : ''}
                            {res.confirmationNumber ? ` · ${res.confirmationNumber}` : ''}
                          </ThemedText>
                        </View>
                        <View style={styles.bookedPill}>
                          <SymbolView name="checkmark" size={11} tintColor="#10B981" />
                          <ThemedText style={styles.bookedPillText}>Booked</ThemedText>
                        </View>
                      </View>
                    ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  // ── Populated state ──
  const typeOrder = ['flight', 'train', 'hotel', 'restaurant', 'activity', 'other'];
  const typeLabels: Record<string, string> = {
    flight: 'Flights',
    train: 'Transport',
    hotel: 'Hotels',
    restaurant: 'Restaurants',
    activity: 'Activities',
    other: 'Other',
  };

  // ── Empty state (no confirmed reservations yet) ──
  if (reservations.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <ExpoImage
            source={require('@/assets/images/onboarding-slide-2.png')}
            style={styles.emptyImage}
            contentFit="contain"
          />
          <ThemedText style={styles.emptyTitle}>Your bookings, all in one place.</ThemedText>
          <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
            Forward your confirmation emails to the address below and we'll organize everything for you.
          </ThemedText>
          <Pressable
            onPress={handleCopyEmail}
            style={[
              styles.emptyEmailBox,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
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
        {renderAccordion()}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Email forwarding strip */}
      <Pressable
        onPress={handleCopyEmail}
        style={[
          styles.emailStrip,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Copy forwarding email address"
      >
        <ExpoImage
          source={require('@/assets/images/gmail-logo.png')}
          style={{ width: 16, height: 16 }}
          contentFit="contain"
        />
        <ThemedText style={[styles.emailStripLabel, { color: theme.textSecondary }]}>
          Forward to:
        </ThemedText>
        <ThemedText
          style={[styles.emailStripAddress, { color: theme.primary }]}
          numberOfLines={1}
        >
          {bookingEmail}
        </ThemedText>
        <SymbolView
          name={emailCopied ? 'checkmark' : 'square.on.square'}
          size={13}
          tintColor={emailCopied ? theme.primary : theme.textSecondary}
        />
      </Pressable>

      {/* Sort chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sortRow}
      >
        {(
          [
            { key: 'recent', label: 'Recent' },
            { key: 'upcoming', label: 'Upcoming' },
            { key: 'type', label: 'By Type' },
          ] as { key: SortBy; label: string }[]
        ).map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => setSortBy(opt.key)}
            style={[
              styles.sortChip,
              sortBy === opt.key
                ? { backgroundColor: theme.primary }
                : {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    borderWidth: 1,
                  },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${opt.label}`}
          >
            <ThemedText
              style={[
                styles.sortChipText,
                { color: sortBy === opt.key ? theme.primaryText : theme.text },
              ]}
            >
              {opt.label}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {/* Grid */}
      {sortBy === 'type' ? (
        <View style={styles.typeGroupContainer}>
          {typeOrder
            .filter((t) => reservations.some((r) => r.type === t))
            .map((t) => {
              const group = reservations.filter((r) => r.type === t);
              return (
                <View key={t} style={styles.groupSection}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <SymbolView
                      name={(TYPE_SYMBOLS[t] ?? 'doc.text.fill') as any}
                      size={14}
                      tintColor={theme.textSecondary}
                    />
                    <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>
                      {typeLabels[t]}
                    </ThemedText>
                  </View>
                  <View style={styles.grid}>{group.map(renderCard)}</View>
                </View>
              );
            })}
        </View>
      ) : (
        <View style={styles.grid}>{sortedReservations.map(renderCard)}</View>
      )}

      {/* Accordion — what still needs booking */}
      {renderAccordion()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: 12,
  },

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

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  groupSection: { gap: 10 },
  groupLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  typeGroupContainer: { gap: 20 },

  // Card
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
  cardMeta: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  cardTypeIcon: { position: 'absolute', top: 10, right: 10 },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 32,
    paddingBottom: 40,
    gap: 12,
  },
  emptyImage: {
    width: 130,
    height: 130,
    marginBottom: 4,
    transform: [{ rotate: '12deg' }],
  },
  emptyTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  emptyEmailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: 4,
  },
  emptyEmailText: { fontSize: 15, fontWeight: '700' },

  // Accordion
  accordionContainer: { gap: 8, paddingBottom: 8 },
  accordionDivider: { height: StyleSheet.hairlineWidth, marginBottom: 4 },
  accordionHeader: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  accordionSection: {
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  accordionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  accordionLabel: { fontSize: 15, fontWeight: '600', flex: 1 },
  accordionCount: { fontSize: 13, fontWeight: '500' },
  accordionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  accordionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accordionItemText: { flex: 1, gap: 2 },
  accordionItemTitle: { fontSize: 14, fontWeight: '600' },
  accordionItemMeta: { fontSize: 12 },
  bookedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#10B98120',
  },
  bookedPillText: { fontSize: 12, fontWeight: '600', color: '#10B981' },
  bookBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  bookBtnText: { fontSize: 11, fontWeight: '600' },
});
