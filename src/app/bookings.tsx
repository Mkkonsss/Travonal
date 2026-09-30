import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AddBookingModal, getCurrSymbol, TYPE_SYMBOLS, TYPE_LABELS, formatBookingDate } from '@/components/add-booking-modal';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Activity, Reservation, Trip, useTrips } from '@/context/trips';
import { useToast } from '@/context/toast';
import {
  ParsedBooking,
  getBookingEmailAI, getParsedBookingsAI, dismissParsedBookingAI, markBookingImportedAI,
} from '@/services/ai';
import { getPlacePhoto } from '@/services/free-photos';

// ── Helpers ──

type TripState = 'upcoming' | 'active' | 'past' | 'draft' | 'planned';

function formatTripDates(trip: Trip): string {
  if (trip.datesKnown === false) return 'Dates TBD';
  return `${formatBookingDate(trip.startDate)} \u2013 ${formatBookingDate(trip.endDate)}`;
}

// ── Main Screen ──

export default function BookingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { trips, getTripState, addReservation, attachReservation, updateReservation, removeReservation } = useTrips();

  // ── Card expansion ──
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // ── Modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalInitialMode, setModalInitialMode] = useState<'choose' | 'email' | 'manual'>('choose');
  const [editingReservation, setEditingReservation] = useState<{ res: Reservation; tripId: string } | null>(null);

  // ── Booking forwarding email ──
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

  // ── Pending bookings (from email forwarding / Gmail sync) ──
  const [pendingBookings, setPendingBookings] = useState<ParsedBooking[]>([]);

  useEffect(() => {
    getParsedBookingsAI()
      .then((res) => setPendingBookings(res.bookings.filter((b) => b.status === 'pending')))
      .catch(() => { /* not set up yet, ignore */ });
  }, [showAddModal]); // refresh when modal closes

  function handleImportPending(booking: ParsedBooking) {
    const data = booking.booking_data;
    const resType = data.reservationType ?? 'other';

    // Check for matching unbooked hotel activity in trips
    if (resType === 'hotel' && data.name) {
      const nameLC = data.name.toLowerCase();
      let match: { tripId: string; activity: Activity } | null = null;
      for (const trip of trips) {
        for (const act of trip.activities) {
          if (act.type !== 'hotel' || act.reservationId) continue; // skip non-hotel or already booked
          if (act.title.toLowerCase().includes(nameLC) || nameLC.includes(act.title.toLowerCase())) {
            match = { tripId: trip.id, activity: act };
            break;
          }
        }
        if (match) break;
      }

      if (match) {
        const m = match;
        Alert.alert(
          'Existing Stay Found',
          `"${m.activity.title}" is already in your trip. Link this booking to it?`,
          [
            {
              text: 'Link to Stay',
              onPress: async () => {
                attachReservation(m.tripId, m.activity.id, {
                  type: 'hotel',
                  title: data.name,
                  day: m.activity.day,
                  confirmationNumber: data.confirmationNumber ?? undefined,
                  price: data.price ?? undefined,
                  currency: data.currency ?? undefined,
                  date: data.bookingDate ?? undefined,
                  checkOutDate: data.checkoutDate ?? undefined,
                  fixed: true,
                });
                await markBookingImportedAI(booking.id).catch(() => {});
                setPendingBookings((prev) => prev.filter((b) => b.id !== booking.id));
                showToast(`Linked to ${m.activity.title}`, 'success');
              },
            },
            {
              text: 'Add as New',
              onPress: () => {
                setEditingReservation(null);
                setPendingImportData(booking);
                setShowAddModal(true);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }
    }

    setEditingReservation(null);
    // Pre-fill the modal with this booking's data by opening in review mode
    setPendingImportData(booking);
    setShowAddModal(true);
  }

  async function handleDismissPending(booking: ParsedBooking) {
    try {
      await dismissParsedBookingAI(booking.id);
      setPendingBookings((prev) => prev.filter((b) => b.id !== booking.id));
      showToast('Booking dismissed', 'success');
    } catch {
      showToast('Could not dismiss', 'error');
    }
  }

  // ── Pending import data (for pre-filling modal from parsed bookings) ──
  const [pendingImportData, setPendingImportData] = useState<ParsedBooking | null>(null);

  // ── Photos ──
  const [photoMap, setPhotoMap] = useState<Map<string, string>>(new Map());

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

  // Fetch photos for reservations that have linked activities with placeIds
  useEffect(() => {
    const fetchPhotos = async () => {
      const newMap = new Map(photoMap);
      let changed = false;
      for (const { trip, reservations } of tripsWithReservations) {
        for (const res of reservations) {
          if (newMap.has(res.id)) continue;
          // Find linked activity
          const linkedActivity = trip.activities.find((a) => a.reservationId === res.id);
          const photoRef = linkedActivity?.placeId ? undefined : undefined;
          const name = res.title;
          try {
            const photo = await getPlacePhoto({
              cacheKey: `booking-${res.id}`,
              name,
              category: res.type === 'hotel' ? 'stay' : res.type === 'restaurant' ? 'food' : 'activity',
            });
            if (photo?.url) {
              newMap.set(res.id, photo.url);
              changed = true;
            }
          } catch { /* ignore */ }
        }
      }
      if (changed) setPhotoMap(new Map(newMap));
    };
    if (tripsWithReservations.length > 0) fetchPhotos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripsWithReservations.length]);

  // ── Actions ──

  function openAddModal() {
    setEditingReservation(null);
    setModalInitialMode('choose');
    setShowAddModal(true);
  }

  function openEditModal(res: Reservation, tripId: string) {
    setEditingReservation({ res, tripId });
    setShowAddModal(true);
  }

  function handleDelete(res: Reservation, tripId: string) {
    Alert.alert('Remove booking?', `Remove "${res.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeReservation(tripId, res.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          showToast('Booking removed', 'success');
          if (expandedCardId === res.id) setExpandedCardId(null);
          setShowAddModal(false);
        },
      },
    ]);
  }

  async function handleCopyConfirmation(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast('Copied to clipboard', 'success');
  }

  // ── Render ──

  const totalBookings = tripsWithReservations.reduce((sum, g) => sum + g.reservations.length, 0);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }, totalBookings === 0 && { flexGrow: 1 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Pending imported bookings */}
        {pendingBookings.length > 0 && (
          <View style={styles.tripGroup}>
            <View style={[styles.tripHeader, { backgroundColor: theme.primaryMuted }]}>
              <View style={styles.tripHeaderLeft}>
                <SymbolView name="envelope.badge.fill" size={24} tintColor={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.tripName}>New Bookings</ThemedText>
                  <ThemedText style={[styles.tripDates, { color: theme.textSecondary }]}>Imported from email</ThemedText>
                </View>
              </View>
              <View style={[styles.stateBadge, { backgroundColor: theme.primary + '20' }]}>
                <ThemedText style={[styles.stateBadgeText, { color: theme.primary }]}>{pendingBookings.length} new</ThemedText>
              </View>
            </View>

            {pendingBookings.map((booking) => {
              const data = booking.booking_data;
              const resTypeKey = data.reservationType ?? 'other';
              return (
                <Animated.View key={booking.id} entering={FadeInDown.duration(200)}>
                  <Pressable
                    onPress={() => handleImportPending(booking)}
                    style={[styles.bookingCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Import ${data.name} booking`}
                  >
                    <View style={styles.compactRow}>
                      <View style={[styles.compactPhoto, { backgroundColor: theme.primaryMuted }]}>
                        <SymbolView name={(TYPE_SYMBOLS[resTypeKey] ?? 'doc.text.fill') as any} size={22} tintColor={theme.primary} />
                      </View>
                      <View style={styles.compactInfo}>
                        <View style={styles.compactTitleRow}>
                          <SymbolView name={(TYPE_SYMBOLS[resTypeKey] ?? 'doc.text.fill') as any} size={14} tintColor={theme.textSecondary} />
                          <ThemedText style={styles.compactTitle} numberOfLines={1}>{data.name || 'Unknown booking'}</ThemedText>
                        </View>
                        <ThemedText style={[styles.compactMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                          {[
                            data.bookingDate ? formatBookingDate(data.bookingDate) : null,
                            data.bookingTime,
                            data.confirmationNumber,
                          ].filter(Boolean).join(' \u00B7 ') || (booking.source_email_subject ?? 'Tap to review')}
                        </ThemedText>
                      </View>
                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); handleDismissPending(booking); }}
                        hitSlop={8}
                        style={{ padding: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss"
                      >
                        <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
                      </Pressable>
                      <SymbolView name="chevron.right" size={14} tintColor={theme.primary} />
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        )}

        {/* Empty state */}
        {totalBookings === 0 && (
          <Animated.View entering={FadeIn.duration(500)} style={styles.emptyState}>
            {/* Gmail logo */}
            <ExpoImage
              source={require('@/assets/images/gmail-logo.png')}
              style={styles.gmailLogo}
              contentFit="contain"
            />

            <ThemedText type="headline" style={styles.emptyTitle}>
              Your bookings, all in one place.
            </ThemedText>
            <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
              Forward your confirmation emails to the address below and we'll organize everything for you.
            </ThemedText>

            {/* Copyable email address */}
            {bookingEmail ? (
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
            ) : (
              <ThemedText style={[styles.emptyText, { color: theme.textSecondary, fontSize: 13 }]}>Loading email...</ThemedText>
            )}
          </Animated.View>
        )}

        {/* Trip groups */}
        {tripsWithReservations.map(({ trip, state, reservations }) => {
          const stateLabel = state === 'active' ? 'Now' : state === 'upcoming' ? 'Upcoming' : state === 'past' ? 'Past' : '';
          return (
            <Animated.View key={trip.id} entering={FadeIn.duration(300)} style={styles.tripGroup}>
              {/* Trip section header */}
              <Pressable
                onPress={() => router.push(`/(tabs)/trip/${trip.id}` as any)}
                style={[styles.tripHeader, { backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel={`View trip to ${trip.destination}`}
              >
                <View style={styles.tripHeaderLeft}>
                  <ThemedText style={styles.tripEmoji}>{trip.emoji}</ThemedText>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.tripName}>{trip.destination}</ThemedText>
                    <ThemedText style={[styles.tripDates, { color: theme.textSecondary }]}>{formatTripDates(trip)}</ThemedText>
                  </View>
                </View>
                <View style={styles.tripHeaderRight}>
                  {stateLabel ? (
                    <View style={[styles.stateBadge, { backgroundColor: state === 'active' ? theme.live + '20' : theme.primaryMuted }]}>
                      <ThemedText style={[styles.stateBadgeText, { color: state === 'active' ? theme.live : theme.textSecondary }]}>{stateLabel}</ThemedText>
                    </View>
                  ) : null}
                  <ThemedText style={[styles.bookingCount, { color: theme.textSecondary }]}>
                    {reservations.length} booking{reservations.length !== 1 ? 's' : ''}
                  </ThemedText>
                </View>
              </Pressable>

              {/* Booking cards */}
              {reservations.map((res) => {
                const isExpanded = expandedCardId === res.id;
                const photoUrl = photoMap.get(res.id);
                return (
                  <Animated.View key={res.id} entering={FadeInDown.duration(200)}>
                    <Pressable
                      onPress={() => setExpandedCardId(isExpanded ? null : res.id)}
                      style={[styles.bookingCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${res.title} booking${isExpanded ? ', tap to collapse' : ', tap to expand'}`}
                    >
                      {/* Compact view — always visible */}
                      <View style={styles.compactRow}>
                        {/* Photo or placeholder */}
                        <View style={[styles.compactPhoto, { backgroundColor: theme.backgroundSelected }]}>
                          {photoUrl ? (
                            <ExpoImage source={{ uri: photoUrl }} style={styles.compactPhotoImg} contentFit="cover" />
                          ) : (
                            <SymbolView name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any} size={22} tintColor={theme.textSecondary} />
                          )}
                        </View>
                        <View style={styles.compactInfo}>
                          <View style={styles.compactTitleRow}>
                            <SymbolView name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any} size={14} tintColor={theme.textSecondary} />
                            <ThemedText style={styles.compactTitle} numberOfLines={1}>{res.title}</ThemedText>
                          </View>
                          <ThemedText style={[styles.compactMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                            {[
                              res.date ? formatBookingDate(res.date) : null,
                              res.time,
                              res.confirmationNumber,
                            ].filter(Boolean).join(' \u00B7 ') || (TYPE_LABELS[res.type] ?? 'Booking')}
                          </ThemedText>
                        </View>
                        {res.confirmationNumber ? (
                          <View style={[styles.confirmedBadge, { backgroundColor: '#10B981' + '20' }]}>
                            <SymbolView name="checkmark" size={12} tintColor="#10B981" />
                          </View>
                        ) : null}
                        <SymbolView name={isExpanded ? 'chevron.up' : 'chevron.down'} size={14} tintColor={theme.textSecondary} />
                      </View>

                      {/* Expanded view */}
                      {isExpanded && (
                        <Animated.View entering={FadeIn.duration(200)} style={styles.expandedSection}>
                          {/* Full-width photo */}
                          {photoUrl && (
                            <ExpoImage source={{ uri: photoUrl }} style={styles.expandedPhoto} contentFit="cover" />
                          )}

                          {/* Type badge */}
                          <View style={styles.expandedTypeRow}>
                            <View style={[styles.expandedTypeBadge, { backgroundColor: theme.primaryMuted }]}>
                              <SymbolView name={(TYPE_SYMBOLS[res.type] ?? 'doc.text.fill') as any} size={14} tintColor={theme.primary} />
                              <ThemedText style={[styles.expandedTypeText, { color: theme.primary }]}>{TYPE_LABELS[res.type] ?? 'Booking'}</ThemedText>
                            </View>
                          </View>

                          {/* Divider */}
                          <View style={[styles.expandedDivider, { backgroundColor: theme.border }]} />

                          {/* Details rows */}
                          {res.confirmationNumber ? (
                            <Pressable
                              onPress={() => handleCopyConfirmation(res.confirmationNumber!)}
                              style={styles.detailRow}
                              accessibilityRole="button"
                              accessibilityLabel="Copy confirmation number"
                            >
                              <SymbolView name="doc.on.clipboard" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Confirmation</ThemedText>
                              <ThemedText style={[styles.detailValue, { color: theme.primary }]}>{res.confirmationNumber}</ThemedText>
                              <SymbolView name="doc.on.doc" size={14} tintColor={theme.textSecondary} />
                            </Pressable>
                          ) : null}

                          {res.date ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="calendar" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Date</ThemedText>
                              <ThemedText style={styles.detailValue}>{formatBookingDate(res.date)}{res.notes?.includes('Check-out:') ? ` \u2013 ${formatBookingDate(res.notes.split('Check-out: ')[1]?.split('\n')[0])}` : ''}</ThemedText>
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
                              <ThemedText style={styles.detailValue}>{getCurrSymbol(res.currency ?? 'USD')}{res.price.toLocaleString()}</ThemedText>
                            </View>
                          ) : null}

                          {res.address ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="mappin" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Address</ThemedText>
                              <ThemedText style={[styles.detailValue, { flex: 1 }]} numberOfLines={2}>{res.address}</ThemedText>
                            </View>
                          ) : null}

                          {res.bookingUrl ? (
                            <Pressable
                              onPress={() => { if (res.bookingUrl) Linking.openURL(res.bookingUrl); }}
                              style={styles.detailRow}
                              accessibilityRole="button"
                              accessibilityLabel="Open booking link"
                            >
                              <SymbolView name="link" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Link</ThemedText>
                              <ThemedText style={[styles.detailValue, { color: theme.primary, flex: 1 }]} numberOfLines={1}>
                                {res.bookingUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}...
                              </ThemedText>
                              <SymbolView name={"arrow.up.right.square" as any} size={14} tintColor={theme.primary} />
                            </Pressable>
                          ) : null}

                          {res.notes && !res.notes.startsWith('Check-out:') ? (
                            <View style={styles.detailRow}>
                              <SymbolView name="note.text" size={16} tintColor={theme.textSecondary} />
                              <ThemedText style={styles.detailLabel}>Notes</ThemedText>
                              <ThemedText style={[styles.detailValue, { flex: 1 }]} numberOfLines={3}>
                                {res.notes.split('\nCheck-out:')[0]}
                              </ThemedText>
                            </View>
                          ) : null}

                          {/* Divider */}
                          <View style={[styles.expandedDivider, { backgroundColor: theme.border }]} />

                          {/* Action buttons */}
                          <View style={styles.expandedActions}>
                            {res.type === 'hotel' && (() => {
                              const linkedAct = trip.activities.find((a) => a.reservationId === res.id);
                              if (!linkedAct) return null;
                              return (
                                <Pressable
                                  onPress={() => router.push(`/stay-detail?tripId=${trip.id}&activityId=${linkedAct.id}` as any)}
                                  style={[styles.actionBtn, { backgroundColor: theme.primaryMuted }]}
                                  accessibilityRole="button"
                                  accessibilityLabel="View stay details"
                                >
                                  <SymbolView name="building.2.fill" size={16} tintColor={theme.primary} />
                                  <ThemedText style={[styles.actionBtnText, { color: theme.primary }]}>View Stay</ThemedText>
                                </Pressable>
                              );
                            })()}
                            <Pressable
                              onPress={() => openEditModal(res, trip.id)}
                              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
                              accessibilityRole="button"
                              accessibilityLabel="Edit booking"
                            >
                              <SymbolView name="pencil" size={16} tintColor={theme.text} />
                              <ThemedText style={styles.actionBtnText}>Edit</ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() => handleDelete(res, trip.id)}
                              style={[styles.actionBtn, { backgroundColor: theme.backgroundSelected }]}
                              accessibilityRole="button"
                              accessibilityLabel="Delete booking"
                            >
                              <SymbolView name="trash" size={16} tintColor={theme.danger} />
                              <ThemedText style={[styles.actionBtnText, { color: theme.danger }]}>Delete</ThemedText>
                            </Pressable>
                          </View>
                        </Animated.View>
                      )}
                    </Pressable>
                  </Animated.View>
                );
              })}
            </Animated.View>
          );
        })}
      </ScrollView>

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
            onClose={() => { setShowAddModal(false); setPendingImportData(null); }}
            editRes={editingReservation}
            pendingImport={pendingImportData}
            initialMode={modalInitialMode}
            trips={trips}
            onAdd={addReservation}
            onUpdate={updateReservation}
            onDelete={handleDelete}
            onMarkImported={async (id) => {
              try { await markBookingImportedAI(id); } catch { /* ignore */ }
              setPendingBookings((prev) => prev.filter((b) => b.id !== id));
              setPendingImportData(null);
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
  content: { padding: Spacing.four, gap: 20 },

  // Empty state
  emptyState: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 32, paddingBottom: 60, gap: 12 },
  gmailLogo: { width: 72, height: 72, marginBottom: 4 },
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

  // Trip group
  tripGroup: { gap: 8 },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: Radius.md,
  },
  tripHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tripEmoji: { fontSize: 28 },
  tripName: { fontSize: 16, fontWeight: '700' },
  tripDates: { fontSize: 13, fontWeight: '500' },
  tripHeaderRight: { alignItems: 'flex-end', gap: 4 },
  stateBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.xs },
  stateBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  bookingCount: { fontSize: 12, fontWeight: '500' },

  // Booking card
  bookingCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // Compact row
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  compactPhoto: {
    width: 52,
    height: 52,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactPhotoImg: { width: 52, height: 52 },
  compactInfo: { flex: 1, gap: 3 },
  compactTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  compactMeta: { fontSize: 13, fontWeight: '500' },
  confirmedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Expanded section
  expandedSection: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  expandedPhoto: { width: '100%', height: 160, borderRadius: Radius.xs },
  expandedTypeRow: { flexDirection: 'row' },
  expandedTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.xs,
  },
  expandedTypeText: { fontSize: 13, fontWeight: '600' },
  expandedDivider: { height: 1, marginVertical: 2 },

  // Detail rows
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  detailLabel: { fontSize: 13, fontWeight: '600', width: 90 },
  detailValue: { fontSize: 14, fontWeight: '500' },

  // Actions
  expandedActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
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

});
