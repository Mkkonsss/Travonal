import { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity, Reservation, Trip } from '@/context/trips';
import type { StayBlock, StaysData } from '@/components/stays-section';
import type { NormalizedPlace } from '@/services/place-model';
import { haversineDistanceKm } from '@/services/itinerary-engine';

import { NightTimeline } from './night-timeline';
import { StayCard } from './stay-card';
import { StayCostSummary } from './stay-cost-summary';
import { GapRow } from './gap-row';
import type { StayAlertData } from './stay-alert';

export interface StaysSectionProps {
  trip: Trip;
  staysData: StaysData;
  hotelSuggestions: NormalizedPlace[];
  hotelPhotoUrls: Map<string, string>;
  activityPhotos: Map<string, string>;
  dayActivities: Map<number, Activity[]>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAddStay: (prefilledDay?: number) => void;
  onViewStay: (activity: Activity, reservation?: Reservation) => void;
  onBookSuggestion: (hotel: NormalizedPlace) => void;
  onBrowseMore: () => void;
  onCopyConfirmation: (text: string) => void;
  onNavigateToHotel: (address: string, lat?: number, lng?: number) => void;
  onOpenBookingLink: (url: string) => void;
  totalDays: number;
  budgetTotal?: number;
  budgetCurrency: string;
  getCurrSymbol: (cur: string) => string;
  gapSuggestions?: Map<string, NormalizedPlace[]>;
  gapPhotoUrls?: Map<string, string>;
}

