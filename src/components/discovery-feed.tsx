/**
 * DiscoveryFeed — full-screen vertical swipeable place feed (TikTok-style).
 *
 * Each card is a full-bleed photo with a dark gradient overlay,
 * place info at the bottom, and horizontal action buttons.
 * Top overlay shows category chip + location pill.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  ViewToken,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { TimePickerButton } from '@/components/time-picker';
import { useTheme } from '@/hooks/use-theme';
import { useDiscoveryFeed } from '@/hooks/use-discovery-feed';
import { useTrips } from '@/context/trips';
import { useInbox } from '@/context/inbox';
import { useToast } from '@/context/toast';
import { ExploreLocation } from '@/services/explore-service';
import { DiscoveryCard } from '@/services/discovery-feed';
import { categoryToActivityType } from '@/services/place-model';
import { getPlacePhoto, categoryPlaceholderColors, categoryPlaceholderEmoji } from '@/services/free-photos';
import { formatDayLabel } from '@/services/trip-helpers';
import { NormalizedPlace } from '@/services/place-model';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Card Component ──

function DiscoveryCardView({
  card,
  cardHeight,
  onSave,
  onAddToTrip,
  onDetail,
  isSavedPlace,
}: {
  card: DiscoveryCard;
  cardHeight: number;
  onSave: () => void;
  onAddToTrip: () => void;
  onDetail: () => void;
  isSavedPlace: boolean;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [color1] = categoryPlaceholderColors(card.place.category);
  const emoji = categoryPlaceholderEmoji(card.place.category);

  // Lazy photo loading — only triggers when card mounts (scrolls into view)
  useEffect(() => {
    let cancelled = false;
    const osmTags = (card.place as any)._osmTags as Record<string, string> | undefined;

    getPlacePhoto({
      cacheKey: card.place.placeId ?? card.place.name,
      osmTags,
      lat: card.place.lat,
      lng: card.place.lng,
      name: card.place.name,
      category: card.place.category,
    }).then((result) => {
      if (!cancelled) {
        setPhotoUrl(result?.url ?? null);
        setPhotoLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setPhotoLoaded(true);
    });

    return () => { cancelled = true; };
  }, [card.place.placeId]);

  return (
    <View style={[styles.card, { height: cardHeight }]}>
      {/* Background photo or placeholder */}
      {photoUrl ? (
        <ExpoImage
          source={{ uri: photoUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color1, alignItems: 'center', justifyContent: 'center' }]}>
          <ThemedText style={styles.placeholderEmoji}>{emoji}</ThemedText>
        </View>
      )}

      {/* Dark gradient overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.82)']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Bottom content */}
      <View style={styles.bottomContent}>
        {/* Reason chip */}
        <View style={styles.reasonChip}>
          <ThemedText style={styles.reasonText}>{card.personalizedReason}</ThemedText>
        </View>

        {/* Place name */}
        <ThemedText style={styles.placeName} numberOfLines={2}>
          {card.place.name}
        </ThemedText>

        {/* City + Rating */}
        <View style={styles.subtitleRow}>
          <ThemedText style={styles.cityText}>{card.cityLabel}</ThemedText>
          {card.place.rating != null && (
            <ThemedText style={styles.ratingText}>
              {'  \u2605 '}{card.place.rating}
            </ThemedText>
          )}
        </View>

        {/* Description */}
        {card.place.description ? (
          <ThemedText style={styles.descriptionText} numberOfLines={2}>
            {card.place.description}
          </ThemedText>
        ) : null}

        {/* Action buttons row */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSave();
            }}
            style={styles.actionPill}
          >
            <ThemedText style={styles.actionPillText}>
              Save {isSavedPlace ? '\u2764\uFE0F' : '\u2661'}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onAddToTrip();
            }}
            style={styles.actionPill}
          >
            <ThemedText style={styles.actionPillText}>Trip +</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDetail();
            }}
            style={styles.actionPill}
          >
            <ThemedText style={styles.actionPillText}>{'Details \u2192'}</ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Main Feed ──

