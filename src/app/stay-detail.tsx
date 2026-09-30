import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { AddBookingModal, getCurrSymbol } from '@/components/add-booking-modal';
import { Radius, Spacing } from '@/constants/theme';
import { useTrips, type Reservation } from '@/context/trips';
import { useToast } from '@/context/toast';
import { useTheme } from '@/hooks/use-theme';
import { getPlacePhoto } from '@/services/free-photos';
import { getBookingEmailAI } from '@/services/ai';
import { getPlaceBookingLinks, openBookingLink } from '@/services/booking-links';
import { formatShortDate } from '@/services/trip-helpers';

export default function StayDetailScreen() {
  const params = useLocalSearchParams<{ tripId?: string; activityId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { trips, attachReservation, updateReservation, removeReservation, removeActivity } = useTrips();

  const trip = trips.find((t) => t.id === params.tripId);
  const activity = trip?.activities.find((a) => a.id === params.activityId);
  const reservation = activity?.reservationId
    ? trip?.reservations?.find((r) => r.id === activity.reservationId)
    : undefined;

  // Photo
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!activity) return;
    const ref = activity.placeId;
    if (!ref) return;
    getPlacePhoto({ cacheKey: ref, photoRef: ref, name: activity.title })
      .then((r) => { if (r) setPhotoUrl(r.url); })
      .catch(() => {});
  }, [activity?.placeId, activity?.title]);

  // Booking modal
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingReservation, setEditingReservation] = useState<{ res: Reservation; tripId: string } | null>(null);
  const [modalInitialMode, setModalInitialMode] = useState<'choose' | 'email' | 'manual'>('choose');

  // Forwarding email
  const [bookingEmail, setBookingEmail] = useState('');
  const [emailCopied, setEmailCopied] = useState(false);

  useEffect(() => {
    getBookingEmailAI().then((r) => setBookingEmail(r.email)).catch(() => {});
  }, []);

  async function handleCopyEmail() {
    if (!bookingEmail) return;
    await Clipboard.setStringAsync(bookingEmail);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  }

  function handleRemoveStay() {
    if (!trip || !activity) return;
    Alert.alert(
      'Remove Stay',
      reservation
        ? 'Remove this stay from your itinerary? Your booking info will be kept in Bookings.'
        : 'Remove this stay from your itinerary?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeActivity(trip.id, activity.id, true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showToast(`${activity.title} removed`, 'success');
            router.back();
          },
        },
      ],
    );
  }

  function handleDeleteBooking(res: Reservation, tripId: string) {
    Alert.alert('Remove booking?', `Remove booking for "${res.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeReservation(tripId, res.id);
          showToast('Booking removed', 'success');
          setShowBookingModal(false);
        },
      },
    ]);
  }

  if (!trip || !activity) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ThemedText style={{ color: theme.textSecondary }}>Stay not found</ThemedText>
        </View>
      </View>
    );
  }

  const booked = activity.bookingStatus === 'booked' || !!reservation;
  const checkInDate = reservation?.date;
  const checkOutDate = reservation?.checkOutDate;
  const nightCount = checkInDate && checkOutDate
    ? Math.max(1, Math.round((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / 86400000))
    : undefined;
  const bookingLinks = getPlaceBookingLinks(activity.title, activity.category ?? 'stay/hotel', trip.destination);
  const address = activity.address ?? reservation?.address;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: booked ? insets.bottom + 20 : insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Section with Overlapping Info ── */}
        <View style={styles.heroContainer}>
          {/* Photo */}
          {photoUrl ? (
            <ExpoImage source={{ uri: photoUrl }} style={styles.heroImage} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <View style={[styles.heroImage, { backgroundColor: theme.backgroundElement }]}>
              <SymbolView name="building.2.fill" size={48} tintColor={theme.textSecondary} />
            </View>
          )}

          {/* Gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.heroGradient}
          />

          {/* Back button */}
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={[styles.backButton, { top: insets.top + 8 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <View style={styles.backButtonBg}>
              <SymbolView name="chevron.left" size={16} tintColor="#fff" />
            </View>
          </Pressable>

          {/* Overlapping hotel info */}
          <View style={styles.heroOverlay}>
            <ThemedText style={styles.heroName} numberOfLines={2}>{activity.title}</ThemedText>

            <View style={styles.heroMeta}>
              {activity.rating != null && (
                <View style={styles.heroRatingRow}>
                  <SymbolView name="star.fill" size={13} tintColor="#F59E0B" />
                  <ThemedText style={styles.heroRating}>{activity.rating.toFixed(1)}</ThemedText>
                  {activity.reviewCount != null && (
                    <ThemedText style={styles.heroReviewCount}>({activity.reviewCount.toLocaleString()})</ThemedText>
                  )}
                </View>
              )}
              {activity.rating != null && address && (
                <ThemedText style={styles.heroDot}>{'\u00B7'}</ThemedText>
              )}
              {address && (
                <ThemedText style={styles.heroAddress} numberOfLines={1}>{address}</ThemedText>
              )}
            </View>

            {/* Dates if known */}
            {booked && checkInDate && checkOutDate && (
              <ThemedText style={styles.heroDates}>
                {formatShortDate(checkInDate)} {'\u2013'} {formatShortDate(checkOutDate)}
                {nightCount ? ` \u00B7 ${nightCount} night${nightCount !== 1 ? 's' : ''}` : ''}
              </ThemedText>
            )}

            {/* View Full Details button */}
            <Pressable
              onPress={() => {
                let url = `/place-detail?name=${encodeURIComponent(activity.title)}&destination=${encodeURIComponent(trip.destination)}`;
                if (activity.placeId) url += `&placeId=${encodeURIComponent(activity.placeId)}`;
                if (activity.address) url += `&address=${encodeURIComponent(activity.address)}`;
                if (activity.lat != null) url += `&lat=${activity.lat}`;
                if (activity.lng != null) url += `&lng=${activity.lng}`;
                if (activity.rating != null) url += `&rating=${activity.rating}`;
                if (activity.category) url += `&category=${encodeURIComponent(activity.category)}`;
                router.push(url as any);
              }}
              style={({ pressed }) => [styles.viewDetailsBtn, { opacity: pressed ? 0.8 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="View full details"
            >
              <ThemedText style={styles.viewDetailsBtnText}>View Full Details</ThemedText>
              <SymbolView name="chevron.right" size={11} tintColor="#fff" />
            </Pressable>
          </View>
        </View>

        {/* ── Booking Section ── */}
        <View style={[styles.section, { borderColor: theme.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SymbolView name="creditcard" size={16} tintColor={theme.textSecondary} />
              <ThemedText style={{ fontSize: 17, fontWeight: '700' }}>Booking</ThemedText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {booked && (
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                  <View style={[styles.statusDot, { backgroundColor: '#10B981' }]} />
                  <ThemedText style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>Booked</ThemedText>
                </View>
              )}
              {!booked && (
                <Pressable
                  onPress={() => {
                    setEditingReservation(null);
                    setModalInitialMode('choose');
                    setShowBookingModal(true);
                  }}
                  hitSlop={8}
                  style={[styles.addPlusBtn, { backgroundColor: theme.background }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add booking"
                >
                  <SymbolView name="plus" size={16} tintColor={theme.text} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Booked — show details */}
          {booked && reservation && (
            <Animated.View entering={FadeIn.duration(200)} style={{ marginTop: 16, gap: 10 }}>
              {reservation.confirmationNumber && (
                <Pressable
                  onPress={() => {
                    Clipboard.setStringAsync(reservation.confirmationNumber!);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    showToast('Copied', 'success');
                  }}
                  style={styles.detailRow}
                  accessibilityRole="button"
                  accessibilityLabel="Copy confirmation number"
                >
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Confirmation</ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>{reservation.confirmationNumber}</ThemedText>
                    <SymbolView name="doc.on.doc" size={14} tintColor={theme.primary} />
                  </View>
                </Pressable>
              )}

              {reservation.date && (
                <View style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Check-in</ThemedText>
                  <ThemedText style={{ fontSize: 15 }}>{formatShortDate(reservation.date)}</ThemedText>
                </View>
              )}

              {reservation.checkOutDate && (
                <View style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Check-out</ThemedText>
                  <ThemedText style={{ fontSize: 15 }}>{formatShortDate(reservation.checkOutDate)}</ThemedText>
                </View>
              )}

              {reservation.price != null && (
                <View style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Price</ThemedText>
                  <ThemedText style={{ fontSize: 15, fontWeight: '600' }}>
                    {getCurrSymbol(reservation.currency ?? 'USD')}{reservation.price.toLocaleString()}
                    {nightCount ? ` (${getCurrSymbol(reservation.currency ?? 'USD')}${Math.round(reservation.price / nightCount)}/night)` : ''}
                  </ThemedText>
                </View>
              )}

              {reservation.roomType && (
                <View style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Room</ThemedText>
                  <ThemedText style={{ fontSize: 15 }}>{reservation.roomType}</ThemedText>
                </View>
              )}

              {reservation.notes && (
                <View style={{ marginTop: 4 }}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Notes</ThemedText>
                  <ThemedText style={{ fontSize: 14, marginTop: 4, color: theme.textSecondary }}>
                    {reservation.notes}
                  </ThemedText>
                </View>
              )}

              {/* Quick actions */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                {reservation.bookingUrl && (
                  <Pressable
                    onPress={() => openBookingLink(reservation.bookingUrl!)}
                    style={[styles.quickAction, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  >
                    <SymbolView name="safari" size={14} tintColor={theme.primary} />
                    <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: '600' }}>Open Booking</ThemedText>
                  </Pressable>
                )}
                {address && (
                  <Pressable
                    onPress={() => {
                      const q = encodeURIComponent(address);
                      Linking.openURL(Platform.OS === 'ios' ? `maps:?q=${q}` : `geo:0,0?q=${q}`);
                    }}
                    style={[styles.quickAction, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  >
                    <SymbolView name="location.fill" size={14} tintColor={theme.primary} />
                    <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: '600' }}>Navigate</ThemedText>
                  </Pressable>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
                <Pressable
                  onPress={() => {
                    setEditingReservation({ res: reservation, tripId: trip.id });
                    setShowBookingModal(true);
                  }}
                  hitSlop={8}
                >
                  <ThemedText style={{ fontSize: 13, color: theme.primary, fontWeight: '600' }}>Edit booking info</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => router.push('/bookings' as any)}
                  hitSlop={8}
                >
                  <ThemedText style={{ fontSize: 13, color: theme.textSecondary, fontWeight: '600' }}>View in My Bookings</ThemedText>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* Not booked — email forwarding + copyable address */}
          {!booked && (
            <View style={{ marginTop: 16, gap: 8 }}>
              <ThemedText style={{ fontSize: 14, color: theme.textSecondary, lineHeight: 20 }}>
                Forward your confirmation email here and we'll organize everything for you.
              </ThemedText>

              {bookingEmail ? (
                <Pressable
                  onPress={handleCopyEmail}
                  style={[styles.emailBox, { borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Copy forwarding email address"
                >
                  <ThemedText style={[styles.emailText, { color: theme.primary }]} numberOfLines={1}>
                    {bookingEmail}
                  </ThemedText>
                  <SymbolView
                    name={emailCopied ? 'checkmark' : 'square.on.square'}
                    size={14}
                    tintColor={emailCopied ? theme.primary : theme.textSecondary}
                  />
                </Pressable>
              ) : (
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary }}>Loading email...</ThemedText>
              )}
            </View>
          )}
        </View>

        {/* ── Remove Stay ── */}
        <View style={{ padding: 20, marginTop: 8 }}>
          <Pressable
            onPress={handleRemoveStay}
            style={({ pressed }) => [{ alignSelf: 'center', opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText style={{ fontSize: 14, color: theme.danger, fontWeight: '600' }}>Remove Stay</ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Sticky Book CTA (when not booked) ── */}
      {!booked && bookingLinks.length > 0 && (
        <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 12, backgroundColor: theme.background, borderTopColor: theme.border }]}>
          <Pressable
            onPress={() => openBookingLink(bookingLinks[0].url)}
            style={({ pressed }) => [styles.stickyCtaBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.9 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Book this stay"
          >
            <ThemedText style={{ fontSize: 17, fontWeight: '700', color: theme.primaryText }}>Book This Stay</ThemedText>
          </Pressable>
        </View>
      )}

      {/* ── Booking Modal (same as My Bookings screen) ── */}
      <Modal
        visible={showBookingModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowBookingModal(false)}
      >
        {showBookingModal && (
          <AddBookingModal
            visible={showBookingModal}
            onClose={() => { setShowBookingModal(false); setEditingReservation(null); }}
            editRes={editingReservation}
            pendingImport={null}
            initialMode={modalInitialMode}
            trips={trips}
            fixedTripId={trip.id}
            fixedTitle={activity.title}
            fixedType="hotel"
            onAdd={(tripId, payload) => {
              // Attach the reservation to this specific activity
              attachReservation(tripId, activity.id, payload);
            }}
            onUpdate={updateReservation}
            onDelete={handleDeleteBooking}
          />
        )}
      </Modal>
    </View>
  );
}

const HERO_HEIGHT = 280;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Hero
  heroContainer: {
    height: HERO_HEIGHT,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: HERO_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.65,
  },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  backButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    paddingBottom: 24,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  heroRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroRating: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  heroReviewCount: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  heroDot: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  heroAddress: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    flex: 1,
  },
  heroDates: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
    marginTop: 4,
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  viewDetailsBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },

  // Sections
  section: {
    marginHorizontal: Spacing.four,
    marginTop: 20,
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  emailText: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  addPlusBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sticky CTA
  stickyCta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stickyCtaBtn: {
    paddingVertical: 16,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