export const StaysSectionComponent = memo(function StaysSectionComponent({
  trip,
  staysData,
  hotelSuggestions,
  hotelPhotoUrls,
  activityPhotos,
  dayActivities,
  collapsed,
  onToggleCollapse,
  onAddStay,
  onViewStay,
  onBookSuggestion,
  onBrowseMore,
  onCopyConfirmation,
  onNavigateToHotel,
  onOpenBookingLink,
  totalDays,
  budgetTotal,
  budgetCurrency,
  getCurrSymbol,
  gapSuggestions,
  gapPhotoUrls,
}: StaysSectionProps) {
  const theme = useTheme();
  const { blocks, uncoveredRanges, hasAnyStay } = staysData;
  const datesKnown = trip.datesKnown !== false;

  // Build interleaved list of stays and gaps sorted by night
  type Row = { kind: 'stay'; block: StayBlock } | { kind: 'gap'; start: number; end: number };
  const rows: Row[] = [];
  if (hasAnyStay) {
    const allItems: { sortKey: number; row: Row }[] = [
      ...blocks.map((b) => ({ sortKey: b.checkInDay, row: { kind: 'stay' as const, block: b } })),
      ...uncoveredRanges.map((g) => ({ sortKey: g.start, row: { kind: 'gap' as const, start: g.start, end: g.end } })),
    ];
    allItems.sort((a, b) => a.sortKey - b.sortKey);
    rows.push(...allItems.map((i) => i.row));
  }

  // Average per-night cost for gap estimates
  const avgPerNight = useMemo(() => {
    const pricedBlocks = blocks.filter((b) => b.reservation?.price && b.reservation.price > 0);
    if (pricedBlocks.length === 0) return 0;
    const totalCost = pricedBlocks.reduce((sum, b) => sum + (b.reservation!.price ?? 0), 0);
    const totalNights = pricedBlocks.reduce((sum, b) => sum + b.nights.length, 0);
    return totalNights > 0 ? totalCost / totalNights : 0;
  }, [blocks]);

  // Compute alerts for each block
  const blockAlerts = useMemo(() => {
    const alertMap = new Map<string, StayAlertData[]>();

    for (let idx = 0; idx < blocks.length; idx++) {
      const block = blocks[idx];
      const alerts: StayAlertData[] = [];
      const checkInTime = block.reservation?.checkInTime ?? '15:00';
      const checkOutTime = block.reservation?.checkOutTime ?? '11:00';

      // Check-in day: early activity alert
      const checkInActivities = dayActivities.get(block.checkInDay);
      if (checkInActivities) {
        const nonHotelActs = checkInActivities.filter((a) => a.type !== 'hotel' && a.time);
        const earliest = nonHotelActs.sort((a, b) => a.time.localeCompare(b.time))[0];
        if (earliest && earliest.time < checkInTime) {
          const isFar = block.hotel.lat != null && earliest.lat != null &&
            haversineDistanceKm(block.hotel.lat, block.hotel.lng!, earliest.lat, earliest.lng!) > 2;
          if (isFar) {
            alerts.push({
              type: 'early_activity',
              message: `${earliest.title} at ${earliest.time} — check-in may not be ready`,
              icon: 'clock.badge.exclamationmark',
            });
          }
        }
      }

      // Check-out day: early activity conflict
      const checkOutActivities = dayActivities.get(block.checkOutDay);
      if (checkOutActivities) {
        const nonHotelActs = checkOutActivities.filter((a) => a.type !== 'hotel' && a.time);
        const earliest = nonHotelActs.sort((a, b) => a.time.localeCompare(b.time))[0];
        if (earliest && earliest.time < checkOutTime) {
          alerts.push({
            type: 'checkout_conflict',
            message: `Checkout at ${checkOutTime} but ${earliest.title} at ${earliest.time} — plan ahead`,
            icon: 'exclamationmark.triangle',
          });
        }
      }

      // Hotel switch alert
      const nextBlock = blocks[idx + 1];
      if (nextBlock && nextBlock.hotel.title !== block.hotel.title) {
        const dist = block.hotel.lat != null && nextBlock.hotel.lat != null
          ? haversineDistanceKm(block.hotel.lat, block.hotel.lng!, nextBlock.hotel.lat, nextBlock.hotel.lng!)
          : null;
        if (dist != null && dist > 1) {
          alerts.push({
            type: 'hotel_switch',
            message: `Hotel change on Day ${nextBlock.checkInDay} — ${dist.toFixed(1)} km between locations`,
            icon: 'arrow.triangle.swap',
          });
        }
      }

      alertMap.set(block.hotel.id, alerts);
    }

    return alertMap;
  }, [blocks, dayActivities]);

  // Coverage stats
  const coveredCount = blocks.reduce((sum, b) => sum + b.nights.length, 0);
  const bookedCount = blocks.filter((b) => b.hotel.bookingStatus === 'booked' || b.reservation).length;
  const pendingCount = blocks.filter((b) => b.hotel.bookingStatus === 'pending' && !b.reservation).length;
  const notBookedCount = blocks.filter((b) => !b.reservation && b.hotel.bookingStatus !== 'booked' && b.hotel.bookingStatus !== 'pending').length;
  const hasGaps = uncoveredRanges.length > 0;
  const allCovered = coveredCount >= totalDays;

  // Single-day trips
  if (totalDays <= 1) {
    return (
      <Animated.View entering={FadeIn.duration(300)} style={s.emptyContainer}>
        <SymbolView name="sun.max.fill" size={40} tintColor={theme.primary} />
        <ThemedText style={s.emptyTitle}>Day Trip</ThemedText>
        <ThemedText style={[s.emptySubtitle, { color: theme.textSecondary }]}>
          No overnight stay needed
        </ThemedText>
      </Animated.View>
    );
  }

  // ─── EMPTY STATE ───────────────────────────────────────────
  if (!hasAnyStay) {
    return (
      <View style={s.root}>
        {/* Empty hero */}
        <Animated.View entering={FadeInDown.duration(300)} style={s.emptyContainer}>
          <SymbolView name="bed.double.fill" size={44} tintColor={theme.primary} />
          <ThemedText style={s.emptyTitle}>Plan Your Stays</ThemedText>
          <ThemedText style={[s.emptySubtitle, { color: theme.textSecondary }]}>
            {totalDays} night{totalDays !== 1 ? 's' : ''} to cover · Add hotels, Airbnbs, or hostels
          </ThemedText>
          <Pressable
            onPress={() => onAddStay()}
            style={({ pressed }) => [s.emptyAddBtn, { backgroundColor: theme.primary }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Add stay"
          >
            <SymbolView name="plus" size={14} tintColor={theme.background} />
            <ThemedText style={[s.emptyAddBtnText, { color: theme.background }]}>Add Stay</ThemedText>
          </Pressable>
        </Animated.View>

        {/* Suggested hotels — full-width grid */}
        {hotelSuggestions.length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(100)}>
            <View style={s.sectionHeader}>
              <ThemedText style={[s.sectionTitle, { color: theme.text }]}>Suggested Hotels</ThemedText>
              <Pressable onPress={onBrowseMore} hitSlop={8}>
                <ThemedText style={[s.browseLink, { color: theme.primary }]}>Browse more</ThemedText>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.suggestScroll}>
              {hotelSuggestions.map((hotel) => {
                const photoUrl = hotelPhotoUrls.get(hotel.placeId ?? hotel.name);
                return (
                  <Pressable
                    key={hotel.placeId ?? hotel.name}
                    onPress={() => onBookSuggestion(hotel)}
                    style={[s.suggestCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  >
                    {photoUrl ? (
                      <ExpoImage source={{ uri: photoUrl }} style={s.suggestPhoto} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <View style={[s.suggestPhoto, { backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' }]}>
                        <SymbolView name="building.2.fill" size={28} tintColor={theme.textSecondary} />
                      </View>
                    )}
                    <View style={s.suggestInfo}>
                      <ThemedText numberOfLines={1} style={s.suggestName}>{hotel.name}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {hotel.rating != null && (
                          <>
                            <SymbolView name="star.fill" size={11} tintColor="#F59E0B" />
                            <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>{hotel.rating.toFixed(1)}</ThemedText>
                          </>
                        )}
                        {hotel.priceLevel != null && (
                          <ThemedText style={{ fontSize: 12, color: theme.textSecondary, marginLeft: 4 }}>
                            {'$'.repeat(hotel.priceLevel)}
                          </ThemedText>
                        )}
                      </View>
                      <View style={[s.bookBtn, { backgroundColor: theme.primary }]}>
                        <ThemedText style={{ color: theme.background, fontSize: 12, fontWeight: '600' }}>Book</ThemedText>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        )}
      </View>
    );
  }

  // ─── STAYS EXIST ────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* ── Dashboard: Coverage timeline + stats ── */}
      <Animated.View entering={FadeInDown.duration(300)} style={[s.dashboard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {/* Stats row */}
        <View style={s.statsRow}>
          <View style={s.statItem}>
            <ThemedText style={[s.statNumber, { color: theme.text }]}>{blocks.length}</ThemedText>
            <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>
              Stay{blocks.length !== 1 ? 's' : ''}
            </ThemedText>
          </View>
          <View style={[s.statDivider, { backgroundColor: theme.border }]} />
          <View style={s.statItem}>
            <ThemedText style={[s.statNumber, { color: allCovered ? '#10B981' : theme.text }]}>
              {coveredCount}/{totalDays}
            </ThemedText>
            <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Nights</ThemedText>
          </View>
          <View style={[s.statDivider, { backgroundColor: theme.border }]} />
          <View style={s.statItem}>
            <ThemedText style={[s.statNumber, { color: theme.text }]}>{bookedCount}</ThemedText>
            <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Booked</ThemedText>
          </View>
          {pendingCount > 0 && (
            <>
              <View style={[s.statDivider, { backgroundColor: theme.border }]} />
              <View style={s.statItem}>
                <ThemedText style={[s.statNumber, { color: '#F59E0B' }]}>{pendingCount}</ThemedText>
                <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Pending</ThemedText>
              </View>
            </>
          )}
          {notBookedCount > 0 && (
            <>
              <View style={[s.statDivider, { backgroundColor: theme.border }]} />
              <View style={s.statItem}>
                <ThemedText style={[s.statNumber, { color: theme.textSecondary }]}>{notBookedCount}</ThemedText>
                <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>Not Booked</ThemedText>
              </View>
            </>
          )}
        </View>

        {/* Night timeline */}
        <NightTimeline
          staysData={staysData}
          totalDays={totalDays}
          tripStartDate={trip.startDate}
          datesKnown={datesKnown}
          theme={theme}
          onTapNight={(day, covered) => {
            if (!covered) onAddStay(day);
          }}
        />
      </Animated.View>

      {/* ── Cost Summary ── */}
      <Animated.View entering={FadeInDown.duration(300).delay(50)}>
        <StayCostSummary
          blocks={blocks}
          totalDays={totalDays}
          budgetTotal={budgetTotal}
          budgetCurrency={budgetCurrency}
          getCurrSymbol={getCurrSymbol}
          theme={theme}
        />
      </Animated.View>

      {/* ── Section label: Your Stays ── */}
      <View style={s.sectionHeader}>
        <ThemedText style={[s.sectionTitle, { color: theme.text }]}>Your Stays</ThemedText>
        <Pressable
          onPress={() => onAddStay()}
          style={({ pressed }) => [s.addStayBtn, { backgroundColor: theme.primary }, pressed && { opacity: 0.85 }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add stay"
        >
          <SymbolView name="plus" size={10} tintColor={theme.background} />
          <ThemedText style={[s.addStayBtnText, { color: theme.background }]}>Add</ThemedText>
        </Pressable>
      </View>

      {/* ── Stay cards & gap rows ── */}
      {rows.map((row, i) => {
        if (row.kind === 'stay') {
          const b = row.block;
          const photoUrl = b.hotel.placeId
            ? activityPhotos.get(b.hotel.placeId)
            : hotelPhotoUrls.get(b.hotel.title);

          return (
            <Animated.View key={b.hotel.id} entering={FadeInDown.duration(300).delay(100 + i * 50)}>
              <StayCard
                block={b}
                tripStartDate={trip.startDate}
                datesKnown={datesKnown}
                photoUrl={photoUrl}
                alerts={blockAlerts.get(b.hotel.id) ?? []}
                getCurrSymbol={getCurrSymbol}
                budgetCurrency={budgetCurrency}
                theme={theme}
                onViewStay={onViewStay}
                onCopyConfirmation={onCopyConfirmation}
                onNavigateToHotel={onNavigateToHotel}
                onOpenBookingLink={onOpenBookingLink}
              />
            </Animated.View>
          );
        }
        // Gap row
        const gapKey = `gap-${row.start}-${row.end}`;
        return (
          <Animated.View key={gapKey} entering={FadeInDown.duration(300).delay(100 + i * 50)}>
            <GapRow
              start={row.start}
              end={row.end}
              avgPerNight={avgPerNight}
              currSymbol={getCurrSymbol(budgetCurrency)}
              suggestions={gapSuggestions?.get(gapKey)}
              suggestionPhotos={gapPhotoUrls}
              theme={theme}
              onAddStay={onAddStay}
              onBookSuggestion={onBookSuggestion}
            />
          </Animated.View>
        );
      })}
    </View>
  );
});

const s = StyleSheet.create({
  root: {
    flex: 1,
  },

  // ── Dashboard ──
  dashboard: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
  },

  // ── Section headers ──
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  browseLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  addStayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  addStayBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Empty state ──
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: Radius.sm,
  },
  emptyAddBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Hotel suggestions ──
  suggestScroll: {
    gap: 12,
    paddingHorizontal: 2,
    paddingBottom: 4,
  },
  suggestCard: {
    width: 220,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  suggestPhoto: {
    width: 220,
    height: 110,
  },
  suggestInfo: {
    padding: 10,
    gap: 4,
  },
  suggestName: {
    fontSize: 14,
    fontWeight: '600',
  },
  bookBtn: {
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
});