export function DiscoveryFeed({
  location,
}: {
  location: ExploreLocation | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { trips, addActivity } = useTrips();
  const { savedPlaces, savePlace, unsavePlace, isSaved } = useInbox();
  const { showToast } = useToast();

  const {
    cards,
    loading,
    initialLoading,
    fetchMore,
    onSave,
    onAddToTrip,
    onViewDetail,
    onDismiss,
  } = useDiscoveryFeed(location);

  // Sheet state for trip/day picker
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  // Pending add-to-trip with time picker
  const [pendingAdd, setPendingAdd] = useState<{
    tripId: string;
    day: number;
    place: NormalizedPlace;
    time: string;
    duration: number;
  } | null>(null);

  // Measure the actual container height so paging snaps exactly to each card
  const [containerHeight, setContainerHeight] = useState(0);
  const CARD_HEIGHT = containerHeight;

  // ── Handlers ──

  function navigateToDetail(card: DiscoveryCard) {
    onViewDetail(card);
    const p = card.place;
    let url = `/place-detail?name=${encodeURIComponent(p.name)}`;
    if (p.placeId) url += `&placeId=${encodeURIComponent(p.placeId)}`;
    if (p.address) url += `&address=${encodeURIComponent(p.address)}`;
    if (p.description) url += `&description=${encodeURIComponent(p.description)}`;
    if (p.rating != null) url += `&rating=${p.rating}`;
    if (p.lat != null) url += `&lat=${p.lat}`;
    if (p.lng != null) url += `&lng=${p.lng}`;
    if (p.category) url += `&category=${encodeURIComponent(p.category)}`;
    if (p.website) url += `&website=${encodeURIComponent(p.website)}`;
    if (p.phone) url += `&phone=${encodeURIComponent(p.phone)}`;
    if (p.openingHours?.[0]) url += `&hours=${encodeURIComponent(p.openingHours[0])}`;
    if (location?.label) url += `&destination=${encodeURIComponent(location.label)}`;
    router.push(url as any);
  }

  function handleSave(card: DiscoveryCard) {
    onSave(card);
    const dest = location?.label ?? '';
    const p = card.place;
    if (isSaved(p.name, dest)) {
      const saved = savedPlaces.find((s) => s.title === p.name && (s.destination ?? '') === dest);
      if (saved) unsavePlace(saved.id);
      showToast('Removed from saved', 'info');
    } else {
      savePlace({
        title: p.name,
        destination: dest,
        type: categoryToActivityType(p.category),
        category: p.category,
        cost: p.priceLevel != null && p.priceLevel <= 1 ? 'budget' : 'moderate',
        duration: 60,
        description: p.description ?? p.address ?? '',
        tags: [],
        crowdLevel: 'medium',
        energyLevel: 'medium',
      });
      showToast(`"${p.name}" saved`, 'success');
    }
  }

  function handleAddToTrip(card: DiscoveryCard) {
    onAddToTrip(card);
    const p = card.place;
    if (trips.length === 0) {
      showToast('Plan a trip first, then add activities', 'info');
      return;
    }
    if (trips.length === 1) {
      showDayPicker(trips[0].id, p);
      return;
    }
    setSheetState({
      title: 'Add to which trip?',
      options: trips.map((t) => ({ label: `${t.emoji} ${t.destination}`, value: t.id })),
      onSelect: (tripId) => {
        setSheetState(null);
        showDayPicker(tripId, p);
      },
    });
  }

  function showDayPicker(tripId: string, place: NormalizedPlace) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const [sy, sm, sd] = trip.startDate.split('-').map(Number);
    const [ey, em, ed] = trip.endDate.split('-').map(Number);
    const totalDays = Math.max(1, Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1);
    if (totalDays <= 1) {
      doAdd(tripId, 1, place);
      return;
    }
    setSheetState({
      title: 'Which day?',
      subtitle: `Add "${place.name}" to ${trip.emoji} ${trip.destination}`,
      options: Array.from({ length: totalDays }, (_, i) => ({
        label: formatDayLabel(i + 1, trip.startDate, trip.datesKnown),
        value: String(i + 1),
      })),
      onSelect: (dayStr) => {
        setSheetState(null);
        doAdd(tripId, Number(dayStr), place);
      },
    });
  }

  function doAdd(tripId: string, day: number, place: NormalizedPlace) {
    setPendingAdd({ tripId, day, place, time: '10:00', duration: 60 });
  }

  function confirmPendingAdd() {
    if (!pendingAdd) return;
    const { tripId, day, place, time, duration } = pendingAdd;
    const trip = trips.find((t) => t.id === tripId);
    addActivity(tripId, {
      title: place.name,
      day,
      time,
      type: categoryToActivityType(place.category),
      duration,
      category: place.category,
      cost: place.priceLevel != null && place.priceLevel <= 1 ? 'budget' : 'moderate',
      description: place.description ?? place.address ?? '',
    });
    setPendingAdd(null);
    showToast(`"${place.name}" added to ${trip?.emoji ?? ''} ${trip?.destination ?? 'trip'} (Day ${day})`, 'success');
  }

  // ── Viewability tracking ──

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const lastVisible = viewableItems[viewableItems.length - 1].index ?? 0;
        if (lastVisible >= cards.length - 3) {
          fetchMore();
        }
      }
    },
  ).current;

  // ── Render ──

  const renderCard = useCallback(
    ({ item }: { item: DiscoveryCard }) => (
      <DiscoveryCardView
        card={item}
        cardHeight={CARD_HEIGHT}
        onSave={() => handleSave(item)}
        onAddToTrip={() => handleAddToTrip(item)}
        onDetail={() => navigateToDetail(item)}
        isSavedPlace={isSaved(item.place.name, location?.label ?? '')}
      />
    ),
    [CARD_HEIGHT, location, isSaved, savedPlaces],
  );

  const onContainerLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== containerHeight) setContainerHeight(h);
  }, [containerHeight]);

  if (initialLoading || containerHeight === 0) {
    return (
      <View
        style={[styles.center, { backgroundColor: '#000' }]}
        onLayout={onContainerLayout}
      >
        <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" />
        <ThemedText style={[styles.loadingText, { color: 'rgba(255,255,255,0.6)' }]}>
          Finding places for you...
        </ThemedText>
      </View>
    );
  }

  if (cards.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <ThemedText style={{ fontSize: 40 }}>{'\uD83C\uDF0D'}</ThemedText>
        <ThemedText style={[styles.emptyTitle, { color: '#fff' }]}>
          No places found
        </ThemedText>
        <ThemedText style={[styles.emptySubtitle, { color: 'rgba(255,255,255,0.5)' }]}>
          Try selecting a different location
        </ThemedText>
      </View>
    );
  }

  const locationLabel = location
    ? location.type === 'current'
      ? 'Near Me'
      : location.label
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={onContainerLayout}>
      <FlatList
        data={cards}
        renderItem={renderCard}
        keyExtractor={(item) => item.place.placeId ?? item.place.name}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(_, index) => ({
          length: CARD_HEIGHT,
          offset: CARD_HEIGHT * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={fetchMore}
        onEndReachedThreshold={0.5}
        windowSize={5}
        removeClippedSubviews
        ListFooterComponent={
          loading ? (
            <View style={[styles.footer, { height: CARD_HEIGHT }]}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : null
        }
      />

      {/* Top overlay: category + location chips */}
      <View style={styles.topOverlay} pointerEvents="box-none">
        <View style={styles.categoryChip}>
          <ThemedText style={styles.categoryChipText}>For You</ThemedText>
        </View>
        {locationLabel && (
          <View style={styles.locationChip}>
            <ThemedText style={styles.locationChipText}>
              {'\uD83D\uDCCD'} {locationLabel} {'\u203A'}
            </ThemedText>
          </View>
        )}
      </View>

      {/* Settings gear */}
      <View style={styles.settingsGearWrap} pointerEvents="box-none">
        <Pressable style={styles.settingsGear}>
          <ThemedText style={styles.settingsGearIcon}>{'\u2699\uFE0F'}</ThemedText>
        </Pressable>
      </View>

      {/* Selection sheet for trip/day picker */}
      {sheetState && (
        <SelectionSheet
          visible
          title={sheetState.title}
          subtitle={sheetState.subtitle}
          options={sheetState.options}
          onSelect={sheetState.onSelect}
          onClose={() => setSheetState(null)}
        />
      )}

      {/* Time picker for pending add */}
      {pendingAdd && (
        <View style={styles.timePickerOverlay}>
          <View style={[styles.timePickerCard, { backgroundColor: '#fff' }]}>
            <ThemedText style={styles.timePickerTitle}>
              Set time for "{pendingAdd.place.name}"
            </ThemedText>
            <TimePickerButton
              value={pendingAdd.time}
              onChange={(time) => setPendingAdd((p) => p ? { ...p, time } : null)}
            />
            <View style={styles.timePickerRow}>
              <Pressable
                onPress={() => setPendingAdd(null)}
                style={[styles.timePickerBtn, { borderColor: '#E5E7EB' }]}
              >
                <ThemedText style={{ color: '#111', fontWeight: '600' }}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={confirmPendingAdd}
                style={[styles.timePickerBtn, { backgroundColor: '#111' }]}
              >
                <ThemedText style={{ color: '#fff', fontWeight: '600' }}>Add</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  card: {
    width: SCREEN_WIDTH,
    position: 'relative',
  },
  placeholderEmoji: {
    fontSize: 64,
    opacity: 0.4,
  },

  // ── Bottom content ──
  bottomContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  reasonChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  reasonText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
  },
  placeName: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    marginBottom: 4,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cityText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    fontWeight: '500',
  },
  ratingText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    fontWeight: '500',
  },
  descriptionText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },

  // ── Action buttons row ──
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionPill: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Top overlay chips ──
  topOverlay: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
  },
  categoryChip: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  categoryChipText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  locationChip: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  locationChipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Settings gear ──
  settingsGearWrap: {
    position: 'absolute',
    right: 16,
    top: '45%',
  },
  settingsGear: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  settingsGearIcon: {
    fontSize: 22,
  },

  // ── General ──
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
  },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  timePickerCard: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    gap: 16,
  },
  timePickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    textAlign: 'center',
  },
  timePickerRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  timePickerBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
